#!/usr/bin/env bun

import { config } from "dotenv";
import { MongoWalletManager } from "./src/blockchain/mixer/mongodb";

// Load environment variables
config();

async function fixErrorWallets() {
  console.log("🔧 Fixing Falsely Marked ERROR Wallets...\n");

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

    console.log("\n📊 Getting all ERROR wallets...");
    const errorWallets = await collection.find({ status: "error" }).toArray();
    console.log(`Found ${errorWallets.length} wallets marked as ERROR`);

    let fixedCount = 0;
    let stillBrokenCount = 0;
    const stillBrokenWallets: string[] = [];

    console.log("\n🔍 Testing and fixing wallets in batches...");

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
      if (i + batchSize < errorWallets.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Final summary
    console.log("\n🎉 WALLET RECOVERY COMPLETE!");
    console.log(`   ✅ Fixed wallets: ${fixedCount}`);
    console.log(`   ❌ Still broken: ${stillBrokenCount}`);
    console.log(`   📈 Mixer capacity increased by ${fixedCount} wallets!`);

    // Get updated statistics
    console.log("\n📊 Updated Wallet Pool Statistics:");
    const stats = await walletManager.getWalletStats();
    console.log(`   Total wallets: ${stats.total}`);
    console.log(
      `   Available: ${stats.available} (was 848, now ${stats.available})`
    );
    console.log(`   In use: ${stats.reserved || 0}`);
    console.log(
      `   Error: ${stats.error || 0} (was 648, now ${stats.error || 0})`
    );

    const capacityIncrease = (((stats.available - 848) / 848) * 100).toFixed(1);
    console.log(`   🚀 Mixer capacity increased by ${capacityIncrease}%`);

    if (stillBrokenCount > 0) {
      console.log(
        `\n⚠️  ${stillBrokenCount} wallets are still broken and need manual investigation`
      );
      console.log("First 5 broken wallets:", stillBrokenWallets.slice(0, 5));
    }

    await walletManager.disconnect();
    console.log("\n✅ Database connection closed");
    console.log(
      "🎯 Your mixer should now have significantly more intermediate wallets available!"
    );
  } catch (error) {
    console.error(
      `\n❌ Fix failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

// Run the fix
fixErrorWallets().catch(console.error);
