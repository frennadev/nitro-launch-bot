import { MongoClient } from 'mongodb';
import { Connection, PublicKey } from '@solana/web3.js';

async function checkSpecificMixerWallets() {
  console.log('🔍 Checking specific wallets from failed mixing operation...\n');
  
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
    
    // Check wallets used at the specific time of the failed operation (7/23/2025, 9:45:21 PM)
    const targetTime = new Date('2025-07-23T21:45:21.000Z'); // Convert to UTC
    const timeWindow = 5 * 60 * 1000; // 5 minutes window
    
    console.log(`🔍 Checking wallets used around ${targetTime.toLocaleString()}`);
    
    const specificWallets = await walletsCollection.find({
      lastUsed: {
        $gte: new Date(targetTime.getTime() - timeWindow),
        $lte: new Date(targetTime.getTime() + timeWindow)
      },
      isActive: true
    }).toArray();
    
    console.log(`📊 Found ${specificWallets.length} wallets used during the failed operation`);
    
    if (specificWallets.length > 0) {
      console.log('\n💰 Checking balances of these specific wallets...');
      
      const connection = new Connection(
        process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
        'confirmed'
      );
      
      let totalStuckSol = 0;
      const walletsWithFunds = [];
      
      for (const wallet of specificWallets) {
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
              status: wallet.status
            });
            
            console.log(`💰 Found ${solAmount.toFixed(6)} SOL in ${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-8)}`);
          } else {
            console.log(`💨 ${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-8)}: 0 SOL`);
          }
        } catch (error) {
          console.log(`❌ Error checking ${wallet.publicKey}: ${error.message}`);
        }
      }
      
      console.log(`\n📊 Summary:`);
      console.log(`Total stuck SOL: ${totalStuckSol.toFixed(6)} SOL`);
      console.log(`Wallets with funds: ${walletsWithFunds.length}`);
      
      if (walletsWithFunds.length > 0) {
        console.log('\n🔧 Recovery options:');
        console.log('1. Use the mixer recovery function to automatically recover funds');
        console.log('2. Manually transfer funds from these wallets to your main wallet');
        console.log('3. Mark these wallets as "available" in the database after recovery');
        
        console.log('\n📋 Wallets with stuck funds:');
        walletsWithFunds.forEach((wallet, i) => {
          console.log(`${i + 1}. ${wallet.publicKey} - ${wallet.balance.toFixed(6)} SOL (Status: ${wallet.status})`);
        });
      }
      
      // Also show all wallets used in the operation for reference
      console.log('\n📋 All wallets used in the failed operation:');
      specificWallets.forEach((wallet, i) => {
        const lastUsed = wallet.lastUsed ? new Date(wallet.lastUsed).toLocaleString() : 'Unknown';
        console.log(`${i + 1}. ${wallet.publicKey} - Status: ${wallet.status} - Last used: ${lastUsed}`);
      });
    }
    
    // Check for any wallets with transaction history that might have received funds
    console.log('\n🔍 Checking for wallets with recent transaction history...');
    const recentWallets = await walletsCollection.find({
      "transactionHistory.0": { $exists: true },
      isActive: true
    }).sort({ lastUsed: -1 }).limit(10).toArray();
    
    console.log(`📊 Found ${recentWallets.length} wallets with transaction history`);
    
    if (recentWallets.length > 0) {
      console.log('\n📋 Recent transaction activity:');
      for (const wallet of recentWallets) {
        const lastUsed = wallet.lastUsed ? new Date(wallet.lastUsed).toLocaleString() : 'Unknown';
        console.log(`${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-8)} - Last used: ${lastUsed}`);
        
        if (wallet.transactionHistory && wallet.transactionHistory.length > 0) {
          const lastTx = wallet.transactionHistory[wallet.transactionHistory.length - 1];
          console.log(`   Last transaction: ${lastTx.type} - ${lastTx.amount} lamports - ${new Date(lastTx.timestamp).toLocaleString()}`);
        }
      }
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
checkSpecificMixerWallets().catch(console.error); 