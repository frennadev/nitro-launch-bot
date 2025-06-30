import { ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";
import { logger } from "./logger";

/**
 * Smart priority fee configuration
 */
export interface SmartPriorityFeeConfig {
  /** Base priority fee in microLamports */
  baseFee: number;
  /** Multiplier for each retry (1.5 = 50% increase) */
  retryMultiplier: number;
  /** Maximum priority fee in microLamports */
  maxFee: number;
  /** Minimum priority fee in microLamports */
  minFee: number;
}

/**
 * Default smart priority fee configuration
 */
export const DEFAULT_SMART_PRIORITY_CONFIG: SmartPriorityFeeConfig = {
  baseFee: 1_000_000, // 1M microLamports (0.001 SOL)
  retryMultiplier: 1.5, // 50% increase per retry
  maxFee: 10_000_000, // 10M microLamports (0.01 SOL) max
  minFee: 100_000, // 100K microLamports (0.0001 SOL) min
};

/**
 * Ultra-fast priority fee configuration for PumpFun launches
 * Designed for maximum speed and success rate
 */
export const ULTRA_FAST_PRIORITY_CONFIG: SmartPriorityFeeConfig = {
  baseFee: 3_000_000, // 3M microLamports (0.003 SOL) - Higher base for speed
  retryMultiplier: 2.0, // 100% increase per retry for aggressive speed
  maxFee: 25_000_000, // 25M microLamports (0.025 SOL) - Very high max
  minFee: 1_000_000, // 1M microLamports (0.001 SOL) - Higher minimum
};

/**
 * Calculate smart priority fee based on retry attempt
 * @param retryAttempt Current retry attempt (0-based)
 * @param config Priority fee configuration
 * @returns Priority fee in microLamports
 */
export const calculateSmartPriorityFee = (
  retryAttempt: number,
  config: SmartPriorityFeeConfig = DEFAULT_SMART_PRIORITY_CONFIG
): number => {
  // Calculate fee with exponential increase
  const calculatedFee = Math.floor(config.baseFee * Math.pow(config.retryMultiplier, retryAttempt));
  
  // Apply min/max bounds
  const boundedFee = Math.max(config.minFee, Math.min(calculatedFee, config.maxFee));
  
  logger.info(`Smart priority fee calculation`, {
    retryAttempt,
    baseFee: config.baseFee,
    calculatedFee,
    boundedFee,
    multiplier: config.retryMultiplier,
  });
  
  return boundedFee;
};

/**
 * Create a priority fee instruction with smart fee calculation
 * @param retryAttempt Current retry attempt (0-based)
 * @param config Priority fee configuration
 * @returns ComputeBudgetProgram instruction
 */
export const createSmartPriorityFeeInstruction = (
  retryAttempt: number,
  config: SmartPriorityFeeConfig = DEFAULT_SMART_PRIORITY_CONFIG
): TransactionInstruction => {
  const priorityFee = calculateSmartPriorityFee(retryAttempt, config);
  
  return ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: priorityFee,
  });
};

/**
 * Get priority fee for different transaction types with ultra-fast option
 */
export const getTransactionTypePriorityConfig = (
  transactionType: "token_creation" | "buy" | "sell" | "transfer" | "ultra_fast_buy"
): SmartPriorityFeeConfig => {
  switch (transactionType) {
    case "ultra_fast_buy":
      return ULTRA_FAST_PRIORITY_CONFIG;
    case "token_creation":
      return {
        baseFee: 2_000_000, // Higher base for token creation
        retryMultiplier: 1.5,
        maxFee: 15_000_000, // Higher max for critical operations
        minFee: 500_000,
      };
    case "buy":
      return {
        baseFee: 1_500_000, // Higher base for buy transactions
        retryMultiplier: 1.5,
        maxFee: 12_000_000,
        minFee: 300_000,
      };
    case "sell":
      return {
        baseFee: 1_000_000, // Standard for sells
        retryMultiplier: 1.5,
        maxFee: 8_000_000,
        minFee: 200_000,
      };
    case "transfer":
      return {
        baseFee: 500_000, // Lower for simple transfers
        retryMultiplier: 1.5,
        maxFee: 5_000_000,
        minFee: 100_000,
      };
    default:
      return DEFAULT_SMART_PRIORITY_CONFIG;
  }
};

/**
 * Log priority fee information for debugging
 */
export const logPriorityFeeInfo = (
  transactionType: string,
  retryAttempt: number,
  priorityFee: number,
  logIdentifier: string
) => {
  const feeInSol = priorityFee / 1_000_000_000; // Convert microLamports to SOL
  
  logger.info(`[${logIdentifier}]: Smart priority fee applied`, {
    transactionType,
    retryAttempt,
    priorityFeeMicroLamports: priorityFee,
    priorityFeeSol: feeInSol.toFixed(6),
    increaseFromBase: retryAttempt > 0 ? `${((Math.pow(1.5, retryAttempt) - 1) * 100).toFixed(1)}%` : "0%",
  });
}; 