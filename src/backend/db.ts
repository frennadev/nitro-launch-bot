import mongoose from "mongoose";
import { env } from "../config";

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return
  await mongoose.connect(env.MONGODB_URI);
  console.log("🚀  MongoDB connected");
}
