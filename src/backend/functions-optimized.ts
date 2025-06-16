import { connectionPool } from "../blockchain/common/connection-pool";
import { secretKeyToKeypair } from "../blockchain/common/utils-optimized";
import { decryptPrivateKey } from "./utils";
import { env } from "../config";
import { logger } from "../blockchain/common/logger";
import { LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { sendAndConfirmTransaction } from "@solana/web3.js";

// Optimized wallet balance checking with caching
export const getWalletBalance = async (publicKey: string): Promise<number> => {
  try {
    const balance = await connectionPool.getBalance(new PublicKey(publicKey));
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    logger.error(`Error getting wallet balance for ${publicKey}:`, error);
    return 0;
  }
};

// Batch wallet balance checking - much more efficient for multiple wallets
export const getBatchWalletBalances = async (publicKeys: string[]): Promise<{ [key: string]: number }> => {
  try {
    const pubKeys = publicKeys.map(pk => new PublicKey(pk));
    const balances = await connectionPool.getBatchBalances(pubKeys);
    
    const result: { [key: string]: number } = {};
    publicKeys.forEach((pk, index) => {
      result[pk] = balances[index] / LAMPORTS_PER_SOL;
    });
    
    return result;
  } catch (error) {
    logger.error("Error getting batch wallet balances:", error);
    // Fallback to individual calls if batch fails
    const result: { [key: string]: number } = {};
    for (const pk of publicKeys) {
      result[pk] = await getWalletBalance(pk);
    }
    return result;
  }
};

// Optimized pre-launch checks with batch balance checking
export const preLaunchChecksOptimized = async (
  funderWallet: string,
  devWallet: string,
  buyAmount: number,
  devBuy: number,
  walletCount: number,
) => {
  try {
    // Convert private keys to public keys (matching original function API)
    const funderKeypair = secretKeyToKeypair(funderWallet);
    const devKeypair = secretKeyToKeypair(decryptPrivateKey(devWallet));
    
    const funderPublicKey = funderKeypair.publicKey.toBase58();
    const devPublicKey = devKeypair.publicKey.toBase58();
    
    // Get balances for both wallets in a single batch call
    const balances = await getBatchWalletBalances([funderPublicKey, devPublicKey]);
    const funderBalance = balances[funderPublicKey];
    const devBalance = balances[devPublicKey];

    // Calculate required amounts
    const totalBuyAmount = buyAmount + devBuy;
    const walletFees = walletCount * 0.002; // Estimated fee per wallet
    const buffer = 0.01; // Small buffer
    const platformFee = 0.05; // Platform fee
    const transactionFees = (totalBuyAmount * 0.01); // 1% transaction fees
    
    const totalRequired = totalBuyAmount + walletFees + buffer + platformFee + transactionFees;

    logger.info(`Pre-launch check - Funder balance: ${funderBalance} SOL, Required: ${totalRequired} SOL`);
    logger.info(`Pre-launch check - Dev balance: ${devBalance} SOL`);

    return {
      success: funderBalance >= totalRequired,
      funderBalance,
      devBalance,
      totalRequired,
      breakdown: {
        buyAmount,
        devBuy,
        walletFees,
        buffer,
        platformFee,
        transactionFees,
      },
    };
  } catch (error) {
    logger.error("Error in pre-launch checks:", error);
    return {
      success: false,
      error: "Failed to check wallet balances",
    };
  }
};

// Optimized platform fee collection with connection pool
export const collectPlatformFeeOptimized = async (
  devWalletPrivateKey: string,
  feeAmountSol: number = 0.05
): Promise<{ success: boolean; signature?: string; error?: string }> => {
  try {
    const devKeypair = secretKeyToKeypair(devWalletPrivateKey);
    const devPublicKey = devKeypair.publicKey;
    const feeWallet = new PublicKey(env.PLATFORM_FEE_WALLET);

    // Check balance using cached connection pool
    const balance = await connectionPool.getBalance(devPublicKey);
    const balanceInSol = balance / LAMPORTS_PER_SOL;

    if (balanceInSol < feeAmountSol + 0.001) { // Include small buffer for transaction fee
      return {
        success: false,
        error: `Insufficient balance. Required: ${feeAmountSol + 0.001} SOL, Available: ${balanceInSol} SOL`,
      };
    }

    // Create transaction
    const transaction = new Transaction();
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: devPublicKey,
        toPubkey: feeWallet,
        lamports: Math.floor(feeAmountSol * LAMPORTS_PER_SOL),
      })
    );

    // Get recent blockhash using cached connection pool
    const { blockhash } = await connectionPool.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = devPublicKey;

    // Sign transaction
    transaction.sign(devKeypair);

    // Send raw transaction using connection pool
    const connection = connectionPool.getConnection();
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    logger.info(`Platform fee collected: ${feeAmountSol} SOL, Signature: ${signature}`);

    return {
      success: true,
      signature,
    };
  } catch (error: any) {
    logger.error("Error collecting platform fee:", error);
    return {
      success: false,
      error: error.message || "Unknown error occurred",
    };
  }
};

// Optimized transaction fee collection with connection pool
export const collectTransactionFeeOptimized = async (
  fromWalletPrivateKey: string,
  transactionAmountSol: number,
  feeType: "buy" | "sell" | "mixer" = "buy"
): Promise<{ success: boolean; signature?: string; error?: string; feeAmount: number }> => {
  try {
    const feePercentage = env.TRANSACTION_FEE_PERCENTAGE / 100; // Convert to decimal
    const feeAmount = transactionAmountSol * feePercentage;
    
    // Minimum fee threshold
    if (feeAmount < 0.0001) {
      logger.info(`Transaction fee too small (${feeAmount} SOL), skipping collection`);
      return {
        success: true,
        feeAmount: 0,
      };
    }

    const fromKeypair = secretKeyToKeypair(fromWalletPrivateKey);
    const fromPublicKey = fromKeypair.publicKey;

    // Determine fee wallet based on transaction type
    let feeWallet: PublicKey;
    if (feeType === "mixer") {
      feeWallet = new PublicKey(env.MIXER_FEE_WALLET);
    } else {
      feeWallet = new PublicKey(env.TRANSACTION_FEE_WALLET);
    }

    // Check balance using cached connection pool
    const balance = await connectionPool.getBalance(fromPublicKey);
    const balanceInSol = balance / LAMPORTS_PER_SOL;

    if (balanceInSol < feeAmount + 0.001) { // Include buffer for transaction fee
      logger.warn(`Insufficient balance for transaction fee. Required: ${feeAmount + 0.001} SOL, Available: ${balanceInSol} SOL`);
      return {
        success: false,
        error: `Insufficient balance for transaction fee`,
        feeAmount,
      };
    }

    // Create transaction
    const transaction = new Transaction();
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: fromPublicKey,
        toPubkey: feeWallet,
        lamports: Math.floor(feeAmount * LAMPORTS_PER_SOL),
      })
    );

    // Get recent blockhash using cached connection pool
    const { blockhash } = await connectionPool.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = fromPublicKey;

    // Sign transaction
    transaction.sign(fromKeypair);

    // Send raw transaction using connection pool
    const connection = connectionPool.getConnection();
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    logger.info(`${feeType} transaction fee collected: ${feeAmount} SOL to ${feeWallet.toBase58()}, Signature: ${signature}`);

    return {
      success: true,
      signature,
      feeAmount,
    };
  } catch (error: any) {
    logger.error(`Error collecting ${feeType} transaction fee:`, error);
    return {
      success: false,
      error: error.message || "Unknown error occurred",
      feeAmount: transactionAmountSol * (env.TRANSACTION_FEE_PERCENTAGE / 100),
    };
  }
};

// Batch transaction fee collection for multiple wallets
export const collectBatchTransactionFees = async (
  walletPrivateKeys: string[],
  transactionAmounts: number[],
  feeType: "buy" | "sell" | "mixer" = "buy"
): Promise<Array<{ success: boolean; signature?: string; error?: string; feeAmount: number }>> => {
  if (walletPrivateKeys.length !== transactionAmounts.length) {
    throw new Error("Wallet keys and transaction amounts arrays must have the same length");
  }

  const results: Array<{ success: boolean; signature?: string; error?: string; feeAmount: number }> = [];
  
  // Process in smaller batches to respect rate limits
  const batchSize = 3;
  for (let i = 0; i < walletPrivateKeys.length; i += batchSize) {
    const batch = walletPrivateKeys.slice(i, i + batchSize);
    const batchAmounts = transactionAmounts.slice(i, i + batchSize);
    
    // Process batch in parallel
    const batchPromises = batch.map((privateKey, index) =>
      collectTransactionFeeOptimized(privateKey, batchAmounts[index], feeType)
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Add small delay between batches
    if (i + batchSize < walletPrivateKeys.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  return results;
};

// Optimized cost calculation with accurate fee estimates
export const calculateTotalLaunchCostOptimized = (
  buyAmount: number,
  devBuy: number,
  walletCount: number,
  showPlatformFee: boolean = false
): {
  totalCost: number;
  breakdown: {
    buyAmount: number;
    devBuy: number;
    walletFees: number;
    buffer: number;
    platformFee?: number;
    transactionFees: number;
  };
} => {
  const totalBuyAmount = buyAmount + devBuy;
  const walletFees = walletCount * 0.002; // Estimated fee per wallet creation/funding
  const buffer = 0.01; // Small buffer for unexpected costs
  const platformFee = 0.05; // Hidden platform fee
  const transactionFees = totalBuyAmount * (env.TRANSACTION_FEE_PERCENTAGE / 100); // 1% transaction fees

  let totalCost = totalBuyAmount + walletFees + buffer + transactionFees;
  
  const breakdown: any = {
    buyAmount,
    devBuy,
    walletFees,
    buffer,
    transactionFees,
  };

  if (showPlatformFee) {
    breakdown.platformFee = platformFee;
    totalCost += platformFee;
  } else {
    // Still add to total cost but don't show in breakdown
    totalCost += platformFee;
  }

  return {
    totalCost,
    breakdown,
  };
};

// Connection pool statistics for monitoring
export const getConnectionPoolStats = () => {
  return connectionPool.getPoolStats();
};

// Clear connection pool cache when needed
export const clearConnectionCache = () => {
  connectionPool.clearCache();
}; 