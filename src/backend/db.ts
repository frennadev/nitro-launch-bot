import mongoose, { type ConnectOptions } from "mongoose";
import { env } from "../config";
import { logger } from "../blockchain/common/logger";

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
