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
      const solLamports = Math.floor(solAmount * 1_000_000_000); // Convert SOL to lamports

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
                  `🚀 Buy transaction sent! Processing ${solAmount} SOL with ${slippage}% slippage...`
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
          const buyData = {
            mint: new PublicKey(tokenAddress),
            amount: BigInt(solLamports),
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
            return {
              success: true,
              signature,
              platform: "pumpswap",
              tokensReceived: "unknown", // PumpSwap doesn't return exact amount
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
}

export default JupiterPumpswapService;
