/**
 * Redis Progress Subscriber for Distributed Architecture
 * This module should be imported by the bot server to receive worker progress events
 * from the separate job server via Redis pub/sub
 */

import { redisClient } from "../jobs/db";
import { socketIOServer, WorkerProgressEvent } from "./socketio-server";

/**
 * Initialize Redis subscriber for worker progress events
 * Call this from the bot server startup to receive progress events from job server
 */
export const initializeProgressSubscriber = async () => {
  if (!redisClient) {
    console.warn(
      "Redis client not available - distributed progress tracking disabled"
    );
    return;
  }

  // Subscribe to worker progress events
  try {
    await redisClient.subscribe("worker_progress");
    console.log("✅ Subscribed to worker progress events from job server");
  } catch (error) {
    console.error("Failed to subscribe to worker_progress channel:", error);
  }

  // Handle incoming progress events
  redisClient.on("message", (channel: string, message: string) => {
    if (channel === "worker_progress") {
      try {
        const progressData = JSON.parse(message);

        // Add timestamp if missing (for compatibility)
        const progressEvent: WorkerProgressEvent = {
          ...progressData,
          timestamp: progressData.timestamp || Date.now(),
        };

        // Emit the progress event via Socket.IO to connected clients
        if (socketIOServer) {
          socketIOServer.emitWorkerProgress(progressEvent);
        }

        console.log(
          `📊 Forwarded progress event: ${progressEvent.workerType} - ${progressEvent.phaseTitle} (${progressEvent.progress}%)`
        );
      } catch (error) {
        console.error("Failed to parse worker progress event:", error);
      }
    }
  });
};

/**
 * Cleanup function to unsubscribe from Redis events
 */
export const cleanupProgressSubscriber = () => {
  if (redisClient) {
    redisClient.unsubscribe("worker_progress");
    console.log("🔄 Unsubscribed from worker progress events");
  }
};
