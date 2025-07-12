import {
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection } from "../common/connection";
import { secretKeyToKeypair } from "../common/utils";
import { decryptPrivateKey } from "../../backend/utils";
import { logger } from "../common/logger";
import { sellInstruction } from "./instructions";
import { getBondingCurve, getBondingCurveData, applySlippage } from "./utils";
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
import axios from "axios";

let solPriceCache = { price: 0, timestamp: 0 };
const SOL_PRICE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function getSolPrice(): Promise<number> {
  const now = Date.now();

  // Return cached price if still valid
  if (
    solPriceCache.price > 0 &&
    now - solPriceCache.timestamp < SOL_PRICE_CACHE_DURATION
  ) {
    return solPriceCache.price;
  }

  try {
    // SOL token address on Solana
    const solAddress = "So11111111111111111111111111111111111111112";

    const response = await axios.get(
      `https://public-api.birdeye.so/defi/token_overview?address=${solAddress}`,
      {
        headers: {
          accept: "application/json",
          "x-chain": "solana",
          "X-API-KEY": "e750e17792ae478983170f78486de13c",
        },
        timeout: 5000,
      }
    );

    const solPrice = response.data?.data?.price || 0;

    // Update cache
    solPriceCache = { price: solPrice, timestamp: now };

    logger.info(`[SOL Price] Fetched SOL price: $${solPrice}`);
    return solPrice;
  } catch (error) {
    logger.warn(
      `[SOL Price] Failed to fetch SOL price, using cached value: $${solPriceCache.price}`
    );
    return solPriceCache.price || 100; // Fallback to $100 if no cache
  }
}

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
  platform?: "jupiter" | "pumpswap" | "pumpfun" | "unknown";
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

    // Handle graduated tokens with Jupiter (best routing and prices)
    if (platform === "pumpswap" || (await isTokenGraduated(tokenAddress))) {
      logger.info(
        `[${logId}] Token is graduated/external, using Jupiter for optimal routing`
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
            `[${logId}] Jupiter sell successful via ${result.platform}: ${result.signature}`
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
            const estimatedSolPrice = (await getSolPrice()) || 160; // This should be fetched from a price API
            calculatedSolReceived = tokenValueInUSD / estimatedSolPrice;
          }

          return {
            success: true,
            signature: result.signature,
            platform: result.platform,
            solReceived: calculatedSolReceived,
            tokensSold: tokenAmount.toString(), // Include the token amount sold
            tokenInfo,
          };
        } else {
          logger.warn(`[${logId}] Jupiter sell failed: ${result.error}`);
        }
      } catch (jupiterError: any) {
        logger.warn(
          `[${logId}] Jupiter sell threw error: ${jupiterError.message}`
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
