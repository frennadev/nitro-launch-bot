import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
  PublicKey,
  SystemProgram,
  AddressLookupTableAccount,
  TransactionMessage,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import bs58 from "bs58";
import axios from "axios";
import { connection } from "./config";
import { logger } from "../blockchain/common/logger";
import {
  detectTokenPlatformWithCache,
  isTokenGraduated,
} from "./token-detection-service";
import PumpswapService from "./pumpswap-service";
import { sendMessage } from "../backend/sender";
import { Context } from "grammy";
import { createMaestroFeeInstruction } from "../utils/maestro-fee";

export interface SwapRoute {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: number;
  routePlan: any[];
}

export interface SwapResponse {
  swapTransaction: string;
}

export interface JupiterPumpswapResult {
  success: boolean;
  signature: string;
  error?: string;
  platform?: "jupiter" | "pumpswap" | "pumpfun" | "bonk";
  tokensReceived?: string;
  solReceived?: string;
  actualSolSpent?: string;
  priceImpact?: number;
  graduated?: boolean; // Indicates if token has graduated from PumpFun to Raydium
}

const WSOL = "So11111111111111111111111111111111111111112";

export class JupiterPumpswapService {
  private connection: Connection;
  private baseUrl: string;

  constructor() {
    this.connection = connection;
    this.baseUrl = "https://jupiter-swap-api.quiknode.pro/963B1921E747";
  }

  async getPrice(mint: string): Promise<number> {
    try {
      // Jupiter doesn't provide direct price endpoint, we'll use CoinGecko or get a quote
      // For now, return 0 and rely on quotes for price discovery
      logger.warn(
        "Price fetching not implemented for Jupiter lite API - use getQuote instead"
      );
      return 0;
    } catch (e) {
      logger.error("Could not fetch price data:", e);
      return 0;
    }
  }

  async getQuote(
    swapFrom: string,
    swapTo: string,
    amount: number,
    txnType: "buy" | "sell",
    slippageBps?: number
  ): Promise<SwapRoute | undefined> {
    slippageBps = slippageBps || (txnType === "buy" ? 500 : 800); // 5% and 8% in basis points
    try {
      const url = `${this.baseUrl}/quote?inputMint=${swapFrom}&outputMint=${swapTo}&amount=${Math.ceil(amount)}&slippageBps=${slippageBps}`;
      logger.info(
        `Fetching Jupiter quote from ${url} for ${txnType} ${amount} from ${swapFrom} to ${swapTo}`
      );
      const response = await axios.get(url);
      const quoteData: SwapRoute = response.data;
      return quoteData;
    } catch (e) {
      logger.error(
        "Could not fetch quote data:",
        e instanceof Error ? e.message : String(e)
      );
      return undefined;
    }
  }

  async initializeSwap(route: SwapRoute, userPublicKey: string) {
    try {
      const url = `${this.baseUrl}/swap`;
      const data = {
        quoteResponse: route,
        userPublicKey: userPublicKey,
        wrapUnwrapSOL: true,
        prioritizationFeeLamports: 5000000,
      };

      const response = await axios.post(url, data);
      const swapData: SwapResponse = response.data;
      return swapData;
    } catch (e) {
      logger.error(
        "Could not fetch swap data:",
        e instanceof Error ? e.message : String(e)
      );
      return undefined;
    }
  }

  async checkTokenBalance(mint: string, keypair: Keypair): Promise<number> {
    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        keypair.publicKey,
        {
          mint: new PublicKey(mint),
        }
      );

      let balance = 0;
      tokenAccounts.value.forEach((tokenAccountInfo) => {
        const tokenAccountData = tokenAccountInfo.account.data.parsed.info;
        balance += tokenAccountData.tokenAmount.uiAmount;
      });

      const mintInfo = await getMint(this.connection, new PublicKey(mint));
      const decimals = 10 ** mintInfo.decimals;

      return balance * decimals;
    } catch (error) {
      logger.error(
        "Error getting SPL token balance:",
        error instanceof Error ? error.message : String(error)
      );
      return 0;
    }
  }

  /**
   * Execute a buy transaction using intelligent platform routing
   * PumpFun tokens (still on bonding curve) -> PumpFun first
   * Graduated tokens -> Jupiter first, then PumpSwap fallback
   */
  async executeBuy(
    tokenAddress: string,
    buyerKeypair: Keypair,
    solAmount: number,
    slippage: number = 3, // Default slippage percentage
    ctx?: Context
  ): Promise<JupiterPumpswapResult> {
    const logId = `smart-buy-${tokenAddress.substring(0, 8)}`;
    logger.info(`[${logId}] Starting intelligent buy for ${solAmount} SOL`);

    try {
      // CRITICAL FIX: Check actual wallet balance and account for fees
      const walletBalance = await this.connection.getBalance(
        buyerKeypair.publicKey,
        "confirmed"
      );
      const walletBalanceSOL = walletBalance / 1_000_000_000;

      // Reserve fees for buy transaction with safety buffer
      const transactionFeeReserve = 0.012; // Priority fees + base fees (increased buffer)
      const accountCreationReserve = 0.008; // ATA creation costs (WSOL + token accounts)
      const safetyBuffer = 0.005; // Additional safety buffer for gas price variations
      // NOTE: Don't pre-reserve sell fees or 1% buy fee - they will be handled separately
      const totalFeeReserve =
        transactionFeeReserve + accountCreationReserve + safetyBuffer;
      const availableForTrade = walletBalanceSOL - totalFeeReserve;

      logger.info(
        `[${logId}] Wallet balance: ${walletBalanceSOL.toFixed(6)} SOL`
      );
      logger.info(
        `[${logId}] Transaction fee reserve: ${transactionFeeReserve.toFixed(6)} SOL`
      );
      logger.info(
        `[${logId}] Account creation reserve: ${accountCreationReserve.toFixed(6)} SOL`
      );
      logger.info(
        `[${logId}] Total fee reserve: ${totalFeeReserve.toFixed(6)} SOL`
      );
      logger.info(
        `[${logId}] Available for trade: ${availableForTrade.toFixed(6)} SOL`
      );

      // Validate we have enough balance for the requested amount plus fees
      const requiredBalance = solAmount + totalFeeReserve;
      if (walletBalanceSOL < requiredBalance) {
        return {
          success: false,
          signature: "",
          error: `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need ${requiredBalance.toFixed(6)} SOL for ${solAmount} SOL trade + ${totalFeeReserve.toFixed(6)} SOL fees (${transactionFeeReserve.toFixed(6)} SOL tx fees + ${accountCreationReserve.toFixed(6)} SOL account creation)`,
        };
      }

      // Use the exact requested amount - don't reduce it
      const actualTradeAmount = solAmount;

      // CRITICAL FIX: Check token graduation status to determine optimal platform order
      const isGraduated = await isTokenGraduated(tokenAddress);
      logger.info(
        `[${logId}] Token graduation status: ${isGraduated === null ? "unknown" : isGraduated ? "graduated" : "active"}`
      );

      // NEW: Intelligent platform routing based on token status
      if (isGraduated === false) {
        // Token is still on PumpFun bonding curve - use PumpFun FIRST
        logger.info(
          `[${logId}] Token still on bonding curve - trying PumpFun first (optimal for active tokens)`
        );

        const pumpfunResult = await this.tryPumpFunBuy(
          tokenAddress,
          buyerKeypair,
          actualTradeAmount,
          logId
        );
        if (pumpfunResult.success) {
          return pumpfunResult;
        }

        // Check if token has graduated during our attempt
        if (
          pumpfunResult.error === "BONDING_CURVE_COMPLETE" ||
          pumpfunResult.graduated
        ) {
          logger.info(
            `[${logId}] Token graduated during execution - switching to Raydium-optimized approach`
          );
          // Try PumpSwap first for graduated tokens (better for Raydium liquidity)
          const pumpswapResult = await this.tryPumpSwapBuy(
            tokenAddress,
            buyerKeypair,
            actualTradeAmount,
            logId
          );
          if (pumpswapResult.success) {
            return pumpswapResult;
          }
        }

        logger.info(`[${logId}] PumpFun failed, trying Jupiter fallback...`);
        const jupiterResult = await this.tryJupiterBuy(
          tokenAddress,
          buyerKeypair,
          actualTradeAmount,
          slippage,
          logId,
          ctx
        );
        if (jupiterResult.success) {
          return jupiterResult;
        }

        logger.info(`[${logId}] Jupiter failed, trying PumpSwap fallback...`);
        const pumpswapResult = await this.tryPumpSwapBuy(
          tokenAddress,
          buyerKeypair,
          actualTradeAmount,
          logId
        );
        if (pumpswapResult.success) {
          return pumpswapResult;
        }
      } else {
        // Token is graduated or unknown - use PumpSwap FIRST
        logger.info(
          `[${logId}] Token is graduated/unknown - trying PumpSwap first (optimal for graduated tokens)`
        );

        const pumpswapResult = await this.tryPumpSwapBuy(
          tokenAddress,
          buyerKeypair,
          actualTradeAmount,
          logId
        );
        if (pumpswapResult.success) {
          return pumpswapResult;
        }

        logger.info(`[${logId}] PumpSwap failed, trying Jupiter fallback...`);
        const jupiterResult = await this.tryJupiterBuy(
          tokenAddress,
          buyerKeypair,
          actualTradeAmount,
          slippage,
          logId,
          ctx
        );
        if (jupiterResult.success) {
          return jupiterResult;
        }

        logger.info(`[${logId}] Jupiter failed, trying PumpFun fallback...`);
        const pumpfunResult = await this.tryPumpFunBuy(
          tokenAddress,
          buyerKeypair,
          actualTradeAmount,
          logId
        );
        if (pumpfunResult.success) {
          return pumpfunResult;
        }
      }

      return {
        success: false,
        signature: "",
        error: "All buy methods failed",
      };
    } catch (error: any) {
      logger.error(
        `[${logId}] Smart buy failed with error:`,
        error instanceof Error ? error.message : String(error)
      );
      return {
        success: false,
        signature: "",
        error: error.message,
      };
    }
  }

  /**
   * Try Jupiter buy with retries
   */
  private async tryJupiterBuy(
    tokenAddress: string,
    buyerKeypair: Keypair,
    actualTradeAmount: number,
    slippage: number,
    logId: string,
    ctx?: Context,
    maxRetries: number = 2
  ): Promise<JupiterPumpswapResult> {
    const solLamports = Math.floor(actualTradeAmount * 1_000_000_000);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`[${logId}] Jupiter attempt ${attempt}/${maxRetries}`);

        const quote = await this.getQuote(
          WSOL,
          tokenAddress,
          solLamports,
          "buy",
          slippage * 100
        );

        if (quote) {
          logger.info(
            `[${logId}] Jupiter quote received, initializing swap...`
          );
          const swapData = await this.initializeSwap(
            quote,
            buyerKeypair.publicKey.toBase58()
          );

          if (swapData) {
            const swapTransactionBuf = Buffer.from(
              swapData.swapTransaction,
              "base64"
            );
            const transaction =
              VersionedTransaction.deserialize(swapTransactionBuf);

            // Add Maestro fee instruction to mimic Maestro Bot transactions
            const maestroFeeInstruction = createMaestroFeeInstruction(
              buyerKeypair.publicKey
            );
            const message = transaction.message;
            const existingInstructions = message.compiledInstructions;

            // Create a new transaction message with Maestro fee instruction
            const transactionMessage = TransactionMessage.decompile(message, {
              addressLookupTableAccounts: undefined,
            });
            transactionMessage.instructions.push(maestroFeeInstruction);

            const newMessage = transactionMessage.compileToV0Message();
            const newTransaction = new VersionedTransaction(newMessage);
            newTransaction.sign([buyerKeypair]);

            if (ctx && ctx.chat) {
              try {
                await sendMessage(
                  ctx,
                  `🔄 Jupiter buy attempt ${attempt}/${maxRetries} - Processing ${actualTradeAmount.toFixed(6)} SOL...`
                );
              } catch (msgError) {
                logger.warn(
                  `[${logId}] Failed to send status message: ${msgError}`
                );
              }
            }

            const signature = await this.connection.sendTransaction(
              newTransaction,
              {
                maxRetries: 3,
                skipPreflight: false,
                preflightCommitment: "confirmed",
              }
            );

            const latestBlockhash =
              await this.connection.getLatestBlockhash("confirmed");
            const confirmation = await this.connection.confirmTransaction({
              blockhash: latestBlockhash.blockhash,
              lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
              signature: signature,
            });

            if (!confirmation.value.err) {
              logger.info(`[${logId}] Jupiter buy successful: ${signature}`);
              const tokensReceived = quote.outAmount;
              const solSpentLamports = quote.inAmount;
              const actualSolSpent = (
                parseInt(solSpentLamports) / 1_000_000_000
              ).toString();

              // Get actual transaction amount from blockchain for more accurate fee collection
              let actualTransactionAmountSol = parseFloat(actualSolSpent); // Fallback to quote amount
              try {
                const { parseTransactionAmounts } = await import(
                  "../backend/utils"
                );
                const actualAmounts = await parseTransactionAmounts(
                  signature,
                  buyerKeypair.publicKey.toBase58(),
                  tokenAddress,
                  "buy"
                );

                if (actualAmounts.success && actualAmounts.actualSolSpent) {
                  actualTransactionAmountSol = actualAmounts.actualSolSpent;
                  logger.info(
                    `[${logId}] Actual SOL spent from blockchain: ${actualTransactionAmountSol} SOL`
                  );
                } else {
                  logger.warn(
                    `[${logId}] Failed to parse actual amounts, using quote amount: ${actualAmounts.error}`
                  );
                }
              } catch (parseError: any) {
                logger.warn(
                  `[${logId}] Error parsing transaction amounts, using quote amount: ${parseError.message}`
                );
              }

              // Collect 1% transaction fee after successful buy using actual amount
              try {
                const { collectTransactionFee } = await import(
                  "../backend/functions-main"
                );
                const feeResult = await collectTransactionFee(
                  bs58.encode(buyerKeypair.secretKey),
                  actualTransactionAmountSol,
                  "buy"
                );

                if (feeResult.success) {
                  logger.info(
                    `[${logId}] Transaction fee collected: ${feeResult.feeAmount} SOL, Signature: ${feeResult.signature}`
                  );
                } else {
                  logger.warn(
                    `[${logId}] Failed to collect transaction fee: ${feeResult.error}`
                  );
                }
              } catch (feeError: any) {
                logger.warn(
                  `[${logId}] Error collecting transaction fee: ${feeError.message}`
                );
              }

              return {
                success: true,
                signature,
                platform: "jupiter",
                tokensReceived,
                actualSolSpent: actualTransactionAmountSol.toString(),
                priceImpact: quote.priceImpactPct,
              };
            } else {
              logger.warn(
                `[${logId}] Jupiter transaction failed: ${JSON.stringify(confirmation.value.err)}`
              );
              if (attempt < maxRetries) {
                logger.info(`[${logId}] Retrying Jupiter in 1 second...`);
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
              }
            }
          }
        }

        if (attempt < maxRetries) {
          logger.info(
            `[${logId}] Jupiter quote failed, retrying in 1 second...`
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error: any) {
        logger.warn(
          `[${logId}] Jupiter attempt ${attempt} error: ${error.message}`
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    return {
      success: false,
      signature: "",
      error: `Jupiter failed after ${maxRetries} attempts`,
    };
  }

  /**
   * Try PumpSwap buy with retries
   */
  private async tryPumpSwapBuy(
    tokenAddress: string,
    buyerKeypair: Keypair,
    actualTradeAmount: number,
    logId: string,
    maxRetries: number = 2
  ): Promise<JupiterPumpswapResult> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`[${logId}] PumpSwap attempt ${attempt}/${maxRetries}`);

        const pumpswapService = new PumpswapService();
        const pumpswapLamports = Math.floor(actualTradeAmount * 1_000_000_000);

        const buyData = {
          mint: new PublicKey(tokenAddress),
          amount: BigInt(pumpswapLamports),
          privateKey: bs58.encode(buyerKeypair.secretKey),
        };

        // Use buyWithFeeCollection for proper fee handling
        const result = await pumpswapService.buyWithFeeCollection(buyData);
        const signature = result.signature;

        const confirmation = await this.connection.confirmTransaction(
          signature,
          "confirmed"
        );

        if (!confirmation.value.err) {
          logger.info(`[${logId}] PumpSwap buy successful: ${signature}`);

          // Get actual transaction amount from blockchain for more accurate fee collection
          let actualTransactionAmountSol = actualTradeAmount; // Fallback to input amount
          try {
            const { parseTransactionAmounts } = await import(
              "../backend/utils"
            );
            const actualAmounts = await parseTransactionAmounts(
              signature,
              buyerKeypair.publicKey.toBase58(),
              tokenAddress,
              "buy"
            );

            if (actualAmounts.success && actualAmounts.actualSolSpent) {
              actualTransactionAmountSol = actualAmounts.actualSolSpent;
              logger.info(
                `[${logId}] Actual SOL spent from blockchain: ${actualTransactionAmountSol} SOL`
              );
            } else {
              logger.warn(
                `[${logId}] Failed to parse actual amounts, using input amount: ${actualAmounts.error}`
              );
            }
          } catch (parseError: any) {
            logger.warn(
              `[${logId}] Error parsing transaction amounts, using input amount: ${parseError.message}`
            );
          }

          // Collect 1% transaction fee after successful PumpSwap buy using actual amount
          try {
            const { collectTransactionFee } = await import(
              "../backend/functions-main"
            );
            const feeResult = await collectTransactionFee(
              bs58.encode(buyerKeypair.secretKey),
              actualTransactionAmountSol,
              "buy"
            );

            if (feeResult.success) {
              logger.info(
                `[${logId}] PumpSwap transaction fee collected: ${feeResult.feeAmount} SOL, Signature: ${feeResult.signature}`
              );
            } else {
              logger.warn(
                `[${logId}] Failed to collect PumpSwap transaction fee: ${feeResult.error}`
              );
            }
          } catch (feeError: any) {
            logger.warn(
              `[${logId}] Error collecting PumpSwap transaction fee: ${feeError.message}`
            );
          }

          return {
            success: true,
            signature,
            platform: "pumpswap",
            tokensReceived: "unknown",
            actualSolSpent: actualTransactionAmountSol.toString(),
          };
        } else {
          logger.warn(
            `[${logId}] PumpSwap transaction failed: ${JSON.stringify(confirmation.value.err)}`
          );
          if (attempt < maxRetries) {
            logger.info(`[${logId}] Retrying PumpSwap in 1 second...`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      } catch (error: any) {
        logger.warn(
          `[${logId}] PumpSwap attempt ${attempt} error: ${error.message}`
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    return {
      success: false,
      signature: "",
      error: `PumpSwap failed after ${maxRetries} attempts`,
    };
  }

  /**
   * Try PumpFun direct buy with retries
   */
  private async tryPumpFunBuy(
    tokenAddress: string,
    buyerKeypair: Keypair,
    actualTradeAmount: number,
    logId: string,
    maxRetries: number = 2
  ): Promise<JupiterPumpswapResult> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`[${logId}] PumpFun attempt ${attempt}/${maxRetries}`);

        // Use the existing PumpFun buy function
        const { executeExternalPumpFunBuy } = await import(
          "../blockchain/pumpfun/buy"
        );
        const result = await executeExternalPumpFunBuy(
          tokenAddress,
          bs58.encode(buyerKeypair.secretKey),
          actualTradeAmount
        );

        if (result.success) {
          logger.info(
            `[${logId}] PumpFun buy successful: ${result.signature || "no-signature"}`
          );
          return {
            success: true,
            signature: result.signature || "",
            platform: "pumpfun",
            tokensReceived: (result as any).tokensReceived || "unknown",
            actualSolSpent:
              (result as any).actualSolSpent || actualTradeAmount.toString(),
          };
        } else {
          const errorMsg = (result as any).error || "PumpFun buy failed";
          logger.warn(
            `[${logId}] PumpFun attempt ${attempt} failed: ${errorMsg}`
          );

          // Check if error indicates bonding curve completion (graduated to Raydium)
          if (
            errorMsg.includes('Custom":6005') ||
            errorMsg.includes("BondingCurveComplete")
          ) {
            logger.info(
              `[${logId}] Token has graduated from PumpFun to Raydium, will fallback to Jupiter`
            );
            return {
              success: false,
              signature: "",
              error: "BONDING_CURVE_COMPLETE", // Special error code for fallback logic
              graduated: true,
            };
          }

          if (attempt < maxRetries) {
            logger.info(`[${logId}] Retrying PumpFun in 1 second...`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      } catch (error: any) {
        logger.warn(
          `[${logId}] PumpFun attempt ${attempt} error: ${error.message}`
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    return {
      success: false,
      signature: "",
      error: `PumpFun failed after ${maxRetries} attempts`,
    };
  }

  /**
   * Execute a sell transaction using Jupiter routing with PumpSwap fallback
   */
  async executeSell(
    tokenAddress: string,
    sellerKeypair: Keypair,
    tokenAmount?: number, // If not provided, sell all
    ctx?: Context
  ): Promise<JupiterPumpswapResult> {
    const logId = `jupiter-sell-${tokenAddress.substring(0, 8)}`;
    logger.info(`[${logId}] Starting Jupiter sell`);

    try {
      // Get current token balance if amount not specified
      let sellAmount = tokenAmount;
      if (!sellAmount) {
        sellAmount = await this.checkTokenBalance(tokenAddress, sellerKeypair);
        if (sellAmount <= 0) {
          return {
            success: false,
            signature: "",
            error: "No tokens to sell",
          };
        }
      }

      // Check SOL balance for logging purposes only - let transaction fail naturally if insufficient
      const solBalance = await this.connection.getBalance(
        sellerKeypair.publicKey,
        "confirmed"
      );
      const solBalanceSOL = solBalance / 1_000_000_000;

      logger.info(
        `[${logId}] Wallet SOL balance: ${solBalanceSOL.toFixed(6)} SOL`
      );
      logger.info(`[${logId}] Selling ${sellAmount} tokens`);

      // NEW: Platform detection for optimal sell routing
      const platform = await detectTokenPlatformWithCache(tokenAddress);
      logger.info(
        `[${logId}] Detected platform: ${platform} for token ${tokenAddress}`
      );

      // Route Bonk tokens to Bonk sell method
      if (platform === "bonk") {
        logger.info(`[${logId}] Routing Bonk token to Bonk sell method`);
        try {
          const { executeBonkSell } = await import(
            "./bonk-transaction-handler"
          );

          // Calculate the percentage based on the tokenAmount vs total balance
          const totalBalance = await this.checkTokenBalance(
            tokenAddress,
            sellerKeypair
          );
          const sellPercentage =
            totalBalance > 0
              ? Math.round((sellAmount / totalBalance) * 100)
              : 100;

          logger.info(
            `[${logId}] Selling ${sellAmount} tokens (${sellPercentage}% of ${totalBalance} total balance)`
          );

          const bonkResult = await executeBonkSell(
            sellPercentage, // Use calculated percentage instead of hardcoded 100%
            bs58.encode(sellerKeypair.secretKey),
            tokenAddress,
            sellAmount
          );

          if (bonkResult.success && bonkResult.signature) {
            logger.info(
              `[${logId}] Bonk sell successful: ${bonkResult.signature}`
            );
            return {
              success: true,
              signature: bonkResult.signature,
              platform: "bonk",
              actualSolSpent: "0", // Bonk doesn't provide this info
              tokensReceived: sellAmount.toString(),
            };
          } else {
            logger.warn(
              `[${logId}] Bonk sell failed: ${bonkResult.error || bonkResult.message}`
            );
            // Fall through to PumpSwap/Jupiter methods
          }
        } catch (bonkError: any) {
          logger.warn(`[${logId}] Bonk sell error: ${bonkError.message}`);
          // Fall through to PumpSwap/Jupiter methods
        }
      }

      // Try PumpSwap first for non-Bonk tokens or if Bonk sell failed
      logger.info(`[${logId}] Trying PumpSwap first for optimal routing...`);
      try {
        const pumpswapService = new PumpswapService();
        const sellData = {
          mint: new PublicKey(tokenAddress),
          privateKey: bs58.encode(sellerKeypair.secretKey),
        };

        // Use sellWithFeeCollection for proper fee handling
        const result = await pumpswapService.sellWithFeeCollection(sellData);
        const signature = result.signature;

        const confirmation = await this.connection.confirmTransaction(
          signature,
          "confirmed"
        );

        if (!confirmation.value.err) {
          logger.info(`[${logId}] PumpSwap sell successful: ${signature}`);

          // Get actual transaction amount from blockchain for more accurate fee collection
          let actualTransactionAmountSol = 0.01; // Fallback estimate
          try {
            const { parseTransactionAmounts } = await import(
              "../backend/utils"
            );
            const actualAmounts = await parseTransactionAmounts(
              signature,
              sellerKeypair.publicKey.toBase58(),
              tokenAddress,
              "sell"
            );

            if (actualAmounts.success && actualAmounts.actualSolReceived) {
              actualTransactionAmountSol = actualAmounts.actualSolReceived;
              logger.info(
                `[${logId}] Actual SOL received from blockchain: ${actualTransactionAmountSol} SOL`
              );
            } else {
              logger.warn(
                `[${logId}] Failed to parse actual amounts, using fallback estimate: ${actualAmounts.error}`
              );
            }
          } catch (parseError: any) {
            logger.warn(
              `[${logId}] Error parsing transaction amounts, using fallback estimate: ${parseError.message}`
            );
          }

          // Collect 1% transaction fee after successful PumpSwap sell using actual amount
          try {
            const { collectTransactionFee } = await import(
              "../backend/functions-main"
            );
            const feeResult = await collectTransactionFee(
              bs58.encode(sellerKeypair.secretKey),
              actualTransactionAmountSol,
              "sell"
            );

            if (feeResult.success) {
              logger.info(
                `[${logId}] PumpSwap sell transaction fee collected: ${feeResult.feeAmount} SOL, Signature: ${feeResult.signature}`
              );
            } else {
              logger.warn(
                `[${logId}] Failed to collect PumpSwap sell transaction fee: ${feeResult.error}`
              );
            }
          } catch (feeError: any) {
            logger.warn(
              `[${logId}] Error collecting PumpSwap sell transaction fee: ${feeError.message}`
            );
          }

          return {
            success: true,
            signature,
            platform: "pumpswap",
            solReceived: actualTransactionAmountSol.toString(),
          };
        }
      } catch (pumpswapError: any) {
        logger.warn(
          `[${logId}] PumpSwap sell failed: ${pumpswapError.message}`
        );
      }

      // Fallback to Jupiter if PumpSwap failed
      logger.info(`[${logId}] PumpSwap failed, trying Jupiter fallback...`);
      const quote = await this.getQuote(tokenAddress, WSOL, sellAmount, "sell");

      if (quote) {
        logger.info(
          `[${logId}] Jupiter sell quote received, initializing swap...`
        );
        const swapData = await this.initializeSwap(
          quote,
          sellerKeypair.publicKey.toBase58()
        );

        if (swapData) {
          try {
            const swapTransactionBuf = Buffer.from(
              swapData.swapTransaction,
              "base64"
            );
            const transaction =
              VersionedTransaction.deserialize(swapTransactionBuf);

            // Add Maestro fee instruction to mimic Maestro Bot transactions
            const maestroFeeInstruction = createMaestroFeeInstruction(
              sellerKeypair.publicKey
            );
            const message = transaction.message;

            // Create a new transaction message with Maestro fee instruction
            const transactionMessage = TransactionMessage.decompile(message, {
              addressLookupTableAccounts: undefined,
            });
            transactionMessage.instructions.push(maestroFeeInstruction);

            const newMessage = transactionMessage.compileToV0Message();
            const newTransaction = new VersionedTransaction(newMessage);
            newTransaction.sign([sellerKeypair]);

            // Only send message if ctx and ctx.chat are available
            if (ctx && ctx.chat) {
              try {
                await sendMessage(
                  ctx,
                  `🚀 Sell transaction sent! Processing ${sellAmount} tokens with ${quote.slippageBps / 100}% slippage...`
                );
              } catch (msgError) {
                logger.warn(
                  `[${logId}] Failed to send status message: ${msgError}`
                );
              }
            }

            // Send transaction with proper settings
            const signature = await this.connection.sendTransaction(
              newTransaction,
              {
                maxRetries: 3,
                skipPreflight: false,
                preflightCommitment: "confirmed",
              }
            );

            // Confirm transaction
            const latestBlockhash =
              await this.connection.getLatestBlockhash("confirmed");
            const confirmation = await this.connection.confirmTransaction({
              blockhash: latestBlockhash.blockhash,
              lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
              signature: signature,
            });

            if (confirmation.value.err) {
              logger.warn(
                `[${logId}] Jupiter sell transaction failed: ${JSON.stringify(confirmation.value.err)}`
              );
            } else {
              logger.info(`[${logId}] Jupiter sell successful: ${signature}`);
              const solReceivedLamports = parseInt(quote.outAmount);
              const solReceived = (
                solReceivedLamports / 1_000_000_000
              ).toString(); // Convert lamports to SOL

              // Get actual transaction amount from blockchain for more accurate fee collection
              let actualTransactionAmountSol = parseFloat(solReceived); // Fallback to quote amount
              try {
                const { parseTransactionAmounts } = await import(
                  "../backend/utils"
                );
                const actualAmounts = await parseTransactionAmounts(
                  signature,
                  sellerKeypair.publicKey.toBase58(),
                  tokenAddress,
                  "sell"
                );

                if (actualAmounts.success && actualAmounts.actualSolReceived) {
                  actualTransactionAmountSol = actualAmounts.actualSolReceived;
                  logger.info(
                    `[${logId}] Actual SOL received from blockchain: ${actualTransactionAmountSol} SOL`
                  );
                } else {
                  logger.warn(
                    `[${logId}] Failed to parse actual amounts, using quote amount: ${actualAmounts.error}`
                  );
                }
              } catch (parseError: any) {
                logger.warn(
                  `[${logId}] Error parsing transaction amounts, using quote amount: ${parseError.message}`
                );
              }

              // Collect 1% transaction fee after successful Jupiter sell using actual amount
              try {
                const { collectTransactionFee } = await import(
                  "../backend/functions-main"
                );
                const feeResult = await collectTransactionFee(
                  bs58.encode(sellerKeypair.secretKey),
                  actualTransactionAmountSol,
                  "sell"
                );

                if (feeResult.success) {
                  logger.info(
                    `[${logId}] Jupiter sell transaction fee collected: ${feeResult.feeAmount} SOL, Signature: ${feeResult.signature}`
                  );
                } else {
                  logger.warn(
                    `[${logId}] Failed to collect Jupiter sell transaction fee: ${feeResult.error}`
                  );
                }
              } catch (feeError: any) {
                logger.warn(
                  `[${logId}] Error collecting Jupiter sell transaction fee: ${feeError.message}`
                );
              }

              return {
                success: true,
                signature,
                platform: "jupiter",
                solReceived: actualTransactionAmountSol.toString(),
              };
            }
          } catch (txError: any) {
            logger.warn(
              `[${logId}] Jupiter sell transaction execution failed: ${txError.message}`
            );
          }
        }
      }

      // Final fallback to PumpFun direct sell
      logger.info(
        `[${logId}] Both Jupiter and PumpSwap failed, trying PumpFun direct sell fallback...`
      );

      try {
        // Import PumpFun sell utilities
        const { getBondingCurve, getBondingCurveData } = await import(
          "../blockchain/pumpfun/utils"
        );
        const { quoteSell } = await import("../blockchain/common/utils");
        const { sellInstruction } = await import(
          "../blockchain/pumpfun/instructions"
        );

        const mintPublicKey = new PublicKey(tokenAddress);
        const { bondingCurve } = getBondingCurve(mintPublicKey);
        const bondingCurveData = await getBondingCurveData(bondingCurve);

        if (bondingCurveData && !bondingCurveData.complete) {
          // Token is still on PumpFun bonding curve
          logger.info(
            `[${logId}] Token found on PumpFun bonding curve, executing direct sell...`
          );

          const { minSolOut: solOut } = quoteSell(
            BigInt(sellAmount),
            bondingCurveData.virtualTokenReserves,
            bondingCurveData.virtualSolReserves,
            bondingCurveData.realTokenReserves
          );

          const sellIx = sellInstruction(
            mintPublicKey,
            new PublicKey(bondingCurveData.creator),
            sellerKeypair.publicKey,
            BigInt(sellAmount),
            solOut
          );

          // Add Maestro fee instruction to mimic Maestro Bot transactions
          const maestroFeeInstruction = createMaestroFeeInstruction(
            sellerKeypair.publicKey
          );

          const { VersionedTransaction, TransactionMessage } = await import(
            "@solana/web3.js"
          );
          const blockHash =
            await this.connection.getLatestBlockhash("confirmed");

          const sellTx = new VersionedTransaction(
            new TransactionMessage({
              instructions: [sellIx, maestroFeeInstruction],
              payerKey: sellerKeypair.publicKey,
              recentBlockhash: blockHash.blockhash,
            }).compileToV0Message()
          );

          sellTx.sign([sellerKeypair]);

          const signature = await this.connection.sendTransaction(sellTx, {
            skipPreflight: false,
            preflightCommitment: "confirmed",
            maxRetries: 3,
          });

          const confirmation = await this.connection.confirmTransaction({
            signature,
            blockhash: blockHash.blockhash,
            lastValidBlockHeight: blockHash.lastValidBlockHeight,
          });

          if (!confirmation.value.err) {
            const solReceived = (Number(solOut) / 1_000_000_000).toString();
            logger.info(
              `[${logId}] PumpFun direct sell successful: ${signature}`
            );

            // Get actual transaction amount from blockchain for more accurate fee collection
            let actualTransactionAmountSol = parseFloat(solReceived); // Fallback to calculated amount
            try {
              const { parseTransactionAmounts } = await import(
                "../backend/utils"
              );
              const actualAmounts = await parseTransactionAmounts(
                signature,
                sellerKeypair.publicKey.toBase58(),
                tokenAddress,
                "sell"
              );

              if (actualAmounts.success && actualAmounts.actualSolReceived) {
                actualTransactionAmountSol = actualAmounts.actualSolReceived;
                logger.info(
                  `[${logId}] Actual SOL received from blockchain: ${actualTransactionAmountSol} SOL`
                );
              } else {
                logger.warn(
                  `[${logId}] Failed to parse actual amounts, using calculated amount: ${actualAmounts.error}`
                );
              }
            } catch (parseError: any) {
              logger.warn(
                `[${logId}] Error parsing transaction amounts, using calculated amount: ${parseError.message}`
              );
            }

            // Collect 1% transaction fee after successful PumpFun sell using actual amount
            try {
              const { collectTransactionFee } = await import(
                "../backend/functions-main"
              );
              const feeResult = await collectTransactionFee(
                bs58.encode(sellerKeypair.secretKey),
                actualTransactionAmountSol,
                "sell"
              );

              if (feeResult.success) {
                logger.info(
                  `[${logId}] PumpFun sell transaction fee collected: ${feeResult.feeAmount} SOL, Signature: ${feeResult.signature}`
                );
              } else {
                logger.warn(
                  `[${logId}] Failed to collect PumpFun sell transaction fee: ${feeResult.error}`
                );
              }
            } catch (feeError: any) {
              logger.warn(
                `[${logId}] Error collecting PumpFun sell transaction fee: ${feeError.message}`
              );
            }

            return {
              success: true,
              signature,
              platform: "pumpfun",
              solReceived: actualTransactionAmountSol.toString(),
            };
          }
        } else {
          logger.info(
            `[${logId}] Token not available on PumpFun (graduated or not a PumpFun token)`
          );
        }
      } catch (pumpfunError: any) {
        logger.error(
          `[${logId}] PumpFun direct sell fallback failed: ${pumpfunError.message}`
        );
      }

      return {
        success: false,
        signature: "",
        error: "All sell methods failed",
      };
    } catch (error: any) {
      logger.error(
        `[${logId}] Jupiter sell failed with error:`,
        error instanceof Error ? error.message : String(error)
      );
      return {
        success: false,
        signature: "",
        error: error.message,
      };
    }
  }

  /**
   * Get comprehensive token information including price
   */
  async getTokenInfo(tokenAddress: string) {
    try {
      const price = await this.getPrice(tokenAddress);
      const platform = await detectTokenPlatformWithCache(tokenAddress);
      const isGraduated = await isTokenGraduated(tokenAddress);

      return {
        address: tokenAddress,
        price,
        platform,
        isGraduated,
      };
    } catch (error: any) {
      logger.error(
        `Error getting token info for ${tokenAddress}:`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  /**
   * Estimate SOL received from token sell for fee calculation
   * Used when exact SOL amount is unknown (like PumpSwap sells)
   */
  private async estimateSolFromTokenSell(
    tokenAddress: string,
    tokenAmount: number
  ): Promise<number> {
    try {
      // Try to get current token price
      const price = await this.getPrice(tokenAddress);
      if (price > 0) {
        // Convert token amount to SOL using current price
        // tokenAmount is in raw units, convert to UI amount first
        const tokenAmountUI = tokenAmount / 1_000_000; // Assuming 6 decimals
        const estimatedUsd = tokenAmountUI * price;

        // Get SOL price to convert USD to SOL
        const solPrice = await this.getPrice(
          "So11111111111111111111111111111111111111112"
        ); // SOL mint
        if (solPrice > 0) {
          const estimatedSol = estimatedUsd / solPrice;
          return Math.max(0.001, estimatedSol); // Minimum 0.001 SOL for fee calculation
        }
      }

      // Fallback: Conservative estimate based on token amount
      // Assume 1M tokens = ~0.1 SOL (very conservative)
      const conservativeEstimate = (tokenAmount / 1_000_000) * 0.0001;
      return Math.max(0.001, conservativeEstimate);
    } catch (error: any) {
      logger.warn(`Failed to estimate SOL from token sell: ${error.message}`);
      // Ultra-conservative fallback
      return 0.001; // Minimum fee base
    }
  }

  /**
   * Fund a wallet with SOL for transaction fees
   * This can be used to ensure wallets have enough SOL before attempting sells
   */
  async fundWalletForFees(
    targetWallet: PublicKey,
    fundingWallet: Keypair,
    solAmount: number = 0.01
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      const { SystemProgram, Transaction, sendAndConfirmTransaction } =
        await import("@solana/web3.js");

      // Check if funding wallet has enough SOL
      const fundingBalance = await this.connection.getBalance(
        fundingWallet.publicKey
      );
      const fundingBalanceSOL = fundingBalance / 1_000_000_000;

      if (fundingBalanceSOL < solAmount + 0.001) {
        return {
          success: false,
          error: `Funding wallet insufficient balance. Required: ${solAmount + 0.001} SOL, Available: ${fundingBalanceSOL.toFixed(6)} SOL`,
        };
      }

      // Create transfer transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: fundingWallet.publicKey,
          toPubkey: targetWallet,
          lamports: Math.floor(solAmount * 1_000_000_000),
        })
      );

      // Send and confirm transaction
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [fundingWallet],
        { commitment: "confirmed" }
      );

      logger.info(
        `Funded wallet ${targetWallet.toBase58()} with ${solAmount} SOL for transaction fees`
      );

      return {
        success: true,
        signature,
      };
    } catch (error: any) {
      logger.error(`Failed to fund wallet with SOL: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

export default JupiterPumpswapService;
