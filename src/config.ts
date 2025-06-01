import dotenv from "dotenv";
import { cleanEnv, makeValidator, str } from "envalid";

dotenv.config();

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
  HELIUS_RPC_URL: validStr()
});
