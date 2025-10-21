import { walletWarmingQueue } from "./queues";
import type { WalletWarmingJob } from "./types";

export interface WalletWarmingOptions {
  warmingTokenAddress?: string; // Default token if not provided
  socketUserId?: string;
}

export interface WalletWarmingResult {
  success: boolean;
  message: string;
  jobId?: string;
}

// Default warming token - a stable PumpFun token for practice trades
const DEFAULT_WARMING_TOKEN =
  process.env.WARMING_TOKEN_ADDRESS ||
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hrpump"; // Placeholder

/**
 * Enqueues a wallet warming job for processing
 *
 * @param userId - User identifier
 * @param userChatId - Telegram chat ID (0 for dapp users)
 * @param walletIds - Array of wallet IDs to warm
 * @param options - Optional configuration
 * @returns Promise with result information
 */
export async function enqueueWalletWarming(
  userId: string,
  userChatId: number,
  walletIds: string[],
  options: WalletWarmingOptions = {}
): Promise<WalletWarmingResult> {
  try {
    // Validate parameters
    if (!userId || typeof userId !== "string") {
      return {
        success: false,
        message: "User ID is required and must be a string",
      };
    }

    if (typeof userChatId !== "number" || userChatId < 0) {
      return {
        success: false,
        message: "User chat ID must be a non-negative number",
      };
    }

    if (!Array.isArray(walletIds) || walletIds.length === 0) {
      return {
        success: false,
        message: "Wallet IDs array is required and must not be empty",
      };
    }

    if (walletIds.length > 73) {
      return {
        success: false,
        message: "Maximum 73 wallets can be warmed at once",
      };
    }

    // Validate each wallet ID
    for (const id of walletIds) {
      if (typeof id !== "string" || id.trim() === "") {
        return {
          success: false,
          message: "All wallet IDs must be non-empty strings",
        };
      }
    }

    if (options.socketUserId !== undefined) {
      if (
        typeof options.socketUserId !== "string" ||
        options.socketUserId.trim() === ""
      ) {
        return {
          success: false,
          message: "Socket user ID must be a non-empty string if provided",
        };
      }
    }

    // Create job data
    const jobData: WalletWarmingJob = {
      userId,
      userChatId,
      walletIds,
      warmingTokenAddress:
        options.warmingTokenAddress || DEFAULT_WARMING_TOKEN,
      socketUserId: options.socketUserId,
    };

    // Create unique job name
    const jobName = `warming-${userId}-${Date.now()}`;

    // Add job to queue
    const job = await walletWarmingQueue.add(jobName, jobData, {
      attempts: 2, // Retry once if fails
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    return {
      success: true,
      message: `Wallet warming job queued successfully for ${walletIds.length} wallets`,
      jobId: job.id?.toString(),
    };
  } catch (error) {
    console.error("Error enqueueing wallet warming job:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to queue wallet warming job",
    };
  }
}

/**
 * Get the status of a wallet warming job
 */
export async function getWalletWarmingJobStatus(jobId: string) {
  try {
    const job = await walletWarmingQueue.getJob(jobId);
    if (!job) {
      return { success: false, message: "Job not found" };
    }

    const state = await job.getState();
    const progress = job.progress;

    return {
      success: true,
      state,
      progress,
      data: job.data,
      returnValue: job.returnvalue,
      failedReason: job.failedReason,
    };
  } catch (error) {
    console.error("Error getting wallet warming job status:", error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to get job status",
    };
  }
}

