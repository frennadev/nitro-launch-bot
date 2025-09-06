#!/usr/bin/env bun

import { config } from "dotenv";
import { MongoWalletManager } from "./src/blockchain/mixer/mongodb";

// Load environment variables
config();

async function testWalletEncryption() {
  console.log("🔍 Testing Intermediate Wallet Encryption...\n");
  
  // Check if we have the required environment variables
  const mongoUri = process.env.MONGODB_URI;
  const encryptionKey = process.env.ENCRYPTION_SECRET;
  const databaseName = process.env.DATABASE_NAME || "nitro-launch-bot";
  
  console.log("📋 Environment Check:");
  console.log(`   MONGODB_URI: ${mongoUri ? "✅ Set" : "❌ Missing"}`);
  console.log(`   ENCRYPTION_SECRET: ${encryptionKey ? `✅ Set (${encryptionKey.length} chars)` : "❌ Missing"}`);
  console.log(`   DATABASE_NAME: ${databaseName}`);
  
  if (!mongoUri || !encryptionKey) {
    console.error("\n❌ Missing required environment variables!");
    console.error("Please ensure MONGODB_URI and ENCRYPTION_SECRET are set in your .env file");
    process.exit(1);
  }
  
  try {
    // Initialize the wallet manager
    console.log("\n🔧 Initializing MongoWalletManager...");
    const walletManager = new MongoWalletManager(mongoUri, databaseName, encryptionKey);
    
    // Connect to MongoDB
    console.log("🔗 Connecting to MongoDB...");
    await walletManager.connect();
    console.log("✅ Connected to MongoDB successfully");
    
    // Get wallet statistics
    console.log("\n📊 Getting wallet statistics...");
    const stats = await walletManager.getWalletStats();
    console.log(`   Total wallets: ${stats.total}`);
    console.log(`   Available wallets: ${stats.available}`);
    console.log(`   Reserved wallets: ${stats.reserved}`);
    console.log(`   Error wallets: ${stats.error || 0}`);
    
    if (stats.total === 0) {
      console.log("\n⚠️  No wallets found in database. The mixer wallet pool might be empty.");
      return;
    }
    
    // Test getting available wallets
    console.log("\n🔍 Testing wallet decryption (first 10 wallets)...");
    const testCount = Math.min(10, stats.available);
    
    if (testCount === 0) {
      console.log("❌ No available wallets to test");
      return;
    }
    
    const availableWallets = await walletManager.getAvailableWallets(testCount);
    console.log(`📦 Retrieved ${availableWallets.length} wallets for testing`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < availableWallets.length; i++) {
      const wallet = availableWallets[i];
      const walletId = wallet.publicKey.slice(0, 8) + "...";
      
      try {
        console.log(`\n🔐 Testing wallet ${i + 1}/${availableWallets.length}: ${walletId}`);
        
        // Test decryption
        const keypair = walletManager.getKeypairFromStoredWallet(wallet);
        
        // Verify the decrypted keypair matches the public key
        if (keypair.publicKey.toString() === wallet.publicKey) {
          console.log(`   ✅ Decryption successful`);
          console.log(`   📊 Balance: ${(wallet.balance / 1e9).toFixed(6)} SOL`);
          console.log(`   🔑 Public key matches: ${keypair.publicKey.toString().slice(0, 8)}...`);
          successCount++;
        } else {
          console.log(`   ❌ Decryption failed: Public key mismatch`);
          console.log(`   Expected: ${wallet.publicKey.slice(0, 8)}...`);
          console.log(`   Got: ${keypair.publicKey.toString().slice(0, 8)}...`);
          failCount++;
        }
        
      } catch (error) {
        console.log(`   ❌ Decryption error: ${error instanceof Error ? error.message : String(error)}`);
        failCount++;
      }
    }
    
    // Summary
    console.log("\n📊 Test Results Summary:");
    console.log(`   ✅ Successful decryptions: ${successCount}`);
    console.log(`   ❌ Failed decryptions: ${failCount}`);
    console.log(`   📈 Success rate: ${((successCount / (successCount + failCount)) * 100).toFixed(1)}%`);
    
    if (failCount > 0) {
      console.log("\n⚠️  Some wallets failed decryption. Possible causes:");
      console.log("   1. Wrong ENCRYPTION_SECRET (different from when wallets were created)");
      console.log("   2. Corrupted wallet data in database");
      console.log("   3. Database connection issues");
      console.log("   4. Encryption algorithm mismatch");
    } else {
      console.log("\n🎉 All wallets decrypted successfully! Encryption system is working properly.");
    }
    
    // Test creating a new wallet to verify encryption works
    console.log("\n🔧 Testing wallet creation and encryption...");
    try {
      const newWallets = await walletManager.generateWallets(1);
      if (newWallets.length > 0) {
        const newWallet = newWallets[0];
        console.log(`✅ Created new wallet: ${newWallet.publicKey.slice(0, 8)}...`);
        
        // Test decryption of the newly created wallet
        const decryptedKeypair = walletManager.getKeypairFromStoredWallet(newWallet);
        if (decryptedKeypair.publicKey.toString() === newWallet.publicKey) {
          console.log(`✅ New wallet decryption successful`);
        } else {
          console.log(`❌ New wallet decryption failed`);
        }
      }
    } catch (createError) {
      console.log(`❌ Failed to create test wallet: ${createError instanceof Error ? createError.message : String(createError)}`);
    }
    
    // Close connection
    await walletManager.disconnect();
    console.log("\n✅ Test completed successfully");
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Stack trace:", error);
    process.exit(1);
  }
}

// Run the test
testWalletEncryption().catch(console.error);