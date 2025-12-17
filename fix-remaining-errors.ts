#!/usr/bin/env bun

import { config } from "dotenv";
import { MongoWalletManager } from "./src/blockchain/mixer/mongodb";

// Load environment variables
config();

async function fixRemainingErrors() {
  console.log("🔧 Fixing ALL Remaining ERROR Wallets...\n");

  const knownWorkingKey = process.env.ENCRYPTION_SECRET;
  const mongoUri = process.env.MONGODB_URI;
  const databaseName = process.env.MONGODB_DATABASE || "nitro_launch";

  if (!mongoUri || !knownWorkingKey) {
    throw new Error(
      "MONGODB_URI and ENCRYPTION_SECRET environment variables are required"
    );
  }

  try {
    console.log("🔧 Connecting to production database...");
    const walletManager = new MongoWalletManager(
      mongoUri,
      databaseName,
      knownWorkingKey
    );
    await walletManager.connect();
    console.log("✅ Connected successfully");

    // Get the collection directly
    const collection = walletManager["walletsCollection"];

    // Get ALL ERROR wallets
    console.log("📊 Getting ALL remaining ERROR wallets...");
    const errorWallets = await collection.find({ status: "error" }).toArray();

    console.log(`Found ${errorWallets.length} ERROR wallets to process`);

    if (errorWallets.length === 0) {
      console.log("🎉 No ERROR wallets remaining!");
      await walletManager.disconnect();
      return;
    }

    let fixedCount = 0;
    let stillBrokenCount = 0;
    const stillBrokenWallets: string[] = [];

    console.log("\n🔍 Testing and fixing all ERROR wallets in batches...");

    // Process in batches of 50 for better performance
    const batchSize = 50;
    for (let i = 0; i < errorWallets.length; i += batchSize) {
      const batch = errorWallets.slice(i, i + batchSize);
      console.log(
        `\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(errorWallets.length / batchSize)} (${batch.length} wallets)`
      );

      const walletsToFix: string[] = [];

      for (const wallet of batch) {
        try {
          // Test decryption
          const keypair = walletManager.getKeypairFromStoredWallet(wallet);

          if (keypair.publicKey.toString() === wallet.publicKey) {
            // This wallet works fine, should be marked as available
            walletsToFix.push(wallet.publicKey);
          } else {
            stillBrokenCount++;
            stillBrokenWallets.push(wallet.publicKey);
          }
        } catch (error) {
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

      if (walletsToFix.length < batch.length) {
        console.log(
          `   ⚠️ ${batch.length - walletsToFix.length} wallets in this batch are genuinely broken`
        );
      }

      // Small delay to avoid overwhelming the database
      if (i + batchSize < errorWallets.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Final summary
    console.log("\n🎉 ERROR WALLET RECOVERY COMPLETE!");
    console.log(`   ✅ Fixed wallets: ${fixedCount}`);
    console.log(`   ❌ Still broken: ${stillBrokenCount}`);

    // Get final updated statistics
    console.log("\n📊 FINAL Wallet Pool Statistics:");
    const finalStats = await walletManager.getWalletStats();
    console.log(`   Total wallets: ${finalStats.total}`);
    console.log(`   Available: ${finalStats.available}`);
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
      `   💪 This supports mixing to ${maxConcurrentRoutes} wallets simultaneously!`
    );

    if (stillBrokenCount > 0) {
      console.log(`\n⚠️  ${stillBrokenCount} wallets are genuinely broken`);
      console.log("These may need manual investigation or recreation");
      if (stillBrokenWallets.length > 0) {
        console.log("First 3 broken wallets:", stillBrokenWallets.slice(0, 3));
      }
    }

    await walletManager.disconnect();
    console.log("\n✅ Database connection closed");
    console.log("🚀 Your mixer now has MAXIMUM available capacity!");
  } catch (error) {
    console.error(
      `\n❌ Fix failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

// Run the complete fix
fixRemainingErrors().catch(console.error);
