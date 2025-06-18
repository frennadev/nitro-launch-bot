#!/usr/bin/env ts-node

import * as dotenv from "dotenv";
import { Keypair, PublicKey } from "@solana/web3.js";
import { MongoSolanaMixer, type MongoMixerConfig } from "../mixer/MongoSolanaMixer";
import bs58 from "bs58";
import { MongoClient } from "mongodb";
import { env } from "../../config";
import { updateMixerProgress, updateMixerStatus } from "../../bot/loading";

// Load environment variables
dotenv.config();

const MONGODB_URI = env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME || "test";
const SOLANA_RPC_ENDPOINT = env.HELIUS_MIXER_RPC_URL;
const ENCRYPTION_KEY = env.ENCRYPTION_SECRET;

// Constants for amount distribution
const MIN_AMOUNT_PER_DESTINATION = 0.01; // 0.01 SOL minimum
const MAX_AMOUNT_PER_DESTINATION = 2.0; // 2 SOL maximum

/**
 * Generate incremental amounts for each destination wallet
 * Uses fixed sequence: 0.5, 0.7, 0.9, 1.0, 1.1, 1.2 SOL for first 6 wallets
 * Then random amounts between 1.5-2.1 SOL for additional wallets
 */
function generateRandomAmounts(totalSol: number, destinationCount: number): number[] {
  const totalLamports = Math.floor(totalSol * 1e9);
  
  // Fixed sequence for first 6 wallets (in SOL)
  const fixedSequence = [0.5, 0.7, 0.9, 1.0, 1.1, 1.2];
  const fixedSequenceLamports = fixedSequence.map(sol => Math.floor(sol * 1e9));
  const fixedSequenceTotal = fixedSequenceLamports.reduce((sum, amount) => sum + amount, 0);
  
  const amounts: number[] = [];
  
  if (totalLamports <= fixedSequenceTotal) {
    // Use only the sequence wallets needed for amounts ≤ 5.4 SOL
    let remainingLamports = totalLamports;
    let walletIndex = 0;
    
    while (remainingLamports > 0 && walletIndex < fixedSequence.length && walletIndex < destinationCount) {
      const sequenceAmount = fixedSequenceLamports[walletIndex];
      if (remainingLamports >= sequenceAmount) {
        amounts.push(sequenceAmount);
        remainingLamports -= sequenceAmount;
      } else {
        // Last wallet gets remaining amount
        amounts.push(remainingLamports);
        remainingLamports = 0;
      }
      walletIndex++;
    }
  } else {
    // Use all 6 sequence wallets + additional wallets with random amounts
    // Add all fixed sequence amounts
    amounts.push(...fixedSequenceLamports);
    
    let remainingLamports = totalLamports - fixedSequenceTotal;
    const additionalWallets = destinationCount - 6;
    
    if (additionalWallets > 0) {
      const minAdditionalLamports = Math.floor(1.5 * 1e9); // 1.5 SOL
      const maxAdditionalLamports = Math.floor(2.1 * 1e9); // 2.1 SOL
      
      // Generate random amounts for additional wallets (except the last one)
      for (let i = 0; i < additionalWallets - 1; i++) {
        const maxForThis = Math.min(maxAdditionalLamports, remainingLamports - minAdditionalLamports);
        const minForThis = Math.min(minAdditionalLamports, maxForThis);
        
        if (minForThis <= maxForThis) {
          const amount = Math.floor(Math.random() * (maxForThis - minForThis + 1)) + minForThis;
          amounts.push(amount);
          remainingLamports -= amount;
        } else {
          // If we can't fit minimum, give remaining to this wallet
          amounts.push(remainingLamports);
          remainingLamports = 0;
          break;
        }
      }
      
      // Last additional wallet gets remaining amount
      if (remainingLamports > 0) {
        amounts.push(remainingLamports);
      }
    }
  }
  
  // Validate total matches (within rounding tolerance)
  const actualTotal = amounts.reduce((sum, amount) => sum + amount, 0);
  if (Math.abs(actualTotal - totalLamports) > destinationCount) { // Allow small rounding differences
    console.warn(`Amount distribution mismatch: expected ${totalLamports}, got ${actualTotal}`);
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

    // Configure the mixer with optimized settings for speed
    const config: MongoMixerConfig = {
      // Optimized mixer settings (500ms-2s total operation time)
      intermediateWalletCount: 5, // Use 5 intermediate wallets for strong privacy
      minDelay: 500, // Reduce from 3000ms to 500ms
      maxDelay: 2000, // Reduce from 7000ms to 2000ms
      useFreshWallets: false, // Use MongoDB wallet pool
      rpcEndpoint: SOLANA_RPC_ENDPOINT,
      priorityFee: 2000, // Increase from 1000 for faster processing

      // Fee funding wallet for enhanced privacy
      feeFundingWallet: feeFundingWallet,

      // MongoDB settings
      mongoUri: MONGODB_URI,
      databaseName: DATABASE_NAME,
      encryptionKey: ENCRYPTION_KEY,

      // Optimized recovery settings
      maxRetries: 2, // Reduce from 3 for speed
      retryDelay: 2000, // Reduce from 5000ms
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
    const intermediateWallets = await walletManager.reserveWalletsForMixing(5); // 5 per route for strong privacy

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
      "  npm run mixer <your_funding_private_key> <your_fee_funding_private_key> 1.5 <destination_wallet_1> <destination_wallet_2>"
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
