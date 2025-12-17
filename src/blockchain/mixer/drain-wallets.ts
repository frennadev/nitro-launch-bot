import { MongoWalletManager } from "./mongodb";
import { SolanaConnectionManager } from "./connection";
import { PublicKey, Keypair } from "@solana/web3.js";
import { env } from "../../config";
import bs58 from "bs58";

/**
 * Drain all mixer wallets to a specified destination address
 */
export async function drainAllMixerWallets(destinationAddress: string) {
  console.log("🚀 Starting mixer wallet drain operation");
  console.log(`📍 Draining to: ${destinationAddress}`);

  const destinationPubkey = new PublicKey(destinationAddress);

  // Initialize wallet manager
  const walletManager = new MongoWalletManager(
    env.MONGODB_URI,
    env.MONGODB_DATABASE,
    env.ENCRYPTION_SECRET
  );

  // Initialize connection manager with backup RPC
  const connectionManager = new SolanaConnectionManager(
    env.HELIUS_MIXER_RPC_URL,
    2000 // Priority fee
  );

  // Initialize fee funding wallet
  if (!env.MIXER_FEE_FUNDING_WALLET_PRIVATE_KEY) {
    throw new Error(
      "MIXER_FEE_FUNDING_WALLET_PRIVATE_KEY environment variable is required"
    );
  }
  const feeFundingWallet = Keypair.fromSecretKey(
    bs58.decode(env.MIXER_FEE_FUNDING_WALLET_PRIVATE_KEY)
  );
  console.log(
    `💳 Fee funding wallet: ${feeFundingWallet.publicKey.toString()}`
  );

  try {
    await walletManager.connect();

    // Get all wallets from the database
    const allWallets = await walletManager.getCollection().find({}).toArray();
    console.log(`📊 Found ${allWallets.length} total wallets in database`);

    const results = {
      totalWallets: allWallets.length,
      walletsWithBalance: 0,
      successfulDrains: 0,
      failedDrains: 0,
      totalDrained: 0,
      errors: [] as string[],
    };

    console.log("\n🔍 Checking wallet balances and draining funds...");

    for (let i = 0; i < allWallets.length; i++) {
      const storedWallet = allWallets[i];

      try {
        // Validate wallet can be decrypted
        if (!walletManager.validateWalletDecryption(storedWallet)) {
          console.log(
            `⚠️ Skipping corrupted wallet ${i + 1}/${allWallets.length}: ${storedWallet.publicKey.slice(0, 8)}...`
          );
          continue;
        }

        const keypair = walletManager.getKeypairFromStoredWallet(storedWallet);
        const balance = await connectionManager.getBalance(keypair.publicKey);

        console.log(
          `\n${i + 1}/${allWallets.length}: ${keypair.publicKey.toString().slice(0, 8)}...`
        );
        console.log(`   Balance: ${(balance / 1e9).toFixed(6)} SOL`);

        if (balance > 0) {
          results.walletsWithBalance++;

          // Calculate transferable amount (account for fees and rent exemption)
          const maxTransferable =
            await connectionManager.getMaxTransferableAmount(keypair.publicKey);

          if (maxTransferable > 0) {
            console.log(
              `   Transferable: ${(maxTransferable / 1e9).toFixed(6)} SOL`
            );

            try {
              // Use fee funding wallet for transaction fees
              const transaction =
                await connectionManager.createTransferTransactionWithFeePayer(
                  keypair.publicKey,
                  destinationPubkey,
                  maxTransferable,
                  feeFundingWallet.publicKey
                );

              const signature = await connectionManager.sendTransaction(
                transaction,
                [keypair, feeFundingWallet]
              );

              // Wait for confirmation with faster timeout and fewer retries
              const confirmationSuccess =
                await connectionManager.waitForConfirmation(signature, 2); // Only 2 retries
              if (confirmationSuccess) {
                console.log(
                  `   ✅ Drained successfully: ${signature.slice(0, 8)}...`
                );
                results.successfulDrains++;
                results.totalDrained += maxTransferable;

                // Update wallet balance in database
                await walletManager.updateWalletBalance(
                  storedWallet.publicKey,
                  0
                );
                await walletManager.recordTransaction(storedWallet.publicKey, {
                  signature,
                  type: "send",
                  amount: maxTransferable,
                  toAddress: destinationAddress,
                });
              } else {
                console.log(`   ❌ Drain failed: Transaction not confirmed`);
                results.failedDrains++;
                results.errors.push(
                  `Drain failed for ${storedWallet.publicKey}: Transaction not confirmed`
                );
              }
            } catch (drainError: any) {
              console.log(`   ❌ Drain failed: ${drainError.message}`);
              results.failedDrains++;
              results.errors.push(
                `Drain failed for ${storedWallet.publicKey}: ${drainError.message}`
              );
            }
          } else {
            console.log(
              `   ⚠️ No transferable balance (insufficient for fees + rent)`
            );
          }
        } else {
          console.log(`   💤 No balance to drain`);
        }

        // Small delay between operations
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error: any) {
        console.log(`   ❌ Error processing wallet: ${error.message}`);
        results.errors.push(
          `Error processing ${storedWallet.publicKey}: ${error.message}`
        );
      }
    }

    // Final summary
    console.log("\n📊 Drain Operation Summary:");
    console.log(`   Total wallets processed: ${results.totalWallets}`);
    console.log(`   Wallets with balance: ${results.walletsWithBalance}`);
    console.log(`   Successful drains: ${results.successfulDrains}`);
    console.log(`   Failed drains: ${results.failedDrains}`);
    console.log(
      `   Total drained: ${(results.totalDrained / 1e9).toFixed(6)} SOL`
    );

    if (results.errors.length > 0) {
      console.log(`\n❌ Errors encountered:`);
      results.errors
        .slice(0, 10)
        .forEach((error) => console.log(`   - ${error}`));
      if (results.errors.length > 10) {
        console.log(`   ... and ${results.errors.length - 10} more errors`);
      }
    }

    return results;
  } catch (error) {
    console.error("❌ Drain operation failed:", error);
    throw error;
  } finally {
    await walletManager.disconnect();
  }
}

/**
 * CLI usage for draining wallets
 */
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log("🚀 Mixer Wallet Drain Tool");
    console.log("");
    console.log("Usage:");
    console.log("  npm run drain-wallets <destination_address>");
    console.log("");
    console.log("Arguments:");
    console.log(
      "  destination_address        - Public key of wallet to receive all funds"
    );
    console.log("");
    console.log("Example:");
    console.log(
      "  npm run drain-wallets 9tzgLYkKNdVoe5iXmFoKC86SGgKatwtKeaURhRUnxppF"
    );
    console.log("");
    process.exit(1);
  }

  const [destinationAddress] = args;

  drainAllMixerWallets(destinationAddress)
    .then((results) => {
      console.log("\n✅ Drain operation completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Drain operation failed:", error);
      process.exit(1);
    });
}
