import {
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  // createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { connection } from "../common/connection";
import { secretKeyToKeypair } from "../common/utils";
import { decryptPrivateKey } from "../../backend/utils";
import { logger } from "../common/logger";
import { sellInstruction } from "./instructions";
import {
  // getGlobalSetting,
  getBondingCurve,
  getBondingCurveData,
  applySlippage,
} from "./utils";
import { detectTokenPlatformWithCache } from "../../service/token-detection-service";
import { TokenInfoService } from "../../service/token-info-service";
import bs58 from "bs58";
// import { ComputeBudgetProgram } from "@solana/web3.js";
// import { sendAndConfirmTransactionWithRetry } from "../common/utils";
import {
  // getCachedPlatform,
  markTokenAsPumpFun,
  markTokenAsPumpswap,
  isTokenGraduated,
} from "../../service/token-detection-service";
import JupiterPumpswapService from "../../service/jupiter-pumpswap-service";
import { collectTransactionFee } from "../../backend/functions-main";
import { Context } from "grammy";
import { sendMessage } from "../../backend/sender";

// Helper function to collect transaction fees (non-blocking)
async function collectFeeAsync(
  privateKey: string,
  amount: number,
  type: "buy" | "sell",
  logId: string
): Promise<void> {
  try {
    const feeResult = await collectTransactionFee(privateKey, amount, type);
    if (feeResult.success) {
      logger.info(
        `[${logId}] Transaction fee collected: ${feeResult.feeAmount} SOL`
      );
    } else {
      logger.warn(
        `[${logId}] Transaction fee collection failed: ${feeResult.error}`
      );
    }
  } catch (feeError: any) {
    logger.warn(
      `[${logId}] Transaction fee collection error: ${feeError.message}`
    );
  }
}

// Helper function to get token info for enhanced messaging (non-blocking)
async function getTokenInfoAsync(
  tokenAddress: string,
  logId: string
): Promise<SimpleExternalSellResult["tokenInfo"]> {
  try {
    const tokenInfoService = TokenInfoService.getInstance();
    const tokenInfo = await tokenInfoService.getTokenInfo(tokenAddress);

    if (tokenInfo) {
      return {
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        price: tokenInfo.price,
        marketCap: tokenInfo.marketCap,
        decimals: tokenInfo.decimals,
      };
    }
  } catch (error: any) {
    logger.warn(`[${logId}] Could not fetch token info: ${error.message}`);
  }
  return undefined;
}

interface ExternalSellResult {
  success: boolean;
  successfulSells: number;
  failedSells: number;
  totalSolReceived?: number;
  error?: string;
}

// Quote sell function - calculates SOL output for token input
const quoteSell = (
  tokenAmountIn: bigint,
  virtualTokenReserves: bigint,
  virtualSolReserves: bigint,
  realTokenReserves: bigint
) => {
  if (tokenAmountIn > realTokenReserves) {
    tokenAmountIn = realTokenReserves;
  }

  const virtualTokenAmount = virtualSolReserves * virtualTokenReserves;
  const newVirtualTokenReserves = virtualTokenReserves + tokenAmountIn;
  const newVirtualSolReserves =
    virtualTokenAmount / newVirtualTokenReserves + BigInt(1);
  const solOut = virtualSolReserves - newVirtualSolReserves;

  return {
    solOut,
    newVirtualTokenReserves,
    newVirtualSolReserves,
    newRealTokenReserves: realTokenReserves - tokenAmountIn,
  };
};

export const executeExternalTokenSell = async (
  tokenAddress: string,
  buyerWallets: string[],
  sellPercent: number
): Promise<ExternalSellResult> => {
  const logIdentifier = `external-sell-${tokenAddress.substring(0, 8)}`;
  logger.info(
    `[${logIdentifier}]: Starting external token sell with ${buyerWallets.length} wallets (${sellPercent}% each)`
  );

  const start = performance.now();

  try {
    const mintPublicKey = new PublicKey(tokenAddress);
    const buyerKeypairs = buyerWallets.map((w) =>
      secretKeyToKeypair(decryptPrivateKey(w))
    );

    // Get bonding curve data for this specific token
    const { bondingCurve } = getBondingCurve(mintPublicKey);
    const bondingCurveData = await getBondingCurveData(bondingCurve);

    if (!bondingCurveData) {
      return {
        success: false,
        successfulSells: 0,
        failedSells: 0,
        error:
          "Token bonding curve not found - token may not be a PumpFun token",
      };
    }

    // Check wallet balances and prepare sell setups
    const walletBalances = [];
    for (const wallet of buyerKeypairs) {
      try {
        const ata = getAssociatedTokenAddressSync(
          mintPublicKey,
          wallet.publicKey
        );
        const balance = (await connection.getTokenAccountBalance(ata)).value
          .amount;
        if (BigInt(balance) > 0) {
          walletBalances.push({
            wallet,
            ata,
            balance: BigInt(balance),
          });
        }
      } catch (error) {
        logger.warn(
          `[${logIdentifier}]: Error checking balance for wallet ${wallet.publicKey.toBase58()}:`,
          error
        );
      }
    }

    if (walletBalances.length === 0) {
      return {
        success: false,
        successfulSells: 0,
        failedSells: 0,
        error: "No tokens found in any buyer wallets",
      };
    }

    const totalBalance = walletBalances.reduce(
      (sum, { balance }) => sum + balance,
      BigInt(0)
    );

    let tokensToSell =
      sellPercent === 100
        ? totalBalance
        : (BigInt(sellPercent) * BigInt(100) * totalBalance) / BigInt(10_000);

    const sellSetups: {
      wallet: Keypair;
      ata: PublicKey;
      amount: bigint;
    }[] = [];

    // Distribute tokens to sell across wallets
    for (const walletInfo of walletBalances) {
      if (tokensToSell <= BigInt(0)) {
        break;
      }
      if (tokensToSell <= walletInfo.balance) {
        sellSetups.push({
          wallet: walletInfo.wallet,
          ata: walletInfo.ata,
          amount: tokensToSell,
        });
        break;
      }
      tokensToSell -= walletInfo.balance;
      sellSetups.push({
        wallet: walletInfo.wallet,
        ata: walletInfo.ata,
        amount: walletInfo.balance,
      });
    }

    logger.info(
      `[${logIdentifier}]: Prepared ${sellSetups.length} sell transactions`
    );

    // Get latest blockhash
    const blockHash = await connection.getLatestBlockhash("processed");

    // Execute sells with retry logic
    const sellPromises = sellSetups.map(async (setup, index) => {
      const maxRetries = 3;
      let baseSlippage = 50; // Start with 50% slippage
      const maxSlippage = 90; // Maximum slippage cap

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const slippage = Math.min(
            baseSlippage + (attempt - 1) * 20,
            maxSlippage
          ); // Increase slippage by 20% each retry, capped at 90%

          logger.info(
            `[${logIdentifier}]: Wallet ${index + 1} - Attempt ${attempt} with ${slippage}% slippage`
          );

          // Quote the sell using current bonding curve data
          const { solOut } = quoteSell(
            setup.amount,
            bondingCurveData.virtualTokenReserves,
            bondingCurveData.virtualSolReserves,
            bondingCurveData.realTokenReserves
          );

          const solOutWithSlippage = applySlippage(solOut, slippage);

          // Create sell instruction
          const sellIx = sellInstruction(
            mintPublicKey,
            new PublicKey(bondingCurveData.creator),
            setup.wallet.publicKey,
            setup.amount,
            solOutWithSlippage
          );

          // Create and send transaction
          const sellTx = new VersionedTransaction(
            new TransactionMessage({
              instructions: [sellIx],
              payerKey: setup.wallet.publicKey,
              recentBlockhash: blockHash.blockhash,
            }).compileToV0Message()
          );

          sellTx.sign([setup.wallet]);

          const signature = await connection.sendTransaction(sellTx, {
            skipPreflight: false,
            preflightCommitment: "processed",
          });

          // Wait for confirmation
          const confirmation = await connection.confirmTransaction(
            {
              signature,
              blockhash: blockHash.blockhash,
              lastValidBlockHeight: blockHash.lastValidBlockHeight,
            },
            "confirmed"
          );

          if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`);
          }

          const solReceived = Number(solOut) / LAMPORTS_PER_SOL;
          logger.info(
            `[${logIdentifier}]: Wallet ${index + 1} sell successful - ${solReceived.toFixed(6)} SOL received`
          );

          return {
            success: true,
            solReceived,
            signature,
            wallet: setup.wallet.publicKey.toBase58(),
          };
        } catch (error: any) {
          logger.warn(
            `[${logIdentifier}]: Wallet ${index + 1} - Attempt ${attempt} failed:`,
            error.message
          );

          if (attempt === maxRetries) {
            return {
              success: false,
              error: error.message,
              wallet: setup.wallet.publicKey.toBase58(),
            };
          }

          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }

      return {
        success: false,
        error: "Max retries exceeded",
        wallet: setup.wallet.publicKey.toBase58(),
      };
    });

    // Wait for all sells to complete
    const results = await Promise.all(sellPromises);

    const successfulSells = results.filter((r) => r.success).length;
    const failedSells = results.filter((r) => !r.success).length;
    const totalSolReceived = results
      .filter((r) => r.success)
      .reduce((sum, r) => sum + (r.solReceived || 0), 0);

    const end = performance.now();
    logger.info(
      `[${logIdentifier}]: External sell completed in ${(end - start).toFixed(2)}ms`,
      {
        successfulSells,
        failedSells,
        totalSolReceived: totalSolReceived.toFixed(6),
      }
    );

    return {
      success: successfulSells > 0,
      successfulSells,
      failedSells,
      totalSolReceived,
    };
  } catch (error: any) {
    logger.error(`[${logIdentifier}]: External sell failed:`, error);
    return {
      success: false,
      successfulSells: 0,
      failedSells: buyerWallets.length,
      error: error.message,
    };
  }
};

export interface SimpleExternalSellResult {
  success: boolean;
  signature?: string;
  error?: string;
  platform?:
    | "jupiter"
    | "pumpswap"
    | "pumpfun"
    | "cpmm"
    | "bonk"
    | "unknown"
    | "meteora"
    | "heaven";
  solReceived?: string;
  tokensSold?: string;
  tokenInfo?: {
    name?: string;
    symbol?: string;
    price?: number;
    marketCap?: number;
    decimals?: number;
  };
}

/**
 * Execute native PumpFun sell with keypair directly (no encryption/decryption)
 * Used for external sells where we already have the keypair
 */
async function executeNativePumpFunSell(
  tokenAddress: string,
  sellerKeypair: Keypair,
  tokenAmount: number,
  ctx: Context
): Promise<SimpleExternalSellResult> {
  const logIdentifier = `native-pumpfun-sell-${tokenAddress.substring(0, 8)}`;
  logger.info(
    `[${logIdentifier}]: Starting native PumpFun sell for ${tokenAmount} tokens`
  );

  const start = performance.now();

  try {
    const mintPublicKey = new PublicKey(tokenAddress);

    // Get bonding curve data for this specific token
    const { bondingCurve } = getBondingCurve(mintPublicKey);
    const bondingCurveData = await getBondingCurveData(bondingCurve);

    if (!bondingCurveData) {
      return {
        success: false,
        error:
          "Token bonding curve not found - token may not be a PumpFun token",
        platform: "pumpfun",
      };
    }

    // Check token balance
    const ata = getAssociatedTokenAddressSync(
      mintPublicKey,
      sellerKeypair.publicKey
    );
    let balance: bigint;

    try {
      const balanceInfo = await connection.getTokenAccountBalance(ata);
      balance = BigInt(balanceInfo.value.amount);
    } catch (error) {
      return {
        success: false,
        error: "No token account found or no tokens to sell",
        platform: "pumpfun",
      };
    }

    if (balance <= BigInt(0)) {
      return {
        success: false,
        error: "No tokens found in wallet",
        platform: "pumpfun",
      };
    }

    // Use the specified token amount or full balance if amount exceeds balance
    const tokensToSell =
      BigInt(tokenAmount) > balance ? balance : BigInt(tokenAmount);

    logger.info(
      `[${logIdentifier}]: Selling ${tokensToSell} tokens (balance: ${balance})`
    );

    // Get latest blockhash
    const blockHash = await connection.getLatestBlockhash("processed");

    // Execute sell with retry logic
    const maxRetries = 3;
    let baseSlippage = 50; // Start with 50% slippage
    const maxSlippage = 90; // Maximum slippage cap

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const slippage = Math.min(
          baseSlippage + (attempt - 1) * 20,
          maxSlippage
        );

        logger.info(
          `[${logIdentifier}]: Attempt ${attempt} with ${slippage}% slippage`
        );

        // Quote the sell using current bonding curve data
        const { solOut } = quoteSell(
          tokensToSell,
          bondingCurveData.virtualTokenReserves,
          bondingCurveData.virtualSolReserves,
          bondingCurveData.realTokenReserves
        );

        const solOutWithSlippage = applySlippage(solOut, slippage);

        // Create sell instruction
        const sellIx = sellInstruction(
          mintPublicKey,
          new PublicKey(bondingCurveData.creator),
          sellerKeypair.publicKey,
          tokensToSell,
          solOutWithSlippage
        );

        // Create and send transaction
        const sellTx = new VersionedTransaction(
          new TransactionMessage({
            instructions: [sellIx],
            payerKey: sellerKeypair.publicKey,
            recentBlockhash: blockHash.blockhash,
          }).compileToV0Message()
        );

        sellTx.sign([sellerKeypair]);

        // Only send message if ctx and ctx.chat are available
        if (ctx && ctx.chat) {
          try {
            await sendMessage(
              ctx,
              `🚀 Sell transaction sent! Processing ${tokensToSell} tokens with ${slippage}% slippage...`,
              {
                parse_mode: "HTML",
              }
            );
          } catch (msgError) {
            logger.warn(
              `[${logIdentifier}] Failed to send status message: ${msgError}`
            );
          }
        }

        const signature = await connection.sendTransaction(sellTx, {
          skipPreflight: false,
          preflightCommitment: "processed",
        });

        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(
          {
            signature,
            blockhash: blockHash.blockhash,
            lastValidBlockHeight: blockHash.lastValidBlockHeight,
          },
          "confirmed"
        );

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${confirmation.value.err}`);
        }

        const solReceived = Number(solOut) / LAMPORTS_PER_SOL;
        const end = performance.now();

        logger.info(
          `[${logIdentifier}]: Native PumpFun sell successful in ${(end - start).toFixed(2)}ms - ${solReceived.toFixed(6)} SOL received`
        );

        // Collect transaction fee after successful sell (non-blocking)
        await collectFeeAsync(
          bs58.encode(sellerKeypair.secretKey),
          solReceived,
          "sell",
          logIdentifier
        );

        return {
          success: true,
          signature,
          platform: "pumpfun",
          solReceived: solReceived.toFixed(6),
          tokensSold: tokenAmount.toString(), // Include the token amount sold
        };
      } catch (error: any) {
        logger.warn(
          `[${logIdentifier}]: Attempt ${attempt} failed:`,
          error.message
        );

        if (attempt === maxRetries) {
          return {
            success: false,
            error: error.message,
            platform: "pumpfun",
          };
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }

    return {
      success: false,
      error: "Max retries exceeded",
      platform: "pumpfun",
    };
  } catch (error: any) {
    logger.error(`[${logIdentifier}]: Native PumpFun sell failed:`, error);
    return {
      success: false,
      error: error.message,
      platform: "pumpfun",
    };
  }
}

/**
 * Execute external token sell with proper platform detection
 * - PumpFun tokens: Use native PumpFun bonding curve
 * - Graduated tokens: Use Jupiter for optimal routing
 * - PumpSwap tokens: Use PumpSwap directly
 */
export async function executeExternalSell(
  tokenAddress: string,
  sellerKeypair: Keypair,
  tokenAmount: number,
  ctx: Context
): Promise<SimpleExternalSellResult> {
  const logId = `external-sell-${tokenAddress.substring(0, 8)}`;
  logger.info(
    `[${logId}] Starting external sell for ${tokenAmount} tokens with platform detection`
  );

  try {
    // First, detect the token platform and get token info
    const [platform, tokenInfo] = await Promise.all([
      detectTokenPlatformWithCache(tokenAddress),
      getTokenInfoAsync(tokenAddress, logId),
    ]);
    logger.info(`[${logId}] Detected platform: ${platform}`);

    // Handle PumpFun tokens with native bonding curve
    if (platform === "pumpfun") {
      logger.info(`[${logId}] Using native PumpFun bonding curve for sell`);

      try {
        // Use the dedicated native PumpFun sell function with keypair directly
        const result = await executeNativePumpFunSell(
          tokenAddress,
          sellerKeypair,
          tokenAmount,
          ctx
        );

        if (result.success) {
          // Only send message if ctx and ctx.chat are available
          if (ctx && ctx.chat) {
            try {
              await sendMessage(
                ctx,
                "✅ Sell transaction confirmed! Processing details...",
                {
                  parse_mode: "HTML",
                }
              );
            } catch (msgError) {
              logger.warn(
                `[${logId}] Failed to send status message: ${msgError}`
              );
            }
          }
          logger.info(
            `[${logId}] Native PumpFun sell successful: ${result.signature}`
          );
          markTokenAsPumpFun(tokenAddress);

          // Note: Fee collection already handled in executeNativePumpFunSell
          return {
            ...result,
            tokenInfo,
          };
        } else {
          logger.warn(`[${logId}] Native PumpFun sell failed: ${result.error}`);
        }
      } catch (pumpfunError: any) {
        logger.warn(
          `[${logId}] Native PumpFun sell threw error: ${pumpfunError.message}`
        );
      }
    }

    // Handle Bonk tokens with native Bonk sell method
    if (platform === "bonk") {
      logger.info(`[${logId}] Using native Bonk sell method`);

      try {
        // Use the dedicated Bonk sell function
        const { executeBonkSell } = await import(
          "../../service/bonk-transaction-handler"
        );

        // Calculate the percentage based on the tokenAmount vs total balance
        const { getTokenBalance } = await import("../../backend/utils");
        const totalBalance = await getTokenBalance(
          tokenAddress,
          sellerKeypair.publicKey.toBase58()
        );
        const sellPercentage =
          totalBalance > 0
            ? Math.round((tokenAmount / totalBalance) * 100)
            : 100;

        logger.info(
          `[${logId}] Selling ${tokenAmount} tokens (${sellPercentage}% of ${totalBalance} total balance)`
        );

        const bonkResult = await executeBonkSell(
          sellPercentage,
          bs58.encode(sellerKeypair.secretKey),
          tokenAddress,
          tokenAmount
        );

        if (bonkResult.success && bonkResult.signature) {
          // Only send message if ctx and ctx.chat are available
          if (ctx && ctx.chat) {
            try {
              await sendMessage(
                ctx,
                "✅ Sell transaction confirmed! Processing details...",
                {
                  parse_mode: "HTML",
                }
              );
            } catch (msgError) {
              logger.warn(
                `[${logId}] Failed to send status message: ${msgError}`
              );
            }
          }
          logger.info(
            `[${logId}] Bonk sell successful: ${bonkResult.signature}`
          );

          // Get actual SOL received from Bonk result or parse from transaction
          let actualSolReceived = bonkResult.actualSolReceived || 0;

          // If Bonk doesn't provide the amount, try to parse it from the transaction
          if (actualSolReceived === 0) {
            try {
              const { parseTransactionAmounts } = await import(
                "../../backend/utils"
              );
              const actualAmounts = await parseTransactionAmounts(
                bonkResult.signature || "",
                sellerKeypair.publicKey.toBase58(),
                tokenAddress,
                "sell"
              );

              if (actualAmounts.success && actualAmounts.actualSolReceived) {
                actualSolReceived = actualAmounts.actualSolReceived;
                logger.info(
                  `[${logId}] Actual SOL received from blockchain: ${actualSolReceived} SOL`
                );
              } else {
                logger.warn(
                  `[${logId}] Failed to parse actual amounts from transaction: ${actualAmounts.error}`
                );
                // Use a more realistic estimate based on token amount and price
                if (tokenInfo?.price && tokenInfo.price > 0) {
                  const tokenValueInUSD =
                    (tokenAmount / Math.pow(10, tokenInfo.decimals || 6)) *
                    tokenInfo.price;
                  const estimatedSolPrice = 170; // Rough SOL price estimate
                  actualSolReceived = tokenValueInUSD / estimatedSolPrice;
                  logger.info(
                    `[${logId}] Using price-based estimate: ${actualSolReceived} SOL`
                  );
                } else {
                  actualSolReceived = 0.01; // Final fallback
                  logger.warn(
                    `[${logId}] Using fallback estimate: ${actualSolReceived} SOL`
                  );
                }
              }
            } catch (parseError: any) {
              logger.warn(
                `[${logId}] Error parsing transaction amounts: ${parseError.message}`
              );
              actualSolReceived = 0.01; // Fallback estimate
            }
          }

          // Collect transaction fee after successful sell (non-blocking)
          await collectFeeAsync(
            bs58.encode(sellerKeypair.secretKey),
            actualSolReceived,
            "sell",
            logId
          );

          return {
            success: true,
            signature: bonkResult.signature,
            platform: "bonk",
            solReceived: actualSolReceived.toString(),
            tokensSold: tokenAmount.toString(),
            tokenInfo: tokenInfo || undefined,
          };
        } else {
          logger.warn(
            `[${logId}] Bonk sell failed: ${bonkResult.error || bonkResult.message}`
          );
        }
      } catch (bonkError: any) {
        logger.warn(`[${logId}] Bonk sell threw error: ${bonkError.message}`);
      }
    }

    // Handle Meteora tokens with universal auto-sell service
    if (platform === "meteora") {
      logger.info(`[${logId}] Using universal Meteora service for sell`);

      try {
        const { executeMeteoraSell } = await import(
          "../../service/meteora/meteora-sell-service"
        );

        const result = await executeMeteoraSell(
          tokenAddress,
          bs58.encode(sellerKeypair.secretKey),
          tokenAmount
        );

        if (result.success && result.signature) {
          logger.info(
            `[${logId}] Universal Meteora ${result.tokenType} sell successful: ${result.signature}`
          );

          // Collect transaction fee after successful sell (non-blocking)
          await collectFeeAsync(
            bs58.encode(sellerKeypair.secretKey),
            0.01, // Estimate for sell
            "sell",
            logId
          );

          return {
            success: true,
            signature: result.signature,
            platform: "meteora",
            solReceived: "unknown",
            tokensSold: tokenAmount.toString(),
          };
        } else {
          throw new Error(result.error || "Meteora sell failed");
        }
      } catch (meteoraError: any) {
        logger.error(
          `[${logId}] Universal Meteora sell failed: ${meteoraError.message}`
        );
        throw new Error(`
❌ Meteora Sell Failed
Unable to complete sale on Meteora

${meteoraError.message}`);
      }
    }

    // Handle Heaven DEX tokens with native Heaven service
    if (platform === "heaven") {
      logger.info(`[${logId}] Using native Heaven DEX service for sell`);

      try {
        const { executeHeavenSell } = await import(
          "../../service/heaven/heaven-service"
        );

        const result = await executeHeavenSell(
          tokenAddress,
          bs58.encode(sellerKeypair.secretKey),
          BigInt(tokenAmount)
        );

        if (result.success && result.signature) {
          logger.info(
            `[${logId}] Universal Heaven DEX sell successful: ${result.signature}`
          );

          // Collect transaction fee after successful sell (non-blocking)
          await collectFeeAsync(
            bs58.encode(sellerKeypair.secretKey),
            0.01, // Estimate for sell
            "sell",
            logId
          );

          return {
            success: true,
            signature: result.signature,
            platform: "heaven",
            solReceived: "unknown",
            tokensSold: tokenAmount.toString(),
          };
        } else {
          throw new Error(result.error || "Heaven DEX sell failed");
        }
      } catch (heavenError: any) {
        logger.error(
          `[${logId}] Universal Heaven DEX sell failed: ${heavenError.message}`
        );
        throw new Error(`
❌ Heaven DEX Sell Failed
Unable to complete sale on Heaven DEX

${heavenError.message}`);
      }
    }

    // Handle graduated tokens with optimized platform priority: PumpSwap/CPMM first, Jupiter fallback
    if (
      platform === "pumpswap" ||
      platform === "cpmm" ||
      (await isTokenGraduated(tokenAddress))
    ) {
      logger.info(
        `[${logId}] Token is graduated/external (${platform}), using optimized platform priority: PumpSwap/CPMM first, Jupiter fallback`
      );

      // Try PumpSwap first for graduated tokens
      if (platform === "pumpswap" || platform === "unknown") {
        logger.info(`[${logId}] Trying PumpSwap first for graduated token`);
        try {
          const pumpswapResult = await executePumpswapSell(
            tokenAddress,
            sellerKeypair,
            tokenAmount
          );

          if (pumpswapResult.success) {
            logger.info(
              `[${logId}] PumpSwap sell successful: ${pumpswapResult.signature}`
            );
            markTokenAsPumpswap(tokenAddress);

            // Collect transaction fee after successful sell (non-blocking)
            const solAmount = pumpswapResult.solReceived
              ? parseFloat(pumpswapResult.solReceived)
              : 0.01; // Fallback estimate
            await collectFeeAsync(
              bs58.encode(sellerKeypair.secretKey),
              solAmount,
              "sell",
              logId
            );

            return {
              ...pumpswapResult,
              tokenInfo,
            };
          } else {
            logger.warn(
              `[${logId}] PumpSwap sell failed: ${pumpswapResult.error}`
            );
          }
        } catch (pumpswapError: any) {
          logger.warn(
            `[${logId}] PumpSwap sell threw error: ${pumpswapError.message}`
          );
        }
      }

      // Try CPMM second for graduated tokens
      if (platform === "cpmm" || platform === "unknown") {
        logger.info(`[${logId}] Trying CPMM for graduated token`);
        try {
          const RaydiumCpmmService = (
            await import("../../service/raydium-cpmm-service")
          ).default;
          const cpmmService = new RaydiumCpmmService();

          const cpmmResult = await cpmmService.sellWithFeeCollection({
            mint: tokenAddress,
            privateKey: bs58.encode(sellerKeypair.secretKey),
            amount_in: BigInt(tokenAmount),
          });

          if (cpmmResult.success) {
            logger.info(
              `[${logId}] CPMM sell successful: ${cpmmResult.signature}`
            );

            // Only send message if ctx and ctx.chat are available
            if (ctx && ctx.chat) {
              try {
                await sendMessage(
                  ctx,
                  "✅ Sell transaction confirmed! Processing details...",
                  {
                    parse_mode: "HTML",
                  }
                );
              } catch (msgError) {
                logger.warn(
                  `[${logId}] Failed to send status message: ${msgError}`
                );
              }
            }

            return {
              success: true,
              signature: cpmmResult.signature,
              platform: "cpmm",
              solReceived: cpmmResult.actualTransactionAmountSol.toString(),
              tokensSold: tokenAmount.toString(),
              tokenInfo,
            };
          } else {
            logger.warn(`[${logId}] CPMM sell failed`);
          }
        } catch (cpmmError: any) {
          logger.warn(`[${logId}] CPMM sell threw error: ${cpmmError.message}`);
        }
      }

      // Jupiter as final fallback for graduated tokens
      logger.info(
        `[${logId}] PumpSwap/CPMM failed, trying Jupiter as fallback`
      );
      try {
        const jupiterService = new JupiterPumpswapService();
        const result = await jupiterService.executeSell(
          tokenAddress,
          sellerKeypair,
          tokenAmount,
          ctx
        );

        if (result.success) {
          // Only send message if ctx and ctx.chat are available
          if (ctx && ctx.chat) {
            try {
              await sendMessage(
                ctx,
                "✅ Sell transaction confirmed! Processing details...",
                {
                  parse_mode: "HTML",
                }
              );
            } catch (msgError) {
              logger.warn(
                `[${logId}] Failed to send status message: ${msgError}`
              );
            }
          }
          logger.info(
            `[${logId}] Jupiter fallback sell successful via ${result.platform}: ${result.signature}`
          );

          // Collect transaction fee after successful sell (non-blocking)
          const solAmount = result.solReceived
            ? parseFloat(result.solReceived)
            : 0.01; // Fallback estimate
          await collectFeeAsync(
            bs58.encode(sellerKeypair.secretKey),
            solAmount,
            "sell",
            logId
          );

          // Calculate SOL received based on token amount and prices
          let calculatedSolReceived = solAmount;
          if (tokenInfo?.price && tokenInfo.price > 0) {
            const tokenValueInUSD =
              (tokenAmount / Math.pow(10, tokenInfo.decimals || 6)) *
              tokenInfo.price;
            // Assuming SOL price is around $100-200, we need to get actual SOL price
            // For now, using a rough estimation - ideally get SOL price from price API
            const estimatedSolPrice = 170; // This should be fetched from a price API
            calculatedSolReceived = tokenValueInUSD / estimatedSolPrice;
          }

          return {
            success: true,
            signature: result.signature,
            platform: result.platform,
            solReceived: calculatedSolReceived.toString(),
            tokensSold: tokenAmount.toString(), // Include the token amount sold
            tokenInfo,
          };
        } else {
          logger.warn(
            `[${logId}] Jupiter fallback sell failed: ${result.error}`
          );
        }
      } catch (jupiterError: any) {
        logger.warn(
          `[${logId}] Jupiter fallback sell threw error: ${jupiterError.message}`
        );
      }
    }

    // Final fallback: Try PumpSwap directly
    logger.info(`[${logId}] Trying PumpSwap as final fallback`);
    try {
      const pumpswapResult = await executePumpswapSell(
        tokenAddress,
        sellerKeypair,
        tokenAmount
      );

      if (pumpswapResult.success) {
        logger.info(
          `[${logId}] PumpSwap fallback sell successful: ${pumpswapResult.signature}`
        );
        markTokenAsPumpswap(tokenAddress);

        // Collect transaction fee after successful sell (non-blocking)
        const solAmount = pumpswapResult.solReceived
          ? parseFloat(pumpswapResult.solReceived)
          : 0.01; // Fallback estimate
        await collectFeeAsync(
          bs58.encode(sellerKeypair.secretKey),
          solAmount,
          "sell",
          logId
        );

        return {
          ...pumpswapResult,
          tokensSold: tokenAmount.toString(), // Include the token amount sold
          tokenInfo,
        };
      } else {
        logger.error(
          `[${logId}] PumpSwap fallback failed: ${pumpswapResult.error}`
        );
      }
    } catch (pumpswapError: any) {
      logger.error(
        `[${logId}] PumpSwap fallback failed: ${pumpswapError.message}`
      );
    }

    return {
      success: false,
      signature: "",
      platform: "unknown",
      error: "All sell methods failed",
    };
  } catch (error: any) {
    logger.error(`[${logId}] External sell failed with error:`, error);
    return {
      success: false,
      signature: "",
      platform: "unknown",
      error: `External sell error: ${error.message}`,
    };
  }
}

// Legacy functions kept for backward compatibility - now use Jupiter internally
async function executePumpswapSell(
  tokenAddress: string,
  sellerKeypair: Keypair,
  tokenAmount: number
): Promise<SimpleExternalSellResult> {
  const logId = `legacy-pumpswap-sell-${tokenAddress.substring(0, 8)}`;
  logger.info(
    `[${logId}] Legacy PumpSwap sell called - redirecting to Jupiter service`
  );

  try {
    const jupiterService = new JupiterPumpswapService();
    const result = await jupiterService.executeSell(
      tokenAddress,
      sellerKeypair,
      tokenAmount
    );

    return {
      success: result.success,
      signature: result.signature,
      error: result.error,
      platform: result.platform,
      solReceived:
        result.solReceived || (result.success ? "Success" : undefined),
    };
  } catch (error: any) {
    logger.error(`[${logId}] Legacy PumpSwap sell error:`, error);
    return {
      success: false,
      signature: "",
      error: error.message,
      platform: "unknown",
    };
  }
}
