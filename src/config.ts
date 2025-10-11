import { config } from "dotenv";
import { cleanEnv, makeValidator, str, num } from "envalid";

config();

const validStr = makeValidator((x, name) => {
  if (!x) {
    throw new Error(
      `Environment variable ${name} is required but not set. Please check your .env file or deployment configuration.`
    );
  }
  return x;
});

const validBool = makeValidator((x) => {
  if (typeof x !== "boolean") throw new Error("Should be a boolean");
  return x;
});

const validInt = makeValidator((x) => {
  if (typeof x !== "number" || isNaN(x)) throw new Error("Should be a number");
  return x;
});

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
    default: "development",
    choices: ["development", "production"],
  }),
  TELEGRAM_BOT_TOKEN: validStr(),
  MONGODB_URI: str({
    default:
      "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/nitro_launch",
  }),
  REDIS_URI: validStr(),
  ENCRYPTION_SECRET: validStr(),
  PINATA_GATEWAY_URL: validStr(),
  PINATA_JWT: validStr(),
  PINATA_API_URL: validStr(),
  HELIUS_RPC_URL: validStr(),
  HELIUS_MIXER_RPC_URL: str({
    default:
      "https://mainnet.helius-rpc.com/?api-key=74feaea1-f5ce-4ef6-a124-49dd51e76f67",
  }),
  TRADING_HELIUS_RPC: validStr(),
  MIXER_HELIUS_RPC: validStr(),
  UTILS_HELIUS_RPC: validStr(),
  ADMIN_IDS: str({ default: "" }),

  // User Access Control
  ALLOWED_USERS: str({ default: "saintlessteel,dyingangels,SuperDevBack" }),

  // WebSocket Configuration
  WEBSOCKET_PORT: str({ default: "3001" }),

  // SolanaTracker API Configuration (Replacing Birdeye)
  SOLANA_TRACKER_API_KEY: str({ default: "" }),
  SOLANA_TRACKER_BASE_URL: str({ default: "https://data.solanatracker.io" }),

  // Platform Fee Configuration (hidden from users)
  PLATFORM_FEE_WALLET: str({
    default: "GRx7vW9ndEhqiL5e8scBQTdse3db9GCVyx9JyH2Ho7R",
  }),
  LAUNCH_FEE_SOL: num({ default: 0.05 }),

  // Transaction Fee Configuration
  TRANSACTION_FEE_PERCENTAGE: num({ default: 1 }), // 1% transaction fee
  TRANSACTION_FEE_WALLET: str({
    default: "GRx7vW9ndEhqiL5e8scBQTdse3db9GCVyx9JyH2Ho7R",
  }),
  MIXER_FEE_WALLET: str({
    default: "GRx7vW9ndEhqiL5e8scBQTdse3db9GCVyx9JyH2Ho7R",
  }),
});

// Performance and resource management
export const ENABLE_BACKGROUND_PRELOADING =
  process.env.ENABLE_BACKGROUND_PRELOADING === "true"; // Disabled by default (only enable explicitly)
export const ENABLE_POOL_CACHE = process.env.ENABLE_POOL_CACHE !== "false"; // Enable by default
export const LIGHTWEIGHT_MODE = process.env.LIGHTWEIGHT_MODE !== "false"; // Enable lightweight mode by default
export const MAX_POOL_CACHE_SIZE = parseInt(
  process.env.MAX_POOL_CACHE_SIZE || "1000"
); // Limit cache size
