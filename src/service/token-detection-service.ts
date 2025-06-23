// Token Detection Service
// Determines whether to use Pumpswap or PumpFun for a given token

import { Connection, PublicKey } from "@solana/web3.js";
import { connection } from "../blockchain/common/connection";
import { getBondingCurve, getBondingCurveData } from "../blockchain/pumpfun/utils";
import { logger } from "../blockchain/common/logger";

export interface TokenDetectionResult {
  isPumpswap: boolean;
  isPumpfun: boolean;
  poolInfo?: any;
  error?: string;
}

// Cache for platform detection results
const platformCache = new Map<string, { 
  platform: 'pumpswap' | 'pumpfun' | 'unknown', 
  timestamp: number,
  permanent: boolean 
}>();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes for non-permanent entries

/**
 * Detect platform using bonding curve data fetching (same approach as launch process)
 * If bonding curve data can be fetched successfully, it's a PumpFun token
 * If bonding curve data cannot be fetched, it's likely a Pumpswap token
 * If bonding curve is complete (graduated), it should use Pumpswap
 */
export async function detectTokenPlatform(tokenAddress: string): Promise<'pumpswap' | 'pumpfun' | 'unknown'> {
  const logId = `platform-detect-${tokenAddress.substring(0, 8)}`;
  logger.info(`[${logId}]: Starting platform detection using bonding curve approach`);
  
  try {
    const mintPk = new PublicKey(tokenAddress);
    const { bondingCurve } = getBondingCurve(mintPk);
    
    logger.info(`[${logId}]: Attempting to fetch bonding curve data for PumpFun detection...`);
    const curveDataStart = performance.now();
    
    let bondingCurveData = null;
    
    try {
      // Use same parallel fetch strategy as launch process for maximum reliability
      const parallelFetchPromises = [
        // Most likely to succeed quickly
        (async () => {
          try {
            const accountInfo = await connection.getAccountInfo(bondingCurve, "processed");
            if (accountInfo?.data) {
              const data = await getBondingCurveData(bondingCurve);
              if (data) {
                logger.info(`[${logId}]: Bonding curve data fetch successful with 'processed' commitment`);
                return { data, commitment: "processed" };
              }
            }
          } catch (error) {
            return null;
          }
          return null;
        })(),
        
        // Backup with confirmed
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 500)); // Small delay to prefer processed
          try {
            const accountInfo = await connection.getAccountInfo(bondingCurve, "confirmed");
            if (accountInfo?.data) {
              const data = await getBondingCurveData(bondingCurve);
              if (data) {
                logger.info(`[${logId}]: Bonding curve data fetch successful with 'confirmed' commitment`);
                return { data, commitment: "confirmed" };
              }
            }
          } catch (error) {
            return null;
          }
          return null;
        })(),
        
        // Final fallback with finalized
        (async () => {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to prefer faster options
          try {
            const accountInfo = await connection.getAccountInfo(bondingCurve, "finalized");
            if (accountInfo?.data) {
              const data = await getBondingCurveData(bondingCurve);
              if (data) {
                logger.info(`[${logId}]: Bonding curve data fetch successful with 'finalized' commitment`);
                return { data, commitment: "finalized" };
              }
            }
          } catch (error) {
            return null;
          }
          return null;
        })()
      ];
      
      // Race to get the first successful result
      const results = await Promise.allSettled(parallelFetchPromises);
      const successfulResult = results.find(result => 
        result.status === 'fulfilled' && result.value !== null
      );
      
      if (successfulResult && successfulResult.status === 'fulfilled' && successfulResult.value) {
        bondingCurveData = successfulResult.value.data;
        const fetchTime = performance.now() - curveDataStart;
        logger.info(`[${logId}]: Parallel bonding curve fetch completed in ${Math.round(fetchTime)}ms using ${successfulResult.value.commitment} commitment`);
      }
      
    } catch (error: any) {
      logger.warn(`[${logId}]: Parallel bonding curve fetch failed: ${error.message}`);
    }
    
    // Fallback to sequential retry logic if parallel fetch failed
    if (!bondingCurveData) {
      logger.info(`[${logId}]: Parallel fetch failed, falling back to sequential retry logic...`);
      
      let retries = 0;
      const maxRetries = 3; // Shorter retry for platform detection
      const baseDelay = 500;
      
      while (!bondingCurveData && retries < maxRetries) {
        try {
          const commitmentLevel = retries < 1 ? "processed" : retries < 2 ? "confirmed" : "finalized";
          
          const accountInfo = await connection.getAccountInfo(bondingCurve, commitmentLevel);
          if (accountInfo && accountInfo.data) {
            bondingCurveData = await getBondingCurveData(bondingCurve);
            if (bondingCurveData) {
              logger.info(`[${logId}]: Sequential fallback successful on attempt ${retries + 1} with ${commitmentLevel} commitment`);
              break;
            }
          }
        } catch (error: any) {
          logger.warn(`[${logId}]: Sequential fallback attempt ${retries + 1} failed: ${error.message}`);
        }
        
        retries += 1;
        if (!bondingCurveData && retries < maxRetries) {
          const delay = baseDelay * (retries + 1);
          logger.info(`[${logId}]: Retrying in ${delay}ms (attempt ${retries}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    if (bondingCurveData) {
      // Successfully fetched bonding curve data = PumpFun token
      logger.info(`[${logId}]: Bonding curve data found - token originated from PumpFun`);
      logger.info(`[${logId}]: Bonding curve creator: ${bondingCurveData.creator}`);
      logger.info(`[${logId}]: Bonding curve complete: ${bondingCurveData.complete}`);
      
      // Check if bonding curve is complete (graduated to Raydium)
      if (bondingCurveData.complete) {
        logger.info(`[${logId}]: Token has graduated to Raydium - should use Pumpswap for best performance`);
        return 'pumpswap';
      } else {
        logger.info(`[${logId}]: Token still on PumpFun bonding curve - should use PumpFun`);
        logger.info(`[${logId}]: Virtual token reserves: ${bondingCurveData.virtualTokenReserves.toString()}`);
        logger.info(`[${logId}]: Virtual SOL reserves: ${bondingCurveData.virtualSolReserves.toString()}`);
        return 'pumpfun';
      }
    } else {
      // Could not fetch bonding curve data = likely Pumpswap token
      logger.info(`[${logId}]: No bonding curve data found - token is likely native Pumpswap`);
      return 'pumpswap';
    }
    
  } catch (error: any) {
    logger.error(`[${logId}]: Platform detection error: ${error.message}`);
    return 'unknown';
  }
}

/**
 * Get cached platform result or detect if not cached
 */
export function getCachedPlatform(tokenAddress: string): 'pumpswap' | 'pumpfun' | 'unknown' | null {
  const cached = platformCache.get(tokenAddress);
  if (!cached) return null;
  
  // Check if cache is still valid (permanent entries never expire)
  if (!cached.permanent && Date.now() - cached.timestamp > CACHE_TTL) {
    platformCache.delete(tokenAddress);
    return null;
  }
  
  return cached.platform;
}

/**
 * Cache platform detection result
 */
export function setCachedPlatform(tokenAddress: string, platform: 'pumpswap' | 'pumpfun' | 'unknown', permanent: boolean = false) {
  platformCache.set(tokenAddress, {
    platform,
    timestamp: Date.now(),
    permanent
  });
  logger.info(`[platform-cache]: Cached ${tokenAddress.substring(0, 8)} as ${platform} (permanent: ${permanent})`);
}

/**
 * Mark a token as Pumpswap permanently (used after successful Pumpswap operations)
 */
export function markTokenAsPumpswap(tokenAddress: string) {
  setCachedPlatform(tokenAddress, 'pumpswap', true);
}

/**
 * Mark a token as PumpFun permanently (used after successful PumpFun operations)
 */
export function markTokenAsPumpFun(tokenAddress: string) {
  setCachedPlatform(tokenAddress, 'pumpfun', true);
}

/**
 * Detect platform with caching
 */
export async function detectTokenPlatformWithCache(tokenAddress: string): Promise<'pumpswap' | 'pumpfun' | 'unknown'> {
  // Check cache first
  const cached = getCachedPlatform(tokenAddress);
  if (cached) {
    logger.info(`[platform-cache]: Using cached result for ${tokenAddress.substring(0, 8)}: ${cached}`);
    return cached;
  }
  
  // Detect and cache result
  const platform = await detectTokenPlatform(tokenAddress);
  setCachedPlatform(tokenAddress, platform, false);
  
  return platform;
}

/**
 * Quick check if token is likely a Pumpswap token
 * @param tokenAddress The token address to check
 * @returns True if token appears to be on Pumpswap
 */
export async function isPumpswapToken(tokenAddress: string): Promise<boolean> {
  try {
    const result = await detectTokenPlatform(tokenAddress);
    return result === 'pumpswap';
  } catch (error) {
    logger.error(`Error in isPumpswapToken check:`, error);
    return false;
  }
}

/**
 * Quick check if token is likely a PumpFun token
 * @param tokenAddress The token address to check
 * @returns True if token appears to be on PumpFun
 */
export async function isPumpfunToken(tokenAddress: string): Promise<boolean> {
  try {
    const result = await detectTokenPlatform(tokenAddress);
    return result === 'pumpfun';
  } catch (error) {
    logger.error(`Error in isPumpfunToken check:`, error);
    return false;
  }
}

/**
 * Quick check if a token has graduated to Raydium (bonding curve complete)
 * This is useful for making fast routing decisions
 */
export async function isTokenGraduated(tokenAddress: string): Promise<boolean | null> {
  const logId = `graduation-check-${tokenAddress.substring(0, 8)}`;
  
  try {
    const mintPk = new PublicKey(tokenAddress);
    const { bondingCurve } = getBondingCurve(mintPk);
    
    // Quick check with processed commitment for speed
    const accountInfo = await connection.getAccountInfo(bondingCurve, "processed");
    if (!accountInfo?.data) {
      logger.info(`[${logId}]: No bonding curve account - likely native Pumpswap token`);
      return null; // No bonding curve = not a PumpFun token
    }
    
    const bondingCurveData = await getBondingCurveData(bondingCurve);
    if (!bondingCurveData) {
      logger.warn(`[${logId}]: Could not decode bonding curve data`);
      return null;
    }
    
    logger.info(`[${logId}]: Token graduation status: ${bondingCurveData.complete ? 'graduated' : 'active'}`);
    return bondingCurveData.complete;
    
  } catch (error: any) {
    logger.error(`[${logId}]: Error checking graduation status: ${error.message}`);
    return null;
  }
} 