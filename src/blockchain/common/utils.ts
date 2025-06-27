import {
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  type TransactionSignature,
  type TransactionConfirmationStatus,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { TransactionSetup } from "./types";
import { connection } from "./connection";
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

export function secretKeyToKeypair(secretKey: string) {
  if (!secretKey || typeof secretKey !== 'string') {
    throw new Error('Invalid secret key: key must be a non-empty string');
  }
  
  // Remove any whitespace
  const cleanKey = secretKey.trim();
  
  if (cleanKey.length === 0) {
    throw new Error('Invalid secret key: key cannot be empty');
  }
  
  try {
    return Keypair.fromSecretKey(bs58.decode(cleanKey));
  } catch (error: any) {
    throw new Error(`Invalid secret key format: ${error.message}`);
  }
}

export function randomizeDistribution(
  totalAmount: number,
  length: number,
  factor: number = 0.5,
) {
  const initialValue = totalAmount / length;
  const distribution = Array(length).fill(initialValue);
  if (length == 1) {
    return [initialValue];
  }

  for (let i = 0; i < length - 1; i++) {
    const maxAdjustment = initialValue * factor;
    const adjustment = (Math.random() - 0.5) * 2 * maxAdjustment;

    distribution[i] += adjustment;
    distribution[i + 1] -= adjustment;
  }
  return distribution;
}

export function chunkArray<T>(arr: T[], batchSize: number): T[][] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError("batchSize must be a positive integer");
  }

  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += batchSize) {
    result.push(arr.slice(i, i + batchSize));
  }
  return result;
}

export const randomizedSleep = async (min = 1000, max = 2000) => {
  const interval = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise((resolve) => setTimeout(resolve, interval));
};

export const sendSignedTransaction = async (txn: VersionedTransaction) => {
  try {
    const signature = await connection.sendTransaction(txn, {
      maxRetries: 3,
      skipPreflight: true,
    });
    return signature;
  } catch (error: any) {
    logger.error(
      "[send-signed-tx]; An Error Occurred While Sending Transaction",
      {
        logs: error.getLogs(),
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
      const blockhash = await connection.getLatestBlockhash("confirmed");
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

export const confirmTransaction = async (
  signature: TransactionSignature,
  desiredConfirmationStatus: TransactionConfirmationStatus,
  timeout: number = 30000,
  pollInterval: number = 1000,
  searchTransactionHistory: boolean = false,
  logIdentifier: string,
) => {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const { value: statuses } = await connection.getSignatureStatuses(
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
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      continue;
    }

    const status = statuses[0];
    if (status === null) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
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

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
  logger.info(
    `[${logIdentifier}]: Transaction confirmation timeout after ${timeout}ms`,
  );
  return false;
};

export const sendAndConfirmTransactionWithRetry = async (
  signedTx: VersionedTransaction,
  setup: TransactionSetup,
  confirmationTimeout: number,
  maxRetries: number,
  retryInterval: number,
  logIdentifier: string,
  options?: {
    useSmartPriorityFees?: boolean;
    transactionType?: "token_creation" | "buy" | "sell" | "transfer";
    basePriorityFee?: number;
  }
) => {
  let success = false;
  let signature: string | null = null;
  let retryCount = 0;
  
  while (retryCount < maxRetries && !success) {
    let currentTx = signedTx;
    
    // Apply smart priority fees if enabled
    if (options?.useSmartPriorityFees && retryCount > 0) {
      const { 
        createSmartPriorityFeeInstruction, 
        getTransactionTypePriorityConfig,
        logPriorityFeeInfo 
      } = await import("./priority-fees");
      
      const config = options.transactionType 
        ? getTransactionTypePriorityConfig(options.transactionType)
        : { baseFee: options.basePriorityFee || 1_000_000, retryMultiplier: 1.5, maxFee: 10_000_000, minFee: 100_000 };
      
      const smartPriorityFeeIx = createSmartPriorityFeeInstruction(retryCount, config);
      const priorityFee = smartPriorityFeeIx.data.readUInt32LE(4); // Extract microLamports from instruction data
      
      logPriorityFeeInfo(
        options.transactionType || "unknown",
        retryCount,
        priorityFee,
        logIdentifier
      );
      
      // Rebuild transaction with new priority fee
      const blockhash = await connection.getLatestBlockhash("confirmed");
      const newInstructions = [smartPriorityFeeIx, ...setup.instructions];
      const message = new TransactionMessage({
        instructions: newInstructions,
        payerKey: setup.payer,
        recentBlockhash: blockhash.blockhash,
      }).compileToV0Message();
      
      currentTx = new VersionedTransaction(message);
      currentTx.sign(setup.signers);
    }
    
    signature = await sendTransaction(currentTx, setup, retryCount > 0);
    if (!signature) {
      logger.error(`[${logIdentifier}]: Failed to send transaction`);
      break;
    }
    
    success = await confirmTransaction(
      signature,
      "confirmed",
      confirmationTimeout,
      1000,
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

export function formatMilliseconds(milliseconds: number): string {
  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);
  const remainingMilliseconds = Math.floor(milliseconds % 1000);

  let formattedTime = "";
  if (hours > 0) {
    formattedTime += hours + "h ";
  }
  if (minutes > 0) {
    formattedTime += minutes + "m ";
  }
  if (seconds > 0) {
    formattedTime += seconds + "s ";
  }
  if (remainingMilliseconds > 0) {
    formattedTime += remainingMilliseconds + "ms";
  }

  return formattedTime.trim();
}


export const quoteSell = (
  tokenAmountIn: bigint,
  virtualTokenReserves: bigint,
  virtualSolReserves: bigint,
  realTokenReserves: bigint
) => {
  const tokenIn = tokenAmountIn > realTokenReserves ? realTokenReserves : tokenAmountIn;
  const k = virtualSolReserves * virtualTokenReserves;
  const newVirtualTokenReserves = virtualTokenReserves + tokenIn;
  const newVirtualSolReserves = k / newVirtualTokenReserves + BigInt(1);
  const solOut = virtualSolReserves - newVirtualSolReserves;
  const minSolOut = applySlippage(solOut, 10);
  return { tokenIn, minSolOut };
};

export const applySlippage = (amount: bigint, slippage: number) => {
  const SlippageAdjustment = BigInt(1);
  const Big10000 = BigInt(10000);

  let slippageBP = (BigInt(Math.floor(100 * slippage)) + BigInt(25)) * SlippageAdjustment;
  const maxSlippage = Big10000 * SlippageAdjustment;

  if (slippageBP > maxSlippage) {
    slippageBP = Big10000;
  }

  const slippageBPBN = slippageBP;

  const slippageNumeratorMul = maxSlippage - slippageBPBN;
  const slippageNumerator = amount * slippageNumeratorMul;

  return slippageNumerator / maxSlippage;
};