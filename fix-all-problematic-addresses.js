import { MongoClient } from 'mongodb';

async function fixAllProblematicAddresses() {
  console.log('🔧 Fixing ALL Problematic Addresses...\n');
  
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  const knownProblematic = [
    "FpRGkmWtwPKrLH7cWV6LFvuFVCCX6KSKy7zuA7sRPUmp"
  ];
  
  let client;
  
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    
    const db = client.db();
    const collection = db.collection('pump_addresses');
    
    // Find all problematic addresses:
    // 1. Marked as used but no user
    // 2. Marked as used but usedAt is older than 24h
    // 3. Known problematic list
    const now = new Date();
    const oldThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const problematicAddresses = await collection.find({
      $or: [
        { isUsed: true, $or: [ { usedBy: null }, { usedBy: { $exists: false } } ] },
        { isUsed: true, usedAt: { $lt: oldThreshold } },
        { publicKey: { $in: knownProblematic } }
      ]
    }).toArray();
    
    console.log(`🔍 Found ${problematicAddresses.length} problematic addresses:`);
    problematicAddresses.forEach((addr, index) => {
      console.log(`   ${index + 1}. ${addr.publicKey} - isUsed: ${addr.isUsed} - usedBy: ${addr.usedBy} - usedAt: ${addr.usedAt}`);
    });
    console.log('');
    
    if (problematicAddresses.length > 0) {
      const publicKeys = problematicAddresses.map(addr => addr.publicKey);
      console.log('🔄 Releasing all problematic addresses back to pool...');
      const result = await collection.updateMany(
        { publicKey: { $in: publicKeys } },
        {
          $set: {
            isUsed: false,
            usedBy: null,
            usedAt: null,
          },
        }
      );
      console.log(`✅ Fixed ${result.modifiedCount} problematic addresses`);
      console.log('');
    }
    
    // Verify the fix
    const remainingProblematic = await collection.countDocuments({
      $or: [
        { isUsed: true, $or: [ { usedBy: null }, { usedBy: { $exists: false } } ] },
        { isUsed: true, usedAt: { $lt: oldThreshold } },
        { publicKey: { $in: knownProblematic } }
      ]
    });
    if (remainingProblematic === 0) {
      console.log('✅ All problematic addresses have been fixed!');
    } else {
      console.log(`⚠️  ${remainingProblematic} problematic addresses still remain`);
    }
    
    // Show updated statistics
    const total = await collection.countDocuments({});
    const used = await collection.countDocuments({ isUsed: true });
    const unused = await collection.countDocuments({
      $or: [
        { isUsed: false },
        { isUsed: { $exists: false } },
        { isUsed: null }
      ]
    });
    
    console.log('\n📊 Updated Database Statistics:');
    console.log(`   Total addresses: ${total}`);
    console.log(`   Used addresses: ${used}`);
    console.log(`   Unused addresses: ${unused}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

fixAllProblematicAddresses(); 