import { ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";
import { SmartPriorityFeeConfig } from "./unified-config";

/**
 * Create a smart priority fee instruction using unified configuration
 */
export function createUnifiedPriorityFeeInstruction(
  retryCount: number,
  config: SmartPriorityFeeConfig
): TransactionInstruction {
  const calculatedFee = Math.floor(
    config.baseFee * Math.pow(config.retryMultiplier, retryCount)
  );
  const finalFee = Math.max(config.minFee, Math.min(calculatedFee, config.maxFee));
  
  return ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: finalFee,
  });
}

/**
 * Calculate priority fee for a given retry attempt
 */
export function calculatePriorityFee(
  retryCount: number,
  config: SmartPriorityFeeConfig
): number {
  const calculatedFee = Math.floor(
    config.baseFee * Math.pow(config.retryMultiplier, retryCount)
  );
  return Math.max(config.minFee, Math.min(calculatedFee, config.maxFee));
}

/**
 * Get priority fee configuration for different transaction types
 */
export function getTransactionTypePriorityConfig(
  transactionType: "buy" | "sell" | "ultra_fast" = "buy"
): SmartPriorityFeeConfig {
  switch (transactionType) {
    case "ultra_fast":
      return {
        baseFee: 3_000_000, // 3M microLamports (0.003 SOL)
        retryMultiplier: 2.0, // 100% increase per retry
        maxFee: 25_000_000, // 25M microLamports (0.025 SOL)
        minFee: 1_000_000, // 1M microLamports (0.001 SOL)
      };
    case "buy":
      return {
        baseFee: 1_500_000, // 1.5M microLamports (0.0015 SOL)
        retryMultiplier: 1.5, // 50% increase per retry
        maxFee: 12_000_000, // 12M microLamports (0.012 SOL)
        minFee: 300_000, // 300K microLamports (0.0003 SOL)
      };
    case "sell":
      return {
        baseFee: 1_000_000, // 1M microLamports (0.001 SOL)
        retryMultiplier: 1.5, // 50% increase per retry
        maxFee: 8_000_000, // 8M microLamports (0.008 SOL)
        minFee: 200_000, // 200K microLamports (0.0002 SOL)
      };
    default:
      return {
        baseFee: 1_000_000,
        retryMultiplier: 1.5,
        maxFee: 10_000_000,
        minFee: 100_000,
      };
  }
} 