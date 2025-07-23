import { MongoClient } from 'mongodb';
import { Connection, PublicKey } from '@solana/web3.js';

async function recoverStuckSol() {
  console.log('🔍 Checking for stuck SOL in specific mixer wallets...\n');
  
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
    
    // The specific wallets that received funds during the failed operation
    const targetWallets = [
      'PbHRCv4j...JSHazB4r', // Received 0.613770 SOL
      '5FsGFoSf...mmcFbpUs'  // Received 0.499000 SOL
    ];
    
    console.log('🔍 Looking for the specific wallets that received funds...');
    
    // Find the full addresses by searching for wallets with recent receive transactions
    const recentReceiveWallets = await walletsCollection.find({
      "transactionHistory": {
        $elemMatch: {
          type: "receive",
          timestamp: {
            $gte: new Date('2025-07-23T21:45:00.000Z'),
            $lte: new Date('2025-07-23T21:46:00.000Z')
          }
        }
      },
      isActive: true
    }).toArray();
    
    console.log(`📊 Found ${recentReceiveWallets.length} wallets with recent receive transactions`);
    
    if (recentReceiveWallets.length > 0) {
      console.log('\n💰 Checking current balances of these wallets...');
      
      const connection = new Connection(
        process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
        'confirmed'
      );
      
      let totalStuckSol = 0;
      const walletsWithFunds = [];
      
      for (const wallet of recentReceiveWallets) {
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
              privateKey: wallet.privateKey // Encrypted private key
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
        console.log('\n🔧 Recovery Information:');
        console.log('These wallets have SOL that can be recovered:');
        
        walletsWithFunds.forEach((wallet, i) => {
          console.log(`\n${i + 1}. Wallet: ${wallet.publicKey}`);
          console.log(`   Balance: ${wallet.balance.toFixed(6)} SOL`);
          console.log(`   Status: ${wallet.status}`);
          console.log(`   Usage Count: ${wallet.usageCount}`);
          console.log(`   Last Used: ${wallet.lastUsed ? new Date(wallet.lastUsed).toLocaleString() : 'Unknown'}`);
          console.log(`   Private Key: ${wallet.privateKey} (encrypted)`);
        });
        
        console.log('\n🔧 Recovery Options:');
        console.log('1. Use the mixer recovery function (recommended)');
        console.log('2. Manually decrypt the private keys and transfer funds');
        console.log('3. Use the bot\'s recovery feature if available');
        
        console.log('\n⚠️  Note: The private keys are encrypted. You\'ll need to decrypt them first.');
        console.log('The mixer should have a recovery function that can handle this automatically.');
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
recoverStuckSol().catch(console.error); 