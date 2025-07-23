import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { logger } from '../../jobs/logger';

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

  log('🚀 Starting Simple SOL Distribution');
  log(`📍 Distributing to ${destinationAddresses.length} wallets`);

  const connection = new Connection(
    process.env.MIXER_HELIUS_RPC || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );
  
  try {
    // Load funding wallet
    const fundingWallet = Keypair.fromSecretKey(bs58.decode(fundingPrivateKey));
    log(`💳 Funding wallet: ${fundingWallet.publicKey.toString()}`);

    // Parse destination wallets
    const destinationWallets = destinationAddresses.map(addr => new PublicKey(addr));

    // Check funding wallet balance
    const fundingBalance = await connection.getBalance(fundingWallet.publicKey);
    log(`💰 Funding balance: ${(fundingBalance / 1e9).toFixed(6)} SOL`);

    const results = [];
    let totalTransferred = 0;

    // Transfer to each destination wallet
    for (let i = 0; i < destinationWallets.length; i++) {
      const destination = destinationWallets[i];
      const amount = amounts[i];
      
      log(`🔄 Transfer ${i + 1}/${destinationWallets.length}: ${(amount / 1e9).toFixed(6)} SOL to ${destination.toString().slice(0, 8)}...`);

      try {
        // Create transfer transaction
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: fundingWallet.publicKey,
            toPubkey: destination,
            lamports: amount,
          })
        );

        // Get recent blockhash
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = fundingWallet.publicKey;

        // Sign and send transaction
        transaction.sign(fundingWallet);
        const signature = await connection.sendRawTransaction(transaction.serialize());
        
        // Wait for confirmation
        await connection.confirmTransaction(signature, 'confirmed');

        log(`✅ Success: ${signature}`);
        
        results.push({
          success: true,
          destination: destination.toString(),
          amount,
          signature
        });

        totalTransferred += amount;

        // Small delay between transactions to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error: any) {
        log(`❌ Failed: ${error.message}`);
        
        results.push({
          success: false,
          destination: destination.toString(),
          amount,
          error: error.message
        });
      }
    }

    // Final summary
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    log(`📊 Distribution Summary: ${successCount}/${results.length} successful, ${(totalTransferred / 1e9).toFixed(6)} SOL distributed`);

    return {
      success: successCount === results.length,
      results,
      totalTransferred,
      successCount,
      failCount
    };

  } catch (error: any) {
    log(`❌ Distribution failed: ${error.message}`);
    throw error;
  }
}

/**
 * Generate optimized distribution amounts for buyer wallets
 * Uses smart wallet count calculation based on buy amount for efficiency
 */
export function generateDistributionAmounts(totalSol: number, destinationCount: number): number[] {
  const totalLamports = Math.floor(totalSol * 1e9);
  
  // Incremental sequence in SOL: 0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5...
  const incrementalSequence = [0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1];
  const incrementalLamports = incrementalSequence.map(sol => Math.floor(sol * 1e9));
  
  // Calculate optimal wallet count for this amount
  function calculateOptimalWalletCount(amount: number): number {
    let cumulativeTotal = 0;
    for (let i = 0; i < incrementalSequence.length; i++) {
      cumulativeTotal += incrementalLamports[i];
      if (amount <= cumulativeTotal) {
        return i + 1;
      }
    }
    const baseTotal = incrementalLamports.reduce((sum, amt) => sum + amt, 0);
    const extraWallets = Math.ceil((amount - baseTotal) / (Math.floor(2.5 * 1e9)));
    return incrementalSequence.length + extraWallets;
  }
  
  const optimalWalletCount = calculateOptimalWalletCount(totalLamports);
  const walletsToUse = Math.min(optimalWalletCount, destinationCount);
  
  const amounts: number[] = [];
  let remainingLamports = totalLamports;
  
  // Distribute using incremental pattern for optimal wallets
  for (let i = 0; i < walletsToUse; i++) {
    if (i < incrementalSequence.length) {
      const incrementAmount = incrementalLamports[i];
      
      if (i === walletsToUse - 1) {
        amounts.push(remainingLamports);
      } else if (remainingLamports >= incrementAmount) {
        amounts.push(incrementAmount);
        remainingLamports -= incrementAmount;
      } else {
        amounts.push(remainingLamports);
        remainingLamports = 0;
      }
    } else {
      const walletsLeft = walletsToUse - i;
      const amountPerWallet = Math.floor(remainingLamports / walletsLeft);
      
      if (i === walletsToUse - 1) {
        amounts.push(remainingLamports);
      } else {
        amounts.push(amountPerWallet);
        remainingLamports -= amountPerWallet;
      }
    }
  }
  
  return amounts;
} 