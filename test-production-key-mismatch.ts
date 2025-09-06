#!/usr/bin/env bun

import { config } from "dotenv";
import { MongoWalletManager } from "./src/blockchain/mixer/mongodb";

// Load environment variables
config();

async function testProductionKeyMismatch() {
  console.log("🔍 Testing Production Key Mismatch with Current ERROR Wallets...\n");
  
  const ourWorkingKey = "294f6d574446132dcb92d050612dea7aa8cdfe918f29adc9681e1cdf75ad42bb";
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  const databaseName = "test";
  
  try {
    console.log("🔧 Connecting to production database...");
    const walletManager = new MongoWalletManager(mongoUri, databaseName, ourWorkingKey);
    await walletManager.connect();
    console.log("✅ Connected successfully");
    
    const collection = walletManager['walletsCollection'];
    
    // Get current ERROR wallets (there should be some from our previous fixes)
    const errorWallets = await collection.find({ status: "error" }).limit(20).toArray();
    
    console.log(`Found ${errorWallets.length} ERROR wallets in database`);
    
    if (errorWallets.length === 0) {
      console.log("✅ No ERROR wallets in database - all were fixed!");
      
      // Let's test some available wallets that were failing in production logs
      const failingWalletIds = [
        "5gaoniNgashmyapxBjvpTKqk7D126mHCudeeAC7G3PRN",
        "7Sot6VR4geJjkPJ8TjR2gweuf9nkeehx6HGVBNY42Ggr",
        "3cEYJqiMBaRMXh9vtxKoKmxCXXawKM7D8hY9bpQUHx9H",
        "29WzTeXrgyerBTNKwdUZ6fVhEDPJTWVvGezY8VmRbGKq",
        "2cZXEFq62WFNhJ2ZmwMKxuFfxyxSM7ucrXLJBbRUrh3E"
      ];
      
      console.log("\n🧪 Testing wallets that failed in production logs...");
      
      let workingCount = 0;
      let failingCount = 0;
      
      for (const walletId of failingWalletIds) {
        const wallet = await collection.findOne({ publicKey: walletId });
        if (wallet) {
          console.log(`\n🔐 Testing wallet: ${walletId.slice(0, 8)}...`);
          console.log(`   Status: ${wallet.status}`);
          console.log(`   Created: ${wallet.createdAt}`);
          
          try {
            const keypair = walletManager.getKeypairFromStoredWallet(wallet);
            if (keypair.publicKey.toString() === wallet.publicKey) {
              console.log(`   ✅ Wallet works with our key!`);
              workingCount++;
            } else {
              console.log(`   ❌ Public key mismatch`);
              failingCount++;
            }
          } catch (error) {
            console.log(`   ❌ Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
            failingCount++;
          }
        } else {
          console.log(`   ⚠️ Wallet ${walletId.slice(0, 8)}... not found in database`);
        }
      }
      
      console.log(`\n📊 Production Log Test Results:`);
      console.log(`   ✅ Working with our key: ${workingCount}`);
      console.log(`   ❌ Failing with our key: ${failingCount}`);
      
      if (workingCount > 0 && failingCount === 0) {
        console.log("\n🎉 CONCLUSION: Our key works fine!");
        console.log("🚨 ISSUE: Production environment is using a DIFFERENT encryption key!");
        console.log("\n📋 SOLUTION:");
        console.log("Update your production environment variable:");
        console.log(`ENCRYPTION_SECRET=${ourWorkingKey}`);
      } else if (failingCount > 0) {
        console.log("\n⚠️ CONCLUSION: Even our key doesn't work for some wallets");
        console.log("This suggests multiple encryption keys were used over time");
      }
      
    } else {
      console.log("\n🧪 Testing current ERROR wallets with our key...");
      
      let workingCount = 0;
      let failingCount = 0;
      
      for (const wallet of errorWallets.slice(0, 10)) {
        console.log(`\n🔐 Testing ERROR wallet: ${wallet.publicKey.slice(0, 8)}...`);
        console.log(`   Status: ${wallet.status}`);
        console.log(`   Created: ${wallet.createdAt}`);
        
        try {
          const keypair = walletManager.getKeypairFromStoredWallet(wallet);
          if (keypair.publicKey.toString() === wallet.publicKey) {
            console.log(`   ✅ ERROR wallet actually works! (False error)`);
            workingCount++;
          } else {
            console.log(`   ❌ Public key mismatch - genuinely broken`);
            failingCount++;
          }
        } catch (error) {
          console.log(`   ❌ Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
          failingCount++;
        }
      }
      
      console.log(`\n📊 ERROR Wallet Test Results:`);
      console.log(`   ✅ Actually working: ${workingCount}`);
      console.log(`   ❌ Actually broken: ${failingCount}`);
      
      if (workingCount > 0) {
        console.log("\n🚨 CONFIRMED: Production is using a different encryption key!");
        console.log("These wallets work fine with our key but are marked as ERROR");
      }
    }
    
    await walletManager.disconnect();
    console.log("\n✅ Test complete");
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run the test
testProductionKeyMismatch().catch(console.error);