import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { logger } from "../../jobs/logger";

/**
 * Simple, reliable SOL distribution to buyer wallets
 * No complex mixing - just direct transfers that work
 */
export async function simpleDirectTransfer(
  fundingPrivateKey: string,
  destinationAddresses: string[],
  amounts: number[],
  logIdentifier?: string
) {
  const log = (message: string) => {
    if (logIdentifier) {
      logger.info(`[${logIdentifier}]: ${message}`);
    } else {
      console.log(message);
    }
  };

  log("🚀 Starting Simple SOL Distribution");
  log(`📍 Distributing to ${destinationAddresses.length} wallets`);

  const connection = new Connection(
    process.env.MIXER_HELIUS_RPC || "https://api.mainnet-beta.solana.com",
    "confirmed"
  );

  try {
    // Load funding wallet
    const fundingWallet = Keypair.fromSecretKey(bs58.decode(fundingPrivateKey));
    log(`💳 Funding wallet: ${fundingWallet.publicKey.toString()}`);

    // Parse destination wallets
    const destinationWallets = destinationAddresses.map(
      (addr) => new PublicKey(addr)
    );

    // Check funding wallet balance
    const fundingBalance = await connection.getBalance(fundingWallet.publicKey);
    log(`💰 Funding balance: ${(fundingBalance / 1e9).toFixed(6)} SOL`);

    const results = [];
    let totalTransferred = 0;

    // CRITICAL FIX: Account for rent exemption in transfer calculations
    const RENT_EXEMPTION = 890880; // ~0.000891 SOL
    const TRANSACTION_FEE = 7000; // ~0.000007 SOL
    const BUFFER = 5000; // ~0.000005 SOL
    const REQUIRED_RESERVES = RENT_EXEMPTION + TRANSACTION_FEE + BUFFER;

    // Transfer to each destination wallet
    for (let i = 0; i < destinationWallets.length; i++) {
      const destination = destinationWallets[i];
      const requestedAmount = amounts[i];

      // CRITICAL FIX: Ensure destination wallet will have enough for rent after receiving funds
      const adjustedAmount = requestedAmount + REQUIRED_RESERVES;

      log(`🔄 Transfer ${i + 1}/${destinationWallets.length}`);
      log(`   Requested: ${(requestedAmount / 1e9).toFixed(6)} SOL`);
      log(
        `   Adjusted: ${(adjustedAmount / 1e9).toFixed(6)} SOL (includes ${(REQUIRED_RESERVES / 1e9).toFixed(6)} SOL for rent+fees)`
      );
      log(`   To: ${destination.toString().slice(0, 8)}...`);

      try {
        // Check if funding wallet has enough for this transfer
        const currentFundingBalance = await connection.getBalance(
          fundingWallet.publicKey
        );
        if (currentFundingBalance < adjustedAmount + TRANSACTION_FEE) {
          throw new Error(
            `Insufficient funding wallet balance: ${(currentFundingBalance / 1e9).toFixed(6)} SOL, need ${((adjustedAmount + TRANSACTION_FEE) / 1e9).toFixed(6)} SOL`
          );
        }
        // Create transfer transaction
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: fundingWallet.publicKey,
            toPubkey: destination,
            lamports: adjustedAmount, // Use adjusted amount
          })
        );

        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = fundingWallet.publicKey;

        // Sign and send transaction
        transaction.sign(fundingWallet);
        const signature = await connection.sendRawTransaction(
          transaction.serialize()
        );

        // Wait for confirmation
        await connection.confirmTransaction(signature, "confirmed");

        log(`✅ Success: ${signature}`);
        log(`   Actual transferred: ${(adjustedAmount / 1e9).toFixed(6)} SOL`);
        log(
          `   Usable by recipient: ${(requestedAmount / 1e9).toFixed(6)} SOL`
        );

        results.push({
          success: true,
          destination: destination.toString(),
          amount: adjustedAmount,
          usableAmount: requestedAmount,
          signature,
        });

        totalTransferred += adjustedAmount;

        // Small delay between transactions to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        log(`❌ Failed: ${errorMessage}`);

        results.push({
          success: false,
          destination: destination.toString(),
          amount: requestedAmount,
          error: errorMessage,
        });
      }
    }

    // Final summary
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;
    const totalUsable = results
      .filter((r) => r.success)
      .reduce((sum, r) => sum + (r.usableAmount || 0), 0);

    log(`📊 Distribution Summary:`);
    log(`   Success: ${successCount}/${results.length} transfers`);
    log(`   Total transferred: ${(totalTransferred / 1e9).toFixed(6)} SOL`);
    log(`   Total usable: ${(totalUsable / 1e9).toFixed(6)} SOL`);
    log(
      `   Rent overhead: ${((totalTransferred - totalUsable) / 1e9).toFixed(6)} SOL`
    );

    return {
      success: successCount === results.length,
      results,
      totalTransferred,
      totalUsable,
      successCount,
      failCount,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`❌ Distribution failed: ${errorMessage}`);
    throw error;
  }
}

/**
 * Generate optimized distribution amounts for buyer wallets using 73-wallet system
 * UPDATED: Now uses the main generateBuyDistribution function with 73-wallet randomization
 * CRITICAL FIX: Account for rent exemption in amount calculations
 */
export async function generateDistributionAmounts(
  totalSol: number,
  destinationCount: number
): Promise<number[]> {
  const RENT_EXEMPTION = 2190880; // ~0.000891 SOL per wallet
  const TRANSACTION_FEE = 7000; // ~0.000007 SOL per wallet
  const BUFFER = 5000; // ~0.000005 SOL per wallet
  const OVERHEAD_PER_WALLET = RENT_EXEMPTION + TRANSACTION_FEE + BUFFER;

  // Calculate available amount after accounting for overhead
  const totalOverhead = OVERHEAD_PER_WALLET * destinationCount;
  const availableForDistribution = Math.max(
    0,
    Math.floor(totalSol * 1e9) - totalOverhead
  );

  if (availableForDistribution <= 0) {
    throw new Error(
      `Insufficient funds: need ${(totalOverhead / 1e9).toFixed(6)} SOL minimum for ${destinationCount} wallets (${(OVERHEAD_PER_WALLET / 1e9).toFixed(6)} SOL each), have ${totalSol.toFixed(6)} SOL`
    );
  }

  // 🚀 NEW: Use the main 73-wallet randomized distribution system
  try {
    // Import the main distribution function
    const { generateBuyDistribution } = await import("../../backend/functions");
    
    // Convert available amount back to SOL for the function
    const availableSol = availableForDistribution / 1e9;
    
    // Generate distribution using the 73-wallet system
    const solDistribution = generateBuyDistribution(availableSol, destinationCount);
    
    // Convert back to lamports and add overhead
    const amounts = solDistribution.map(solAmount => 
      Math.floor(solAmount * 1e9) + OVERHEAD_PER_WALLET
    );
    
    // Pad remaining destinations with minimum overhead (for unused wallets)
    while (amounts.length < destinationCount) {
      amounts.push(OVERHEAD_PER_WALLET);
    }
    
    console.log(`🎲 Using 73-wallet randomized distribution: ${solDistribution.filter(x => x > 0).length} active wallets`);
    
    return amounts;
    
  } catch (error) {
    console.warn("Failed to use 73-wallet distribution, falling back to legacy system:", error);
    
    // FALLBACK: Legacy incremental sequence
    const incrementalSequence = [
      0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1,
    ];
    const incrementalLamports = incrementalSequence.map((sol) =>
      Math.floor(sol * 1e9)
    );

    // Calculate optimal wallet count for available amount (not including overhead)
    function calculateOptimalWalletCount(amount: number): number {
      let cumulativeTotal = 0;
      for (let i = 0; i < incrementalSequence.length; i++) {
        cumulativeTotal += incrementalLamports[i];
        if (amount <= cumulativeTotal) {
          return i + 1;
        }
      }
      const baseTotal = incrementalLamports.reduce((sum, amt) => sum + amt, 0);
      const extraWallets = Math.ceil(
        (amount - baseTotal) / Math.floor(2.5 * 1e9)
      );
      return incrementalSequence.length + extraWallets;
    }

    const optimalWalletCount = calculateOptimalWalletCount(
      availableForDistribution
    );
    const walletsToUse = Math.min(optimalWalletCount, destinationCount);

    const amounts: number[] = [];
    let remainingLamports = availableForDistribution;

    // Distribute using incremental pattern for optimal wallets
    for (let i = 0; i < walletsToUse; i++) {
      if (i < incrementalSequence.length) {
        const incrementAmount = incrementalLamports[i];

        if (i === walletsToUse - 1) {
          amounts.push(remainingLamports + OVERHEAD_PER_WALLET);
        } else if (remainingLamports >= incrementAmount) {
          amounts.push(incrementAmount + OVERHEAD_PER_WALLET);
          remainingLamports -= incrementAmount;
        } else {
          amounts.push(remainingLamports + OVERHEAD_PER_WALLET);
          remainingLamports = 0;
        }
      } else {
        const walletsLeft = walletsToUse - i;
        const amountPerWallet = Math.floor(remainingLamports / walletsLeft);

        if (i === walletsToUse - 1) {
          amounts.push(remainingLamports + OVERHEAD_PER_WALLET);
        } else {
          amounts.push(amountPerWallet + OVERHEAD_PER_WALLET);
          remainingLamports -= amountPerWallet;
        }
      }
    }

    // Pad remaining destinations with minimum overhead (for unused wallets)
    while (amounts.length < destinationCount) {
      amounts.push(OVERHEAD_PER_WALLET);
    }
    
    return amounts;
  }
}
