#!/usr/bin/env bun

import { config } from "dotenv";
import { MongoWalletManager } from "./src/blockchain/mixer/mongodb";

// Load environment variables
config();

async function checkCurrentErrors() {
  console.log("🔍 Checking Current ERROR Wallets...\n");

  const knownWorkingKey =
    "294f6d574446132dcb92d050612dea7aa8cdfe918f29adc9681e1cdf75ad42bb";
  const mongoUri =
    "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=NitroLaunch";
  const databaseName = "test";

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

    // Get current ERROR wallets
    console.log("📊 Getting current ERROR wallets...");
    const errorWallets = await collection
      .find({ status: "error" })
      .limit(10)
      .toArray();

    console.log(`Found ${errorWallets.length} ERROR wallets to test`);

    if (errorWallets.length === 0) {
      console.log("✅ No ERROR wallets found!");
      await walletManager.disconnect();
      return;
    }

    let fixableCount = 0;
    let genuinelyBrokenCount = 0;
    const fixableWallets: string[] = [];

    console.log("\n🧪 Testing current ERROR wallets:");
    for (let i = 0; i < errorWallets.length; i++) {
      const wallet = errorWallets[i];
      console.log(
        `\n🔐 Testing ERROR wallet ${i + 1}: ${wallet.publicKey.slice(0, 8)}...`
      );
      console.log(`   Created: ${wallet.createdAt}`);
      console.log(
        `   Private key length: ${wallet.privateKey?.length || "N/A"}`
      );

      try {
        const keypair = walletManager.getKeypairFromStoredWallet(wallet);
        if (keypair.publicKey.toString() === wallet.publicKey) {
          console.log(`   ✅ ERROR wallet actually works! (False error)`);
          fixableCount++;
          fixableWallets.push(wallet.publicKey);
        } else {
          console.log(`   ❌ Public key mismatch - genuinely corrupted`);
          genuinelyBrokenCount++;
        }
      } catch (error) {
        console.log(
          `   ❌ Decryption failed: ${error instanceof Error ? error.message : String(error)}`
        );
        genuinelyBrokenCount++;
      }
    }

    console.log(`\n📊 ERROR Wallet Analysis:`);
    console.log(`   ✅ Fixable (false errors): ${fixableCount}`);
    console.log(`   ❌ Genuinely broken: ${genuinelyBrokenCount}`);

    if (fixableCount > 0) {
      console.log(`\n🔧 Fixing ${fixableCount} false ERROR wallets...`);

      const updateResult = await collection.updateMany(
        { publicKey: { $in: fixableWallets } },
        {
          $set: {
            status: "available",
            lastUsed: null,
            usageCount: 0,
          },
        }
      );

      console.log(`✅ Fixed ${updateResult.modifiedCount} wallets`);

      // Get updated stats
      const finalStats = await walletManager.getWalletStats();
      console.log(`\n📊 Updated Wallet Pool:`);
      console.log(`   Total: ${finalStats.total}`);
      console.log(`   Available: ${finalStats.available}`);
      console.log(`   Error: ${finalStats.error || 0}`);

      const maxRoutes = Math.floor(finalStats.available / 8);
      console.log(`   🔄 Max 8-loop routes: ${maxRoutes}`);
    }

    await walletManager.disconnect();
    console.log("\n✅ Current error check complete!");
  } catch (error) {
    console.error(
      `\n❌ Check failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

// Run the check
checkCurrentErrors().catch(console.error);
