const { Connection, Keypair, PublicKey, SystemProgram, Transaction } = require('@solana/web3.js');
const bs58 = require('bs58');

/**
 * Simple, reliable SOL distribution to buyer wallets
 * No complex mixing - just direct transfers that work
 */
async function simpleDirectTransfer(fundingPrivateKey, destinationAddresses, amounts) {
  console.log('🚀 Starting Simple SOL Distribution');
  console.log(`📍 Distributing to ${destinationAddresses.length} wallets`);

  const connection = new Connection(process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
  
  try {
    // Load funding wallet
    const fundingWallet = Keypair.fromSecretKey(bs58.decode(fundingPrivateKey));
    console.log(`💳 Funding wallet: ${fundingWallet.publicKey.toString()}`);

    // Parse destination wallets
    const destinationWallets = destinationAddresses.map(addr => new PublicKey(addr));

    // Check funding wallet balance
    const fundingBalance = await connection.getBalance(fundingWallet.publicKey);
    console.log(`💰 Funding balance: ${(fundingBalance / 1e9).toFixed(6)} SOL`);

    const results = [];
    let totalTransferred = 0;

    // Transfer to each destination wallet
    for (let i = 0; i < destinationWallets.length; i++) {
      const destination = destinationWallets[i];
      const amount = amounts[i];
      
      console.log(`\n🔄 Transfer ${i + 1}/${destinationWallets.length}:`);
      console.log(`   To: ${destination.toString()}`);
      console.log(`   Amount: ${(amount / 1e9).toFixed(6)} SOL`);

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
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = fundingWallet.publicKey;

        // Sign and send transaction
        transaction.sign(fundingWallet);
        const signature = await connection.sendRawTransaction(transaction.serialize());
        
        // Wait for confirmation
        await connection.confirmTransaction(signature, 'confirmed');

        console.log(`   ✅ Success: ${signature}`);
        
        results.push({
          success: true,
          destination: destination.toString(),
          amount,
          signature
        });

        totalTransferred += amount;

        // Small delay between transactions
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        
        results.push({
          success: false,
          destination: destination.toString(),
          amount,
          error: error.message
        });
      }
    }

    // Final summary
    console.log(`\n📊 Distribution Summary:`);
    console.log(`   Total transfers: ${results.length}`);
    console.log(`   Successful: ${results.filter(r => r.success).length}`);
    console.log(`   Failed: ${results.filter(r => !r.success).length}`);
    console.log(`   Total distributed: ${(totalTransferred / 1e9).toFixed(6)} SOL`);

    return {
      success: results.every(r => r.success),
      results,
      totalTransferred
    };

  } catch (error) {
    console.error('❌ Distribution failed:', error);
    throw error;
  }
}

module.exports = { simpleDirectTransfer }; 