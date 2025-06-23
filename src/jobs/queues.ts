import { Queue } from "bullmq";
import { redisClient } from "./db";
import type { LaunchTokenJob, PrepareTokenLaunchJob, ExecuteTokenLaunchJob, SellDevJob, SellWalletJob } from "./types";

export const tokenLaunchQueue = new Queue<LaunchTokenJob>("token-launch", {
  connection: redisClient,
});

export const prepareLaunchQueue = new Queue<PrepareTokenLaunchJob>("prepare-launch", {
  connection: redisClient,
});

export const executeLaunchQueue = new Queue<ExecuteTokenLaunchJob>("execute-launch", {
  connection: redisClient,
});

export const devSellQueue = new Queue<SellDevJob>("dev-sell", {
  connection: redisClient,
});

export const walletSellQueue = new Queue<SellWalletJob>("wallet-sell", {
  connection: redisClient,
});
