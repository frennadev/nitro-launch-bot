import mongoose, { type ConnectOptions } from "mongoose";
import { env } from "../config";
import Redis from "ioredis";
import { logger } from "./logger";

export async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    logger.info("🚀  MongoDB connected");
  }
  const options: ConnectOptions = {};
  await mongoose.connect(env.MONGODB_URI, options);
  logger.info("🚀  MongoDB connected");
}

export async function disconnectDB() {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  logger.info("❌ Mongo DB disconnected");
}

export const redisClient = new Redis(env.REDIS_URI, {
  maxRetriesPerRequest: null,
  connectTimeout: 5000,
});

redisClient.on("ready", () => {
  logger.info("Redis connection ready");
});

redisClient.on("error", async (error) => {
  logger.error(`Redis connection error: ${error}`, error);
  await closeRedis();
});

redisClient.on("reconnecting", () => {
  logger.info("Redis: Reconnecting...");
});

redisClient.on("close", async () => {
  logger.info("Redis: Connection closed");
  await closeRedis();
});

export const closeRedis = () => {
  try {
    if (redisClient) {
      redisClient.disconnect();
      logger.info("Redis connection closed gracefully");
    }
  } catch (error) {
    logger.error(`Error closing Redis connection: ${error}`);
    throw error;
  }
};
