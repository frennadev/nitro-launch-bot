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
  // Try to get enhanced status first
  try {
    const { getCTOJobStatusWithProgress } = await import(
      "./cto-progress-tracker"
    );
    return await getCTOJobStatusWithProgress(jobId);
  } catch {
    // Fallback to basic status
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
  }
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

// Import types for progress tracking
type CTOProgressEvent = {
  jobId: string;
  tokenAddress: string;
  phase: number;
  totalPhases: number;
  phaseTitle: string;
  phaseDescription: string;
  progress: number;
  status: "started" | "in_progress" | "completed" | "failed";
  mode: "standard" | "prefunded";
  platform: string;
  details?: Record<string, unknown>;
};

type CTOOperationResult = {
  jobId: string;
  success: boolean;
  successfulBuys: number;
  failedBuys: number;
  totalSpent: number;
  error?: string;
};

/**
 * Subscribe to real-time progress updates for a CTO job
 *
 * @param jobId - The job ID to track
 * @param onProgress - Callback for progress updates
 * @param onCompleted - Optional callback for completion
 * @returns Unsubscribe function
 */
export const subscribeToProgress = async (
  jobId: string,
  onProgress: (event: CTOProgressEvent) => void,
  onCompleted?: (result: CTOOperationResult) => void
) => {
  try {
    const { subscribeToCTOProgress } = await import("./cto-progress-tracker");
    return subscribeToCTOProgress(jobId, onProgress, onCompleted);
  } catch (error) {
    console.warn("Progress tracking not available:", error);
    return () => {}; // Return no-op unsubscribe function
  }
};

/**
 * Get progress statistics for multiple CTO jobs
 *
 * @param jobIds - Array of job IDs to analyze
 * @returns Progress statistics
 */
export const getCTOProgressStats = async (jobIds: string[]) => {
  try {
    const { getCTOProgressStats } = await import("./cto-progress-tracker");
    return getCTOProgressStats(jobIds);
  } catch (error) {
    console.warn("Progress stats not available:", error);
    return {
      total: jobIds.length,
      queued: jobIds.length,
      active: 0,
      completed: 0,
      failed: 0,
      totalProgress: 0,
      averageProgress: 0,
    };
  }
};

// Export the queue and types for advanced usage
export { ctoQueue } from "./queues";
export type { CTOJob } from "./types";
