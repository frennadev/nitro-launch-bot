import mongoose, { type ConnectOptions } from "mongoose";
import { env } from "../config";
import Redis from "ioredis";
import { logger } from "../blockchain/common/logger";

mongoose.Promise = global.Promise

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  const options: ConnectOptions = {}
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
