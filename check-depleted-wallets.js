import { MongoClient } from 'mongodb';

async function checkDepletedWallets() {
  console.log('🔍 Investigating Depleted Wallets...\n');
  
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  
  let client;
  
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db('test');
    const collection = db.collection('mixer_wallets');
    
    // Get detailed breakdown of depleted wallets
    const depletedWallets = await collection.find({ 
      status: "depleted"
    }).limit(10).toArray();
    
    console.log(`📊 Found ${depletedWallets.length} depleted wallets (showing first 10):`);
    
    depletedWallets.forEach((wallet, index) => {
      console.log(`\n${index + 1}. ${wallet.publicKey}`);
      console.log(`   Status: ${wallet.status}`);
      console.log(`   Balance: ${wallet.balance || 0} lamports (${((wallet.balance || 0) / 1e9).toFixed(6)} SOL)`);
      console.log(`   Usage count: ${wallet.usageCount || 0}`);
      console.log(`   isActive: ${wallet.isActive}`);
      console.log(`   Last used: ${wallet.lastUsed || 'Never'}`);
      console.log(`   Created: ${wallet.createdAt}`);
      
      // Check transaction history
      if (wallet.transactionHistory && wallet.transactionHistory.length > 0) {
        console.log(`   Transaction count: ${wallet.transactionHistory.length}`);
        const lastTx = wallet.transactionHistory[wallet.transactionHistory.length - 1];
        console.log(`   Last transaction: ${lastTx.type} - ${lastTx.amount} lamports at ${lastTx.timestamp}`);
      }
    });
    
    // Check if depleted wallets have balance
    const depletedWithBalance = await collection.countDocuments({
      status: "depleted",
      balance: { $gt: 0 }
    });
    
    const depletedZeroBalance = await collection.countDocuments({
      status: "depleted",
      balance: { $lte: 0 }
    });
    
    console.log(`\n📊 Depleted Wallet Analysis:`);
    console.log(`   Total depleted: 523`);
    console.log(`   With balance > 0: ${depletedWithBalance}`);
    console.log(`   With zero balance: ${depletedZeroBalance}`);
    
    // Check if depleted wallets are actually in use
    const depletedInUse = await collection.countDocuments({
      status: "depleted",
      lastUsed: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Used in last 5 minutes
    });
    
    console.log(`   Recently used (last 5 min): ${depletedInUse}`);
    
    // Check if we should reset depleted wallets to available
    const shouldReset = await collection.countDocuments({
      status: "depleted",
      $or: [
        { balance: { $gt: 0 } },
        { lastUsed: { $lt: new Date(Date.now() - 10 * 60 * 1000) } } // Not used in last 10 minutes
      ]
    });
    
    console.log(`\n🔄 Wallets that should be reset to available: ${shouldReset}`);
    
    if (shouldReset > 0) {
      console.log(`\n💡 Recommendation: Reset ${shouldReset} depleted wallets to available status`);
      console.log(`   This would increase available wallets from 389 to ${389 + shouldReset}`);
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

checkDepletedWallets(); 