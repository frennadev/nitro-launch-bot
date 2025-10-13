import { connectDB, disconnectDB } from "./src/jobs/db";
import { WalletModel } from "./src/backend/models";
import { decryptPrivateKey } from "./src/backend/utils";

async function diagnoseBuyerWallets() {
  console.log("🔍 Diagnosing buyer wallet data integrity...\n");

  try {
    await connectDB();

    // Find all buyer wallets
    const buyerWallets = await WalletModel.find({ isBuyer: true }).lean();
    console.log(`Found ${buyerWallets.length} buyer wallets\n`);

    let validWallets = 0;
    let invalidWallets = 0;

    for (const wallet of buyerWallets) {
      console.log(`\n--- Wallet ${wallet._id} ---`);
      console.log(`User: ${wallet.user}`);
      console.log(`Public Key: ${wallet.publicKey}`);
      console.log(
        `Private Key (encrypted): ${wallet.privateKey ? `"${wallet.privateKey.substring(0, 20)}..."` : "NULL/UNDEFINED"}`
      );

      if (!wallet.privateKey) {
        console.log("❌ ERROR: Private key is null/undefined");
        invalidWallets++;
        continue;
      }

      try {
        // Test decryption
        const decrypted = decryptPrivateKey(wallet.privateKey);
        console.log(`✅ Decryption successful (length: ${decrypted.length})`);
        validWallets++;
      } catch (error) {
        console.log(
          `❌ Decryption failed: ${error instanceof Error ? error.message : String(error)}`
        );
        invalidWallets++;

        // Additional debugging
        console.log(`   - Type: ${typeof wallet.privateKey}`);
        console.log(`   - Length: ${wallet.privateKey.length}`);
        console.log(`   - Contains colon: ${wallet.privateKey.includes(":")}`);
        console.log(
          `   - Parts after split: ${wallet.privateKey.split(":").length}`
        );
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`✅ Valid wallets: ${validWallets}`);
    console.log(`❌ Invalid wallets: ${invalidWallets}`);
    console.log(
      `📈 Success rate: ${((validWallets / buyerWallets.length) * 100).toFixed(1)}%`
    );

    if (invalidWallets > 0) {
      console.log(
        "\n⚠️  Action needed: Some wallets have corrupted private key data"
      );
      console.log("   Consider running wallet repair/re-encryption process");
    }
  } catch (error) {
    console.error("Error during diagnosis:", error);
  } finally {
    await disconnectDB();
  }
}

diagnoseBuyerWallets().catch(console.error);
