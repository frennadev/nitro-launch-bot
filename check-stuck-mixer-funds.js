import { MongoClient } from 'mongodb';
import { Connection, PublicKey } from '@solana/web3.js';

async function checkStuckMixerFunds() {
  console.log('🔍 Checking for stuck SOL in mixer intermediate wallets...\n');
  
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
    
    // Check for wallets that are currently "in_use" (might be stuck from failed operation)
    console.log('\n🔍 Checking for wallets with "in_use" status...');
    const inUseWallets = await walletsCollection.find({ 
      status: "in_use",
      isActive: true
    }).toArray();
    
    console.log(`📊 Found ${inUseWallets.length} wallets with "in_use" status`);
    
    if (inUseWallets.length > 0) {
      console.log('\n💰 Checking balances of in-use wallets...');
      
      const connection = new Connection(
        process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
        'confirmed'
      );
      
      let totalStuckSol = 0;
      const walletsWithFunds = [];
      
      for (const wallet of inUseWallets) {
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
              usageCount: wallet.usageCount
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
          console.log(`${i + 1}. ${wallet.publicKey} - ${wallet.balance.toFixed(6)} SOL`);
        });
      }
    }
    
    // Also check for wallets with recent transaction history
    console.log('\n🔍 Checking for wallets with recent transaction history...');
    const recentWallets = await walletsCollection.find({
      "transactionHistory.0": { $exists: true },
      isActive: true
    }).sort({ lastUsed: -1 }).limit(20).toArray();
    
    console.log(`📊 Found ${recentWallets.length} wallets with transaction history`);
    
    if (recentWallets.length > 0) {
      console.log('\n📋 Recent wallet activity:');
      recentWallets.slice(0, 10).forEach((wallet, i) => {
        const lastUsed = wallet.lastUsed ? new Date(wallet.lastUsed).toLocaleString() : 'Unknown';
        console.log(`${i + 1}. ${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-8)} - Last used: ${lastUsed}`);
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
checkStuckMixerFunds().catch(console.error); 