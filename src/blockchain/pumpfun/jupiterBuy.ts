import { logger } from "../common/logger";
import { secretKeyToKeypair } from "../common/utils";
import { jupiterService, JupiterSwapResult } from "../../service/jupiter-service";

export interface JupiterBuyParams {
  tokenAddress: string;
  solAmount: number;
  walletPrivateKey: string;
  userId: string;
  slippageBps?: number;
  priorityLevel?: "medium" | "high" | "veryHigh";
  maxPriorityFeeLamports?: number;
}

export interface JupiterBuyResult {
  success: boolean;
  signature?: string;
  error?: string;
  inputAmount?: number;
  outputAmount?: number;
  priceImpactPct?: string;
}

/**
 * Execute a Jupiter buy transaction for any token
 * This is the universal fallback for tokens that can't be bought on PumpFun or Pumpswap
 */
export const executeJupiterBuy = async (params: JupiterBuyParams): Promise<JupiterBuyResult> => {
  const logId = `jupiter-buy-${params.tokenAddress.substring(0, 8)}`;
  
  try {
    logger.info(`[${logId}] Starting Jupiter buy: ${params.solAmount} SOL -> ${params.tokenAddress}`);

    // Convert private key to keypair
    const walletKeypair = secretKeyToKeypair(params.walletPrivateKey);
    
    // Execute Jupiter swap
    const result: JupiterSwapResult = await jupiterService.executeSwap({
      tokenAddress: params.tokenAddress,
      solAmount: params.solAmount,
      walletKeypair,
      slippageBps: params.slippageBps || 100, // 1% default slippage
      priorityLevel: params.priorityLevel || "high",
      maxPriorityFeeLamports: params.maxPriorityFeeLamports || 10000000, // 0.01 SOL max priority fee
    });

    if (result.success && result.signature) {
      logger.info(`[${logId}] Jupiter buy successful: ${result.signature}`);
      logger.info(`[${logId}] Input: ${result.inputAmount} SOL, Output: ${result.outputAmount} tokens`);
      logger.info(`[${logId}] Price impact: ${result.priceImpactPct}%`);

      // Record the transaction in the database
      try {
        const { recordTransactionWithActualAmounts } = await import("../../backend/utils");
        await recordTransactionWithActualAmounts(
          params.tokenAddress,
          walletKeypair.publicKey.toString(),
          "external_buy", // Transaction type for Jupiter buys
          result.signature,
          true, // success
          1, // launchAttempt
          {
            amountSol: result.inputAmount || params.solAmount,
            amountTokens: (result.outputAmount || 0).toString()
          }
        );
        logger.info(`[${logId}] Transaction recorded in database`);
      } catch (dbError: any) {
        logger.error(`[${logId}] Failed to record transaction: ${dbError.message}`);
        // Don't fail the whole operation if DB recording fails
      }

      return {
        success: true,
        signature: result.signature,
        inputAmount: result.inputAmount,
        outputAmount: result.outputAmount,
        priceImpactPct: result.priceImpactPct
      };

    } else {
      logger.error(`[${logId}] Jupiter buy failed: ${result.error}`);
      return {
        success: false,
        error: result.error || "Jupiter swap failed"
      };
    }

  } catch (error: any) {
    logger.error(`[${logId}] Jupiter buy error: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Check if a token is supported by Jupiter
 */
export const isJupiterSupported = async (tokenAddress: string): Promise<boolean> => {
  try {
    return await jupiterService.isTokenSupported(tokenAddress);
  } catch (error: any) {
    logger.error(`[jupiter-check] Error checking Jupiter support for ${tokenAddress}: ${error.message}`);
    return false;
  }
};

/**
 * Get Jupiter quote for a token (for price estimation)
 */
export const getJupiterQuote = async (
  tokenAddress: string, 
  solAmount: number,
  slippageBps: number = 100
) => {
  try {
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const amountLamports = Math.floor(solAmount * 1e9);
    
    return await jupiterService.getQuote(
      SOL_MINT,
      tokenAddress,
      amountLamports,
      slippageBps
    );
  } catch (error: any) {
    logger.error(`[jupiter-quote] Error getting quote: ${error.message}`);
    return null;
  }
}; 