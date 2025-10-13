import { connectDB, disconnectDB } from "./src/jobs/db";
import { WalletModel, UserModel } from "./src/backend/models";
import { decryptPrivateKey } from "./src/backend/utils";

async function simulateTokenLaunchScenario() {
  console.log("🔍 Simulating token launch scenario...\n");

  try {
    await connectDB();

    // Find users with both buyer wallets and dev wallets
    const users = await UserModel.find().lean();
    console.log(`Found ${users.length} users\n`);

    let testCount = 0;
    let errorCount = 0;

    for (const user of users.slice(0, 5)) {
      // Test first 5 users
      console.log(`--- Testing User ${user._id} ---`);

      try {
        // Get buyer wallets
        const buyerWallets = await WalletModel.find({
          user: user._id,
          isBuyer: true,
        }).lean();

        // Get dev wallet
        const devWallet = await WalletModel.findOne({
          user: user._id,
          isDev: true,
        }).lean();

        // Get funding wallet
        const fundingWallet = await WalletModel.findOne({
          user: user._id,
          isFunding: true,
        }).lean();

        console.log(`  Buyer wallets: ${buyerWallets.length}`);
        console.log(`  Dev wallet: ${devWallet ? "Found" : "Missing"}`);
        console.log(`  Funding wallet: ${fundingWallet ? "Found" : "Missing"}`);

        if (buyerWallets.length === 0) {
          console.log("  ⚠️  No buyer wallets - skipping\n");
          continue;
        }

        testCount++;

        // Test decrypting all buyer wallets (simulate the exact scenario from worker)
        console.log("  Testing buyer wallet decryption...");
        const buyerKeys: string[] = [];
        for (const wallet of buyerWallets) {
          try {
            if (!wallet.privateKey) {
              throw new Error(`Wallet ${wallet._id} has no privateKey field`);
            }
            const decryptedKey = decryptPrivateKey(wallet.privateKey);
            buyerKeys.push(decryptedKey);
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            console.log(
              `  ❌ Failed to decrypt buyer wallet ${wallet._id}: ${errorMsg}`
            );
            errorCount++;
            break;
          }
        }

        if (buyerKeys.length === buyerWallets.length) {
          console.log(
            `  ✅ All ${buyerWallets.length} buyer wallets decrypted successfully`
          );
        }

        // Test dev wallet decryption
        if (devWallet) {
          try {
            if (!devWallet.privateKey) {
              throw new Error("Dev wallet has no privateKey field");
            }
            decryptPrivateKey(devWallet.privateKey);
            console.log("  ✅ Dev wallet decrypted successfully");
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            console.log(`  ❌ Failed to decrypt dev wallet: ${errorMsg}`);
            errorCount++;
          }
        }

        // Test funding wallet decryption
        if (fundingWallet) {
          try {
            if (!fundingWallet.privateKey) {
              throw new Error("Funding wallet has no privateKey field");
            }
            decryptPrivateKey(fundingWallet.privateKey);
            console.log("  ✅ Funding wallet decrypted successfully");
          } catch (error) {
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            console.log(`  ❌ Failed to decrypt funding wallet: ${errorMsg}`);
            errorCount++;
          }
        }

        console.log();
      } catch (error) {
        console.log(
          `  ❌ Error during user ${user._id} test: ${error instanceof Error ? error.message : String(error)}\n`
        );
        errorCount++;
      }
    }

    console.log(`📊 Simulation Results:`);
    console.log(`✅ Users tested: ${testCount}`);
    console.log(`❌ Errors encountered: ${errorCount}`);
    console.log(
      `📈 Success rate: ${testCount > 0 ? (((testCount - errorCount) / testCount) * 100).toFixed(1) : 0}%`
    );

    if (errorCount === 0) {
      console.log(
        "\n🎉 All tests passed! The encryption system is working correctly."
      );
      console.log("💡 The original error might be due to:");
      console.log("   - Race conditions during high load");
      console.log("   - Database connection issues");
      console.log("   - Temporary memory/resource constraints");
    }
  } catch (error) {
    console.error("Error during simulation:", error);
  } finally {
    await disconnectDB();
  }
}

simulateTokenLaunchScenario().catch(console.error);
