/**
 * External Buy Queue API
 * Provides external application interface for executing token purchases from user wallets
 */

import { Job } from "bullmq";
import { externalBuyQueue } from "./queues";
import type { ExternalBuyJob } from "./types";
import {
  ctoProgressStore,
  type ExternalBuyProgressEvent,
  type ExternalBuyOperationResult,
} from "./cto-progress-tracker";
import { logger } from "./logger";

export interface EnqueueExternalBuyRequest {
  userId: string;
  userChatId: number;
  tokenAddress: string;
  buyAmount: number;
  walletPrivateKey: string;
  slippage?: number;
  priorityFee?: number;
  platform?: string;
  socketUserId?: string;
}

export interface EnqueueExternalBuyResponse {
  success: boolean;
  jobId: string;
  message: string;
  error?: string;
}

export interface ExternalBuyJobStatus {
  jobId: string;
  status: "queued" | "active" | "completed" | "failed" | "not_found";
  progress?: ExternalBuyProgressEvent;
  result?: ExternalBuyOperationResult;
  queuePosition?: number;
  createdAt?: number;
  processedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface CancelExternalBuyResponse {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Enqueue a new external buy operation
 */
export async function enqueueExternalBuy(
  request: EnqueueExternalBuyRequest
): Promise<EnqueueExternalBuyResponse> {
  try {
    logger.info("[external-buy-api]: Enqueueing external buy operation", {
      userId: request.userId,
      tokenAddress: request.tokenAddress.slice(0, 8) + "...",
      buyAmount: request.buyAmount,
      slippage: request.slippage,
      priorityFee: request.priorityFee,
      platform: request.platform,
    });

    // Validate required fields
    if (
      !request.userId ||
      !request.tokenAddress ||
      !request.walletPrivateKey ||
      !request.buyAmount
    ) {
      return {
        success: false,
        jobId: "",
        message: "Missing required fields",
        error:
          "userId, tokenAddress, walletPrivateKey, and buyAmount are required",
      };
    }

    if (request.buyAmount <= 0) {
      return {
        success: false,
        jobId: "",
        message: "Invalid buy amount",
        error: "buyAmount must be greater than 0",
      };
    }

    // Validate token address format (basic Solana address validation)
    if (request.tokenAddress.length < 32 || request.tokenAddress.length > 44) {
      return {
        success: false,
        jobId: "",
        message: "Invalid token address",
        error: "Token address must be a valid Solana address",
      };
    }

    // Create job data
    const jobData: ExternalBuyJob = {
      userId: request.userId,
      userChatId: request.userChatId || Math.floor(Math.random() * 1000000),
      tokenAddress: request.tokenAddress,
      buyAmount: request.buyAmount,
      walletPrivateKey: request.walletPrivateKey,
      slippage: request.slippage || 3,
      priorityFee: request.priorityFee || 0.002,
      platform: request.platform || "auto",
      socketUserId: request.socketUserId,
    };

    // Add job to queue with retry configuration
    const job = await externalBuyQueue.add("external-buy", jobData, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000, // Start with 5 second delay
      },
      removeOnComplete: 50, // Keep last 50 completed jobs
      removeOnFail: 100, // Keep last 100 failed jobs
      delay: 0, // Process immediately
    });

    logger.info(
      `[external-buy-api]: External buy job enqueued with ID: ${job.id}`
    );

    return {
      success: true,
      jobId: job.id?.toString() || "unknown",
      message: `External buy operation queued successfully for ${request.buyAmount} SOL`,
    };
  } catch (error: any) {
    logger.error(
      "[external-buy-api]: Failed to enqueue external buy operation:",
      error
    );
    return {
      success: false,
      jobId: "",
      message: "Failed to enqueue external buy operation",
      error: error.message || "Unknown error occurred",
    };
  }
}

/**
 * Get detailed status of an external buy job
 */
export async function getExternalBuyJobStatus(
  jobId: string
): Promise<ExternalBuyJobStatus> {
  try {
    logger.info(`[external-buy-api]: Getting status for job: ${jobId}`);

    const job = await Job.fromId(externalBuyQueue, jobId);

    if (!job) {
      return {
        jobId,
        status: "not_found",
      };
    }

    const jobState = await job.getState();
    const progress = ctoProgressStore.getLatestProgress(jobId) as any;
    const result = ctoProgressStore.getOperationResult(jobId) as any;

    // Calculate queue position for waiting jobs
    let queuePosition: number | undefined;
    if (jobState === "waiting") {
      const waitingJobs = await externalBuyQueue.getWaiting();
      queuePosition = waitingJobs.findIndex((j) => j.id === job.id) + 1;
    }

    return {
      jobId,
      status: mapJobStateToStatus(jobState),
      progress,
      result,
      queuePosition,
      createdAt: job.timestamp,
      processedAt: job.processedOn || undefined,
      completedAt: job.finishedOn || undefined,
      error: job.failedReason || undefined,
    };
  } catch (error: any) {
    logger.error(
      `[external-buy-api]: Failed to get job status for ${jobId}:`,
      error
    );
    return {
      jobId,
      status: "not_found",
      error: error.message || "Failed to retrieve job status",
    };
  }
}

/**
 * Cancel a pending external buy job
 */
export async function cancelExternalBuy(
  jobId: string
): Promise<CancelExternalBuyResponse> {
  try {
    logger.info(`[external-buy-api]: Attempting to cancel job: ${jobId}`);

    const job = await Job.fromId(externalBuyQueue, jobId);

    if (!job) {
      return {
        success: false,
        message: "Job not found",
        error: "The specified job could not be found",
      };
    }

    const jobState = await job.getState();

    // Only allow cancellation of waiting or delayed jobs
    if (jobState === "waiting" || jobState === "delayed") {
      await job.remove();
      logger.info(`[external-buy-api]: Job ${jobId} cancelled successfully`);

      return {
        success: true,
        message: "External buy job cancelled successfully",
      };
    } else {
      return {
        success: false,
        message: `Cannot cancel job in ${jobState} state`,
        error: "Job is already being processed or has completed",
      };
    }
  } catch (error: any) {
    logger.error(`[external-buy-api]: Failed to cancel job ${jobId}:`, error);
    return {
      success: false,
      message: "Failed to cancel external buy job",
      error: error.message || "Unknown error occurred",
    };
  }
}

/**
 * Subscribe to progress updates for a specific external buy job
 */
export function subscribeToExternalBuyProgress(
  jobId: string,
  onProgress: (event: ExternalBuyProgressEvent) => void,
  onCompleted?: (result: ExternalBuyOperationResult) => void
): () => void {
  const unsubscribeProgress = ctoProgressStore.onProgress(
    jobId,
    onProgress as any
  );
  const unsubscribeCompleted = onCompleted
    ? ctoProgressStore.onCompleted(jobId, onCompleted as any)
    : () => {};

  // Return combined unsubscribe function
  return () => {
    unsubscribeProgress();
    unsubscribeCompleted();
  };
}

/**
 * Get progress statistics for external buy operations
 */
export function getExternalBuyStats() {
  // Reuse the existing CTO stats function since they share the same storage
  // In a production system, you might want separate statistics
  return ctoProgressStore.getProgressStats();
}

// Helper function to map BullMQ job states to our status enum
function mapJobStateToStatus(jobState: string): ExternalBuyJobStatus["status"] {
  switch (jobState) {
    case "waiting":
    case "delayed":
      return "queued";
    case "active":
      return "active";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "not_found";
  }
}

// Export types for external use
export type {
  ExternalBuyProgressEvent,
  ExternalBuyOperationResult,
} from "./cto-progress-tracker";
