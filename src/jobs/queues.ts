import { Queue } from "bullmq";
import { redisClient } from "./db";
import type {
  LaunchTokenJob,
  PrepareTokenLaunchJob,
  ExecuteTokenLaunchJob,
  SellDevJob,
  SellWalletJob,
} from "./types";

export const tokenLaunchQueue = new Queue<LaunchTokenJob>(
  "super-token-launch",
  {
    connection: redisClient,
  }
);

export const prepareLaunchQueue = new Queue<PrepareTokenLaunchJob>(
  "super-prepare-launch",
  {
    connection: redisClient,
  }
);

export const executeLaunchQueue = new Queue<ExecuteTokenLaunchJob>(
  "super-execute-launch",
  {
    connection: redisClient,
  }
);

export const devSellQueue = new Queue<SellDevJob>("super-dev-sell", {
  connection: redisClient,
});

export const walletSellQueue = new Queue<SellWalletJob>("super-wallet-sell", {
  connection: redisClient,
});
