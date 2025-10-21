#!/usr/bin/env tsx

import { walletWarmingQueue } from "./src/jobs/queues.ts";
import { connectDB } from "./src/jobs/db.ts";
import type { WalletWarmingJob } from "./src/jobs/types.ts";

async function addWalletWarmingJobTest() {
  try {
    console.log("🚀 Connecting to database and queue...");
    await connectDB();

    console.log("📋 Adding wallet warming job to queue...");

    // Note: Using the public key as wallet ID for now - in production, this should be the MongoDB document ID
    const jobData: WalletWarmingJob = {
      userId: "68492054bc12916bc8cedcb3",
      userChatId: 12345,
      walletIds: ["6878f618332e48a5fbcffcc7"], // This should ideally be the MongoDB document _id
      warmingTokenAddress: "Hcekdr1nt43jvAi9aznxM2jrxGNBEVK8GWnwTHoVpump",
    };

    const job = await walletWarmingQueue.add("warm-wallets-2", jobData, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
    });

    console.log(`✅ Wallet warming job added successfully!`);
    console.log(`   - Job ID: ${job.id}`);
    console.log(`   - User ID: ${jobData.userId}`);
    console.log(`   - Wallet to warm: ${jobData.walletIds[0]}`);
    console.log(`   - Token: ${jobData.warmingTokenAddress}`);

    console.log("\n📊 Job has been queued successfully!");
    console.log("🔍 To monitor progress:");
    console.log("   - Check the terminal running the workers");
    console.log("   - Monitor wallet warming state in MongoDB");
    console.log("   - Watch for Socket.IO progress events");

    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to add wallet warming job:", error);
    process.exit(1);
  }
}

addWalletWarmingJobTest();
