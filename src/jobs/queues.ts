import { Queue } from "bullmq";
import type { LaunchTokenJob, SellDevJob, SellWalletJob } from "./types";
import { redisClient } from "../backend/db";

export const tokenLaunchQueue = new Queue<LaunchTokenJob>("launch-token", {
  connection: redisClient,
});

export const devSellQueue = new Queue<SellDevJob>("sell-dev", {
  connection: redisClient,
});

export const walletSellQueue = new Queue<SellWalletJob>("sell-wallets", {
  connection: redisClient,
});
