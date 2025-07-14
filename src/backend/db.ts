import mongoose, { type ConnectOptions } from "mongoose";
import { env } from "../config";
import { dbLogger } from "../utils/logger";

export async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    dbLogger.info("🚀  MongoDB connected");
  }
  const options: ConnectOptions = {};
  await mongoose.connect(env.MONGODB_URI, options);
  dbLogger.info("🚀  MongoDB connected");
}

export async function disconnectDB() {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
    dbLogger.info("🔐  MongoDB disconnected");
  }
}
