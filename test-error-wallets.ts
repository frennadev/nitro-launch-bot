#!/usr/bin/env bun

import { config } from "dotenv";
import { MongoWalletManager } from "./src/blockchain/mixer/mongodb";

// Load environment variables
config();

async function testErrorWallets() {
  console.log("🔍 Testing ERROR Wallets Specifically...\n");
  
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  const encryptionKey = "294f6d574446132dcb92d050612dea7aa8cdfe918f29adc9681e1cdf75ad42bb";
  const databaseName = "test";
  
  try {
    console.log("🔧 Connecting to production database...");
    const walletManager = new MongoWalletManager(mongoUri, databaseName, encryptionKey);
    await walletManager.connect();
    console.log("✅ Connected successfully");
    
    // Get the collection directly to query error wallets
    const collection = walletManager['walletsCollection'];
    
    console.log("\n📊 Error Wallet Analysis:");
    const errorWallets = await collection.find({ status: "error" }).limit(10).toArray();
    console.log(`Found ${errorWallets.length} error wallets to test`);
    
    let successCount = 0;
    let failCount = 0;
    const failureReasons: { [key: string]: number } = {};
    
    for (let i = 0; i < errorWallets.length; i++) {
      const wallet = errorWallets[i];
      const walletId = wallet.publicKey.slice(0, 8) + "...";
      
      console.log(`\n🔐 Testing ERROR wallet ${i + 1}: ${walletId}`);
      console.log(`   Status: ${wallet.status}`);
      console.log(`   Created: ${wallet.createdAt}`);
      console.log(`   Private key length: ${wallet.privateKey?.length || 'undefined'}`);
      console.log(`   Private key format: ${wallet.privateKey?.includes(':') ? 'IV:encrypted' : 'unknown'}`);
      
      try {
        // Test decryption
        const keypair = walletManager.getKeypairFromStoredWallet(wallet);
        
        if (keypair.publicKey.toString() === wallet.publicKey) {
          console.log(`   ✅ ERROR wallet actually decrypts fine! (False error)`);
          successCount++;
          
          // This wallet should be marked as available, not error
          console.log(`   🔧 This wallet should be marked as AVAILABLE, not ERROR`);
        } else {
          console.log(`   ❌ Public key mismatch after decryption`);
          failCount++;
          failureReasons["public_key_mismatch"] = (failureReasons["public_key_mismatch"] || 0) + 1;
        }
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log(`   ❌ Decryption failed: ${errorMsg}`);
        failCount++;
        
        // Categorize the error
        if (errorMsg.includes("Invalid encryption key")) {
          failureReasons["invalid_encryption_key"] = (failureReasons["invalid_encryption_key"] || 0) + 1;
        } else if (errorMsg.includes("Non-base58 character")) {
          failureReasons["non_base58_character"] = (failureReasons["non_base58_character"] || 0) + 1;
        } else if (errorMsg.includes("corrupted data")) {
          failureReasons["corrupted_data"] = (failureReasons["corrupted_data"] || 0) + 1;
        } else {
          failureReasons["other"] = (failureReasons["other"] || 0) + 1;
        }
      }
    }
    
    // Summary
    console.log("\n📊 ERROR Wallet Test Results:");
    console.log(`   ✅ Actually working: ${successCount} (false errors)`);
    console.log(`   ❌ Actually broken: ${failCount}`);
    
    if (Object.keys(failureReasons).length > 0) {
      console.log("\n🔍 Failure Breakdown:");
      Object.entries(failureReasons).forEach(([reason, count]) => {
        console.log(`   ${reason}: ${count} wallets`);
      });
    }
    
    if (successCount > 0) {
      console.log("\n🚨 CRITICAL FINDING:");
      console.log(`   ${successCount} wallets marked as ERROR actually work fine!`);
      console.log("   These should be marked as AVAILABLE to increase mixer capacity.");
      console.log("\n🔧 Recommended action:");
      console.log("   Run a script to re-validate all ERROR wallets and mark working ones as AVAILABLE");
    }
    
    // Test some available wallets for comparison
    console.log("\n🔍 Testing AVAILABLE wallets for comparison:");
    const availableWallets = await collection.find({ status: "available" }).limit(3).toArray();
    
    for (let i = 0; i < availableWallets.length; i++) {
      const wallet = availableWallets[i];
      const walletId = wallet.publicKey.slice(0, 8) + "...";
      
      try {
        const keypair = walletManager.getKeypairFromStoredWallet(wallet);
        if (keypair.publicKey.toString() === wallet.publicKey) {
          console.log(`   ✅ Available wallet ${walletId} works correctly`);
        }
      } catch (error) {
        console.log(`   ❌ Available wallet ${walletId} FAILED: ${error}`);
      }
    }
    
    await walletManager.disconnect();
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run the test
testErrorWallets().catch(console.error);