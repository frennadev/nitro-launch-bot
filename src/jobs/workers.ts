import { Worker } from "bullmq";
import { tokenLaunchQueue, devSellQueue, walletSellQueue } from "./queues";
import type { LaunchTokenJob, SellDevJob, SellWalletJob } from "./types";
import { redisClient } from "../backend/db";
import {
  releaseDevSellLock,
  releaseWalletSellLock,
  updateTokenState,
} from "../backend/functions";
import { TokenState } from "../backend/types";
import {
  sendLaunchFailureNotification,
  sendLaunchSuccessNotification,
  sendNotification,
} from "../bot/message";
import { executeTokenLaunch } from "../blockchain/pumpfun/launch";
import { executeDevSell, executeWalletSell } from "../blockchain/pumpfun/sell";
import { logger } from "./logger";

console.log("workerrrr here")
export const launchTokenWorker = new Worker<LaunchTokenJob>(
  tokenLaunchQueue.name,
  async (job) => {
    try {
      logger.info("[jobs]: Token Launch Job starting...");
      const data = job.data;
      logger.info("[jobs-launch-token]: Job Data", data);
      await executeTokenLaunch(
        data.tokenPrivateKey,
        data.funderWallet,
        data.devWallet,
        data.buyerWallets,
        data.buyDistribution,
        data.tokenName,
        data.tokenSymbol,
        data.tokenMetadataUri,
        data.buyAmount,
        data.devBuy,
        data.launchStage,
      );
      await updateTokenState(data.tokenAddress, TokenState.LAUNCHED);
      await sendLaunchSuccessNotification(
        data.userChatId,
        data.tokenAddress,
        data.tokenName,
        data.tokenSymbol,
      );
    } catch (error: any) {
      logger.error(
        "[jobs-launch-token]: Error Occurred while launching token",
        error,
      );
      throw error;
    }
  },
  { connection: redisClient, concurrency: 10 },
);

export const sellDevWorker = new Worker<SellDevJob>(
  devSellQueue.name,
  async (job) => {
    try {
      logger.info("[jobs]: Sell Dev Job starting...");
      const data = job.data;
      logger.info("[jobs-sell-dev]: Job Data", data);
      const result = await executeDevSell(
        data.tokenAddress,
        data.devWallet,
        data.sellPercent,
      );
      await releaseDevSellLock(data.tokenAddress);
      await sendNotification(
        data.userChatId,
        `🎉 Dev Sell completed successfully\\.\n[View on Solscan](https://solscan.io/tx/${result.signature})`,
      );
    } catch (error: any) {
      logger.error(
        "[jobs-sell-dev]: Error Occurred while selling dev supply",
        error,
      );
      throw error;
    }
  },
  { connection: redisClient, concurrency: 10 },
);

export const sellWalletWorker = new Worker<SellWalletJob>(
  walletSellQueue.name,
  async (job) => {
    try {
      logger.info("[jobs]: Wallet Sell Job starting...");
      const data = job.data;
      logger.info("[jobs-sell-wallet]: Job Data", data);
      await executeWalletSell(
        data.tokenAddress,
        data.buyerWallets,
        data.devWallet,
        data.sellPercent,
      );
      await releaseWalletSellLock(data.tokenAddress);
      await sendNotification(
        data.userChatId,
        "🎉 Wallet Sell completed successfully\\.",
      );
    } catch (error: any) {
      logger.error(
        "[jobs-sell-wallet]: Error Occurred while selling wallet supply",
        error,
      );
      throw error;
    }
  },
  { connection: redisClient, concurrency: 10 },
);

launchTokenWorker.on("error", async (error) => {
  logger.error("[jobs]: Token Launch Worker Error", error);
});
launchTokenWorker.on("failed", async (job) => {
  await updateTokenState(job!.data.tokenAddress, TokenState.LISTED);
  const token = job!.data;
  await sendLaunchFailureNotification(
    job!.data.userChatId,
    token.tokenAddress,
    token.tokenName,
    token.tokenSymbol,
  );
});

sellDevWorker.on("error", async (error) => {
  logger.error("[jobs]: Dev Sell Worker Error", error);
});
sellDevWorker.on("failed", async (job) => {
  await releaseDevSellLock(job!.data.tokenAddress);
  await sendNotification(
    job!.data.userChatId,
    "❌ Dev Wallet Sell Failed\\. Please try again 🔄",
  );
});

sellWalletWorker.on("error", async (error) => {
  logger.error("[jobs]: Wallet Sell Worker Error", error);
});
sellWalletWorker.on("failed", async (job) => {
  await releaseWalletSellLock(job!.data.tokenAddress);
  await sendNotification(
    job!.data.userChatId,
    "❌ Wallet Sells Failed\\. Please try again 🔄",
  );
});

console.log("after worker -->")
