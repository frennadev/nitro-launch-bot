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
  MONGODB_URI: str({ 
    default: "mongodb+srv://alphaadmindev:alphaadmin@bundler.bladbsz.mongodb.net/" 
  }),
  REDIS_URI: validStr(),
  ENCRYPTION_SECRET: validStr(),
  PINATA_GATEWAY_URL: validStr(),
  PINATA_JWT: validStr(),
  PINATA_API_URL: validStr(),
  HELIUS_RPC_URL: validStr(),
  HELIUS_MIXER_RPC_URL: str({ 
    default: "https://mainnet.helius-rpc.com/?api-key=74feaea1-f5ce-4ef6-a124-49dd51e76f67" 
  }),
  ADMIN_IDS: str({ default: "" }),
  
  // Platform Fee Configuration (hidden from users)
  PLATFORM_FEE_WALLET: str({ default: "GRx7vW9ndEhqiL5e8scBQTdse3db9GCVyx9JyH2Ho7R" }),
  LAUNCH_FEE_SOL: num({ default: 0.05 }),
  
  // Transaction Fee Configuration
  TRANSACTION_FEE_PERCENTAGE: num({ default: 1 }), // 1% transaction fee
  TRANSACTION_FEE_WALLET: str({ default: "GRx7vW9ndEhqiL5e8scBQTdse3db9GCVyx9JyH2Ho7R" }),
  MIXER_FEE_WALLET: str({ default: "GRx7vW9ndEhqiL5e8scBQTdse3db9GCVyx9JyH2Ho7R" }),
});
