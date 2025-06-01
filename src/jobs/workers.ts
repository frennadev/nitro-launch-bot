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

export const launchTokenWorker = new Worker<LaunchTokenJob>(
  tokenLaunchQueue.name,
  async (job) => {
    try {
      console.log("Token Launch Job starting...");
      console.log(job.data);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      throw new Error("Failed launch due to weird reason");
      const token = job.data;
      await updateTokenState(token.tokenAddress, TokenState.LAUNCHED);
      await sendLaunchSuccessNotification(
        job!.data.userChatId,
        token.tokenAddress,
        token.tokenName,
        token.tokenSymbol,
      );
    } catch (error: any) {
      console.error(`Error Occurred while launching token: ${error.message}`);
      throw error;
    }
  },
  { connection: redisClient, concurrency: 10 },
);

launchTokenWorker.on("error", async (error) => {
  console.log(`Token Launch Worker Error: ${error}`);
});
launchTokenWorker.on("failed", async (job) => {
  console.log(`Token Launch Worker Job Failed: ${job?.name}`);
  await updateTokenState(job!.data.tokenAddress, TokenState.LISTED);
  const token = job!.data;
  await sendLaunchFailureNotification(
    job!.data.userChatId,
    token.tokenAddress,
    token.tokenName,
    token.tokenSymbol,
  );
});
