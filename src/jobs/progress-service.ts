/**
 * Distributed Progress Tracking Service
 * Handles worker progress emission in both monolith and distributed architectures
 */

export interface WorkerProgressEvent {
  jobId: string;
  workerType:
    | "launch_token"
    | "prepare_launch"
    | "execute_launch"
    | "dev_sell"
    | "wallet_sell"
    | "create_token_metadata"
    | "launch_token_from_dapp";
  tokenAddress: string;
  userId: string;
  userChatId: number;
  phase: number;
  totalPhases: number;
  phaseTitle: string;
  phaseDescription: string;
  progress: number;
  status: "started" | "in_progress" | "completed" | "failed";
  timestamp: number;
  details?: Record<string, unknown>;
}

/**
 * Safe worker progress emission that works in both monolith and distributed modes
 */
export const emitWorkerProgress = (
  jobId: string,
  workerType: WorkerProgressEvent["workerType"],
  tokenAddress: string,
  userId: string,
  userChatId: number,
  phase: number,
  totalPhases: number,
  phaseTitle: string,
  phaseDescription: string,
  progress: number,
  status: WorkerProgressEvent["status"],
  details?: Record<string, unknown>
): void => {
  const progressEvent: WorkerProgressEvent = {
    jobId,
    workerType,
    tokenAddress,
    userId,
    userChatId,
    phase,
    totalPhases,
    phaseTitle,
    phaseDescription,
    progress,
    status,
    timestamp: Date.now(),
    details,
  };

  // Check if we're running in distributed mode
  const isDistributed =
    process.env.NODE_ENV === "distributed" ||
    process.env.DISTRIBUTED_MODE === "true";

  if (isDistributed) {
    // In distributed mode, emit via Redis pub/sub
    emitViaRedis(progressEvent);
  } else {
    // In monolith mode, emit directly via Socket.IO
    emitViaSocketIO(progressEvent);
  }
};

/**
 * Emit progress via Socket.IO (monolith mode)
 */
const emitViaSocketIO = (event: WorkerProgressEvent): void => {
  try {
    // Use dynamic import to avoid requiring socket.io in distributed mode
    const socketModule = eval('require("../websocket/socketio-server")');

    // Check if the socket server is initialized
    if (
      socketModule.socketIOServer &&
      typeof socketModule.socketIOServer.emitWorkerProgress === "function"
    ) {
      socketModule.socketIOServer.emitWorkerProgress(
        event.jobId,
        event.workerType,
        event.tokenAddress,
        event.userId,
        event.userChatId,
        event.phase,
        event.totalPhases,
        event.phaseTitle,
        event.phaseDescription,
        event.progress,
        event.status,
        event.details
      );
    } else {
      // Socket.IO server not initialized, this is normal in distributed mode
      // Use debug level instead of console.log to reduce noise
      if (process.env.DEBUG_PROGRESS === "true") {
        console.log(
          "Socket.IO server not initialized - running in distributed mode"
        );
      }
    }
  } catch (error) {
    // Only log if debug mode is enabled to reduce log noise
    if (process.env.DEBUG_PROGRESS === "true") {
      console.log(
        "Socket.IO progress emission unavailable:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
};

/**
 * Emit progress via Redis pub/sub (distributed mode)
 */
const emitViaRedis = (event: WorkerProgressEvent): void => {
  try {
    // Use dynamic import to avoid requiring Redis in monolith mode
    const redisModule = eval('require("../backend/redis")');
    const redisClient = redisModule.redisClient || redisModule.default;

    if (redisClient && redisClient.publish) {
      // Publish to Redis channel that the bot server will subscribe to
      redisClient.publish("worker_progress", JSON.stringify(event));
    }
  } catch {
    console.log("Redis progress emission unavailable");
  }
};

/**
 * No-op function for backward compatibility
 */
export const emitWorkerStep = (): void => {
  // Legacy function - not used in current implementation
};
