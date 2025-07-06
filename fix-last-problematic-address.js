import { MongoClient } from 'mongodb';

async function fixLastProblematicAddress() {
  console.log('🔧 Fixing LAST Problematic Address...\n');
  
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  let client;
  
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    
    const db = client.db();
    const collection = db.collection('pump_addresses');
    
    // Find the last problematic address
    const now = new Date();
    const oldThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const problematic = await collection.findOne({
      $or: [
        { isUsed: true, $or: [ { usedBy: null }, { usedBy: { $exists: false } } ] },
        { isUsed: true, usedAt: { $lt: oldThreshold } }
      ]
    });
    
    if (!problematic) {
      console.log('✅ No problematic addresses remain!');
      return;
    }
    
    console.log(`🔍 Found problematic address: ${problematic.publicKey} - isUsed: ${problematic.isUsed} - usedBy: ${problematic.usedBy} - usedAt: ${problematic.usedAt}`);
    
    // Release it back to the pool
    await collection.updateOne(
      { publicKey: problematic.publicKey },
      {
        $set: {
          isUsed: false,
          usedBy: null,
          usedAt: null,
        },
      }
    );
    
    console.log('✅ Problematic address released back to pool!');
    
    // Verify
    const stillProblematic = await collection.countDocuments({
      $or: [
        { isUsed: true, $or: [ { usedBy: null }, { usedBy: { $exists: false } } ] },
        { isUsed: true, usedAt: { $lt: oldThreshold } }
      ]
    });
    if (stillProblematic === 0) {
      console.log('✅ All problematic addresses have been fixed!');
    } else {
      console.log(`⚠️  ${stillProblematic} problematic addresses still remain`);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

fixLastProblematicAddress(); 