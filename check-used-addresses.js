import { MongoClient } from 'mongodb';

async function checkUsedAddresses() {
  console.log('🔍 Checking Used Addresses in External Database...\n');
  
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  
  let client;
  
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    
    const db = client.db();
    const collection = db.collection('pump_addresses');
    
    // Get total counts
    const total = await collection.countDocuments({});
    const used = await collection.countDocuments({ isUsed: true });
    const unused = await collection.countDocuments({ 
      $or: [
        { isUsed: false },
        { isUsed: { $exists: false } },
        { isUsed: null }
      ]
    });
    
    console.log('📊 Database Statistics:');
    console.log(`   Total addresses: ${total}`);
    console.log(`   Used addresses: ${used}`);
    console.log(`   Unused addresses: ${unused}`);
    console.log('');
    
    // Check some used addresses
    const usedAddresses = await collection.find({ isUsed: true }).limit(10).toArray();
    
    console.log('🔍 Sample of Used Addresses:');
    usedAddresses.forEach((addr, index) => {
      console.log(`   ${index + 1}. ${addr.publicKey}`);
      console.log(`      isUsed: ${addr.isUsed}`);
      console.log(`      usedBy: ${addr.usedBy || 'null'}`);
      console.log(`      usedAt: ${addr.usedAt || 'null'}`);
      console.log('');
    });
    
    // Check if any used addresses have null usedBy (this would be problematic)
    const problematicAddresses = await collection.find({ 
      isUsed: true, 
      $or: [
        { usedBy: null },
        { usedBy: { $exists: false } }
      ]
    }).limit(5).toArray();
    
    if (problematicAddresses.length > 0) {
      console.log('⚠️  PROBLEMATIC ADDRESSES FOUND (used but no user):');
      problematicAddresses.forEach((addr, index) => {
        console.log(`   ${index + 1}. ${addr.publicKey} - usedAt: ${addr.usedAt}`);
      });
      console.log('');
    } else {
      console.log('✅ All used addresses have valid user assignments');
    }
    
    // Check for addresses that might be stuck
    const oldUsedAddresses = await collection.find({
      isUsed: true,
      usedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Older than 24 hours
    }).limit(5).toArray();
    
    if (oldUsedAddresses.length > 0) {
      console.log('⏰ OLD USED ADDRESSES (older than 24 hours):');
      oldUsedAddresses.forEach((addr, index) => {
        console.log(`   ${index + 1}. ${addr.publicKey}`);
        console.log(`      usedBy: ${addr.usedBy}`);
        console.log(`      usedAt: ${addr.usedAt}`);
      });
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

checkUsedAddresses(); 