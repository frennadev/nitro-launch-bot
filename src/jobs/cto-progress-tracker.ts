/**
 * Frontend Progress Tracking Service for CTO Operations
 * Provides real-time progress updates and historical tracking for external applications
 */

import { EventEmitter } from "events";
import { ctoQueue } from "./queues";
import type { CTOJob } from "./types";

export interface CTOProgressEvent {
  jobId: string;
  tokenAddress: string;
  userId: string;
  userChatId: number;
  socketUserId?: string;
  phase: number;
  totalPhases: number;
  phaseTitle: string;
  phaseDescription: string;
  progress: number;
  status: "started" | "in_progress" | "completed" | "failed";
  timestamp: number;
  mode: "standard" | "prefunded";
  platform: string;
  buyAmount: number;
  details?: {
    // Phase-specific details
    successfulBuys?: number;
    failedBuys?: number;
    totalSpent?: number;
    walletsUsed?: number;
    error?: string;
    transactionSignatures?: string[];
    estimatedTimeRemaining?: number;
    currentOperation?: string;
  };
}

export interface CTOOperationResult {
  jobId: string;
  success: boolean;
  successfulBuys: number;
  failedBuys: number;
  totalSpent: number;
  error?: string;
  transactionSignatures: string[];
  completedAt: number;
  duration: number;
}

/**
 * In-memory progress storage for fast frontend access
 */
class CTOProgressStore {
  private progressEvents = new Map<string, CTOProgressEvent[]>();
  private operationResults = new Map<string, CTOOperationResult>();
  private eventEmitter = new EventEmitter();

  // Store progress event
  addProgressEvent(event: CTOProgressEvent): void {
    const events = this.progressEvents.get(event.jobId) || [];
    events.push(event);
    this.progressEvents.set(event.jobId, events);

    // Emit for real-time listeners
    this.eventEmitter.emit("progress", event);
    this.eventEmitter.emit(`progress:${event.jobId}`, event);

    // Clean up old events (keep last 1000 events per job)
    if (events.length > 1000) {
      this.progressEvents.set(event.jobId, events.slice(-1000));
    }
  }

  // Store final operation result
  addOperationResult(result: CTOOperationResult): void {
    this.operationResults.set(result.jobId, result);
    this.eventEmitter.emit("completed", result);
    this.eventEmitter.emit(`completed:${result.jobId}`, result);
  }

  // Get all progress events for a job
  getProgressEvents(jobId: string): CTOProgressEvent[] {
    return this.progressEvents.get(jobId) || [];
  }

  // Get latest progress event for a job
  getLatestProgress(jobId: string): CTOProgressEvent | undefined {
    const events = this.progressEvents.get(jobId);
    return events && events.length > 0 ? events[events.length - 1] : undefined;
  }

  // Get operation result
  getOperationResult(jobId: string): CTOOperationResult | undefined {
    return this.operationResults.get(jobId);
  }

  // Subscribe to progress events
  onProgress(
    jobId: string,
    callback: (event: CTOProgressEvent) => void
  ): () => void {
    this.eventEmitter.on(`progress:${jobId}`, callback);
    return () => this.eventEmitter.off(`progress:${jobId}`, callback);
  }

  // Subscribe to completion events
  onCompleted(
    jobId: string,
    callback: (result: CTOOperationResult) => void
  ): () => void {
    this.eventEmitter.on(`completed:${jobId}`, callback);
    return () => this.eventEmitter.off(`completed:${jobId}`, callback);
  }

  // Subscribe to all progress events
  onAllProgress(callback: (event: CTOProgressEvent) => void): () => void {
    this.eventEmitter.on("progress", callback);
    return () => this.eventEmitter.off("progress", callback);
  }

  // Clean up old data
  cleanup(maxAge: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAge;

    for (const [jobId, events] of this.progressEvents.entries()) {
      const recentEvents = events.filter((event) => event.timestamp > cutoff);
      if (recentEvents.length === 0) {
        this.progressEvents.delete(jobId);
      } else {
        this.progressEvents.set(jobId, recentEvents);
      }
    }

    for (const [jobId, result] of this.operationResults.entries()) {
      if (result.completedAt < cutoff) {
        this.operationResults.delete(jobId);
      }
    }
  }
}

// Global progress store instance
export const ctoProgressStore = new CTOProgressStore();

/**
 * Enhanced CTO progress emitter that integrates with the frontend tracking
 */
export const emitCTOProgress = (
  jobId: string,
  tokenAddress: string,
  userId: string,
  userChatId: number,
  phase: number,
  totalPhases: number,
  phaseTitle: string,
  phaseDescription: string,
  progress: number,
  status: CTOProgressEvent["status"],
  mode: "standard" | "prefunded",
  platform: string,
  buyAmount: number,
  socketUserId?: string,
  details?: CTOProgressEvent["details"]
): void => {
  const progressEvent: CTOProgressEvent = {
    jobId,
    tokenAddress,
    userId,
    userChatId,
    socketUserId,
    phase,
    totalPhases,
    phaseTitle,
    phaseDescription,
    progress,
    status,
    timestamp: Date.now(),
    mode,
    platform,
    buyAmount,
    details,
  };

  // Store in local progress store
  ctoProgressStore.addProgressEvent(progressEvent);

  // Emit via existing progress service for Socket.IO
  try {
    // Dynamic import to avoid circular dependencies
    import("./progress-service")
      .then(({ emitWorkerProgress }) => {
        emitWorkerProgress(
          jobId,
          "cto_operation",
          tokenAddress,
          userId,
          userChatId,
          phase,
          totalPhases,
          phaseTitle,
          phaseDescription,
          progress,
          status,
          {
            mode,
            platform,
            buyAmount,
            socketUserId,
            ...details,
          }
        );
      })
      .catch((error) => {
        console.warn("Failed to emit via progress service:", error);
      });
  } catch (error) {
    console.warn("Failed to import progress service:", error);
  }
};

/**
 * Record final CTO operation result
 */
export const recordCTOResult = (
  jobId: string,
  success: boolean,
  successfulBuys: number,
  failedBuys: number,
  totalSpent: number,
  transactionSignatures: string[] = [],
  error?: string,
  startTime?: number
): void => {
  const now = Date.now();
  const duration = startTime ? now - startTime : 0;

  const result: CTOOperationResult = {
    jobId,
    success,
    successfulBuys,
    failedBuys,
    totalSpent,
    error,
    transactionSignatures,
    completedAt: now,
    duration,
  };

  ctoProgressStore.addOperationResult(result);
};

/**
 * Get comprehensive job status including progress history
 */
export const getCTOJobStatusWithProgress = async (jobId: string) => {
  // Get basic job status from queue
  const job = await ctoQueue.getJob(jobId);

  if (!job) {
    return { status: "not_found", error: "Job not found" };
  }

  const state = await job.getState();
  const queueProgress = job.progress;

  // Get detailed progress from store
  const progressEvents = ctoProgressStore.getProgressEvents(jobId);
  const latestProgress = ctoProgressStore.getLatestProgress(jobId);
  const operationResult = ctoProgressStore.getOperationResult(jobId);

  return {
    jobId: job.id,
    status: state,
    queueProgress,
    data: job.data as CTOJob,
    finishedOn: job.finishedOn,
    processedOn: job.processedOn,
    failedReason: job.failedReason,
    // Enhanced progress data
    progressEvents,
    latestProgress,
    operationResult,
    // Convenience fields
    currentPhase: latestProgress?.phase,
    totalPhases: latestProgress?.totalPhases,
    currentProgress: latestProgress?.progress,
    currentStatus: latestProgress?.status,
    phaseTitle: latestProgress?.phaseTitle,
    phaseDescription: latestProgress?.phaseDescription,
    details: latestProgress?.details,
  };
};

/**
 * Subscribe to real-time progress updates for a specific job
 */
export const subscribeToCTOProgress = (
  jobId: string,
  onProgress: (event: CTOProgressEvent) => void,
  onCompleted?: (result: CTOOperationResult) => void
): (() => void) => {
  const unsubscribeProgress = ctoProgressStore.onProgress(jobId, onProgress);
  const unsubscribeCompleted = onCompleted
    ? ctoProgressStore.onCompleted(jobId, onCompleted)
    : () => {};

  return () => {
    unsubscribeProgress();
    unsubscribeCompleted();
  };
};

/**
 * Get progress statistics for multiple jobs
 */
export const getCTOProgressStats = (jobIds: string[]) => {
  const stats = {
    total: jobIds.length,
    queued: 0,
    active: 0,
    completed: 0,
    failed: 0,
    totalProgress: 0,
    averageProgress: 0,
  };

  for (const jobId of jobIds) {
    const latestProgress = ctoProgressStore.getLatestProgress(jobId);
    if (latestProgress) {
      stats.totalProgress += latestProgress.progress;

      switch (latestProgress.status) {
        case "started":
        case "in_progress":
          stats.active++;
          break;
        case "completed":
          stats.completed++;
          break;
        case "failed":
          stats.failed++;
          break;
      }
    } else {
      stats.queued++;
    }
  }

  stats.averageProgress =
    stats.total > 0 ? stats.totalProgress / stats.total : 0;

  return stats;
};

// Auto-cleanup old progress data every hour
setInterval(
  () => {
    ctoProgressStore.cleanup();
  },
  60 * 60 * 1000
);
