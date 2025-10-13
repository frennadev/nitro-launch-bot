import mongoose, { type ConnectOptions } from "mongoose";
import { env } from "../config";
import Redis from "ioredis";
import { logger } from "./logger";

let isConnecting = false;
let connectionRetries = 0;
const MAX_RETRIES = 5;
const RETRY_DELAY = 2000;

export async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    logger.info("🚀  MongoDB connected");
    return;
  }

  if (isConnecting) {
    logger.info("MongoDB connection already in progress...");
    return;
  }

  isConnecting = true;

  try {
    const options: ConnectOptions = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
    };

    await mongoose.connect(env.MONGODB_URI, options);
    logger.info("🚀  MongoDB connected");
    connectionRetries = 0;
  } catch (error) {
    logger.error("MongoDB connection failed:", error);
    throw error;
  } finally {
    isConnecting = false;
  }
}

export async function disconnectDB() {
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      logger.info("❌ MongoDB disconnected gracefully");
    }
  } catch (error) {
    logger.error("Error disconnecting MongoDB:", error);
    throw error;
  }
}

// Redis connection with improved error handling and reconnection logic
export const redisClient = new Redis(env.REDIS_URI, {
  connectTimeout: 10000,
  lazyConnect: true,
  enableReadyCheck: true,
  maxRetriesPerRequest: null, // For Bull queues
  family: 4, // Force IPv4
  keepAlive: 30000,
  reconnectOnError: (err) => {
    const targetError = "READONLY";
    return err.message.includes(targetError);
  },
});

let redisConnectionState = "disconnected";

redisClient.on("connect", () => {
  logger.info("Redis: Connecting...");
  redisConnectionState = "connecting";
});

redisClient.on("ready", () => {
  logger.info("Redis: Connection ready");
  redisConnectionState = "ready";
  connectionRetries = 0;
});

redisClient.on("error", (error: any) => {
  logger.error(`Redis connection error: ${error.message}`, error);
  redisConnectionState = "error";

  // Don't auto-disconnect on every error, let Redis handle reconnection
  if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
    connectionRetries++;
    if (connectionRetries >= MAX_RETRIES) {
      logger.error(`Redis: Max retries (${MAX_RETRIES}) reached, giving up`);
      setTimeout(() => closeRedis(), 1000);
    }
  }
});

redisClient.on("reconnecting", (delay: number) => {
  logger.info(
    `Redis: Reconnecting in ${delay}ms... (attempt ${connectionRetries + 1})`
  );
  redisConnectionState = "reconnecting";
});

redisClient.on("close", () => {
  logger.info("Redis: Connection closed");
  redisConnectionState = "closed";
});

redisClient.on("end", () => {
  logger.info("Redis: Connection ended");
  redisConnectionState = "disconnected";
});

// Graceful Redis connection management
export const connectRedis = async (): Promise<void> => {
  if (redisConnectionState === "ready") {
    return;
  }

  try {
    await redisClient.connect();
    logger.info("Redis: Connected successfully");
  } catch (error) {
    logger.error("Redis: Failed to connect", error);
    throw error;
  }
};

export const closeRedis = async (): Promise<void> => {
  try {
    if (redisClient && redisConnectionState !== "disconnected") {
      await redisClient.quit();
      logger.info("Redis: Connection closed gracefully");
    }
  } catch (error) {
    logger.error(`Error closing Redis connection: ${error}`);
    // Force disconnect if graceful quit fails
    try {
      redisClient.disconnect();
    } catch (disconnectError) {
      logger.error("Error force disconnecting Redis:", disconnectError);
    }
  }
};

export const getRedisStatus = () => {
  return {
    state: redisConnectionState,
    status: redisClient.status,
    retries: connectionRetries,
  };
};

// Graceful shutdown handler
export const gracefulShutdown = async (): Promise<void> => {
  logger.info("Initiating graceful shutdown...");

  try {
    await Promise.all([closeRedis(), disconnectDB()]);
    logger.info("Graceful shutdown completed");
  } catch (error) {
    logger.error("Error during graceful shutdown:", error);
    throw error;
  }
};

// Note: SIGTERM/SIGINT handlers are managed by the main process (src/jobs/index.ts)
// The gracefulShutdown function above is called by the main handler
