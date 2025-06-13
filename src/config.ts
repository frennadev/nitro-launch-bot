import { config } from "dotenv";
import { cleanEnv, makeValidator, str, num } from "envalid";

config();

const validStr = makeValidator((x) => {
  if (!x) throw new Error("Should not empty");
  return x;
});

export const env = cleanEnv(process.env, {
  NODE_ENV: str({
    default: "development",
    choices: ["development", "production"],
  }),
  TELEGRAM_BOT_TOKEN: validStr(),
  MONGODB_URI: validStr(),
  REDIS_URI: validStr(),
  ENCRYPTION_SECRET: validStr(),
  PINATA_GATEWAY_URL: validStr(),
  PINATA_JWT: validStr(),
  PINATA_API_URL: validStr(),
  HELIUS_RPC_URL: validStr(),
  ADMIN_IDS: str({ default: "" }),
  
  // Platform Fee Configuration
  PLATFORM_FEE_WALLET: str({ default: "" }), // Platform fee collection wallet
  LAUNCH_FEE_SOL: num({ default: 0.05 }), // Fee for token launches (0.05 SOL)
});
