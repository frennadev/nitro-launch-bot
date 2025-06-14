#!/usr/bin/env ts-node

import * as dotenv from "dotenv";
import { Keypair, PublicKey } from "@solana/web3.js";
import { MongoSolanaMixer, type MongoMixerConfig } from "../mixer/MongoSolanaMixer";
import bs58 from "bs58";
import { MongoClient } from "mongodb";
import { env } from "../../config";

// Load environment variables
dotenv.config();

const MONGODB_URI = env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME || "test";
const SOLANA_RPC_ENDPOINT =
  process.env.SOLANA_RPC_ENDPOINT || "https://mainnet.helius-rpc.com/?api-key=417b1887-2994-4d66-a5db-a30a372b7c8e";
const ENCRYPTION_KEY = "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456"; // Fixed key

// Constants for amount distribution
const MIN_AMOUNT_PER_DESTINATION = 0.01; // 0.01 SOL minimum
const MAX_AMOUNT_PER_DESTINATION = 2.0; // 2 SOL maximum

/**
 * Generate random amounts for each destination wallet
 * Ensures each wallet gets between 0.01 and 2 SOL, and total equals the specified amount
 */
function generateRandomAmounts(totalSol: number, destinationCount: number): number[] {
  const totalLamports = Math.floor(totalSol * 1e9);
  const minLamports = Math.floor(MIN_AMOUNT_PER_DESTINATION * 1e9);
  const maxLamports = Math.floor(MAX_AMOUNT_PER_DESTINATION * 1e9);

  // Validate constraints
  const minTotal = minLamports * destinationCount;
  const maxTotal = maxLamports * destinationCount;

  if (totalLamports < minTotal) {
    throw new Error(
      `Total amount too small. Minimum required: ${minTotal / 1e9} SOL for ${destinationCount} destinations`
    );
  }

  if (totalLamports > maxTotal) {
    throw new Error(
      `Total amount too large. Maximum allowed: ${maxTotal / 1e9} SOL for ${destinationCount} destinations`
    );
  }

  // Generate random amounts
  const amounts: number[] = [];
  let remainingLamports = totalLamports;

  // Generate amounts for all but the last destination
  for (let i = 0; i < destinationCount - 1; i++) {
    const remainingDestinations = destinationCount - i;
    const minForRemaining = minLamports * (remainingDestinations - 1);
    const maxForRemaining = maxLamports * (remainingDestinations - 1);

    // Calculate bounds for this destination
    const minForThis = Math.max(minLamports, remainingLamports - maxForRemaining);
    const maxForThis = Math.min(maxLamports, remainingLamports - minForRemaining);

    // Generate random amount within bounds
    const amount = Math.floor(Math.random() * (maxForThis - minForThis + 1)) + minForThis;
    amounts.push(amount);
    remainingLamports -= amount;
  }

  // Last destination gets the remaining amount
  amounts.push(remainingLamports);

  // Shuffle the amounts to randomize distribution
  for (let i = amounts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [amounts[i], amounts[j]] = [amounts[j], amounts[i]];
  }

  return amounts;
}

/**
 * Simple Solana Mixer - Mix SOL through intermediate wallets for privacy
 *
 * Usage: npm run mixer <funding_private_key> <fee_funding_private_key> <total_amount_sol> <destination1> [destination2] [destination3] ...
 */
async function runMixer(
  fundingPrivateKey: string,
  feeFundingPrivateKey: string,
  totalAmountSol: number,
  destinationAddresses: string[]
) {
  console.log("🚀 Starting Solana Mixer");
  console.log(`💰 Total amount to mix: ${totalAmountSol} SOL`);
  console.log(`📍 Mixing to ${destinationAddresses.length} destinations`);

  try {
    // Validate total amount
    if (totalAmountSol <= 0) {
      throw new Error("Total amount must be greater than 0");
    }

    // Load wallets from private keys (base58 encoded)
    const fundingWallet = Keypair.fromSecretKey(bs58.decode(fundingPrivateKey));
    const feeFundingWallet = Keypair.fromSecretKey(bs58.decode(feeFundingPrivateKey));

    // Parse destination wallets
    const destinationWallets = destinationAddresses.map((addr) => new PublicKey(addr));

    console.log(`\n💳 Funding wallet: ${fundingWallet.publicKey.toString()}`);
    console.log(`💳 Fee funding wallet: ${feeFundingWallet.publicKey.toString()}`);
    console.log(`📍 Destination wallets:`);
    destinationWallets.forEach((dest, i) => {
      console.log(`   ${i + 1}. ${dest.toString()}`);
    });

    // Generate random amounts for each destination
    const amounts = generateRandomAmounts(totalAmountSol, destinationWallets.length);

    console.log(`\n🎲 Random amount distribution:`);
    amounts.forEach((amount, i) => {
      console.log(`   ${i + 1}. ${(amount / 1e9).toFixed(6)} SOL`);
    });

    const totalCheck = amounts.reduce((sum, amount) => sum + amount, 0);
    console.log(`   Total: ${(totalCheck / 1e9).toFixed(6)} SOL`);

    // Configure the mixer with simple settings
    const config: MongoMixerConfig = {
      // Basic mixer settings (3-7 seconds total operation time)
      intermediateWalletCount: 5, // 5 intermediate wallets per route for enhanced privacy
      minDelay: 3000, // 3 seconds minimum
      maxDelay: 7000, // 7 seconds maximum
      useFreshWallets: false, // Use MongoDB wallet pool
      rpcEndpoint: SOLANA_RPC_ENDPOINT,
      priorityFee: 1000,

      // Fee funding wallet for enhanced privacy
      feeFundingWallet: feeFundingWallet,

      // MongoDB settings
      mongoUri: MONGODB_URI,
      databaseName: DATABASE_NAME,
      encryptionKey: ENCRYPTION_KEY,

      // Recovery settings
      maxRetries: 3,
      retryDelay: 5000,
    };

    const mixer = new MongoSolanaMixer(config);

    // Initialize the mixer
    console.log("\n🔧 Initializing mixer...");
    await mixer.initialize();

    // Check wallet pool health
    const walletStats = await mixer.getWalletStats();
    console.log(`\n📊 Wallet Pool Status:`);
    console.log(`   Total wallets: ${walletStats.total}`);
    console.log(`   Available: ${walletStats.available}`);

    const walletsNeeded = destinationWallets.length * config.intermediateWalletCount;
    if (walletStats.available < walletsNeeded) {
      throw new Error(`Insufficient wallets in pool. Need: ${walletsNeeded}, Available: ${walletStats.available}`);
    }

    // Check balances
    const connectionManager = (mixer as any).connectionManager;
    const fundingBalance = await connectionManager.getBalance(fundingWallet.publicKey);
    const feeFundingBalance = await connectionManager.getBalance(feeFundingWallet.publicKey);

    console.log(`\n💰 Wallet balances:`);
    console.log(`   Funding wallet: ${(fundingBalance / 1e9).toFixed(6)} SOL`);
    console.log(`   Fee funding wallet: ${(feeFundingBalance / 1e9).toFixed(6)} SOL`);

    // Check if funding wallet has enough SOL
    const totalNeeded = Math.floor(totalAmountSol * 1e9);
    if (fundingBalance < totalNeeded) {
      throw new Error(
        `Insufficient funds. Need: ${(totalNeeded / 1e9).toFixed(6)} SOL, Have: ${(fundingBalance / 1e9).toFixed(6)} SOL`
      );
    }

    // Estimate fees
    const estimatedFeePerTx = 6000; // ~6000 lamports per transaction
    const totalTransactions = destinationWallets.length * (config.intermediateWalletCount + 1);
    const totalFeesNeeded = totalTransactions * estimatedFeePerTx;

    console.log(`\n📊 Fee estimation:`);
    console.log(`   Total transactions: ${totalTransactions}`);
    console.log(`   Estimated fees needed: ${(totalFeesNeeded / 1e9).toFixed(6)} SOL`);

    if (feeFundingBalance < totalFeesNeeded) {
      console.log(`⚠️  Warning: Fee funding wallet may not have enough SOL`);
    }

    console.log(`\n🔀 Starting mixing operation...`);
    console.log(`⏱️  Operation will complete in 3-7 seconds`);

    // Create custom mixing routes with specific amounts
    const routes = await createCustomMixingRoutes(mixer, fundingWallet, destinationWallets, amounts);

    // Execute the mixing with custom routes
    const startTime = Date.now();
    const results = await executeCustomMixing(mixer, routes);
    const endTime = Date.now();

    // Process results
    console.log(`\n📊 Mixing Results (completed in ${((endTime - startTime) / 1000).toFixed(1)}s):`);
    let successCount = 0;
    let totalSignatures = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      console.log(`\n🛤️  Route ${i + 1} to ${result.route.destination.toString()}:`);
      console.log(`   Success: ${result.success ? "✅" : "❌"}`);
      console.log(`   Amount: ${(result.route.amount / 1e9).toFixed(6)} SOL`);

      if (result.success) {
        successCount++;
        totalSignatures += result.transactionSignatures.length;
        console.log(`   Transactions: ${result.transactionSignatures.length}`);
        result.transactionSignatures.forEach((sig: string, idx: number) => {
          console.log(`     ${idx + 1}. ${sig}`);
        });
      } else {
        console.log(`   Error: ${result.error}`);
      }
    }

    // Check final balances
    const finalFundingBalance = await connectionManager.getBalance(fundingWallet.publicKey);
    const finalFeeFundingBalance = await connectionManager.getBalance(feeFundingWallet.publicKey);

    console.log(`\n💰 Final balances:`);
    console.log(`   Funding wallet: ${(finalFundingBalance / 1e9).toFixed(6)} SOL`);
    console.log(`   Fee funding wallet: ${(finalFeeFundingBalance / 1e9).toFixed(6)} SOL`);
    console.log(
      `   Total spent: ${((fundingBalance - finalFundingBalance + feeFundingBalance - finalFeeFundingBalance) / 1e9).toFixed(6)} SOL`
    );

    // Check destination balances
    console.log(`\n📍 Destination wallet balances:`);
    for (let i = 0; i < destinationWallets.length; i++) {
      const destBalance = await connectionManager.getBalance(destinationWallets[i]);
      console.log(`   ${i + 1}. ${destinationWallets[i].toString()}: ${(destBalance / 1e9).toFixed(6)} SOL`);
    }

    // Summary
    console.log(`\n🎉 Mixing Summary:`);
    console.log(`   Successful routes: ${successCount}/${results.length}`);
    console.log(`   Total transactions: ${totalSignatures}`);
    console.log(`   Duration: ${((endTime - startTime) / 1000).toFixed(1)}s`);
    console.log(`   Success rate: ${Math.round((successCount / results.length) * 100)}%`);

    await mixer.cleanup();

    return {
      success: successCount === results.length,
      successCount,
      totalRoutes: results.length,
      totalTransactions: totalSignatures,
      duration: (endTime - startTime) / 1000,
      results,
    };
  } catch (error) {
    console.error("❌ Mixing failed:", error);
    throw error;
  }
}

/**
 * Create custom mixing routes with specific amounts for each destination
 */
async function createCustomMixingRoutes(
  mixer: any,
  fundingWallet: Keypair,
  destinationWallets: PublicKey[],
  amounts: number[]
) {
  const routes = [];

  for (let i = 0; i < destinationWallets.length; i++) {
    const destination = destinationWallets[i];
    const amount = amounts[i];

    // Get intermediate wallets from MongoDB
    const walletManager = mixer.getWalletManager();
    const intermediateWallets = await walletManager.reserveWalletsForMixing(5); // 5 per route

    if (intermediateWallets.length < 5) {
      throw new Error(`Insufficient intermediate wallets for route ${i + 1}`);
    }

    const route = {
      source: {
        keypair: fundingWallet,
        publicKey: fundingWallet.publicKey,
      },
      intermediates: intermediateWallets.slice(0, 5).map((wallet: any) => ({
        keypair: walletManager.getKeypairFromStoredWallet(wallet),
        publicKey: new PublicKey(wallet.publicKey),
        balance: wallet.balance,
      })),
      destination,
      amount,
    };

    routes.push(route);
  }

  return routes;
}

/**
 * Execute custom mixing with pre-defined routes and amounts
 */
async function executeCustomMixing(mixer: any, routes: any[]) {
  // Use the mixer's internal execution method
  const results = [];

  for (const route of routes) {
    try {
      const result = await mixer.executeSingleRouteWithTiming(route, 1000, 0, routes.length - 1, 0);
      results.push(result);
    } catch (error) {
      results.push({
        success: false,
        transactionSignatures: [],
        error: error instanceof Error ? error.message : "Unknown error",
        route,
        usedWalletIds: route.intermediates.map((w: any) => w.publicKey.toString()),
      });
    }
  }

  return results;
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.log("🔀 Solana Mixer - Privacy-focused SOL mixing");
    console.log("");
    console.log("Usage:");
    console.log(
      "  npm run mixer <funding_private_key> <fee_funding_private_key> <total_amount_sol> <destination1> [destination2] [destination3] ..."
    );
    console.log("");
    console.log("Arguments:");
    console.log("  funding_private_key      - Base58 private key of wallet containing SOL to mix");
    console.log("  fee_funding_private_key  - Base58 private key of wallet that pays transaction fees");
    console.log("  total_amount_sol         - Total amount of SOL to mix (e.g., 1.5)");
    console.log("  destination1, 2, 3...    - Public keys of wallets to receive mixed SOL");
    console.log("");
    console.log("Amount Distribution:");
    console.log("  • Each destination receives 0.01 to 2.0 SOL randomly");
    console.log("  • Total amount is split randomly among all destinations");
    console.log("  • Minimum total: 0.01 × number_of_destinations SOL");
    console.log("  • Maximum total: 2.0 × number_of_destinations SOL");
    console.log("");
    console.log("Example:");
    console.log(
      "  npm run mixer 3HRTe8nq4vbjymnW3gbtJL8adGUdY4zGBzRwU4cgMaWt4KtW5hrfxN1fBwDUmfVcVGyHmHbqHSk32eAjKspkYury 2gUjTFFBhpNrAe4dwgoHnJswY3rqFK3wdPZu6FggsR7h64Gy4BpbUhvXJaDiMX6LYnaKd7vsK9qULQJ4D2nfcdQ6 1.5 ATG7618Psn4XtJHEnuo93Q2SFmzudUdrfGxwQzKXduxP 6s2kbSCvGQmgJ8GM12YanpDv4F6oyQVe37qfqvUZhSTK"
    );
    console.log("");
    console.log("Features:");
    console.log("  • Mixes SOL through intermediate wallets for privacy");
    console.log("  • Uses separate wallet for transaction fees");
    console.log("  • Completes mixing in 3-7 seconds regardless of size");
    console.log("  • Randomly distributes amounts between 0.01-2 SOL per destination");
    console.log("  • Stores intermediate wallets in MongoDB for reuse");
    process.exit(1);
  }

  const [fundingKey, feeKey, totalAmountStr, ...destinations] = args;
  const totalAmount = parseFloat(totalAmountStr);

  if (isNaN(totalAmount) || totalAmount <= 0) {
    console.error("❌ Invalid total amount. Must be a positive number.");
    process.exit(1);
  }

  runMixer(fundingKey, feeKey, totalAmount, destinations)
    .then((result) => {
      console.log(`\n✅ Mixing completed: ${result.successCount}/${result.totalRoutes} routes successful`);
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error("❌ Mixing failed:", error.message);
      process.exit(1);
    });
}

export { runMixer };
