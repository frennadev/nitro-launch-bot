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
    process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
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
 * Generate distribution amounts for buyer wallets
 */
export function generateDistributionAmounts(totalSol: number, destinationCount: number): number[] {
  const totalLamports = Math.floor(totalSol * 1e9);
  const amountPerWallet = Math.floor(totalLamports / destinationCount);
  
  // Create equal distribution
  const amounts = new Array(destinationCount).fill(amountPerWallet);
  
  // Distribute any remainder to the first few wallets
  const remainder = totalLamports - (amountPerWallet * destinationCount);
  for (let i = 0; i < remainder && i < destinationCount; i++) {
    amounts[i] += 1;
  }
  
  return amounts;
} 