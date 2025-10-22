#!/usr/bin/env ts-node

import * as dotenv from "dotenv";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  MongoSolanaMixer,
  type MongoMixerConfig,
} from "../mixer/MongoSolanaMixer";
import bs58 from "bs58";
import { MongoClient } from "mongodb";
import { env } from "../../config";
import { updateMixerProgress, updateMixerStatus } from "../../bot/loading";

// Load environment variables
dotenv.config();

const MONGODB_URI = env.MONGODB_URI;
const DATABASE_NAME = process.env.DATABASE_NAME;
const ENCRYPTION_KEY = env.ENCRYPTION_SECRET; // ✅ FIXED: Use ENCRYPTION_SECRET from env config
const SOLANA_RPC_ENDPOINT = env.HELIUS_MIXER_RPC_URL;

// Minimum amount per destination (0.01 SOL)
const MIN_AMOUNT_PER_DESTINATION = 0.01;

/**
 * Generate amounts using 73-wallet distribution system
 * Replaces legacy equal distribution with sophisticated tiered system
 */
async function generateRandomAmounts(
  totalSol: number,
  destinationCount: number
): Promise<number[]> {
  try {
    // Use the main 73-wallet distribution system
    const { generateBuyDistribution } = await import("../../backend/functions");
    const distributionSOL = generateBuyDistribution(totalSol, destinationCount);
    const amounts = distributionSOL.map(amount => Math.floor(amount * 1e9)); // Convert to lamports
    
    console.log(`✅ Generated ${amounts.length} amounts using 73-wallet distribution system`);
    console.log(`   Active wallets: ${amounts.filter(a => a > 0).length}/${amounts.length}`);
    console.log(`   Amount range: ${(Math.min(...amounts.filter(a => a > 0)) / 1e9).toFixed(6)} - ${(Math.max(...amounts) / 1e9).toFixed(6)} SOL`);
    
    return amounts;
  } catch (error) {
    console.warn(`⚠️ Failed to use 73-wallet distribution, falling back to simple distribution:`, error);
    
    // Fallback to simple distribution (but still better than equal)
    const amounts: number[] = [];
    const totalLamports = Math.floor(totalSol * 1e9);
    const baseAmount = Math.floor(totalLamports / destinationCount);
    let remainder = totalLamports - (baseAmount * destinationCount);

    for (let i = 0; i < destinationCount; i++) {
      let amount = baseAmount;
      
      // Distribute remainder more evenly across wallets instead of front-loading
      if (remainder > 0) {
        const remainingWallets = destinationCount - i;
        const amountToAdd = Math.floor(remainder / remainingWallets);
        amount += amountToAdd;
        remainder -= amountToAdd;
      }

      // Add small random variation (±3% instead of ±5% for more stability)
      const variation = Math.floor(amount * 0.03 * (Math.random() - 0.5));
      amount = Math.max(Math.floor(MIN_AMOUNT_PER_DESTINATION * 1e9), amount + variation);
      amounts.push(amount);
    }

    console.log(`✅ Generated ${amounts.length} amounts using improved fallback distribution`);
    return amounts;
  }
}

/**
 * Simple Solana Mixer - Mix SOL through intermediate wallets for privacy
 *
 * Usage: npm run mixer <funding_private_key> <fee_funding_private_key> <total_amount_sol> <destination1> [destination2] [destination3] ...
 */
export async function runMixer(
  fundingPrivateKey: string,
  feeFundingPrivateKey: string,
  totalAmountSol: number,
  destinationAddresses: string[],
  options?: {
    parallelMode?: boolean;
    maxConcurrentTx?: number;
    balanceCheckTimeout?: number;
    fastMode?: boolean;
    customAmounts?: number[]; // ✅ NEW: Allow custom distribution amounts
  }
) {
  console.log("🚀 Starting Solana Mixer");
  console.log(`💰 Total amount to mix: ${totalAmountSol} SOL`);
  console.log(`📍 Mixing to ${destinationAddresses.length} destinations`);
  
  // Display mixer mode
  if (options?.parallelMode) {
    console.log(`⚡ Mode: PARALLEL (High-Speed) - ${options.maxConcurrentTx || 3} concurrent transactions`);
    console.log(`🎯 Balance check timeout: ${options.balanceCheckTimeout || 5000}ms`);
  } else {
    console.log(`🔄 Mode: SEQUENTIAL (Traditional) - Safer confirmation-based processing`);
  }

  try {
    // Validate total amount
    if (totalAmountSol <= 0) {
      throw new Error("Total amount must be greater than 0");
    }

    // Validate destinations
    if (destinationAddresses.length === 0) {
      throw new Error("At least one destination address is required");
    }

    // Convert string addresses to PublicKey objects
    const destinationWallets = destinationAddresses.map((addr) => {
      try {
        return new PublicKey(addr);
      } catch (error) {
        throw new Error(`Invalid destination address: ${addr}`);
      }
    });

    // Create funding wallet from private key
    const fundingWallet = Keypair.fromSecretKey(bs58.decode(fundingPrivateKey));
    const feeFundingWallet = Keypair.fromSecretKey(bs58.decode(feeFundingPrivateKey));

    console.log(`\n💼 Funding wallet: ${fundingWallet.publicKey.toString()}`);
    console.log(`💳 Fee funding wallet: ${feeFundingWallet.publicKey.toString()}`);

    // Use custom amounts if provided, otherwise generate 73-wallet distribution
    let amounts: number[];
    if (options?.customAmounts && options.customAmounts.length === destinationWallets.length) {
      console.log(`🎯 Using custom 73-wallet distribution amounts`);
      amounts = options.customAmounts.map(amount => Math.floor(amount * 1e9)); // Convert SOL to lamports
    } else {
      console.log(`🎲 Generating 73-wallet distribution for optimal mixing`);
      amounts = await generateRandomAmounts(totalAmountSol, destinationWallets.length);
    }

    // Verify total matches
    const totalCheck = amounts.reduce((sum, amount) => sum + amount, 0);
    console.log(`\n📊 Amount distribution:`);
    amounts.forEach((amount, i) => {
      console.log(`   ${i + 1}. ${destinationWallets[i].toString().slice(0, 8)}...: ${(amount / 1e9).toFixed(6)} SOL`);
    });

    console.log(`   Total: ${(totalCheck / 1e9).toFixed(6)} SOL`);

    // Configure the mixer with optimized settings for speed
    const config: MongoMixerConfig = {
      // Optimized mixer settings (500ms-2s total operation time)
      intermediateWalletCount: 8, // Use 8 intermediate wallets for strong privacy
      minDelay: options?.parallelMode ? 0 : 500, // No delays in parallel mode
      maxDelay: options?.parallelMode ? 0 : 2000, // No delays in parallel mode
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
      
      // NEW: Parallel processing configuration (ENABLED with RPC rate limiting)
      parallelMode: true, // Enable parallel mode with proper rate limiting
      maxConcurrentTx: options?.maxConcurrentTx || 2, // Reduced to 2 for RPC safety (5 tx/sec limit)
      balanceCheckTimeout: options?.balanceCheckTimeout || 8000, // Increased timeout for stability
      fastMode: options?.fastMode || false,
      
      // RPC Rate Limiting (based on your plan: 50 req/sec, 5 tx/sec)
      rpcRateLimit: {
        maxRequestsPerSecond: 40, // Stay under 50 req/sec limit
        maxTransactionsPerSecond: 4, // Stay under 5 tx/sec limit
        burstAllowance: 10, // Allow short bursts
      },
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

    const walletsNeeded =
      destinationWallets.length * config.intermediateWalletCount;
    if (walletStats.available < walletsNeeded) {
      console.log(
        `⚠️  Warning: Need ${walletsNeeded} wallets, only ${walletStats.available} available`
      );
      console.log(`   Generating additional wallets...`);
      await mixer.ensureWalletPoolHealth(walletsNeeded);
    }

    // Create custom mixing routes with specific amounts
    const routes = await createCustomMixingRoutes(
      mixer,
      fundingWallet,
      destinationWallets,
      amounts
    );

    // Execute mixing with custom routes
    console.log(`\n🎯 Executing ${routes.length} custom mixing routes...`);
    const startTime = Date.now();

    const results = await executeCustomMixing(mixer, routes);

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    // Calculate success metrics
    const successfulRoutes = results.filter((result) => result.success);
    const successCount = successfulRoutes.length;
    const totalSignatures = results.reduce(
      (sum, result) => sum + (result.signatures?.length || 0),
      0
    );

    console.log(`\n✅ Mixing completed in ${duration.toFixed(2)}s`);
    console.log(`📊 Results: ${successCount}/${results.length} routes successful`);
    console.log(`📝 Total transactions: ${totalSignatures}`);

    if (successCount < results.length) {
      console.log(`⚠️  ${results.length - successCount} routes failed`);
      results
        .filter((result) => !result.success)
        .forEach((result, i) => {
          console.log(`   Route ${i + 1}: ${result.error}`);
        });
    }

    // Cleanup
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
 * NOW USES ATOMIC WALLET RESERVATION to prevent wallet reuse across routes
 * 🛡️ SECURITY: Validates all destinations have < 0.1 SOL
 */
async function createCustomMixingRoutes(
  mixer: any,
  fundingWallet: Keypair,
  destinationWallets: PublicKey[],
  amounts: number[]
) {
  const MAX_ALLOWED_BALANCE = 0.1 * 1_000_000_000; // 0.1 SOL in lamports
  
  // Filter out invalid destinations/amounts AND validate security requirements
  console.log(`🛡️ SECURITY: Validating ${destinationWallets.length} destination wallets (must have < 0.1 SOL)...`);
  const validRouteData = [];
  
  for (let i = 0; i < amounts.length && i < destinationWallets.length; i++) {
    const destination = destinationWallets[i];
    const amount = amounts[i];

    // Skip routes with invalid amounts
    if (!amount || amount <= 0 || isNaN(amount)) {
      console.log(`⚠️  Skipping route ${i + 1}: Invalid amount ${amount}`);
      continue;
    }

    // 🛡️ CRITICAL SECURITY: Validate destination has < 0.1 SOL
    try {
      const balance = await mixer.connectionManager.getBalance(destination);
      
      if (balance >= MAX_ALLOWED_BALANCE) {
        console.error(
          `❌ SECURITY VIOLATION: Skipping destination ${i + 1} (${destination.toString().slice(0, 8)}...): ` +
          `Has ${(balance / 1_000_000_000).toFixed(6)} SOL (>= 0.1 SOL). ` +
          `Mixer can only send to wallets with less than 0.1 SOL.`
        );
        continue; // Skip this destination
      }
      
      console.log(`✅ Destination ${i + 1} (${destination.toString().slice(0, 8)}...) validated: ${(balance / 1_000_000_000).toFixed(6)} SOL`);
    } catch (error) {
      // If balance check fails (wallet doesn't exist), that's acceptable (balance = 0)
      console.log(`✅ Destination ${i + 1} (${destination.toString().slice(0, 8)}...) validated: New wallet (no balance)`);
    }

    validRouteData.push({ destination, amount });
  }

  if (validRouteData.length === 0) {
    throw new Error(
      "No valid routes to create. All destinations must have less than 0.1 SOL. " +
      "This is a security requirement and cannot be bypassed."
    );
  }
  
  console.log(`✅ SECURITY: ${validRouteData.length}/${destinationWallets.length} destinations passed validation`);

  // ATOMIC RESERVATION: Reserve ALL wallets needed upfront to prevent reuse
  const totalWalletsNeeded = validRouteData.length * mixer.config.intermediateWalletCount;
  console.log(`🔍 Atomically reserving ${totalWalletsNeeded} unique intermediate wallets...`);

  const reservedWallets = await mixer.walletManager.reserveWalletsForMixing(
    totalWalletsNeeded,
    [] // No exclusions for first reservation
  );

  if (reservedWallets.length < totalWalletsNeeded) {
    throw new Error(
      `Insufficient intermediate wallets for privacy mixing. Need ${totalWalletsNeeded}, got ${reservedWallets.length}. Cannot proceed without proper privacy protection.`
    );
  }

  // Now distribute the unique wallets across routes
  const routes = [];
  for (let i = 0; i < validRouteData.length; i++) {
    const { destination, amount } = validRouteData[i];
    
    // Get this route's unique set of intermediate wallets
    const startIdx = i * mixer.config.intermediateWalletCount;
    const endIdx = startIdx + mixer.config.intermediateWalletCount;
    const routeIntermediateWallets = reservedWallets.slice(startIdx, endIdx);

    const route = {
      source: {
        publicKey: fundingWallet.publicKey,
        keypair: fundingWallet,
        balance: amount + 0.006, // Add buffer for fees
      },
      intermediates: routeIntermediateWallets.map((wallet: any) => {
        try {
          const keypair = mixer.walletManager.getKeypairFromStoredWallet(wallet);
          return {
            publicKey: new PublicKey(wallet.publicKey),
            keypair: keypair,
            balance: wallet.balance - 0.006,
          };
        } catch (decryptError) {
          console.error(`❌ Failed to decrypt intermediate wallet ${wallet.publicKey}: ${decryptError}`);
          throw new Error(`Intermediate wallet decryption failed: ${wallet.publicKey}`);
        }
      }),
      destination,
      amount,
    };

    routes.push(route);
  }

  console.log(
    `🎯 Created ${routes.length} routes with ${totalWalletsNeeded} unique intermediate wallets (atomically reserved)`
  );
  return routes;
}

/**
 * Execute custom mixing with pre-defined routes and amounts
 * Uses the new smart balance checking system for better reliability
 * NOW PROPERLY RELEASES WALLETS after execution
 */
async function executeCustomMixing(mixer: any, routes: any[]) {
  const results = [];
  const allUsedWalletIds: string[] = [];

  try {
    for (const route of routes) {
      try {
        // Use the parallel execution method which has the new smart balance checking
        const result = await mixer.executeSingleRouteParallel(
          route,
          0, // No delays in parallel mode
          0, // currentTransactionIndex
          routes.length - 1, // totalDelays
          0  // remainingTime
        );
        results.push(result);
        
        // Track wallets used in this route
        if (result.usedWalletIds) {
          allUsedWalletIds.push(...result.usedWalletIds);
        }
      } catch (error) {
        console.warn(`⚠️ Parallel execution failed for route, falling back to optimized: ${error instanceof Error ? error.message : String(error)}`);
        
        // Fallback to optimized method if parallel fails
        try {
          const result = await mixer.executeSingleRouteOptimized(
            route,
            1000,
            0,
            routes.length - 1,
            0
          );
          results.push(result);
          
          // Track wallets used in fallback
          if (result.usedWalletIds) {
            allUsedWalletIds.push(...result.usedWalletIds);
          }
        } catch (fallbackError) {
          results.push({
            success: false,
            error: fallbackError instanceof Error ? fallbackError.message : "Unknown error",
            signatures: [],
          });
          
          // Even on failure, track the wallets that were attempted
          const routeWalletIds = route.intermediates.map((w: any) => w.publicKey.toString());
          allUsedWalletIds.push(...routeWalletIds);
        }
      }
    }

    return results;
  } finally {
    // CRITICAL: Release all used wallets back to pool, even if execution fails
    if (allUsedWalletIds.length > 0) {
      try {
        await mixer.walletManager.releaseWallets(allUsedWalletIds);
        console.log(`🔄 Released ${allUsedWalletIds.length} wallets back to pool`);
      } catch (releaseError) {
        console.error(`❌ Failed to release wallets:`, releaseError);
      }
    }
  }
}