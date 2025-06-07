import mongoose, { type ConnectOptions } from "mongoose";
import { env } from "../config";
import Redis from "ioredis";
import { logger } from "../blockchain/common/logger";

mongoose.Promise = global.Promise

console.log("Here-->")
export async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    logger.info("🚀  MongoDB connected")
  };
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

console.log("Here Again ---> ", env.REDIS_URI)
export const redisClient = new Redis(env.REDIS_URI, {
  maxRetriesPerRequest: null,
  connectTimeout: 5000,
});
console.log("After Here --> ")
