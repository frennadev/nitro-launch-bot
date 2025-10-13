import { connectDB, disconnectDB } from "./src/jobs/db";
import { WalletModel } from "./src/backend/models";
import {
  safeDecryptWalletBatch,
  safeDecryptPrivateKey,
} from "./src/backend/wallet-decryption";

async function testResilientDecryption() {
  console.log("🔧 Testing resilient wallet decryption system...\n");

  try {
    await connectDB();

    // Get some test wallets
    const testWallets = await WalletModel.find({ isBuyer: true })
      .limit(5)
      .lean();
    console.log(`Found ${testWallets.length} test wallets\n`);

    if (testWallets.length === 0) {
      console.log("No test wallets found. Exiting.");
      return;
    }

    // Test 1: Single wallet decryption with retry
    console.log("--- Test 1: Single Wallet Decryption ---");
    const testWallet = testWallets[0];
    const singleResult = await safeDecryptPrivateKey(
      testWallet.privateKey,
      testWallet._id.toString()
    );

    if (singleResult.success) {
      console.log("✅ Single wallet decryption successful");
      console.log(
        `   Decrypted key length: ${singleResult.privateKey?.length}`
      );
    } else {
      console.log("❌ Single wallet decryption failed:", singleResult.error);
    }

    // Test 2: Batch wallet decryption
    console.log("\n--- Test 2: Batch Wallet Decryption ---");
    const batchResult = await safeDecryptWalletBatch(
      testWallets.map((w) => ({
        _id: w._id.toString(),
        privateKey: w.privateKey,
      })),
      "test wallet"
    );

    console.log(
      `Batch result: ${batchResult.success ? "SUCCESS" : "PARTIAL/FAILURE"}`
    );
    console.log(
      `✅ Successfully decrypted: ${batchResult.privateKeys.length}/${testWallets.length}`
    );
    console.log(`❌ Failed to decrypt: ${batchResult.errors.length}`);

    if (batchResult.errors.length > 0) {
      console.log("Errors:");
      batchResult.errors.forEach((error) => {
        console.log(`   - Wallet ${error.walletId}: ${error.error}`);
      });
    }

    // Test 3: Error handling with invalid data
    console.log("\n--- Test 3: Error Handling ---");
    const invalidResult = await safeDecryptPrivateKey(
      "invalid:data:format",
      "test-invalid-wallet"
    );

    if (!invalidResult.success) {
      console.log("✅ Invalid data properly handled:", invalidResult.error);
    } else {
      console.log("❌ Invalid data should have failed!");
    }

    console.log("\n🎉 Resilient decryption system test completed!");
    console.log(
      "💡 This system will now handle transient errors gracefully during token launches."
    );
  } catch (error) {
    console.error("Test error:", error);
  } finally {
    await disconnectDB();
  }
}

testResilientDecryption().catch(console.error);
