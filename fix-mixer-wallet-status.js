import { MongoClient } from 'mongodb';

async function fixMixerWalletStatus() {
  console.log('🔧 Fixing Mixer Wallet Status...\n');
  
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  
  let client;
  
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db('test');
    const collection = db.collection('mixer_wallets');
    
    // Get current stats before fix
    const statsBefore = await collection.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]).toArray();
    
    console.log('📊 Before fix:');
    statsBefore.forEach(stat => {
      console.log(`   ${stat._id || 'null'}: ${stat.count}`);
    });
    
    // Reset depleted wallets to available
    const result = await collection.updateMany(
      {
        status: "depleted",
        balance: 0,
        lastUsed: { $lt: new Date(Date.now() - 5 * 60 * 1000) } // Not used in last 5 minutes
      },
      {
        $set: {
          status: "available",
          balance: 0,
          usageCount: 0
        }
      }
    );
    
    console.log(`\n🔄 Reset ${result.modifiedCount} depleted wallets to available`);
    
    // Get stats after fix
    const statsAfter = await collection.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]).toArray();
    
    console.log('\n📊 After fix:');
    statsAfter.forEach(stat => {
      console.log(`   ${stat._id || 'null'}: ${stat.count}`);
    });
    
    // Calculate improvement
    const availableBefore = statsBefore.find(s => s._id === 'available')?.count || 0;
    const availableAfter = statsAfter.find(s => s._id === 'available')?.count || 0;
    const improvement = availableAfter - availableBefore;
    
    console.log(`\n✅ Improvement: +${improvement} available wallets`);
    console.log(`   Available wallets: ${availableBefore} → ${availableAfter}`);
    
    if (improvement > 0) {
      console.log(`\n🎉 Success! Mixer wallet pool now has ${availableAfter} available wallets`);
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

fixMixerWalletStatus(); 