import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { logger } from "../common/logger";
import JupiterPumpswapService from "../../service/jupiter-pumpswap-service";

export interface ExternalBuyResult {
  success: boolean;
  signature: string;
  error?: string;
  platform?: 'jupiter' | 'pumpswap' | 'pumpfun' | 'unknown';
  solReceived?: string;
}

/**
 * Execute external token buy using the unified Jupiter-Pumpswap service
 * This service automatically handles Jupiter -> Pumpswap -> PumpFun fallback chain
 */
export async function executeExternalBuy(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number
): Promise<ExternalBuyResult> {
  const logId = `external-buy-${tokenAddress.substring(0, 8)}`;
  
  try {
    logger.info(`[${logId}] Starting external token buy for ${solAmount} SOL using unified service`);
    
    // Use the new unified Jupiter-Pumpswap service for all external buys
    const jupiterPumpswapService = new JupiterPumpswapService();
    
    const result = await jupiterPumpswapService.executeBuy(
      tokenAddress,
      buyerKeypair,
      solAmount,
      3 // 3% slippage
    );
    
    if (result.success) {
      logger.info(`[${logId}] External buy successful via ${result.platform}: ${result.signature}`);
      return {
        success: true,
        signature: result.signature,
        platform: result.platform,
        solReceived: result.actualSolSpent || solAmount.toString()
      };
    } else {
      logger.error(`[${logId}] External buy failed: ${result.error}`);
      return {
        success: false,
        signature: '',
        error: result.error || 'External buy failed'
      };
    }
    
  } catch (error: any) {
    logger.error(`[${logId}] External buy error: ${error.message}`);
    return {
      success: false,
      signature: '',
      error: error.message
    };
  }
} 