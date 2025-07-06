import { MongoClient } from 'mongodb';

async function fixProblematicAddresses() {
  console.log('🔧 Fixing Problematic Addresses...\n');
  
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  
  let client;
  
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    
    const db = client.db();
    const collection = db.collection('pump_addresses');
    
    // Find addresses that are marked as used but have no user
    const problematicAddresses = await collection.find({ 
      isUsed: true, 
      $or: [
        { usedBy: null },
        { usedBy: { $exists: false } }
      ]
    }).toArray();
    
    console.log(`🔍 Found ${problematicAddresses.length} problematic addresses:`);
    problematicAddresses.forEach((addr, index) => {
      console.log(`   ${index + 1}. ${addr.publicKey} - usedAt: ${addr.usedAt}`);
    });
    console.log('');
    
    if (problematicAddresses.length > 0) {
      console.log('🔄 Fixing problematic addresses...');
      
      // Release these addresses back to the pool
      const result = await collection.updateMany(
        { 
          isUsed: true, 
          $or: [
            { usedBy: null },
            { usedBy: { $exists: false } }
          ]
        },
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
      isUsed: true, 
      $or: [
        { usedBy: null },
        { usedBy: { $exists: false } }
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

fixProblematicAddresses(); 