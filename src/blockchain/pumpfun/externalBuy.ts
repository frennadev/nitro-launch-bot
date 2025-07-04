import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { logger } from "../common/logger";
import { getCachedPlatform, markTokenAsPumpFun, markTokenAsPumpswap, isTokenGraduated } from "../../service/token-detection-service";
import { executeExternalPumpFunBuy } from "./buy";
import { executeJupiterBuy, isJupiterSupported } from "./jupiterBuy";
import PumpswapService from "../../service/pumpswap-service";
import bs58 from "bs58";
import { connection } from "../../service/config";

export interface ExternalBuyResult {
  success: boolean;
  signature: string;
  error?: string;
  platform?: 'jupiter' | 'pumpswap' | 'pumpfun' | 'unknown';
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
      amount: BigInt(Math.ceil(solAmount * LAMPORTS_PER_SOL)),
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
 * Execute external token buy with Jupiter as primary for graduated tokens
 * Flow: Jupiter (for graduated) -> Pumpswap -> PumpFun
 */
export async function executeExternalBuy(
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number
): Promise<ExternalBuyResult> {
  const logId = `external-buy-${tokenAddress.substring(0, 8)}`;
  
  try {
    logger.info(`[${logId}] Starting external token buy for ${solAmount} SOL`);
    
    // Check if token has graduated first to optimize routing
    const graduated = await isTokenGraduated(tokenAddress);
    logger.info(`[${logId}] Token graduation status: ${graduated ? 'graduated' : graduated === false ? 'active' : 'unknown'}`);
    
    if (graduated === true) {
      logger.info(`[${logId}] Token has graduated to Raydium - trying Jupiter first (universal DEX aggregator)`);
      
      // Try Jupiter first for graduated tokens
      if (await isJupiterSupported(tokenAddress)) {
        logger.info(`[${logId}] Attempting Jupiter buy for graduated token...`);
        try {
          const jupiterResult = await executeJupiterBuy({
            tokenAddress,
            solAmount,
            walletPrivateKey: bs58.encode(buyerKeypair.secretKey),
            userId: "external_buy", // Placeholder for external buys
            slippageBps: 100, // 1% slippage
            priorityLevel: "high"
          });
          
          if (jupiterResult.success) {
            return {
              success: true,
              signature: jupiterResult.signature!,
              platform: 'jupiter',
              solReceived: solAmount.toString()
            };
          }
          
          logger.warn(`[${logId}] Jupiter buy failed: ${jupiterResult.error}`);
        } catch (error: any) {
          logger.warn(`[${logId}] Jupiter buy threw error: ${error.message}`);
        }
      }
      
      // Try Pumpswap as fallback for graduated tokens
      try {
        logger.info(`[${logId}] Trying Pumpswap as fallback for graduated token...`);
        const pumpswapResult = await executePumpswapBuy(tokenAddress, buyerKeypair, solAmount);
        
        if (pumpswapResult.success) {
          return {
            success: true,
            signature: pumpswapResult.signature,
            platform: 'pumpswap',
            solReceived: pumpswapResult.solReceived
          };
        }
        
        logger.warn(`[${logId}] Pumpswap buy failed for graduated token: ${pumpswapResult.error}`);
        
      } catch (error: any) {
        logger.warn(`[${logId}] Pumpswap buy threw error: ${error.message}`);
      }
      
      // For graduated tokens, we should NOT try PumpFun as it will fail with error 6005
      logger.warn(`[${logId}] All platforms failed for graduated token - skipping PumpFun (would fail with BondingCurveComplete error)`);
      
      return {
        success: false,
        signature: '',
        platform: 'unknown',
        error: 'Token has graduated to Raydium but is not available on Jupiter or Pumpswap. It may be a very new graduation or have liquidity issues.'
      };
    }
    
    // For non-graduated tokens or unknown status, try PumpFun first
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
      
      logger.warn(`[${logId}] PumpFun buy failed: ${pumpfunResult.signature || 'Unknown error'}`);
      
    } catch (error: any) {
      logger.warn(`[${logId}] PumpFun buy threw error (likely not PumpFun token): ${error.message}`);
    }
    
    // Try Jupiter as fallback for non-graduated tokens
    if (await isJupiterSupported(tokenAddress)) {
      logger.info(`[${logId}] Trying Jupiter as fallback...`);
      try {
        const jupiterResult = await executeJupiterBuy({
          tokenAddress,
          solAmount,
          walletPrivateKey: bs58.encode(buyerKeypair.secretKey),
          userId: "external_buy", // Placeholder for external buys
          slippageBps: 150, // Higher slippage for fallback
          priorityLevel: "veryHigh"
        });
        
        if (jupiterResult.success) {
          return {
            success: true,
            signature: jupiterResult.signature!,
            platform: 'jupiter',
            solReceived: solAmount.toString()
          };
        }
        
        logger.warn(`[${logId}] Jupiter fallback failed: ${jupiterResult.error}`);
      } catch (error: any) {
        logger.warn(`[${logId}] Jupiter fallback threw error: ${error.message}`);
      }
    }
    
    // Try Pumpswap as final fallback
    try {
      logger.info(`[${logId}] Trying Pumpswap as final fallback...`);
      const pumpswapResult = await executePumpswapBuy(tokenAddress, buyerKeypair, solAmount);
      
      if (pumpswapResult.success) {
        return {
          success: true,
          signature: pumpswapResult.signature,
          platform: 'pumpswap',
          solReceived: pumpswapResult.solReceived
        };
      }
      
      logger.warn(`[${logId}] Pumpswap fallback failed: ${pumpswapResult.error}`);
      
    } catch (error: any) {
      logger.warn(`[${logId}] Pumpswap fallback threw error: ${error.message}`);
    }
    
    // All methods failed
    return {
      success: false,
      signature: '',
      platform: 'unknown',
      error: 'All trading platforms failed (Jupiter, Pumpswap, PumpFun). This token may not be tradeable or may have technical issues.'
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