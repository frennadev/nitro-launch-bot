#!/usr/bin/env node

const { MongoClient } = require("mongodb");

async function findWalletInfo() {
  const client = new MongoClient(
    process.env.MONGODB_URI || "mongodb://localhost:27017/nitro-launch-bot"
  );

  try {
    await client.connect();
    const db = client.db();

    console.log("🔍 Looking for wallet and user information...");

    // Find the wallet by public key
    const wallet = await db.collection("wallets").findOne({
      publicKey: "7d5TJ9MBaciEE1UUL3dpN2gGViVPP8JdnYVLCMBRg9br",
    });

    if (wallet) {
      console.log(`✅ Found wallet document:`);
      console.log(`   - ID: ${wallet._id}`);
      console.log(`   - Public Key: ${wallet.publicKey}`);
      console.log(`   - Owner: ${wallet.userId}`);
      console.log(`   - Warming Status: ${wallet.warming?.isWarming || false}`);
      console.log(`   - Current Stage: ${wallet.warming?.stage || 0}`);
    } else {
      console.log("❌ Wallet not found");
      return;
    }

    // Find the user
    const user = await db.collection("users").findOne({
      _id: require("mongodb").ObjectId.createFromHexString(
        "68492054bc12916bc8cedcb3"
      ),
    });

    if (user) {
      console.log(`✅ Found user:`);
      console.log(`   - ID: ${user._id}`);
      console.log(`   - Username: ${user.userName}`);
      console.log(`   - Funding Wallet: ${user.fundingWallet}`);

      // Get funding wallet details
      if (user.fundingWallet) {
        const fundingWallet = await db.collection("wallets").findOne({
          _id: user.fundingWallet,
        });
        if (fundingWallet) {
          console.log(
            `   - Funding Wallet Public Key: ${fundingWallet.publicKey}`
          );
        }
      }
    } else {
      console.log("❌ User not found");
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.close();
  }
}

findWalletInfo();
