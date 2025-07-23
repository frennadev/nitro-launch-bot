import { MongoClient } from 'mongodb';
import { Connection, PublicKey } from '@solana/web3.js';

async function findExactWallets() {
  console.log('🔍 Finding exact wallets with stuck SOL...\n');
  
  const mongoUri = process.env.MONGODB_URI || "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  const databaseName = process.env.DATABASE_NAME || "test";
  
  let client;
  
  try {
    // Connect to MongoDB
    client = new MongoClient(mongoUri);
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db(databaseName);
    const walletsCollection = db.collection('mixer_wallets');
    
    // Get all wallets with transaction history
    console.log('🔍 Getting all wallets with transaction history...');
    const allWallets = await walletsCollection.find({
      "transactionHistory.0": { $exists: true },
      isActive: true
    }).toArray();
    
    console.log(`📊 Found ${allWallets.length} wallets with transaction history`);
    
    // Check balances of all these wallets
    console.log('\n💰 Checking balances of all wallets with transaction history...');
    
    const connection = new Connection(
      process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
      'confirmed'
    );
    
    let totalStuckSol = 0;
    const walletsWithFunds = [];
    
    for (const wallet of allWallets) {
      try {
        const pubkey = new PublicKey(wallet.publicKey);
        const balance = await connection.getBalance(pubkey);
        
        if (balance > 0) {
          const solAmount = balance / 1e9;
          totalStuckSol += solAmount;
          walletsWithFunds.push({
            publicKey: wallet.publicKey,
            balance: solAmount,
            lastUsed: wallet.lastUsed,
            usageCount: wallet.usageCount,
            status: wallet.status,
            transactionHistory: wallet.transactionHistory
          });
          
          console.log(`💰 Found ${solAmount.toFixed(6)} SOL in ${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-8)}`);
        }
      } catch (error) {
        console.log(`❌ Error checking ${wallet.publicKey}: ${error.message}`);
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`Total stuck SOL: ${totalStuckSol.toFixed(6)} SOL`);
    console.log(`Wallets with funds: ${walletsWithFunds.length}`);
    
    if (walletsWithFunds.length > 0) {
      console.log('\n🔧 Wallets with stuck SOL:');
      
      walletsWithFunds.forEach((wallet, i) => {
        console.log(`\n${i + 1}. ${wallet.publicKey}`);
        console.log(`   Balance: ${wallet.balance.toFixed(6)} SOL`);
        console.log(`   Status: ${wallet.status}`);
        console.log(`   Usage Count: ${wallet.usageCount}`);
        console.log(`   Last Used: ${wallet.lastUsed ? new Date(wallet.lastUsed).toLocaleString() : 'Unknown'}`);
        
        if (wallet.transactionHistory && wallet.transactionHistory.length > 0) {
          console.log(`   Transaction History:`);
          wallet.transactionHistory.forEach((tx, txIndex) => {
            const txTime = new Date(tx.timestamp).toLocaleString();
            const txAmount = (tx.amount / 1e9).toFixed(6);
            console.log(`     ${txIndex + 1}. ${tx.type} - ${txAmount} SOL - ${txTime}`);
          });
        }
      });
      
      console.log('\n🔧 Recovery Options:');
      console.log('1. Use the mixer recovery function to automatically recover funds');
      console.log('2. Manually transfer funds from these wallets to your main wallet');
      console.log('3. Mark these wallets as "available" in the database after recovery');
      
      // Check if any of these match the expected amounts from the failed operation
      const expectedAmounts = [0.499000, 0.613770]; // From the logs
      console.log('\n🎯 Checking for wallets with expected amounts:');
      
      walletsWithFunds.forEach((wallet, i) => {
        const isExpectedAmount = expectedAmounts.some(expected => 
          Math.abs(wallet.balance - expected) < 0.001
        );
        
        if (isExpectedAmount) {
          console.log(`✅ ${wallet.publicKey} - ${wallet.balance.toFixed(6)} SOL (matches expected amount)`);
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (client) {
      await client.close();
      console.log('\n🔌 Disconnected from MongoDB');
    }
  }
}

// Run the script
findExactWallets().catch(console.error); 