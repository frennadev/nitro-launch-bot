#!/usr/bin/env bun

import { config } from "dotenv";
import { MongoWalletManager } from "./src/blockchain/mixer/mongodb";

// Load environment variables
config();

async function findProductionKey() {
  console.log("🔍 EMERGENCY: Finding Production Encryption Key...\n");

  const mongoUri =
    "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=NitroLaunch";
  const databaseName = "test";

  // Test different possible keys
  const possibleKeys = [
    "294f6d574446132dcb92d050612dea7aa8cdfe918f29adc9681e1cdf75ad42bb", // Our working key
    process.env.ENCRYPTION_SECRET, // Local env key
    // Add more possible keys here if you have any ideas
  ];

  try {
    console.log("🔧 Connecting to production database...");

    // Get a sample of recently failed wallets
    const testManager = new MongoWalletManager(
      mongoUri,
      databaseName,
      possibleKeys[0]
    );
    await testManager.connect();

    const collection = testManager["walletsCollection"];

    // Get some recently created ERROR wallets (these should be the ones failing in production)
    const recentErrorWallets = await collection
      .find({
        status: "error",
        createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }, // Last hour
      })
      .limit(5)
      .toArray();

    console.log(
      `Found ${recentErrorWallets.length} recent ERROR wallets to test with different keys`
    );

    if (recentErrorWallets.length === 0) {
      console.log(
        "❌ No recent ERROR wallets found - production might not be running"
      );
      await testManager.disconnect();
      return;
    }

    // Test each possible key
    for (let i = 0; i < possibleKeys.length; i++) {
      const key = possibleKeys[i];
      if (!key) continue;

      console.log(
        `\n🧪 Testing key ${i + 1}: ${key.slice(0, 16)}...${key.slice(-8)}`
      );

      const walletManager = new MongoWalletManager(mongoUri, databaseName, key);
      await walletManager.connect();

      let successCount = 0;
      let failCount = 0;

      for (const wallet of recentErrorWallets.slice(0, 3)) {
        // Test first 3
        try {
          const keypair = walletManager.getKeypairFromStoredWallet(wallet);
          if (keypair.publicKey.toString() === wallet.publicKey) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          failCount++;
        }
      }

      console.log(
        `   ✅ Success: ${successCount}/${recentErrorWallets.slice(0, 3).length} wallets`
      );
      console.log(
        `   ❌ Failed: ${failCount}/${recentErrorWallets.slice(0, 3).length} wallets`
      );

      if (successCount === recentErrorWallets.slice(0, 3).length) {
        console.log(`\n🎉 FOUND WORKING KEY: ${key}`);
        console.log("This is the key that production should be using!");

        // Test a few more to be sure
        console.log("\n🔍 Confirming with more wallets...");
        let confirmSuccess = 0;
        for (const wallet of recentErrorWallets) {
          try {
            const keypair = walletManager.getKeypairFromStoredWallet(wallet);
            if (keypair.publicKey.toString() === wallet.publicKey) {
              confirmSuccess++;
            }
          } catch (error) {
            // ignore
          }
        }
        console.log(
          `✅ Confirmed: ${confirmSuccess}/${recentErrorWallets.length} recent ERROR wallets work with this key`
        );
      }

      await walletManager.disconnect();
    }

    await testManager.disconnect();

    console.log("\n🚨 DIAGNOSIS COMPLETE");
    console.log("📋 Next steps:");
    console.log(
      "1. Check what ENCRYPTION_SECRET is set in your production environment"
    );
    console.log("2. Either update production to use the working key, or");
    console.log("3. Provide the production key so we can fix wallets with it");
  } catch (error) {
    console.error(
      `\n❌ Key search failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

// Run the key search
findProductionKey().catch(console.error);
