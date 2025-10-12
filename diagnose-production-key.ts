#!/usr/bin/env bun

import { config } from "dotenv";
import { MongoWalletManager } from "./src/blockchain/mixer/mongodb";

// Load environment variables
config();

async function diagnoseProductionKey() {
  console.log("🔍 EMERGENCY: Diagnosing Production Encryption Key Mismatch...\n");
  
  // Test with the key we know worked locally
  const knownWorkingKey = "294f6d574446132dcb92d050612dea7aa8cdfe918f29adc9681e1cdf75ad42bb";
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  const databaseName = "test";
  
  try {
    console.log("🔧 Connecting to production database...");
    const walletManager = new MongoWalletManager(mongoUri, databaseName, knownWorkingKey);
    await walletManager.connect();
    console.log("✅ Connected successfully");
    
    // Get the collection directly
    const collection = walletManager['walletsCollection'];
    
    console.log("\n📊 Current Wallet Status (After Recent Mixer Run):");
    const statusCounts = await collection.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    
    statusCounts.forEach(status => {
      console.log(`   ${status._id}: ${status.count} wallets`);
    });
    
    // Check if new error wallets were created recently
    console.log("\n🔍 Checking for recently created ERROR wallets...");
    const recentErrors = await collection.find({ 
      status: "error",
      createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) } // Last 10 minutes
    }).limit(5).toArray();
    
    if (recentErrors.length > 0) {
      console.log(`⚠️ Found ${recentErrors.length} wallets marked as ERROR in the last 10 minutes!`);
      
      console.log("\n🧪 Testing recent ERROR wallets with our known working key:");
      for (let i = 0; i < Math.min(3, recentErrors.length); i++) {
        const wallet = recentErrors[i];
        console.log(`\n🔐 Testing recent ERROR wallet ${i+1}: ${wallet.publicKey.slice(0, 8)}...`);
        console.log(`   Created: ${wallet.createdAt}`);
        console.log(`   Private key length: ${wallet.privateKey?.length || 'N/A'}`);
        
        try {
          const keypair = walletManager.getKeypairFromStoredWallet(wallet);
          if (keypair.publicKey.toString() === wallet.publicKey) {
            console.log(`   ✅ ERROR wallet decrypts fine with our key! (False error)`);
          } else {
            console.log(`   ❌ Public key mismatch - genuinely corrupted`);
          }
        } catch (error) {
          console.log(`   ❌ Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
          console.log(`   🔍 This suggests production is using a DIFFERENT encryption key!`);
        }
      }
    } else {
      console.log("✅ No recent ERROR wallets found");
    }
    
    // Test a few available wallets to confirm our key still works
    console.log("\n🧪 Testing AVAILABLE wallets with our key (sanity check):");
    const availableWallets = await collection.find({ status: "available" }).limit(3).toArray();
    
    let workingCount = 0;
    for (const wallet of availableWallets) {
      try {
        const keypair = walletManager.getKeypairFromStoredWallet(wallet);
        if (keypair.publicKey.toString() === wallet.publicKey) {
          workingCount++;
        }
      } catch (error) {
        console.log(`   ❌ Available wallet ${wallet.publicKey.slice(0, 8)}... failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    console.log(`   ✅ ${workingCount}/${availableWallets.length} available wallets work with our key`);
    
    await walletManager.disconnect();
    
    console.log("\n🚨 DIAGNOSIS COMPLETE:");
    if (recentErrors.length > 0) {
      console.log("❌ PRODUCTION IS USING A DIFFERENT ENCRYPTION KEY!");
      console.log("📋 Action needed:");
      console.log("   1. Check what ENCRYPTION_SECRET is set in production environment");
      console.log("   2. Either update production to use the correct key");
      console.log("   3. Or update our scripts to use production's current key");
      console.log("   4. Re-run wallet recovery with the correct key");
    } else {
      console.log("✅ No immediate encryption issues detected");
    }
    
  } catch (error) {
    console.error(`\n❌ Diagnosis failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run the diagnosis
diagnoseProductionKey().catch(console.error);