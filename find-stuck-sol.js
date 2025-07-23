const { Connection, PublicKey } = require('@solana/web3.js');

// Intermediate wallet addresses from the failed mixer logs
const intermediateWallets = [
  // Route 1 intermediate wallets (from the logs)
  "5FsGFoSf...", // First intermediate in route 1
  "H1iVsZbZ...", // Second intermediate in route 1
  
  // Route 2 intermediate wallets (from the logs)  
  "PbHRCv4j...", // First intermediate in route 2
  "521QLdRH...", // Second intermediate in route 2
];

// Full addresses (you'll need to replace the shortened ones with full addresses)
const fullAddresses = [
  // These are the actual addresses from the logs - you'll need to get the full addresses
  // from your MongoDB database or by checking the mixer logs more carefully
];

async function findStuckSol() {
  console.log('🔍 Finding stuck SOL in mixer intermediate wallets...\n');
  
  const connection = new Connection(
    process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );
  
  try {
    // First, let's check if we can find the full addresses from the logs
    console.log('📋 Intermediate wallet addresses from logs:');
    intermediateWallets.forEach((addr, i) => {
      console.log(`${i + 1}. ${addr}`);
    });
    
    console.log('\n⚠️  Note: The addresses above are shortened. To find the full addresses:');
    console.log('1. Check your MongoDB mixer_wallets collection for wallets used in the last mixing operation');
    console.log('2. Look for wallets with status "in_use" or check the transaction history');
    console.log('3. The full addresses should be in your mixer logs or database');
    
    // If you have the full addresses, uncomment and use this section:
    /*
    console.log('\n💰 Checking balances of intermediate wallets...');
    
    for (const address of fullAddresses) {
      try {
        const pubkey = new PublicKey(address);
        const balance = await connection.getBalance(pubkey);
        
        if (balance > 0) {
          console.log(`💰 Found ${(balance / 1e9).toFixed(6)} SOL in ${address.slice(0, 8)}...${address.slice(-8)}`);
        } else {
          console.log(`💨 ${address.slice(0, 8)}...${address.slice(-8)}: 0 SOL`);
        }
      } catch (error) {
        console.log(`❌ Error checking ${address}: ${error.message}`);
      }
    }
    */
    
    console.log('\n🔧 To recover stuck SOL:');
    console.log('1. Find the full addresses of the intermediate wallets');
    console.log('2. Use the mixer recovery function or manually transfer funds');
    console.log('3. Check the MongoDB mixer_wallets collection for wallet details');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the script
findStuckSol().catch(console.error); 