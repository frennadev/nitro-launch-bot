#!/usr/bin/env bun

import { config } from "dotenv";
import { MongoWalletManager } from "./src/blockchain/mixer/mongodb";

// Load environment variables
config();

async function fixAllWallets() {
  console.log("🔧 Fixing ALL Wallets - Making Maximum Available...\n");

  const mongoUri =
    "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=NitroLaunch";
  const encryptionKey =
    "294f6d574446132dcb92d050612dea7aa8cdfe918f29adc9681e1cdf75ad42bb";
  const databaseName = "test";

  try {
    console.log("🔧 Connecting to production database...");
    const walletManager = new MongoWalletManager(
      mongoUri,
      databaseName,
      encryptionKey
    );
    await walletManager.connect();
    console.log("✅ Connected successfully");

    // Get the collection directly
    const collection = walletManager["walletsCollection"];

    console.log("\n📊 Current Wallet Status Distribution:");
    const statusCounts = await collection
      .aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();

    statusCounts.forEach((status) => {
      console.log(`   ${status._id}: ${status.count} wallets`);
    });

    const totalWallets = statusCounts.reduce(
      (sum, status) => sum + status.count,
      0
    );
    console.log(`   TOTAL: ${totalWallets} wallets`);

    // Get all non-available wallets (except those truly in use right now)
    console.log("\n🔍 Getting all wallets that aren't 'available'...");
    const nonAvailableWallets = await collection
      .find({
        status: { $ne: "available" },
      })
      .toArray();

    console.log(
      `Found ${nonAvailableWallets.length} wallets to check and potentially fix`
    );

    if (nonAvailableWallets.length === 0) {
      console.log("✅ All wallets are already available!");
      await walletManager.disconnect();
      return;
    }

    let fixedCount = 0;
    let stillBrokenCount = 0;
    let inUseCount = 0;
    const stillBrokenWallets: string[] = [];

    console.log("\n🔍 Testing and fixing ALL non-available wallets...");

    // Process in batches of 100 for better performance
    const batchSize = 100;
    for (let i = 0; i < nonAvailableWallets.length; i += batchSize) {
      const batch = nonAvailableWallets.slice(i, i + batchSize);
      console.log(
        `\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(nonAvailableWallets.length / batchSize)} (${batch.length} wallets)`
      );

      const walletsToFix: string[] = [];

      for (const wallet of batch) {
        // Skip wallets that are legitimately in use right now
        if (wallet.status === "in_use") {
          // Double check if they're really in use by checking lastUsed timestamp
          const lastUsed = wallet.lastUsed ? new Date(wallet.lastUsed) : null;
          const now = new Date();
          const hoursSinceLastUse = lastUsed
            ? (now.getTime() - lastUsed.getTime()) / (1000 * 60 * 60)
            : null;

          if (hoursSinceLastUse && hoursSinceLastUse > 1) {
            // If not used in the last hour, it's probably stuck as "in_use"
            console.log(
              `   🔄 ${wallet.publicKey.slice(0, 8)}... - Stuck as in_use (${hoursSinceLastUse.toFixed(1)}h ago), checking...`
            );
          } else {
            console.log(
              `   ⏳ ${wallet.publicKey.slice(0, 8)}... - Recently in use, skipping`
            );
            inUseCount++;
            continue;
          }
        }

        try {
          // Test decryption
          const keypair = walletManager.getKeypairFromStoredWallet(wallet);

          if (keypair.publicKey.toString() === wallet.publicKey) {
            // This wallet works fine, should be marked as available
            walletsToFix.push(wallet.publicKey);
          } else {
            console.log(
              `   ❌ ${wallet.publicKey.slice(0, 8)}... - Public key mismatch`
            );
            stillBrokenCount++;
            stillBrokenWallets.push(wallet.publicKey);
          }
        } catch (error) {
          console.log(
            `   ❌ ${wallet.publicKey.slice(0, 8)}... - Decryption failed: ${error instanceof Error ? error.message : String(error)}`
          );
          stillBrokenCount++;
          stillBrokenWallets.push(wallet.publicKey);
        }
      }

      // Bulk update the working wallets to available status
      if (walletsToFix.length > 0) {
        const updateResult = await collection.updateMany(
          { publicKey: { $in: walletsToFix } },
          {
            $set: {
              status: "available",
              lastUsed: null,
              usageCount: 0,
            },
          }
        );

        console.log(
          `   ✅ Fixed ${updateResult.modifiedCount} wallets in this batch`
        );
        fixedCount += updateResult.modifiedCount;
      }

      // Small delay to avoid overwhelming the database
      if (i + batchSize < nonAvailableWallets.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Final summary
    console.log("\n🎉 COMPLETE WALLET RECOVERY FINISHED!");
    console.log(`   ✅ Fixed wallets: ${fixedCount}`);
    console.log(`   ⏳ Still in use: ${inUseCount}`);
    console.log(`   ❌ Actually broken: ${stillBrokenCount}`);
    console.log(
      `   📈 Total wallets processed: ${fixedCount + inUseCount + stillBrokenCount}`
    );

    // Get final updated statistics
    console.log("\n📊 FINAL Wallet Pool Statistics:");
    const finalStats = await walletManager.getWalletStats();
    console.log(`   Total wallets: ${finalStats.total}`);
    console.log(`   Available: ${finalStats.available}`);
    console.log(`   In use: ${finalStats.reserved || 0}`);
    console.log(`   Error: ${finalStats.error || 0}`);

    const availabilityPercentage = (
      (finalStats.available / finalStats.total) *
      100
    ).toFixed(1);
    console.log(
      `   🎯 Availability: ${availabilityPercentage}% of all wallets`
    );

    // Calculate mixer capacity for 8-loop system
    const maxConcurrentRoutes = Math.floor(finalStats.available / 8);
    console.log(`   🔄 Max concurrent 8-loop routes: ${maxConcurrentRoutes}`);
    console.log(
      `   💪 This supports mixing to ${maxConcurrentRoutes} wallets simultaneously with full privacy!`
    );

    if (stillBrokenCount > 0) {
      console.log(
        `\n⚠️  ${stillBrokenCount} wallets are genuinely broken and need investigation`
      );
      if (stillBrokenWallets.length > 0) {
        console.log("First 5 broken wallets:", stillBrokenWallets.slice(0, 5));
      }
    }

    await walletManager.disconnect();
    console.log("\n✅ Database connection closed");
    console.log("🚀 Your mixer now has MAXIMUM capacity available!");
  } catch (error) {
    console.error(
      `\n❌ Fix failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

// Run the complete fix
fixAllWallets().catch(console.error);
