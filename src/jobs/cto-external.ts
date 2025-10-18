import { ctoQueue } from "./queues";
import type { CTOJob } from "./types";

/**
 * Enqueue a CTO (Call To Others) operation for external applications
 *
 * @param jobData - CTO job data
 * @param priority - Job priority (optional, default: 0)
 * @returns Promise with job information
 *
 * @example
 * ```typescript
 * // Standard CTO operation
 * const job = await enqueueCTOOperation({
 *   userId: "user123",
 *   userChatId: 12345,
 *   tokenAddress: "So11111111111111111111111111111111111111112",
 *   buyAmount: 1.5,
 *   mode: "standard",
 *   platform: "pumpfun",
 *   socketUserId: "socket123" // optional for progress tracking
 * });
 *
 * // Prefunded CTO operation
 * const prefundedJob = await enqueueCTOOperation({
 *   userId: "user123",
 *   userChatId: 12345,
 *   tokenAddress: "So11111111111111111111111111111111111111112",
 *   buyAmount: 2.0,
 *   mode: "prefunded",
 *   platform: "bonk"
 * });
 * ```
 */
export const enqueueCTOOperation = async (
  jobData: CTOJob,
  priority: number = 0
) => {
  const job = await ctoQueue.add("cto-operation", jobData, {
    priority,
    attempts: 3, // Retry up to 3 times on failure
    backoff: {
      type: "exponential",
      delay: 5000, // Start with 5 second delay between retries
    },
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 50, // Keep last 50 failed jobs for debugging
  });

  return {
    jobId: job.id,
    status: "queued",
    data: jobData,
  };
};

/**
 * Get the status of a CTO operation job
 *
 * @param jobId - The job ID returned from enqueueCTOOperation
 * @returns Promise with job status information
 */
export const getCTOJobStatus = async (jobId: string) => {
  const job = await ctoQueue.getJob(jobId);

  if (!job) {
    return { status: "not_found", error: "Job not found" };
  }

  const state = await job.getState();
  const progress = job.progress;

  return {
    jobId: job.id,
    status: state,
    progress,
    data: job.data,
    finishedOn: job.finishedOn,
    processedOn: job.processedOn,
    failedReason: job.failedReason,
  };
};

/**
 * Cancel a pending CTO operation job
 *
 * @param jobId - The job ID to cancel
 * @returns Promise with cancellation result
 */
export const cancelCTOJob = async (jobId: string) => {
  const job = await ctoQueue.getJob(jobId);

  if (!job) {
    return { success: false, error: "Job not found" };
  }

  const state = await job.getState();

  if (state === "completed" || state === "failed") {
    return { success: false, error: `Job already ${state}` };
  }

  await job.remove();

  return { success: true, message: "Job cancelled successfully" };
};

// Export the queue and types for advanced usage
export { ctoQueue } from "./queues";
export type { CTOJob } from "./types";
