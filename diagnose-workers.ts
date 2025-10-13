#!/usr/bin/env bun

/**
 * Worker Diagnostics Script
 *
 * This script checks the status of all BullMQ workers and queues
 * to diagnose why workers might not be functioning properly.
 */

import { logger } from "./src/jobs/logger";
import { redisClient } from "./src/jobs/db";
import {
  tokenLaunchQueue,
  devSellQueue,
  walletSellQueue,
  prepareLaunchQueue,
  executeLaunchQueue,
  createTokenMetadataQueue,
  launchDappTokenQueue,
} from "./src/jobs/queues";

async function diagnoseWorkers() {
  console.log("🔍 WORKER DIAGNOSTICS STARTING...\n");

  try {
    // 1. Check Redis Connection
    console.log("1️⃣ REDIS CONNECTION CHECK:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    try {
      await redisClient.ping();
      console.log("✅ Redis connection: HEALTHY");

      const info = await redisClient.info();
      const lines = info.split("\n");
      const connectedClients = lines
        .find((line) => line.startsWith("connected_clients:"))
        ?.split(":")[1]
        ?.trim();
      console.log(`📊 Connected clients: ${connectedClients || "unknown"}`);
    } catch (error) {
      console.log("❌ Redis connection: FAILED");
      console.log(`   Error: ${error}`);
      return;
    }

    // 2. Check Queue Status
    console.log("\n2️⃣ QUEUE STATUS CHECK:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const queues = [
      { name: "tokenLaunchQueue", queue: tokenLaunchQueue },
      { name: "devSellQueue", queue: devSellQueue },
      { name: "walletSellQueue", queue: walletSellQueue },
      { name: "prepareLaunchQueue", queue: prepareLaunchQueue },
      { name: "executeLaunchQueue", queue: executeLaunchQueue },
      { name: "createTokenMetadataQueue", queue: createTokenMetadataQueue },
      { name: "launchDappTokenQueue", queue: launchDappTokenQueue },
    ];

    for (const { name, queue } of queues) {
      try {
        const [waiting, active, completed, failed] = await Promise.all([
          queue.getWaiting(),
          queue.getActive(),
          queue.getCompleted(),
          queue.getFailed(),
        ]);

        console.log(`📋 ${name}:`);
        console.log(`   • Waiting: ${waiting.length}`);
        console.log(`   • Active: ${active.length}`);
        console.log(`   • Completed: ${completed.length}`);
        console.log(`   • Failed: ${failed.length}`);

        if (failed.length > 0) {
          console.log(`   ⚠️  Recent failures:`);
          failed.slice(-3).forEach((job, i) => {
            console.log(
              `      ${i + 1}. ${job.failedReason || "Unknown error"}`
            );
          });
        }
      } catch (error) {
        console.log(`❌ ${name}: Error getting status - ${error}`);
      }
    }

    // 3. Check Worker Registration
    console.log("\n3️⃣ WORKER REGISTRATION CHECK:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    try {
      // Import workers to check if they initialize without errors
      const workers = await import("./src/jobs/workers");

      const workerNames = [
        "launchTokenWorker",
        "sellDevWorker",
        "sellWalletWorker",
        "prepareLaunchWorker",
        "createTokenMetadataWorker",
        "launchTokenFromDappWorker",
        "executeLaunchWorker",
      ];

      for (const workerName of workerNames) {
        if (workers[workerName]) {
          console.log(`✅ ${workerName}: REGISTERED`);
        } else {
          console.log(`❌ ${workerName}: NOT FOUND`);
        }
      }
    } catch (error) {
      console.log(`❌ Worker import failed: ${error}`);
    }

    // 4. Check Environment Variables
    console.log("\n4️⃣ ENVIRONMENT CHECK:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const { env } = await import("./src/config");
    console.log(`📍 REDIS_URI: ${env.REDIS_URI ? "✅ SET" : "❌ MISSING"}`);
    console.log(`📍 MONGODB_URI: ${env.MONGODB_URI ? "✅ SET" : "❌ MISSING"}`);
    console.log(`📍 NODE_ENV: ${process.env.NODE_ENV || "development"}`);

    console.log("\n✅ DIAGNOSTICS COMPLETE");
    console.log("\nIf workers are still not functioning:");
    console.log(
      "1. Check if jobs process is running: 'bun run src/jobs/index.ts'"
    );
    console.log("2. Check Docker logs if running in containers");
    console.log("3. Verify Redis and MongoDB connections are stable");
  } catch (error) {
    console.error("❌ Diagnostics failed:", error);
  } finally {
    // Cleanup
    await redisClient.quit();
    process.exit(0);
  }
}

// Run diagnostics
diagnoseWorkers().catch(console.error);
