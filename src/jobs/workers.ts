import { Worker } from "bullmq";
import { tokenLaunchQueue } from "./queues";
import type { LaunchTokenJob } from "./types";
import { redisClient } from "../backend/db";

export const launchTokenWorker = new Worker<LaunchTokenJob>(
  tokenLaunchQueue.name,
  async (job) => {
    console.log("Token Launch Job starting...");
    // perform the launch
    console.log(job.data);
  },
  { connection: redisClient, concurrency: 10 },
);
launchTokenWorker.on("error", async (error) => {
  console.log(`Token Launch Worker Error: ${error}`);
});
launchTokenWorker.on("failed", async (job) => {
  console.log(`Token Launch Worker Job Failed: ${job?.id}`);
});
