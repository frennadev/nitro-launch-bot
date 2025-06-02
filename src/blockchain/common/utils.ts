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
  return Keypair.fromSecretKey(bs58.decode(secretKey));
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

export const sendTransaction = async (
  signedTx: VersionedTransaction,
  setup: TransactionSetup,
  isRetry: boolean = false,
) => {
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
};

export const sendSignedTransaction = async (txn: VersionedTransaction) => {
  try {
    const signature = await connection.sendTransaction(txn, { maxRetries: 3 });
    return signature;
  } catch (error: any) {
    console.error("An Error Occurred While Sending Transaction", {
      logs: error.getLogs(),
      message: error.message,
    });
    throw new Error(
      `Error occurred while sending transaction: ${error.message}`,
    );
  }
};

export const confirmTransaction = async (
  signature: TransactionSignature,
  desiredConfirmationStatus: TransactionConfirmationStatus,
  timeout: number = 30000,
  pollInterval: number = 1000,
  searchTransactionHistory: boolean = false,
) => {
  const logIdentifier = "confirm-txn-new";
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const { value: statuses } = await connection.getSignatureStatuses(
      [signature],
      { searchTransactionHistory },
    );

    if (!statuses || statuses.length === 0) {
      console.log("Failed to get signature statuse", { logIdentifier });
      if (Date.now() - start > timeout / 2) {
        // if the time elapsed is already half the timeout, return as failure
        console.log(
          "Early termination because signature was not found on chain",
          { logIdentifier },
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
      console.log(
        `Transaction with signature ${signature} failed: ${JSON.stringify(status.err)}`,
        { logIdentifier },
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
  console.log(`Transaction confirmation timeout after ${timeout}ms`, {
    logIdentifier,
  });
  return false;
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
      console.error(`[${logIdentifier}]: Failed to submit transaction`);
      break;
    }
    success = await confirmTransaction(
      signature,
      "confirmed",
      confirmationTimeout,
    );
    if (!success) {
      console.info(
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
  const hours = Math.floor(milliseconds / (1000 * 60 * 60))
  const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60))
  const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000)
  const remainingMilliseconds = Math.floor(milliseconds % 1000)

  let formattedTime = ""
  if (hours > 0) {
    formattedTime += hours + "h "
  }
  if (minutes > 0) {
    formattedTime += minutes + "m "
  }
  if (seconds > 0) {
    formattedTime += seconds + "s "
  }
  if (remainingMilliseconds > 0) {
    formattedTime += remainingMilliseconds + "ms"
  }

  return formattedTime.trim()
}
