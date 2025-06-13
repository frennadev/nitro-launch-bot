import { Worker } from "bullmq";
import { tokenLaunchQueue, devSellQueue, walletSellQueue } from "./queues";
import type { LaunchTokenJob, SellDevJob, SellWalletJob } from "./types";
import { redisClient } from "./db";
import {
  releaseDevSellLock,
  releaseWalletSellLock,
  updateTokenState,
  handleTokenLaunchFailure,
} from "../backend/functions-main";
import { TokenState } from "../backend/types";
import {
  sendLaunchFailureNotification,
  sendLaunchSuccessNotification,
  sendNotification,
} from "../bot/message";
import { executeTokenLaunch } from "../blockchain/pumpfun/launch";
import { executeDevSell, executeWalletSell } from "../blockchain/pumpfun/sell";
import { logger } from "./logger";
import { updateLoadingState, completeLoadingState, failLoadingState } from "../bot/loading";

export const launchTokenWorker = new Worker<LaunchTokenJob>(
  tokenLaunchQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `${data.userChatId}-token_launch-${data.tokenAddress}`;
    
    try {
      logger.info("[jobs]: Token Launch Job starting...");
      logger.info("[jobs-launch-token]: Job Data", data);
      
      // Update loading state - Phase 0: Validating parameters
      await updateLoadingState(loadingKey, 0);
      
      // Update loading state - Phase 1: Checking balances
      await updateLoadingState(loadingKey, 1);
      
      // Update loading state - Phase 2: Creating token
      await updateLoadingState(loadingKey, 2);
      
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
      
      // Update loading state - Phase 5: Finalizing
      await updateLoadingState(loadingKey, 5);
      
      await updateTokenState(data.tokenAddress, TokenState.LAUNCHED, data.userId);
      
      // Complete loading state
      await completeLoadingState(
        loadingKey,
        undefined,
        `**Token:** ${data.tokenName} ($${data.tokenSymbol})\n**Address:** \`${data.tokenAddress}\``
      );
      
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
      
      // Fail loading state
      await failLoadingState(loadingKey, error.message);
      
      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 10,
    removeOnFail: {
      count: 20,
    },
    removeOnComplete: {
      count: 10,
    },
    // Set lock duration to 5 minutes (300 seconds) for launch operations
    lockDuration: 5 * 60 * 1000, // 5 minutes in milliseconds
    lockRenewTime: 30 * 1000, // Renew lock every 30 seconds
  },
);

export const sellDevWorker = new Worker<SellDevJob>(
  devSellQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `${data.userChatId}-dev_sell-${data.tokenAddress}`;
    
    try {
      logger.info("[jobs]: Sell Dev Job starting...");
      logger.info("[jobs-sell-dev]: Job Data", data);
      
      // Update loading state - Phase 0: Validating parameters
      await updateLoadingState(loadingKey, 0);
      
      // Update loading state - Phase 1: Calculating amounts
      await updateLoadingState(loadingKey, 1);
      
      // Update loading state - Phase 2: Executing transaction
      await updateLoadingState(loadingKey, 2);
      
      const result = await executeDevSell(
        data.tokenAddress,
        data.devWallet,
        data.sellPercent,
      );
      
      // Update loading state - Phase 3: Confirming
      await updateLoadingState(loadingKey, 3);
      
      await releaseDevSellLock(data.tokenAddress);
      
      // Complete loading state
      await completeLoadingState(
        loadingKey,
        undefined,
        `**Transaction:** [View on Solscan](https://solscan.io/tx/${result.signature})`
      );
      
      await sendNotification(
        data.userChatId,
        `🎉 Dev Sell completed successfully\\.\n[View on Solscan](https://solscan.io/tx/${result.signature})`,
      );
    } catch (error: any) {
      logger.error(
        "[jobs-sell-dev]: Error Occurred while selling dev supply",
        error,
      );
      
      // Fail loading state
      await failLoadingState(loadingKey, error.message);
      
      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 10,
    removeOnComplete: {
      count: 10,
    },
    removeOnFail: {
      count: 20,
    },
  },
);

export const sellWalletWorker = new Worker<SellWalletJob>(
  walletSellQueue.name,
  async (job) => {
    const data = job.data;
    const loadingKey = `${data.userChatId}-wallet_sell-${data.tokenAddress}`;
    
    try {
      logger.info("[jobs]: Wallet Sell Job starting...");
      logger.info("[jobs-sell-wallet]: Job Data", data);
      
      // Update loading state - Phase 0: Validating holdings
      await updateLoadingState(loadingKey, 0);
      
      // Update loading state - Phase 1: Calculating amounts
      await updateLoadingState(loadingKey, 1);
      
      // Update loading state - Phase 2: Executing transactions
      await updateLoadingState(loadingKey, 2);
      
      await executeWalletSell(
        data.tokenAddress,
        data.buyerWallets,
        data.devWallet,
        data.sellPercent,
      );
      
      // Update loading state - Phase 3: Confirming
      await updateLoadingState(loadingKey, 3);
      
      await releaseWalletSellLock(data.tokenAddress);
      
      // Complete loading state
      await completeLoadingState(loadingKey);
      
      await sendNotification(
        data.userChatId,
        "🎉 Wallet Sell completed successfully\\.",
      );
    } catch (error: any) {
      logger.error(
        "[jobs-sell-wallet]: Error Occurred while selling wallet supply",
        error,
      );
      
      // Fail loading state
      await failLoadingState(loadingKey, error.message);
      
      throw error;
    }
  },
  {
    connection: redisClient,
    concurrency: 10,
    removeOnComplete: {
      count: 10,
    },
    removeOnFail: {
      count: 20,
    },
  },
);

launchTokenWorker.on("ready", () => {
  logger.info("Token launch worker ready");
});
launchTokenWorker.on("active", async () => {
  logger.info("Token launch worker active");
});
launchTokenWorker.on("error", async (error) => {
  logger.error("Token Launch Worker Error", error);
});
launchTokenWorker.on("failed", async (job) => {
  await updateTokenState(job!.data.tokenAddress, TokenState.LISTED, job!.data.userId);
  
  // Handle pump address release on launch failure
  await handleTokenLaunchFailure(job!.data.tokenAddress);
  
  const token = job!.data;
  await sendLaunchFailureNotification(
    job!.data.userChatId,
    token.tokenAddress,
    token.tokenName,
    token.tokenSymbol,
  );
});
launchTokenWorker.on("closed", () => {
  logger.info("Launch Token worker closed successfully")
})

sellDevWorker.on("ready", () => {
  logger.info("Dev Sell worker ready");
});
sellDevWorker.on("active", async () => {
  logger.info("Dev Sell worker active");
});
sellDevWorker.on("error", async (error) => {
  logger.error("Dev Sell Worker Error", error);
});
sellDevWorker.on("failed", async (job) => {
  await releaseDevSellLock(job!.data.tokenAddress);
  await sendNotification(
    job!.data.userChatId,
    "❌ Dev Wallet Sell Failed\\. Please try again 🔄",
  );
});
sellDevWorker.on("closed", () => {
  logger.error("Dev Sell Worker closed successfully");
});

sellWalletWorker.on("ready", () => {
  logger.info("Wallet Sell worker ready");
});
sellWalletWorker.on("active", async () => {
  logger.info("Wallet Sell worker active");
});
sellWalletWorker.on("error", async (error) => {
  logger.error("Wallet Sell Worker Error", error);
});
sellWalletWorker.on("failed", async (job) => {
  await releaseWalletSellLock(job!.data.tokenAddress);
  await sendNotification(
    job!.data.userChatId,
    "❌ Wallet Sells Failed\\. Please try again 🔄",
  );
});
sellWalletWorker.on("closed", async () => {
  logger.info("Wallet Sell worker closed successfully");
});
