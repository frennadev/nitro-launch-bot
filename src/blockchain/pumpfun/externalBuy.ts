import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { logger } from "../common/logger";
import { getCachedPlatform, markTokenAsPumpFun, markTokenAsPumpswap, isTokenGraduated } from "../../service/token-detection-service";
import { executeExternalPumpFunBuy } from "./buy";
import PumpswapService from "../../service/pumpswap-service";
import bs58 from "bs58";
import { connection } from "../../service/config";

export interface ExternalBuyResult {
  success: boolean;
  signature?: string;
  error?: string;
  platform?: 'pumpswap' | 'pumpfun';
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
  logger.info(`[${logId}] Starting external buy for ${solAmount} SOL`);

  try {
    // Start Pumpswap data preloading immediately (coordinated with transaction)
    const pumpswapService = new PumpswapService();
    const preloadPromise = pumpswapService.preloadTokenData(tokenAddress);

    // Check if we have cached platform info from token display
    const cachedPlatform = getCachedPlatform(tokenAddress);
    
    if (cachedPlatform === 'pumpswap') {
      logger.info(`[${logId}] Using cached Pumpswap detection - going directly to Pumpswap`);
      // Try Pumpswap first since it's cached as confirmed Pumpswap
      try {
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
          throw new Error(`Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }
        
        logger.info(`[${logId}] Pumpswap buy successful: ${signature}`);
        markTokenAsPumpswap(tokenAddress); // Mark as permanently Pumpswap
        return {
          success: true,
          signature,
          platform: 'pumpswap'
        };
         
      } catch (pumpswapError: any) {
        logger.error(`[${logId}] Pumpswap buy failed for cached Pumpswap token:`, pumpswapError);
        // Fall through to try PumpFun
      }
    }
    
    if (cachedPlatform === 'pumpfun') {
      logger.info(`[${logId}] Using cached PumpFun detection`);
      
      // Even if cached as PumpFun, check if it has graduated (for optimal routing)
      try {
        const graduated = await isTokenGraduated(tokenAddress);
        if (graduated === true) {
          logger.info(`[${logId}] Cached PumpFun token has graduated - switching to Pumpswap for better performance`);
          markTokenAsPumpswap(tokenAddress); // Update cache to Pumpswap
          
          // Route to Pumpswap for graduated tokens
          const privateKeyBase58 = bs58.encode(buyerKeypair.secretKey);
          
          const buyData = {
            mint: new PublicKey(tokenAddress),
            amount: BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL)),
            privateKey: privateKeyBase58
          };
          
          logger.info(`[${logId}] Creating Pumpswap buy transaction for graduated token...`);
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
            throw new Error(`Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }
          
          logger.info(`[${logId}] Pumpswap buy successful for graduated token: ${signature}`);
          return {
            success: true,
            signature,
            platform: 'pumpswap'
          };
        } else if (graduated === false) {
          logger.info(`[${logId}] Token is still on PumpFun bonding curve - routing to PumpFun`);
          // Continue to PumpFun logic below
        } else {
          logger.info(`[${logId}] Could not determine graduation status - using fallback detection`);
          // Continue to fallback logic below
        }
      } catch (graduationError: any) {
        logger.warn(`[${logId}] Could not check graduation status, proceeding with cached PumpFun: ${graduationError.message}`);
      }
      
      // Try PumpFun directly since it's cached as confirmed PumpFun (and not graduated)
      try {
        const result = await executeExternalPumpFunBuy(
          tokenAddress,
          bs58.encode(buyerKeypair.secretKey),
          solAmount
        );
        
        if (result.success && result.signature) {
          logger.info(`[${logId}] PumpFun buy successful: ${result.signature}`);
          markTokenAsPumpFun(tokenAddress); // Mark as permanently PumpFun
          return {
            success: true,
            signature: result.signature,
            platform: 'pumpfun'
          };
        } else {
          logger.info(`[${logId}] PumpFun buy failed (possibly incorrect cache)`);
          // Fall through to try Pumpswap
        }
      } catch (pumpfunError: any) {
        logger.info(`[${logId}] PumpFun buy threw error: ${pumpfunError.message}`);
        // Fall through to try Pumpswap
      }
    }
    
    // First, check if token has graduated (fast routing decision)
    try {
      const graduated = await isTokenGraduated(tokenAddress);
      if (graduated === true) {
        logger.info(`[${logId}] Token has graduated to Raydium - routing directly to Pumpswap`);
        
        // Route directly to Pumpswap for graduated tokens
        const privateKeyBase58 = bs58.encode(buyerKeypair.secretKey);
        
        const buyData = {
          mint: new PublicKey(tokenAddress),
          amount: BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL)),
          privateKey: privateKeyBase58
        };
        
        logger.info(`[${logId}] Creating Pumpswap buy transaction for graduated token...`);
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
          throw new Error(`Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }
        
        logger.info(`[${logId}] Pumpswap buy successful for graduated token: ${signature}`);
        markTokenAsPumpswap(tokenAddress); // Mark as permanently Pumpswap
        return {
          success: true,
          signature,
          platform: 'pumpswap'
        };
      } else if (graduated === false) {
        logger.info(`[${logId}] Token is still on PumpFun bonding curve - routing to PumpFun`);
        // Continue to PumpFun logic below
      } else {
        logger.info(`[${logId}] Could not determine graduation status - using fallback detection`);
        // Continue to fallback logic below
      }
    } catch (graduationError: any) {
      logger.warn(`[${logId}] Graduation check failed, falling back to standard detection: ${graduationError.message}`);
    }
    
    // Try PumpFun first using bonding curve detection (for non-graduated or unknown tokens)
    logger.info(`[${logId}] Attempting PumpFun buy with bonding curve detection`);
    try {
      const result = await executeExternalPumpFunBuy(
        tokenAddress,
        bs58.encode(buyerKeypair.secretKey),
        solAmount
      );
      
      if (result.success && result.signature) {
        logger.info(`[${logId}] PumpFun buy successful: ${result.signature}`);
        markTokenAsPumpFun(tokenAddress); // Mark as permanently PumpFun
        return {
          success: true,
          signature: result.signature,
          platform: 'pumpfun'
        };
      } else {
        logger.info(`[${logId}] PumpFun buy failed (likely not PumpFun token)`);
        // If PumpFun fails, it's likely a Pumpswap token
      }
    } catch (pumpfunError: any) {
      logger.info(`[${logId}] PumpFun buy threw error (likely not PumpFun token): ${pumpfunError.message}`);
      // If PumpFun throws error, it's likely a Pumpswap token
    }

    // Try Pumpswap as fallback
    logger.info(`[${logId}] Attempting Pumpswap buy as fallback`);
    try {
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
        throw new Error(`Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      logger.info(`[${logId}] Pumpswap buy successful: ${signature}`);
      markTokenAsPumpswap(tokenAddress); // Mark as permanently Pumpswap
      return {
        success: true,
        signature,
        platform: 'pumpswap'
      };
      
    } catch (pumpswapError: any) {
      logger.error(`[${logId}] Pumpswap buy failed:`, pumpswapError);
      return {
        success: false,
        error: `Both platforms failed. PumpFun: bonding curve not found. Pumpswap: ${pumpswapError.message}`
      };
    }

  } catch (error: any) {
    logger.error(`[${logId}] External buy error:`, error);
    return {
      success: false,
      error: error.message
    };
  }
} 