import { Worker } from "bullmq";
import { tokenLaunchQueue } from "./queues";
import type { LaunchTokenJob } from "./types";
import { redisClient } from "../backend/db";
import { updateTokenState } from "../backend/functions";
import { TokenState } from "../backend/types";
import {
  sendLaunchFailureNotification,
  sendLaunchSuccessNotification,
} from "../bot/message";
import { executeTokenLaunch } from "../blockchain/pumpfun/launch";
import { logger } from "./logger";

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
      logger.error("[jobs-launch-token]: Error Occurred while launching token", error);
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
