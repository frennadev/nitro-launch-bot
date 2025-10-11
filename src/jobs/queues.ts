import { Queue } from "bullmq";
import { redisClient } from "./db";
import type {
  LaunchTokenJob,
  PrepareTokenLaunchJob,
  ExecuteTokenLaunchJob,
  SellDevJob,
  SellWalletJob,
  CreateTokenMetadataJob,
} from "./types";

export const tokenLaunchQueue = new Queue<LaunchTokenJob>(
  "bundler-token-launch",
  {
    connection: redisClient,
  }
);

export const prepareLaunchQueue = new Queue<PrepareTokenLaunchJob>(
  "bundler-prepare-launch",
  {
    connection: redisClient,
  }
);

export const executeLaunchQueue = new Queue<ExecuteTokenLaunchJob>(
  "bundler-execute-launch",
  {
    connection: redisClient,
  }
);

export const devSellQueue = new Queue<SellDevJob>("bundler-dev-sell", {
  connection: redisClient,
});

export const walletSellQueue = new Queue<SellWalletJob>("bundler-wallet-sell", {
  connection: redisClient,
});

export const createTokenMetadataQueue = new Queue<CreateTokenMetadataJob>(
  "bundler-create-token-metadata",
  {
    connection: redisClient,
  }
);
