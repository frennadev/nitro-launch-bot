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
  platform?: "jupiter" | "pumpswap" | "pumpfun";
  tokensReceived?: string;
  solReceived?: string;
  actualSolSpent?: string;
  priceImpact?: number;
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
   * Execute a buy transaction using Jupiter routing with PumpSwap fallback
   */
  async executeBuy(
    tokenAddress: string,
    buyerKeypair: Keypair,
    solAmount: number,
    slippage: number = 3, // Default slippage percentage
    ctx?: Context
  ): Promise<JupiterPumpswapResult> {
    const logId = `jupiter-buy-${tokenAddress.substring(0, 8)}`;
    logger.info(`[${logId}] Starting Jupiter buy for ${solAmount} SOL`);

    try {
      // CRITICAL FIX: Check actual wallet balance and account for fees
      const walletBalance = await this.connection.getBalance(buyerKeypair.publicKey, "confirmed");
      const walletBalanceSOL = walletBalance / 1_000_000_000;
      
      // Reserve fees: 0.01 SOL for transaction fees + 1% buy fee
      const transactionFeeReserve = 0.01; // Priority fees + base fees
      const buyFeePercent = 0.01; // 1% buy fee
      const estimatedBuyFee = walletBalanceSOL * buyFeePercent;
      const totalFeeReserve = transactionFeeReserve + estimatedBuyFee;
      const availableForTrade = walletBalanceSOL - totalFeeReserve;
      
      logger.info(`[${logId}] Wallet balance: ${walletBalanceSOL.toFixed(6)} SOL`);
      logger.info(`[${logId}] Transaction fee reserve: ${transactionFeeReserve.toFixed(6)} SOL`);
      logger.info(`[${logId}] Estimated 1% buy fee: ${estimatedBuyFee.toFixed(6)} SOL`);
      logger.info(`[${logId}] Total fee reserve: ${totalFeeReserve.toFixed(6)} SOL`);
      logger.info(`[${logId}] Available for trade: ${availableForTrade.toFixed(6)} SOL`);
      
      // Validate we have enough balance
      if (availableForTrade <= 0) {
        return {
          success: false,
          signature: "",
          error: `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees (${transactionFeeReserve.toFixed(6)} SOL tx fees + ${estimatedBuyFee.toFixed(6)} SOL buy fee)`
        };
      }
      
      // Use the minimum of requested amount or available balance
      const actualTradeAmount = Math.min(solAmount, availableForTrade);
      
      if (actualTradeAmount < solAmount) {
        logger.warn(`[${logId}] Adjusted trade amount from ${solAmount} SOL to ${actualTradeAmount.toFixed(6)} SOL due to insufficient balance`);
      }
      
      const solLamports = Math.floor(actualTradeAmount * 1_000_000_000); // Convert SOL to lamports

      // Try Jupiter first
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
          try {
            const swapTransactionBuf = Buffer.from(
              swapData.swapTransaction,
              "base64"
            );
            const transaction =
              VersionedTransaction.deserialize(swapTransactionBuf);

            // Sign the transaction
            transaction.sign([buyerKeypair]);

            // Only send message if ctx and ctx.chat are available
            if (ctx && ctx.chat) {
              try {
                await sendMessage(
                  ctx,
                  `🚀 Buy transaction sent! Processing ${actualTradeAmount.toFixed(6)} SOL with ${slippage}% slippage...`
                );
              } catch (msgError) {
                logger.warn(`[${logId}] Failed to send status message: ${msgError}`);
              }
            }

            // Send transaction with proper settings
            const signature = await this.connection.sendTransaction(
              transaction,
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
                `[${logId}] Jupiter transaction failed: ${JSON.stringify(confirmation.value.err)}`
              );
            } else {
              logger.info(`[${logId}] Jupiter buy successful: ${signature}`);
              const tokensReceived = quote.outAmount;
              const solSpentLamports = quote.inAmount;
              const actualSolSpent = (
                parseInt(solSpentLamports) / 1_000_000_000
              ).toString();
              
              // Collect 1% transaction fee after successful buy
              try {
                const { collectTransactionFee } = await import("../backend/functions-main");
                const feeResult = await collectTransactionFee(
                  bs58.encode(buyerKeypair.secretKey),
                  parseFloat(actualSolSpent),
                  "buy"
                );
                
                if (feeResult.success) {
                  logger.info(`[${logId}] Transaction fee collected: ${feeResult.feeAmount} SOL, Signature: ${feeResult.signature}`);
                } else {
                  logger.warn(`[${logId}] Failed to collect transaction fee: ${feeResult.error}`);
                }
              } catch (feeError: any) {
                logger.warn(`[${logId}] Error collecting transaction fee: ${feeError.message}`);
              }
              
              return {
                success: true,
                signature,
                platform: "jupiter",
                tokensReceived,
                actualSolSpent,
                priceImpact: quote.priceImpactPct,
              };
            }
          } catch (txError: any) {
            logger.warn(
              `[${logId}] Jupiter transaction execution failed: ${txError.message}`
            );
          }
        }
      }

      // Fallback to PumpSwap for native tokens
      logger.info(`[${logId}] Jupiter failed, trying PumpSwap fallback...`);

      // Check if token is graduated or suitable for PumpSwap
      const isGraduated = await isTokenGraduated(tokenAddress);

      if (isGraduated) {
        try {
          const pumpswapService = new PumpswapService();
          
          // Use actual available balance for Pumpswap
          const pumpswapLamports = Math.floor(actualTradeAmount * 1_000_000_000);
          
          const buyData = {
            mint: new PublicKey(tokenAddress),
            amount: BigInt(pumpswapLamports),
            privateKey: bs58.encode(buyerKeypair.secretKey),
          };

          const buyTx = await pumpswapService.buyTx(buyData);
          const signature = await this.connection.sendTransaction(buyTx, {
            skipPreflight: false,
            preflightCommitment: "confirmed",
            maxRetries: 3,
          });

          const confirmation = await this.connection.confirmTransaction(
            signature,
            "confirmed"
          );

          if (!confirmation.value.err) {
            logger.info(`[${logId}] PumpSwap buy successful: ${signature}`);
            
            // Collect 1% transaction fee after successful PumpSwap buy
            try {
              const { collectTransactionFee } = await import("../backend/functions-main");
              const feeResult = await collectTransactionFee(
                bs58.encode(buyerKeypair.secretKey),
                actualTradeAmount,
                "buy"
              );
              
              if (feeResult.success) {
                logger.info(`[${logId}] PumpSwap transaction fee collected: ${feeResult.feeAmount} SOL, Signature: ${feeResult.signature}`);
              } else {
                logger.warn(`[${logId}] Failed to collect PumpSwap transaction fee: ${feeResult.error}`);
              }
            } catch (feeError: any) {
              logger.warn(`[${logId}] Error collecting PumpSwap transaction fee: ${feeError.message}`);
            }
            
            return {
              success: true,
              signature,
              platform: "pumpswap",
              tokensReceived: "unknown", // PumpSwap doesn't return exact amount
              actualSolSpent: actualTradeAmount.toString(),
            };
          }
        } catch (pumpswapError: any) {
          logger.error(
            `[${logId}] PumpSwap fallback failed: ${pumpswapError.message}`
          );
        }
      }

      return {
        success: false,
        signature: "",
        error: "All buy methods failed",
      };
    } catch (error: any) {
      logger.error(
        `[${logId}] Jupiter buy failed with error:`,
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

      logger.info(`[${logId}] Selling ${sellAmount} tokens`);

      // Try Jupiter first
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

            // Sign the transaction
            transaction.sign([sellerKeypair]);
            
            // Only send message if ctx and ctx.chat are available
            if (ctx && ctx.chat) {
              try {
                await sendMessage(
                  ctx,
                  `🚀 Sell transaction sent! Processing ${sellAmount} tokens with ${quote.slippageBps / 100}% slippage...`
                );
              } catch (msgError) {
                logger.warn(`[${logId}] Failed to send status message: ${msgError}`);
              }
            }

            // Send transaction with proper settings
            const signature = await this.connection.sendTransaction(
              transaction,
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
              
              // Collect 1% transaction fee after successful Jupiter sell
              try {
                const { collectTransactionFee } = await import("../backend/functions-main");
                const feeResult = await collectTransactionFee(
                  bs58.encode(sellerKeypair.secretKey),
                  parseFloat(solReceived),
                  "sell"
                );
                
                if (feeResult.success) {
                  logger.info(`[${logId}] Jupiter sell transaction fee collected: ${feeResult.feeAmount} SOL, Signature: ${feeResult.signature}`);
                } else {
                  logger.warn(`[${logId}] Failed to collect Jupiter sell transaction fee: ${feeResult.error}`);
                }
              } catch (feeError: any) {
                logger.warn(`[${logId}] Error collecting Jupiter sell transaction fee: ${feeError.message}`);
              }
              
              return {
                success: true,
                signature,
                platform: "jupiter",
                solReceived,
              };
            }
          } catch (txError: any) {
            logger.warn(
              `[${logId}] Jupiter sell transaction execution failed: ${txError.message}`
            );
          }
        }
      }

      // Fallback to PumpSwap
      logger.info(`[${logId}] Jupiter failed, trying PumpSwap fallback...`);

      try {
        const pumpswapService = new PumpswapService();
        const sellData = {
          mint: new PublicKey(tokenAddress),
          privateKey: bs58.encode(sellerKeypair.secretKey),
        };

        const sellTx = await pumpswapService.sellTx(sellData);
        const signature = await this.connection.sendTransaction(sellTx, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });

        const confirmation = await this.connection.confirmTransaction(
          signature,
          "confirmed"
        );

        if (!confirmation.value.err) {
          logger.info(`[${logId}] PumpSwap sell successful: ${signature}`);
          
          // Collect 1% transaction fee after successful PumpSwap sell
          try {
            const { collectTransactionFee } = await import("../backend/functions-main");
            // For PumpSwap sells, we need to estimate SOL received since it's unknown
            // Use a conservative estimate based on token amount and current price
            const estimatedSolReceived = await this.estimateSolFromTokenSell(tokenAddress, sellAmount);
            
            const feeResult = await collectTransactionFee(
              bs58.encode(sellerKeypair.secretKey),
              estimatedSolReceived,
              "sell"
            );
            
            if (feeResult.success) {
              logger.info(`[${logId}] PumpSwap sell transaction fee collected: ${feeResult.feeAmount} SOL, Signature: ${feeResult.signature}`);
            } else {
              logger.warn(`[${logId}] Failed to collect PumpSwap sell transaction fee: ${feeResult.error}`);
            }
          } catch (feeError: any) {
            logger.warn(`[${logId}] Error collecting PumpSwap sell transaction fee: ${feeError.message}`);
          }
          
          return {
            success: true,
            signature,
            platform: "pumpswap",
            solReceived: "unknown",
          };
        }
      } catch (pumpswapError: any) {
        logger.error(
          `[${logId}] PumpSwap sell fallback failed: ${pumpswapError.message}`
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
  private async estimateSolFromTokenSell(tokenAddress: string, tokenAmount: number): Promise<number> {
    try {
      // Try to get current token price
      const price = await this.getPrice(tokenAddress);
      if (price > 0) {
        // Convert token amount to SOL using current price
        // tokenAmount is in raw units, convert to UI amount first
        const tokenAmountUI = tokenAmount / 1_000_000; // Assuming 6 decimals
        const estimatedUsd = tokenAmountUI * price;
        
        // Get SOL price to convert USD to SOL
        const solPrice = await this.getPrice("So11111111111111111111111111111111111111112"); // SOL mint
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
}

export default JupiterPumpswapService;
