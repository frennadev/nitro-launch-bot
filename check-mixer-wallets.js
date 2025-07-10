import { MongoClient } from 'mongodb';

async function checkMixerWallets() {
  console.log('🔍 Checking Mixer Wallet Pool...\n');
  
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  
  let client;
  
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    // Check different possible database names
    const possibleDatabases = ['test', 'nitro-launch', 'nitro_launch'];
    
    for (const dbName of possibleDatabases) {
      console.log(`\n🔍 Checking database: ${dbName}`);
      
      const db = client.db(dbName);
      const collection = db.collection('mixer_wallets'); // Mixer uses 'mixer_wallets' collection
      
      // Get total counts
      const total = await collection.countDocuments({});
      const available = await collection.countDocuments({ 
        isActive: true,
        status: "available"
      });
      const inUse = await collection.countDocuments({ 
        isActive: true,
        status: "in_use"
      });
      const depleted = await collection.countDocuments({ 
        isActive: true,
        status: "depleted"
      });
      const error = await collection.countDocuments({ 
        isActive: true,
        status: "error"
      });
      
      console.log(`📊 ${dbName} Mixer Wallet Pool Statistics:`);
      console.log(`   Total wallets: ${total}`);
      console.log(`   Available: ${available}`);
      console.log(`   In use: ${inUse}`);
      console.log(`   Depleted: ${depleted}`);
      console.log(`   Error: ${error}`);
      
      if (total > 0) {
        console.log(`   Usage percentage: ${Math.round(((total - available) / total) * 100)}%`);
        
        // Check some available wallets
        const sampleWallets = await collection.find({ 
          isActive: true,
          status: "available"
        }).limit(3).toArray();
        
        if (sampleWallets.length > 0) {
          console.log(`🔍 Sample of Available Mixer Wallets in ${dbName}:`);
          sampleWallets.forEach((wallet, index) => {
            console.log(`   ${index + 1}. ${wallet.publicKey}`);
            console.log(`      Status: ${wallet.status}`);
            console.log(`      Balance: ${wallet.balance || 0} lamports`);
            console.log(`      Usage count: ${wallet.usageCount || 0}`);
          });
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (client) {
      await client.close();
      console.log('\n🔌 Database connection closed');
    }
    process.exit(0);
  }
}

checkMixerWallets(); 