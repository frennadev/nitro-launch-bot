import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { logger } from "../common/logger";
import { getCachedPlatform, markTokenAsPumpFun, markTokenAsPumpswap, isTokenGraduated } from "../../service/token-detection-service";
import { executeExternalPumpFunBuy } from "./buy";
import PumpswapService from "../../service/pumpswap-service";
import bs58 from "bs58";
import { connection } from "../../service/config";

export interface ExternalBuyResult {
  success: boolean;
  signature: string;
  error?: string;
  platform?: 'pumpswap' | 'pumpfun' | 'unknown';
  solReceived?: string;
}

interface PumpswapBuyResult {
  success: boolean;
  signature: string;
  error?: string;
  solReceived?: string;
}

async function executePumpswapBuy(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number
): Promise<PumpswapBuyResult> {
  const logId = `pumpswap-buy-${tokenAddress.substring(0, 8)}`;
  
  try {
    const pumpswapService = new PumpswapService();
    const privateKeyBase58 = bs58.encode(buyerKeypair.secretKey);
    
    const buyData = {
      mint: new PublicKey(tokenAddress),
      amount: BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL)),
      privateKey: privateKeyBase58
    };
    
    logger.info(`[${logId}] Creating Pumpswap buy transaction...`);
    const buyTx = await pumpswapService.buyTx(buyData);
    
    logger.info(`[${logId}] Sending Pumpswap transaction...`);
    const signature = await connection.sendTransaction(buyTx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3
    });
    
    logger.info(`[${logId}] Pumpswap transaction sent: ${signature}`);
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      return {
        success: false,
        signature: '',
        error: `Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`
      };
    }
    
    logger.info(`[${logId}] Pumpswap buy successful: ${signature}`);
    return {
      success: true,
      signature,
      solReceived: solAmount.toString()
    };
    
  } catch (error: any) {
    logger.error(`[${logId}] Pumpswap buy error:`, error);
    return {
      success: false,
      signature: '',
      error: error.message
    };
  }
}

/**
 * Execute external token buy with automatic platform detection using bonding curve approach
 * Graduated tokens (complete: true) are routed directly to Pumpswap for optimal performance
 */
export async function executeExternalBuy(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number
): Promise<ExternalBuyResult> {
  const logId = `external-buy-${tokenAddress.substring(0, 8)}`;
  
  try {
    logger.info(`[${logId}] Starting external token buy for ${solAmount} SOL`);
    
    // Check if token is graduated using bonding curve data
    const isGraduated = await isTokenGraduated(tokenAddress);
    logger.info(`[${logId}] Token graduation status: ${isGraduated ? 'graduated' : 'not graduated'}`);
    
    if (isGraduated) {
      logger.info(`[${logId}] Token has graduated to Raydium - routing directly to Pumpswap`);
      
      try {
        logger.info(`[${logId}] Creating Pumpswap buy transaction for graduated token...`);
        const pumpswapResult = await executePumpswapBuy(tokenAddress, buyerKeypair, solAmount);
        
        if (pumpswapResult.success) {
          return {
            success: true,
            signature: pumpswapResult.signature,
            platform: 'pumpswap',
            solReceived: pumpswapResult.solReceived
          };
        }
        
        // If Pumpswap fails, log the error and continue to fallback
        logger.warn(`[${logId}] Pumpswap buy failed for graduated token: ${pumpswapResult.error}`);
        
        // Check if this is a known creator authority mismatch error
        if (pumpswapResult.error?.includes('ConstraintSeeds') || 
            pumpswapResult.error?.includes('0x7d6') ||
            pumpswapResult.error?.includes('coin_creator_vault_authority')) {
          logger.warn(`[${logId}] Detected creator authority mismatch - this token may have inconsistent creator data`);
          
          return {
            success: false,
            signature: '',
            platform: 'pumpswap',
            error: `Token has creator authority mismatch between PumpFun and Pumpswap. This token cannot be traded through either platform due to inconsistent on-chain data. Error: ${pumpswapResult.error}`
          };
        }
        
      } catch (error: any) {
        logger.warn(`[${logId}] Graduation check failed, falling back to standard detection: ${error.message}`);
      }
    }
    
    // Try PumpFun first for non-graduated tokens or as fallback
    logger.info(`[${logId}] Attempting PumpFun buy with bonding curve detection`);
    
    try {
      const pumpfunResult = await executeExternalPumpFunBuy(
        tokenAddress,
        bs58.encode(buyerKeypair.secretKey),
        solAmount
      );
      
      if (pumpfunResult.success && pumpfunResult.signature) {
        return {
          success: true,
          signature: pumpfunResult.signature,
          platform: 'pumpfun',
          solReceived: solAmount.toString()
        };
      }
      
      // Log PumpFun failure details
      logger.warn(`[${logId}] PumpFun buy failed: ${pumpfunResult.signature || 'Unknown error'}`);
      
    } catch (error: any) {
      logger.warn(`[${logId}] PumpFun buy threw error (likely not PumpFun token): ${error.message}`);
    }
    
    // Try Pumpswap as fallback if not already tried
    if (!isGraduated) {
      logger.info(`[${logId}] Attempting Pumpswap buy as fallback`);
      
      try {
        const pumpswapResult = await executePumpswapBuy(tokenAddress, buyerKeypair, solAmount);
        
        if (pumpswapResult.success) {
          return {
            success: true,
            signature: pumpswapResult.signature,
            platform: 'pumpswap',
            solReceived: pumpswapResult.solReceived
          };
        }
        
        logger.warn(`[${logId}] Pumpswap buy failed: ${pumpswapResult.error}`);
        
        // Check for creator authority mismatch in fallback too
        if (pumpswapResult.error?.includes('ConstraintSeeds') || 
            pumpswapResult.error?.includes('0x7d6') ||
            pumpswapResult.error?.includes('coin_creator_vault_authority')) {
          
          return {
            success: false,
            signature: '',
            platform: 'pumpswap',
            error: `Token has creator authority mismatch. This appears to be a token with inconsistent on-chain creator data that cannot be traded through standard DEX interfaces. Error: ${pumpswapResult.error}`
          };
        }
        
      } catch (error: any) {
        logger.error(`[${logId}] Pumpswap buy threw error: ${error.message}`);
      }
    }
    
    // Both methods failed
    return {
      success: false,
      signature: '',
      platform: 'unknown',
      error: 'Both PumpFun and Pumpswap transactions failed. This token may not be tradeable or may have account derivation issues.'
    };
    
  } catch (error: any) {
    logger.error(`[${logId}] External buy failed with unexpected error:`, error);
    return {
      success: false,
      signature: '',
      platform: 'unknown',
      error: `Unexpected error: ${error.message}`
    };
  }
} 