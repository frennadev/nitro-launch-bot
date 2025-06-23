import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { detectTokenPlatform } from "../../service/token-detection-service";
import PumpswapService from "../../service/pumpswap-service";
import { logger } from "../common/logger";
import { executeFundingBuy } from "./buy";
import bs58 from "bs58";

interface ExternalBuyResult {
  success: boolean;
  signature?: string;
  error?: string;
  platform?: 'pumpswap' | 'pumpfun';
  tokensReceived?: string;
}

/**
 * Executes a buy transaction for an external token.
 * Automatically detects if token is on Pumpswap or PumpFun and uses appropriate method.
 * @param tokenAddress The address of the token to buy
 * @param buyerKeypair The keypair of the buyer wallet
 * @param solAmount The amount of SOL to spend on the token
 * @returns The transaction result
 */
export async function executeExternalBuy(tokenAddress: string, buyerKeypair: Keypair, solAmount: number): Promise<ExternalBuyResult> {
  const logId = `external-buy-${tokenAddress.substring(0, 8)}`;
  const walletId = buyerKeypair.publicKey.toBase58().substring(0, 8);
  
  logger.info(`[${logId}] Starting external buy: ${solAmount} SOL for token ${tokenAddress} from wallet ${walletId}...`);
  
  try {
    // Validate inputs
    if (solAmount <= 0) {
      throw new Error('SOL amount must be greater than 0');
    }
    
    if (solAmount < 0.001) {
      throw new Error('Minimum buy amount is 0.001 SOL');
    }
    
    // Try to get platform from cache first (for speed)
    let detection: any;
    try {
      const { getPlatformFromCache } = await import('../../bot/index');
      const cachedPlatform = getPlatformFromCache(tokenAddress);
      
      if (cachedPlatform) {
        logger.info(`[${logId}] Using cached platform detection: ${cachedPlatform}`);
        detection = {
          isPumpswap: cachedPlatform === 'pumpswap',
          isPumpfun: cachedPlatform === 'pumpfun',
          error: cachedPlatform === 'unknown' ? 'Token not found on supported platforms' : undefined
        };
      } else {
        logger.info(`[${logId}] No cached platform found, detecting token platform...`);
        detection = await detectTokenPlatform(tokenAddress);
      }
    } catch (cacheError) {
      logger.warn(`[${logId}] Cache access failed, falling back to detection:`, cacheError);
      logger.info(`[${logId}] Detecting token platform...`);
      detection = await detectTokenPlatform(tokenAddress);
    }
    
    if (detection.error) {
      logger.error(`[${logId}] Token detection failed:`, detection.error);
      return {
        success: false,
        error: detection.error
      };
    }
    
    // Try Pumpswap first if available
    if (detection.isPumpswap) {
      logger.info(`[${logId}] Token detected on Pumpswap, using Pumpswap service`);
      
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
        const { connection } = await import('../../service/config');
        const signature = await connection.sendTransaction(buyTx, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 3
        });
        
        logger.info(`[${logId}] Pumpswap transaction sent: ${signature}`);
        
        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        
        if (confirmation.value.err) {
          throw new Error(`Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }
        
        logger.info(`[${logId}] Pumpswap buy successful: ${signature}`);
        
        return {
          success: true,
          signature,
          platform: 'pumpswap'
        };
        
      } catch (pumpswapError: any) {
        logger.error(`[${logId}] Pumpswap buy failed:`, pumpswapError);
        
        // If Pumpswap fails, try PumpFun as fallback
        if (detection.isPumpfun) {
          logger.info(`[${logId}] Falling back to PumpFun after Pumpswap failure`);
        } else {
          return {
            success: false,
            error: `Pumpswap buy failed: ${pumpswapError.message}`,
            platform: 'pumpswap'
          };
        }
      }
    }
    
    // Use PumpFun if token is on PumpFun or as fallback
    if (detection.isPumpfun) {
      logger.info(`[${logId}] Using PumpFun for token buy`);
      
      try {
        const privateKeyBase58 = bs58.encode(buyerKeypair.secretKey);
        
        logger.info(`[${logId}] Executing PumpFun buy...`);
        const { executeExternalPumpFunBuy } = await import('./buy');
        const pumpfunResult = await executeExternalPumpFunBuy(tokenAddress, privateKeyBase58, solAmount);
        
                 if (pumpfunResult.success && pumpfunResult.signature) {
           logger.info(`[${logId}] PumpFun buy successful: ${pumpfunResult.signature}`);
           
           return {
             success: true,
             signature: pumpfunResult.signature,
             platform: 'pumpfun'
           };
         } else {
          logger.error(`[${logId}] PumpFun buy failed`);
          return {
            success: false,
            error: 'PumpFun buy transaction failed',
            platform: 'pumpfun'
          };
        }
        
      } catch (pumpfunError: any) {
        logger.error(`[${logId}] PumpFun buy error:`, pumpfunError);
        return {
          success: false,
          error: `PumpFun buy failed: ${pumpfunError.message}`,
          platform: 'pumpfun'
        };
      }
    }
    
    // Token not found on either platform
    logger.error(`[${logId}] Token not available on supported platforms`);
    return {
      success: false,
      error: 'Token not available on supported platforms (Pumpswap or PumpFun)'
    };
    
  } catch (error: any) {
    logger.error(`[${logId}] External buy error:`, error);
    return {
      success: false,
      error: `External buy failed: ${error.message}`
    };
  }
} 