#!/usr/bin/env bun

import { config } from "dotenv";
import { MongoWalletManager } from "./src/blockchain/mixer/mongodb";

// Load environment variables
config();

async function testProductionWallets() {
  console.log("🔍 Testing Production Wallet Encryption...\n");
  
  // Use production-like settings
  const mongoUri = process.env.MONGODB_URI;
  const encryptionKey = process.env.ENCRYPTION_SECRET;
  const databaseName = process.env.DATABASE_NAME || "nitro-launch-bot";
  
  console.log("📋 Production Environment Check:");
  console.log(`   MONGODB_URI: ${mongoUri ? "✅ Set" : "❌ Missing"}`);
  console.log(`   ENCRYPTION_SECRET: ${encryptionKey ? `✅ Set (${encryptionKey.length} chars)` : "❌ Missing"}`);
  console.log(`   DATABASE_NAME: ${databaseName}`);
  
  if (!mongoUri || !encryptionKey) {
    console.error("\n❌ Missing required environment variables!");
    process.exit(1);
  }
  
  try {
    console.log("\n🔧 Connecting to production database...");
    const walletManager = new MongoWalletManager(mongoUri, databaseName, encryptionKey);
    await walletManager.connect();
    console.log("✅ Connected successfully");
    
    // Get raw collection statistics
    console.log("\n📊 Raw Collection Statistics:");
    const collection = walletManager['walletsCollection']; // Access private property
    const totalCount = await collection.countDocuments({});
    const availableCount = await collection.countDocuments({ status: "available" });
    const errorCount = await collection.countDocuments({ status: "error" });
    const inUseCount = await collection.countDocuments({ status: "in_use" });
    
    console.log(`   Total documents: ${totalCount}`);
    console.log(`   Available: ${availableCount}`);
    console.log(`   In use: ${inUseCount}`);
    console.log(`   Error: ${errorCount}`);
    
    if (totalCount === 0) {
      console.log("\n❌ No wallets found in production database!");
      console.log("   This suggests either:");
      console.log("   1. Wrong database connection");
      console.log("   2. Wallets are in a different collection");
      console.log("   3. Database is actually empty");
      return;
    }
    
    // Get some sample wallets for testing
    console.log("\n🔍 Testing wallet decryption (first 5 wallets)...");
    const sampleWallets = await collection.find({}).limit(5).toArray();
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < sampleWallets.length; i++) {
      const wallet = sampleWallets[i];
      const walletId = wallet.publicKey.slice(0, 8) + "...";
      
      try {
        console.log(`\n🔐 Testing wallet ${i + 1}: ${walletId}`);
        console.log(`   Status: ${wallet.status}`);
        console.log(`   Created: ${wallet.createdAt}`);
        console.log(`   Usage count: ${wallet.usageCount}`);
        
        // Test decryption
        const keypair = walletManager.getKeypairFromStoredWallet(wallet);
        
        if (keypair.publicKey.toString() === wallet.publicKey) {
          console.log(`   ✅ Decryption successful`);
          successCount++;
        } else {
          console.log(`   ❌ Public key mismatch after decryption`);
          failCount++;
        }
        
      } catch (error) {
        console.log(`   ❌ Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
        failCount++;
      }
    }
    
    // Summary
    console.log("\n📊 Production Wallet Test Results:");
    console.log(`   ✅ Successful decryptions: ${successCount}`);
    console.log(`   ❌ Failed decryptions: ${failCount}`);
    
    if (failCount > 0) {
      console.log("\n🚨 CRITICAL ISSUE IDENTIFIED:");
      console.log("   Production wallets cannot be decrypted with current ENCRYPTION_SECRET");
      console.log("   This explains why the mixer is failing!");
      console.log("\n🔧 Possible solutions:");
      console.log("   1. Use the original ENCRYPTION_SECRET that was used to create these wallets");
      console.log("   2. Re-encrypt all wallets with the current ENCRYPTION_SECRET");
      console.log("   3. Generate new intermediate wallets with current encryption key");
    } else {
      console.log("\n✅ All wallets decrypt successfully - encryption system is working!");
    }
    
    await walletManager.disconnect();
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run the test
testProductionWallets().catch(console.error);