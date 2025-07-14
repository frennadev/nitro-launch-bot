import { config } from "dotenv";

// Load environment variables
config();

// Environment configuration
export const env = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || "",
  NODE_ENV: process.env.NODE_ENV || "development",
  MONGODB_URI: process.env.MONGODB_URI || "",
  REDIS_URI: process.env.REDIS_URI || "",
  HELIUS_RPC_URL: process.env.HELIUS_RPC_URL || "",
  PINATA_API_KEY: process.env.PINATA_API_KEY || "",
  PINATA_SECRET_KEY: process.env.PINATA_SECRET_KEY || "",
  PINATA_JWT: process.env.PINATA_JWT || "",
  ENCRYPTION_SECRET: process.env.ENCRYPTION_SECRET || "",
  TRADING_HELIUS_RPC: process.env.TRADING_HELIUS_RPC || "",
  MIXER_HELIUS_RPC: process.env.MIXER_HELIUS_RPC || "",
  UTILS_HELIUS_RPC: process.env.UTILS_HELIUS_RPC || "",
  ADMIN_IDS: process.env.ADMIN_IDS || "",
  PLATFORM_FEE_WALLET: process.env.PLATFORM_FEE_WALLET || "GRx7vW9ndEhqiL5e8scBQTdse3db9GCVyx9JyH2Ho7R",
  LAUNCH_FEE_SOL: parseFloat(process.env.LAUNCH_FEE_SOL || "0.05"),
  TRANSACTION_FEE_PERCENTAGE: parseFloat(process.env.TRANSACTION_FEE_PERCENTAGE || "1"),
  TRANSACTION_FEE_WALLET: process.env.TRANSACTION_FEE_WALLET || "GRx7vW9ndEhqiL5e8scBQTdse3db9GCVyx9JyH2Ho7R",
  MIXER_FEE_WALLET: process.env.MIXER_FEE_WALLET || "GRx7vW9ndEhqiL5e8scBQTdse3db9GCVyx9JyH2Ho7R",
};

// Performance configuration
export const LIGHTWEIGHT_MODE = process.env.LIGHTWEIGHT_MODE === "true";
export const ENABLE_BACKGROUND_PRELOADING = process.env.ENABLE_BACKGROUND_PRELOADING === "true";
export const MAX_POOL_CACHE_SIZE = parseInt(process.env.MAX_POOL_CACHE_SIZE || "1000");
export const ENABLE_POOL_CACHE = process.env.ENABLE_POOL_CACHE !== 'false';
