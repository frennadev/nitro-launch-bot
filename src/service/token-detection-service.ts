// Token Detection Service
// Determines whether to use Pumpswap or PumpFun for a given token

import { PublicKey } from '@solana/web3.js';
import { getTokenPoolInfo } from '../backend/get-poolInfo';
import { logger } from '../blockchain/common/logger';

export interface TokenDetectionResult {
  isPumpswap: boolean;
  isPumpfun: boolean;
  poolInfo?: any;
  error?: string;
}

/**
 * Detects whether a token is available on Pumpswap or PumpFun
 * @param tokenAddress The token address to check
 * @returns Detection result with platform availability
 */
export async function detectTokenPlatform(tokenAddress: string): Promise<TokenDetectionResult> {
  const logId = `token-detect-${tokenAddress.substring(0, 8)}`;
  
  try {
    // Validate token address
    const tokenMint = new PublicKey(tokenAddress);
    logger.info(`[${logId}] Detecting platform for token: ${tokenAddress}`);
    
    // First, try to get Pumpswap pool info
    try {
      const poolInfo = await getTokenPoolInfo(tokenAddress);
      
      if (poolInfo && poolInfo.poolId) {
        logger.info(`[${logId}] Token found on Pumpswap with pool: ${poolInfo.poolId.toBase58()}`);
        return {
          isPumpswap: true,
          isPumpfun: false,
          poolInfo
        };
      } else {
        logger.info(`[${logId}] Token not found on Pumpswap, checking PumpFun`);
      }
    } catch (error) {
      logger.warn(`[${logId}] Error checking Pumpswap:`, error);
    }
    
    // If not on Pumpswap, check if it's a PumpFun token
    // We can use the existing PumpFun detection logic
    try {
      // Import PumpFun utilities
      const { getBondingCurve, getBondingCurveData } = await import('../blockchain/pumpfun/utils');
      
      const { bondingCurve } = getBondingCurve(tokenMint);
      const bondingCurveData = await getBondingCurveData(bondingCurve);
      
      if (bondingCurveData) {
        logger.info(`[${logId}] Token found on PumpFun`);
        return {
          isPumpswap: false,
          isPumpfun: true
        };
      } else {
        logger.info(`[${logId}] Token not found on PumpFun either`);
      }
    } catch (error) {
      logger.warn(`[${logId}] Error checking PumpFun:`, error);
    }
    
    // Token not found on either platform
    logger.warn(`[${logId}] Token not found on Pumpswap or PumpFun`);
    return {
      isPumpswap: false,
      isPumpfun: false,
      error: 'Token not found on supported platforms (Pumpswap or PumpFun)'
    };
    
  } catch (error: any) {
    logger.error(`[${logId}] Error in token detection:`, error);
    return {
      isPumpswap: false,
      isPumpfun: false,
      error: `Token detection failed: ${error.message}`
    };
  }
}

/**
 * Quick check if token is likely a Pumpswap token
 * @param tokenAddress The token address to check
 * @returns True if token appears to be on Pumpswap
 */
export async function isPumpswapToken(tokenAddress: string): Promise<boolean> {
  try {
    const result = await detectTokenPlatform(tokenAddress);
    return result.isPumpswap;
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
    return result.isPumpfun;
  } catch (error) {
    logger.error(`Error in isPumpfunToken check:`, error);
    return false;
  }
} 