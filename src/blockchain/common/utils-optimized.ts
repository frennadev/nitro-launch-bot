import {
  Keypair,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { 
  TransactionSignature,
  TransactionConfirmationStatus,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { TransactionSetup } from "./types";
import { connectionPool } from "./connection-pool";
import { logger } from "./logger";

export const generateKeypairs = (count: number) => {
  const keys = [];
  for (let i = 0; i < count; i++) {
    const key = Keypair.generate();
    keys.push({
      publicKey: key.publicKey.toBase58(),
      secretKey: bs58.encode(key.secretKey),
    });
  }
  return keys;
};

export const secretKeyToKeypair = (secretKey: string) => {
  return Keypair.fromSecretKey(bs58.decode(secretKey));
};

export const chunkArray = <T>(array: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
};

export const randomizedSleep = async (min: number, max: number) => {
  const sleepTime = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise((resolve) => setTimeout(resolve, sleepTime));
};

export const randomizeDistribution = (
  totalAmount: number,
  walletCount: number,
): number[] => {
  if (walletCount === 0) return [];
  if (walletCount === 1) return [totalAmount];

  const distribution: number[] = [];
  let remaining = totalAmount;

  for (let i = 0; i < walletCount - 1; i++) {
    const maxForThis = remaining - (walletCount - i - 1) * 0.01;
    const minForThis = 0.01;
    const amount = Math.random() * (maxForThis - minForThis) + minForThis;
    distribution.push(amount);
    remaining -= amount;
  }

  distribution.push(Math.max(0.01, remaining));
  return distribution;
};

export const formatMilliseconds = (ms: number): string => {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(2);
    return `${minutes}m ${seconds}s`;
  }
};

// Optimized transaction sending using connection pool
export const sendSignedTransaction = async (txn: VersionedTransaction) => {
  try {
    const signature = await connectionPool.sendTransaction(txn, {
      maxRetries: 3,
      skipPreflight: true,
    });
    return signature;
  } catch (error: any) {
    logger.error(
      "[send-signed-tx]; An Error Occurred While Sending Transaction",
      {
        logs: error.getLogs?.() || "No logs available",
        message: error.message,
      },
    );
    throw error;
  }
};

export const sendTransaction = async (
  signedTx: VersionedTransaction,
  setup: TransactionSetup,
  isRetry: boolean = false,
) => {
  try {
    if (isRetry) {
      const blockhash = await connectionPool.getLatestBlockhash("confirmed");
      const message = new TransactionMessage({
        instructions: setup.instructions,
        payerKey: setup.payer,
        recentBlockhash: blockhash.blockhash,
      }).compileToV0Message();
      const txn = new VersionedTransaction(message);
      txn.sign(setup.signers);
      const signature = await sendSignedTransaction(txn);
      return signature;
    } else {
      const signature = await sendSignedTransaction(signedTx);
      return signature;
    }
  } catch (error) {
    logger.error(
      "[send-transaction]: Error occurred while sending transaction",
      error,
    );
    return null;
  }
};

// Optimized transaction confirmation with better caching and rate limiting
export const confirmTransaction = async (
  signature: TransactionSignature,
  desiredConfirmationStatus: TransactionConfirmationStatus,
  timeout: number = 30000,
  pollInterval: number = 2000, // Increased from 1000ms to reduce API calls
  searchTransactionHistory: boolean = false,
  logIdentifier: string,
) => {
  const start = Date.now();
  let lastPollTime = 0;

  while (Date.now() - start < timeout) {
    // Ensure minimum poll interval to avoid excessive API calls
    const timeSinceLastPoll = Date.now() - lastPollTime;
    if (timeSinceLastPoll < pollInterval) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval - timeSinceLastPoll));
    }
    
    lastPollTime = Date.now();

    try {
      const { value: statuses } = await connectionPool.getSignatureStatuses(
        [signature],
        { searchTransactionHistory },
      );

      if (!statuses || statuses.length === 0) {
        logger.info(`[${logIdentifier}]: Failed to get signature status`);
        if (Date.now() - start > timeout / 2) {
          logger.info(
            `[${logIdentifier}]: Early termination because signature was not found on chain`,
          );
          return false;
        }
        continue;
      }

      const status = statuses[0];
      if (status === null) {
        continue;
      }

      if (status.err) {
        logger.error(
          `[${logIdentifier}]: Transaction with signature ${signature} failed with error ${JSON.stringify(status.err)}`,
        );
        return false;
      }

      if (
        status.confirmationStatus &&
        status.confirmationStatus === desiredConfirmationStatus
      ) {
        return true;
      }

      if (status.confirmationStatus === "finalized") {
        return true;
      }
    } catch (error) {
      logger.warn(`[${logIdentifier}]: Error checking transaction status: ${error}`);
      // Continue polling on error
    }
  }
  
  logger.info(
    `[${logIdentifier}]: Transaction confirmation timeout after ${timeout}ms`,
  );
  return false;
};

// Optimized batch confirmation for multiple transactions
export const confirmTransactionsBatch = async (
  signatures: TransactionSignature[],
  desiredConfirmationStatus: TransactionConfirmationStatus,
  timeout: number = 30000,
  pollInterval: number = 2000,
  logIdentifier: string,
): Promise<boolean[]> => {
  const start = Date.now();
  const results: boolean[] = new Array(signatures.length).fill(false);
  const pendingIndices = signatures.map((_, index) => index);
  let lastPollTime = 0;

  while (Date.now() - start < timeout && pendingIndices.length > 0) {
    // Ensure minimum poll interval
    const timeSinceLastPoll = Date.now() - lastPollTime;
    if (timeSinceLastPoll < pollInterval) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval - timeSinceLastPoll));
    }
    
    lastPollTime = Date.now();

    try {
      const pendingSignatures = pendingIndices.map(i => signatures[i]);
      const { value: statuses } = await connectionPool.getSignatureStatuses(
        pendingSignatures,
        { searchTransactionHistory: false },
      );

      if (!statuses || statuses.length === 0) {
        continue;
      }

      // Process each status
      for (let i = pendingIndices.length - 1; i >= 0; i--) {
        const originalIndex = pendingIndices[i];
        const status = statuses[i];

        if (status === null) {
          continue;
        }

        if (status.err) {
          logger.error(
            `[${logIdentifier}]: Transaction ${signatures[originalIndex]} failed with error ${JSON.stringify(status.err)}`,
          );
          results[originalIndex] = false;
          pendingIndices.splice(i, 1);
          continue;
        }

        if (
          (status.confirmationStatus && status.confirmationStatus === desiredConfirmationStatus) ||
          status.confirmationStatus === "finalized"
        ) {
          results[originalIndex] = true;
          pendingIndices.splice(i, 1);
        }
      }
    } catch (error) {
      logger.warn(`[${logIdentifier}]: Error checking batch transaction status: ${error}`);
    }
  }

  // Mark remaining pending transactions as failed
  pendingIndices.forEach(index => {
    results[index] = false;
  });

  logger.info(
    `[${logIdentifier}]: Batch confirmation completed. Success: ${results.filter(r => r).length}/${results.length}`,
  );

  return results;
};

export const sendAndConfirmTransactionWithRetry = async (
  signedTx: VersionedTransaction,
  setup: TransactionSetup,
  confirmationTimeout: number,
  maxRetries: number,
  retryInterval: number,
  logIdentifier: string,
) => {
  let success = false;
  let signature: string | null = null;
  let retryCount = 0;
  
  while (retryCount < maxRetries && !success) {
    signature = await sendTransaction(signedTx, setup, retryCount > 0);
    if (!signature) {
      logger.error(`[${logIdentifier}]: Failed to send transaction`);
      break;
    }
    
    success = await confirmTransaction(
      signature,
      "confirmed",
      confirmationTimeout,
      2000, // Increased poll interval
      false,
      logIdentifier,
    );
    
    if (!success) {
      logger.error(
        `[${logIdentifier}]: transaction confirmation failed❌. Retrying in ${retryInterval} ms...`,
      );
      retryCount += 1;
      await randomizedSleep(retryInterval, retryInterval * 1.5);
      continue;
    }
  }
  
  return {
    success,
    signature,
  };
};

// Batch transaction sending with optimized rate limiting
export const sendAndConfirmTransactionsBatch = async (
  transactions: Array<{
    signedTx: VersionedTransaction;
    setup: TransactionSetup;
  }>,
  confirmationTimeout: number,
  maxRetries: number,
  retryInterval: number,
  logIdentifier: string,
  batchSize: number = 5, // Process in smaller batches to respect rate limits
): Promise<Array<{ success: boolean; signature: string | null }>> => {
  const results: Array<{ success: boolean; signature: string | null }> = [];
  
  // Process transactions in batches
  const batches = chunkArray(transactions, batchSize);
  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    logger.info(`[${logIdentifier}]: Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} transactions)`);
    
    // Send all transactions in the batch
    const signatures: (string | null)[] = await Promise.all(
      batch.map(async ({ signedTx, setup }) => {
        try {
          return await sendTransaction(signedTx, setup, false);
        } catch (error) {
          logger.error(`[${logIdentifier}]: Failed to send transaction in batch: ${error}`);
          return null;
        }
      })
    );
    
    // Confirm all transactions in the batch
    const validSignatures = signatures.filter((sig): sig is string => sig !== null);
    const confirmationResults = validSignatures.length > 0 
      ? await confirmTransactionsBatch(
          validSignatures,
          "confirmed",
          confirmationTimeout,
          2000,
          logIdentifier
        )
      : [];
    
    // Map results back to original order
    let confirmationIndex = 0;
    for (let i = 0; i < batch.length; i++) {
      const signature = signatures[i];
      if (signature === null) {
        results.push({ success: false, signature: null });
      } else {
        const success = confirmationResults[confirmationIndex] || false;
        results.push({ success, signature });
        confirmationIndex++;
      }
    }
    
    // Add delay between batches to respect rate limits
    if (batchIndex < batches.length - 1) {
      await randomizedSleep(1000, 2000);
    }
  }
  
  return results;
}; 