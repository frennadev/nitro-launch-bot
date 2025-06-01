import { Queue } from "bullmq";
import type { LaunchTokenJob } from "./types";
import { redisClient } from "../backend/db";

export const tokenLaunchQueue = new Queue<LaunchTokenJob>("launch-token", {
    connection: redisClient
})
