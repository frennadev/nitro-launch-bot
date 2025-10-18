import { Queue } from "bullmq";
import { redisClient } from "./db";
import type {
  LaunchTokenJob,
  PrepareTokenLaunchJob,
  ExecuteTokenLaunchJob,
  SellDevJob,
  SellWalletJob,
  CreateTokenMetadataJob,
  LaunchDappTokenJob,
  CTOJob,
} from "./types";

export const tokenLaunchQueue = new Queue<LaunchTokenJob>(
  "nitro-token-launch",
  {
    connection: redisClient,
  }
);

export const prepareLaunchQueue = new Queue<PrepareTokenLaunchJob>(
  "nitro-prepare-launch",
  {
    connection: redisClient,
  }
);

export const executeLaunchQueue = new Queue<ExecuteTokenLaunchJob>(
  "nitro-execute-launch",
  {
    connection: redisClient,
  }
);

export const devSellQueue = new Queue<SellDevJob>("nitro-dev-sell", {
  connection: redisClient,
});

export const walletSellQueue = new Queue<SellWalletJob>("nitro-wallet-sell", {
  connection: redisClient,
});

export const createTokenMetadataQueue = new Queue<CreateTokenMetadataJob>(
  "bundler-create-token-metadata",
  {
    connection: redisClient,
  }
);

export const launchDappTokenQueue = new Queue<LaunchDappTokenJob>(
  "bundler-launch-dapp-token",
  {
    connection: redisClient,
  }
);

export const ctoQueue = new Queue<CTOJob>("nitro-cto-operation", {
  connection: redisClient,
});
