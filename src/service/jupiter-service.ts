import { Connection, PublicKey, VersionedTransaction, Keypair } from "@solana/web3.js";
import { logger } from "../blockchain/common/logger";
import fetch from "cross-fetch";

// Jupiter API configuration using QuickNode endpoints
const JUPITER_API_BASE_URL = "https://jupiter-swap-api.quiknode.pro/963B1921E747";
const SOLANA_RPC_URL = "https://silent-crimson-diamond.solana-mainnet.quiknode.pro/6965dae80c8f203c75cdaab1f46b51cb654fc293/";

// Create connection using QuickNode RPC
const connection = new Connection(SOLANA_RPC_URL, {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: 60000,
});

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee?: any;
  priceImpactPct: string;
  routePlan: any[];
  contextSlot: number;
  timeTaken: number;
}

export interface JupiterSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
  computeUnitLimit: number;
  prioritizationType: any;
  dynamicSlippageReport?: any;
  simulationError?: any;
}

export interface JupiterSwapParams {
  tokenAddress: string;
  solAmount: number;
  walletKeypair: Keypair;
  slippageBps?: number;
  priorityLevel?: "medium" | "high" | "veryHigh";
  maxPriorityFeeLamports?: number;
}

export interface JupiterSwapResult {
  success: boolean;
  signature?: string;
  error?: string;
  inputAmount?: number;
  outputAmount?: number;
  priceImpactPct?: string;
}

/**
 * Jupiter Service for token swaps using QuickNode Jupiter API
 */
export class JupiterService {
  private connection: Connection;

  constructor() {
    this.connection = connection;
  }

  /**
   * Get a quote for swapping SOL to a token
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 100
  ): Promise<JupiterQuoteResponse | null> {
    try {
      const url = `${JUPITER_API_BASE_URL}/v6/quote?` +
        `inputMint=${inputMint}&` +
        `outputMint=${outputMint}&` +
        `amount=${amount}&` +
        `slippageBps=${slippageBps}&` +
        `onlyDirectRoutes=false&` +
        `asLegacyTransaction=false`;

      logger.info(`[jupiter-service] Getting quote: ${url}`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[jupiter-service] Quote request failed: ${response.status} ${errorText}`);
        return null;
      }

      const quote = await response.json();
      logger.info(`[jupiter-service] Quote received: ${quote.outAmount} tokens for ${amount} lamports`);
      return quote;

    } catch (error: any) {
      logger.error(`[jupiter-service] Error getting quote: ${error.message}`);
      return null;
    }
  }

  /**
   * Execute a swap transaction
   */
  async executeSwap(params: JupiterSwapParams): Promise<JupiterSwapResult> {
    const logId = `jupiter-swap-${params.tokenAddress.substring(0, 8)}`;
    
    try {
      logger.info(`[${logId}] Starting Jupiter swap: ${params.solAmount} SOL -> ${params.tokenAddress}`);

      // SOL mint address
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      
              // Convert SOL to lamports
        const amountLamports = Math.ceil(params.solAmount * 1e9);
      
      // Get quote
      const quote = await this.getQuote(
        SOL_MINT,
        params.tokenAddress,
        amountLamports,
        params.slippageBps || 100
      );

      if (!quote) {
        return {
          success: false,
          error: "Failed to get Jupiter quote"
        };
      }

      logger.info(`[${logId}] Quote received: ${quote.outAmount} tokens, price impact: ${quote.priceImpactPct}%`);

      // Get swap transaction
      const swapResponse = await this.getSwapTransaction(quote, params);
      
      if (!swapResponse) {
        return {
          success: false,
          error: "Failed to get swap transaction"
        };
      }

      // Execute the transaction
      const result = await this.sendTransaction(swapResponse, params.walletKeypair, logId);
      
      if (result.success) {
        return {
          success: true,
          signature: result.signature,
          inputAmount: params.solAmount,
          outputAmount: parseInt(quote.outAmount),
          priceImpactPct: quote.priceImpactPct
        };
      } else {
        return {
          success: false,
          error: result.error
        };
      }

    } catch (error: any) {
      logger.error(`[${logId}] Jupiter swap error: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get swap transaction from Jupiter API
   */
  private async getSwapTransaction(
    quote: JupiterQuoteResponse,
    params: JupiterSwapParams
  ): Promise<JupiterSwapResponse | null> {
    try {
      const response = await fetch(`${JUPITER_API_BASE_URL}/v6/swap`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: params.walletKeypair.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: params.maxPriorityFeeLamports || 10000000,
              priorityLevel: params.priorityLevel || "high"
            }
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[jupiter-service] Swap request failed: ${response.status} ${errorText}`);
        return null;
      }

      const swapData = await response.json();
      return swapData;

    } catch (error: any) {
      logger.error(`[jupiter-service] Error getting swap transaction: ${error.message}`);
      return null;
    }
  }

  /**
   * Send transaction to the network
   */
  private async sendTransaction(
    swapResponse: JupiterSwapResponse,
    walletKeypair: Keypair,
    logId: string
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      // Deserialize the transaction
      const transactionBuf = Buffer.from(swapResponse.swapTransaction, "base64");
      const transaction = VersionedTransaction.deserialize(transactionBuf);

      // Sign the transaction
      transaction.sign([walletKeypair]);

      // Send the transaction
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: true,
          maxRetries: 3,
        }
      );

      logger.info(`[${logId}] Transaction sent: ${signature}`);

      // Confirm the transaction
      const confirmation = await this.connection.confirmTransaction(
        {
          signature,
          blockhash: (await this.connection.getLatestBlockhash()).blockhash,
          lastValidBlockHeight: swapResponse.lastValidBlockHeight,
        },
        "confirmed"
      );

      if (confirmation.value.err) {
        logger.error(`[${logId}] Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        return {
          success: false,
          error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
        };
      }

      logger.info(`[${logId}] Transaction confirmed: https://solscan.io/tx/${signature}`);
      return {
        success: true,
        signature
      };

    } catch (error: any) {
      logger.error(`[${logId}] Error sending transaction: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if a token is supported by Jupiter
   */
  async isTokenSupported(tokenAddress: string): Promise<boolean> {
    try {
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const quote = await this.getQuote(SOL_MINT, tokenAddress, 1000000, 100); // Test with 0.001 SOL
      return quote !== null;
    } catch (error) {
      logger.error(`[jupiter-service] Error checking token support: ${error}`);
      return false;
    }
  }

  /**
   * Get connection instance
   */
  getConnection(): Connection {
    return this.connection;
  }
}

// Export singleton instance
export const jupiterService = new JupiterService(); 