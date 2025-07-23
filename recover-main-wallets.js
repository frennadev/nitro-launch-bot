import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import * as crypto from 'crypto';

// Configuration
const DESTINATION_WALLET = 'D8HzTnuLAk5nL76cDq9bjZWc8LqQizodXC1G7oBVNQL2';
const FEE_FUNDING_PRIVATE_KEY = '5DxL2BEk9RWyd9vatheaRp6m91oRTpd5PEaDtFJV4kGFgEzhFSukbLX66tF9eo3KuvCwmBHTxwGyVDGgwX2vPwKD';

// The two main wallets with stuck SOL from the failed mixing operation
const STUCK_WALLETS = [
  {
    publicKey: '5FsGFoSfFDnmV6S28uBqhDnjWWVaE6UTcyovmmcFbpUs',
    expectedBalance: 0.499000,
    encryptedPrivateKey: null // Will be retrieved from MongoDB
  },
  {
    publicKey: 'PbHRCv4jJXaN6QksQGdL3MJT6993QUoNUZWJSHazB4r',
    expectedBalance: 0.613770,
    encryptedPrivateKey: null // Will be retrieved from MongoDB
  }
];

async function recoverMainWallets() {
  console.log('🔍 Recovering SOL from main stuck wallets...\n');
  
  try {
    // Setup Solana connection
    const connection = new Connection(
      process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    
    // Setup fee funding wallet
    const feeFundingWallet = Keypair.fromSecretKey(bs58.decode(FEE_FUNDING_PRIVATE_KEY));
    console.log(`💳 Fee funding wallet: ${feeFundingWallet.publicKey.toString()}`);
    
    // Check fee funding wallet balance
    const feeFundingBalance = await connection.getBalance(feeFundingWallet.publicKey);
    console.log(`💰 Fee funding balance: ${(feeFundingBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
    
    if (feeFundingBalance < 0.01 * LAMPORTS_PER_SOL) {
      throw new Error('Insufficient funds in fee funding wallet. Need at least 0.01 SOL for fees.');
    }
    
    // Check current balances of the stuck wallets
    console.log('\n🔍 Checking current balances...');
    
    for (const wallet of STUCK_WALLETS) {
      try {
        const pubkey = new PublicKey(wallet.publicKey);
        const balance = await connection.getBalance(pubkey);
        const solBalance = balance / LAMPORTS_PER_SOL;
        
        console.log(`💰 ${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-8)}: ${solBalance.toFixed(6)} SOL (expected: ${wallet.expectedBalance.toFixed(6)} SOL)`);
        
        if (solBalance > 0.001) { // Only recover if there's meaningful amount
          console.log(`🔄 Will recover ${solBalance.toFixed(6)} SOL from this wallet`);
          
          // For now, we'll need to get the private key from MongoDB
          // Let me create a manual recovery approach
          console.log(`📝 Manual recovery needed for ${wallet.publicKey}`);
          console.log(`   - Current balance: ${solBalance.toFixed(6)} SOL`);
          console.log(`   - Destination: ${DESTINATION_WALLET}`);
          console.log(`   - Fee payer: ${feeFundingWallet.publicKey.toString()}`);
        }
      } catch (error) {
        console.log(`❌ Error checking ${wallet.publicKey}: ${error.message}`);
      }
    }
    
    console.log('\n🔧 Recovery Instructions:');
    console.log('1. The two main wallets have been identified');
    console.log('2. You need to manually transfer the funds using a wallet that has the private keys');
    console.log('3. Or use the mixer recovery function if available');
    console.log('4. All funds should be sent to: ' + DESTINATION_WALLET);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the recovery
recoverMainWallets().catch(console.error); 