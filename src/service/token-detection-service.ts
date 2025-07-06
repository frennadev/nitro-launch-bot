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

export interface TokenLaunchStatus {
  isLaunched: boolean;
  isListed: boolean;
  platform?: 'pumpswap' | 'pumpfun' | 'raydium' | 'jupiter' | 'unknown';
  hasLiquidity: boolean;
  hasTradingVolume: boolean;
  lastActivity?: Date;
  error?: string;
}

// Cache for platform detection results
const platformCache = new Map<string, { 
  platform: 'pumpswap' | 'pumpfun' | 'unknown', 
  timestamp: number,
  permanent: boolean 
}>();

// Cache for launch status detection results
const launchStatusCache = new Map<string, { 
  status: TokenLaunchStatus, 
  timestamp: number 
}>();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes for non-permanent entries
const LAUNCH_STATUS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes for launch status

/**
 * Fast lightweight platform detection for UI display
 * Skips expensive bonding curve checks for recently cached tokens
 */
export async function detectTokenPlatformFast(tokenAddress: string): Promise<'pumpswap' | 'pumpfun' | 'unknown'> {
  // Check cache first
  const cached = getCachedPlatform(tokenAddress);
  if (cached) {
    // If we have a recent cache result, use it without re-checking
    // Only re-check if the cache is old and not permanent
    const cacheEntry = platformCache.get(tokenAddress);
    if (cacheEntry?.permanent || (Date.now() - cacheEntry!.timestamp < 60000)) { // 1 minute for fast checks
      return cached;
    }
  }
  
  // For new tokens or old cache, do a quick check
  return await detectTokenPlatform(tokenAddress);
}

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
      logger.info(`[${logId}]: No bonding curve account - likely native Pumpswap token or non-PumpFun token`);
      return null; // No bonding curve = not a PumpFun token
    }
    
    const bondingCurveData = await getBondingCurveData(bondingCurve);
    if (!bondingCurveData) {
      logger.warn(`[${logId}]: Could not decode bonding curve data`);
      return null;
    }
    
    const isGraduated = bondingCurveData.complete;
    logger.info(`[${logId}]: Token graduation status: ${isGraduated ? 'graduated' : 'active'}`);
    
    // Additional debugging for graduated tokens
    if (isGraduated) {
      logger.info(`[${logId}]: Token has graduated to Raydium - should be available on Jupiter or Pumpswap`);
      logger.info(`[${logId}]: Creator: ${bondingCurveData.creator}`);
      logger.info(`[${logId}]: Virtual token reserves: ${bondingCurveData.virtualTokenReserves.toString()}`);
      logger.info(`[${logId}]: Virtual SOL reserves: ${bondingCurveData.virtualSolReserves.toString()}`);
    } else {
      logger.info(`[${logId}]: Token still on PumpFun bonding curve - should use PumpFun`);
    }
    
    return isGraduated;
    
  } catch (error: any) {
    logger.error(`[${logId}]: Error checking graduation status: ${error.message}`);
    return null;
  }
}

/**
 * Comprehensive check to determine if a token is already launched/listed
 * Checks multiple sources: PumpFun bonding curve, Raydium pools, Jupiter, and on-chain data
 */
export async function detectTokenLaunchStatus(tokenAddress: string): Promise<TokenLaunchStatus> {
  const logId = `launch-detect-${tokenAddress.substring(0, 8)}`;
  logger.info(`[${logId}]: Starting comprehensive token launch status detection`);
  
  // Check cache first
  const cached = getCachedLaunchStatus(tokenAddress);
  if (cached) {
    logger.info(`[${logId}]: Using cached launch status result`);
    return cached;
  }
  
  const startTime = performance.now();
  
  try {
    const mintPk = new PublicKey(tokenAddress);
    
    // Parallel checks for maximum efficiency
    const checks = await Promise.allSettled([
      checkPumpFunBondingCurve(mintPk, logId),
      checkRaydiumPool(mintPk, logId),
      checkJupiterToken(mintPk, logId),
      checkOnChainTokenData(mintPk, logId)
    ]);
    
    // Process results
    const results = checks.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        logger.warn(`[${logId}]: Check ${index} failed: ${result.reason}`);
        return null;
      }
    });
    
    // Aggregate results
    const launchStatus = aggregateLaunchStatus(results, logId);
    
    // Cache the result
    setCachedLaunchStatus(tokenAddress, launchStatus);
    
    const detectionTime = performance.now() - startTime;
    logger.info(`[${logId}]: Launch status detection completed in ${Math.round(detectionTime)}ms`, launchStatus);
    
    return launchStatus;
    
  } catch (error: any) {
    logger.error(`[${logId}]: Launch status detection error: ${error.message}`);
    return {
      isLaunched: false,
      isListed: false,
      platform: 'unknown',
      hasLiquidity: false,
      hasTradingVolume: false,
      error: error.message
    };
  }
}

/**
 * Check if token has a PumpFun bonding curve (indicates it was launched on PumpFun)
 */
async function checkPumpFunBondingCurve(mintPk: PublicKey, logId: string): Promise<Partial<TokenLaunchStatus> | null> {
  try {
    const { bondingCurve } = getBondingCurve(mintPk);
    const accountInfo = await connection.getAccountInfo(bondingCurve, "confirmed");
    
    if (accountInfo?.data) {
      const bondingCurveData = await getBondingCurveData(bondingCurve);
      if (bondingCurveData) {
        logger.info(`[${logId}]: PumpFun bonding curve found - token was launched on PumpFun`);
        return {
          isLaunched: true,
          isListed: true,
          platform: 'pumpfun',
          hasLiquidity: true, // Bonding curve indicates liquidity
          hasTradingVolume: bondingCurveData.complete ? false : true, // Active if not graduated
          lastActivity: new Date()
        };
      }
    }
    return null;
  } catch (error: any) {
    logger.warn(`[${logId}]: PumpFun bonding curve check failed: ${error.message}`);
    return null;
  }
}

/**
 * Check if token has a Raydium pool (indicates it's listed on Raydium)
 */
async function checkRaydiumPool(mintPk: PublicKey, logId: string): Promise<Partial<TokenLaunchStatus> | null> {
  try {
    // Check if token has a market ID (indicates it's listed on Raydium)
    const { getMarketId } = await import("../get-marketId");
    const marketId = await getMarketId(mintPk.toBase58());
    
    if (marketId) {
      logger.info(`[${logId}]: Raydium market found - token is listed on Raydium`);
      return {
        isLaunched: true,
        isListed: true,
        platform: 'raydium',
        hasLiquidity: true,
        hasTradingVolume: true,
        lastActivity: new Date()
      };
    }
    return null;
  } catch (error: any) {
    logger.warn(`[${logId}]: Raydium pool check failed: ${error.message}`);
    return null;
  }
}

/**
 * Check if token is available on Jupiter (indicates it's listed and tradeable)
 */
async function checkJupiterToken(mintPk: PublicKey, logId: string): Promise<Partial<TokenLaunchStatus> | null> {
  try {
    // Check if token is available on Jupiter
    const response = await fetch(`https://token.jup.ag/all`);
    if (!response.ok) {
      throw new Error(`Jupiter API returned ${response.status}`);
    }
    
    const tokens = await response.json() as any[];
    const token = tokens.find((t: any) => t.address === mintPk.toBase58());
    
    if (token) {
      logger.info(`[${logId}]: Token found on Jupiter - token is listed and tradeable`);
      return {
        isLaunched: true,
        isListed: true,
        platform: 'jupiter',
        hasLiquidity: true,
        hasTradingVolume: true,
        lastActivity: new Date()
      };
    }
    return null;
  } catch (error: any) {
    logger.warn(`[${logId}]: Jupiter token check failed: ${error.message}`);
    return null;
  }
}

/**
 * Check on-chain token data (mint account, metadata, etc.)
 */
async function checkOnChainTokenData(mintPk: PublicKey, logId: string): Promise<Partial<TokenLaunchStatus> | null> {
  try {
    // Check if mint account exists and has data
    const mintInfo = await connection.getAccountInfo(mintPk, "confirmed");
    
    if (mintInfo?.data) {
      // Check if token has metadata (simplified check without metaplex dependency)
      const { getAssociatedTokenAddress } = await import("@solana/spl-token");
      const metadataAddress = await getAssociatedTokenAddress(mintPk, mintPk);
      const metadataInfo = await connection.getAccountInfo(metadataAddress, "confirmed");
      
      if (metadataInfo?.data) {
        logger.info(`[${logId}]: On-chain token data found - token exists with metadata`);
        return {
          isLaunched: true,
          isListed: false, // On-chain existence doesn't guarantee listing
          platform: 'unknown',
          hasLiquidity: false,
          hasTradingVolume: false,
          lastActivity: new Date()
        };
      }
    }
    return null;
  } catch (error: any) {
    logger.warn(`[${logId}]: On-chain token data check failed: ${error.message}`);
    return null;
  }
}

/**
 * Aggregate results from multiple checks into a single launch status
 */
function aggregateLaunchStatus(results: (Partial<TokenLaunchStatus> | null)[], logId: string): TokenLaunchStatus {
  const validResults = results.filter(r => r !== null) as Partial<TokenLaunchStatus>[];
  
  if (validResults.length === 0) {
    logger.info(`[${logId}]: No launch indicators found - token appears to be unlaunched`);
    return {
      isLaunched: false,
      isListed: false,
      platform: 'unknown',
      hasLiquidity: false,
      hasTradingVolume: false
    };
  }
  
  // Determine if launched (any platform found)
  const isLaunched = validResults.some(r => r.isLaunched);
  
  // Determine if listed (has liquidity or trading volume)
  const isListed = validResults.some(r => r.isListed);
  
  // Determine platform (prioritize PumpFun > Raydium > Jupiter > unknown)
  let platform: 'pumpswap' | 'pumpfun' | 'raydium' | 'jupiter' | 'unknown' = 'unknown';
  if (validResults.some(r => r.platform === 'pumpfun')) platform = 'pumpfun';
  else if (validResults.some(r => r.platform === 'raydium')) platform = 'raydium';
  else if (validResults.some(r => r.platform === 'jupiter')) platform = 'jupiter';
  
  // Determine liquidity and trading volume
  const hasLiquidity = validResults.some(r => r.hasLiquidity);
  const hasTradingVolume = validResults.some(r => r.hasTradingVolume);
  
  // Get most recent activity
  const lastActivity = validResults
    .filter(r => r.lastActivity)
    .sort((a, b) => (b.lastActivity?.getTime() || 0) - (a.lastActivity?.getTime() || 0))[0]?.lastActivity;
  
  logger.info(`[${logId}]: Aggregated launch status`, {
    isLaunched,
    isListed,
    platform,
    hasLiquidity,
    hasTradingVolume,
    lastActivity: lastActivity?.toISOString()
  });
  
  return {
    isLaunched,
    isListed,
    platform,
    hasLiquidity,
    hasTradingVolume,
    lastActivity
  };
}

/**
 * Quick check if token is already launched (cached result preferred)
 */
export async function isTokenAlreadyLaunched(tokenAddress: string): Promise<boolean> {
  try {
    const status = await detectTokenLaunchStatus(tokenAddress);
    return status.isLaunched;
  } catch (error) {
    logger.error(`Error checking if token is already launched:`, error);
    return false; // Default to false on error to allow launch
  }
}

/**
 * Quick check if token is already listed (cached result preferred)
 */
export async function isTokenAlreadyListed(tokenAddress: string): Promise<boolean> {
  try {
    const status = await detectTokenLaunchStatus(tokenAddress);
    return status.isListed;
  } catch (error) {
    logger.error(`Error checking if token is already listed:`, error);
    return false; // Default to false on error to allow launch
  }
}

/**
 * Get cached launch status result
 */
function getCachedLaunchStatus(tokenAddress: string): TokenLaunchStatus | null {
  const cached = launchStatusCache.get(tokenAddress);
  if (!cached) return null;
  
  // Check if cache is still valid
  if (Date.now() - cached.timestamp > LAUNCH_STATUS_CACHE_TTL) {
    launchStatusCache.delete(tokenAddress);
    return null;
  }
  
  return cached.status;
}

/**
 * Cache launch status result
 */
function setCachedLaunchStatus(tokenAddress: string, status: TokenLaunchStatus) {
  launchStatusCache.set(tokenAddress, {
    status,
    timestamp: Date.now()
  });
  logger.info(`[launch-status-cache]: Cached ${tokenAddress.substring(0, 8)} launch status`);
}

/**
 * Clear launch status cache for a specific token
 */
export function clearLaunchStatusCache(tokenAddress: string) {
  launchStatusCache.delete(tokenAddress);
  logger.info(`[launch-status-cache]: Cleared cache for ${tokenAddress.substring(0, 8)}`);
}

/**
 * Clear all launch status cache
 */
export function clearAllLaunchStatusCache() {
  const count = launchStatusCache.size;
  launchStatusCache.clear();
  logger.info(`[launch-status-cache]: Cleared all cache entries (${count} entries)`);
} 