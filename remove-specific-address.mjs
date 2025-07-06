import { MongoClient } from 'mongodb';

const MONGODB_URI = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
const DATABASE_NAME = 'pump_addresses';
const COLLECTION_NAME = 'pump_addresses';

const PROBLEMATIC_ADDRESS = 'YSseuXX93i7kHVuSGnPviCKDdY6tHeW9yJPJnFnpUmP';

async function removeSpecificAddress() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    console.log('🔌 Connecting to external MongoDB...');
    await client.connect();
    
    const db = client.db();
    const collection = db.collection(COLLECTION_NAME);
    
    console.log(`🔍 Looking for address: ${PROBLEMATIC_ADDRESS}`);
    
    // Check if the address exists
    const existingAddress = await collection.findOne({ publicKey: PROBLEMATIC_ADDRESS });
    
    if (!existingAddress) {
      console.log('❌ Address not found in database');
      return;
    }
    
    console.log('📋 Found address details:');
    console.log(`   Address: ${existingAddress.publicKey}`);
    console.log(`   isUsed: ${existingAddress.isUsed}`);
    console.log(`   usedBy: ${existingAddress.usedBy || 'N/A'}`);
    console.log(`   usedAt: ${existingAddress.usedAt || 'N/A'}`);
    console.log(`   createdAt: ${existingAddress.createdAt || 'N/A'}`);
    
    // Remove the address
    console.log('🗑️ Removing address from database...');
    const result = await collection.deleteOne({ publicKey: PROBLEMATIC_ADDRESS });
    
    if (result.deletedCount > 0) {
      console.log('✅ Address successfully removed from database');
    } else {
      console.log('❌ Failed to remove address');
    }
    
    // Verify removal
    const verifyAddress = await collection.findOne({ publicKey: PROBLEMATIC_ADDRESS });
    if (!verifyAddress) {
      console.log('✅ Verification: Address no longer exists in database');
    } else {
      console.log('❌ Verification failed: Address still exists');
    }
    
    // Show updated statistics
    const totalCount = await collection.countDocuments();
    const usedCount = await collection.countDocuments({ isUsed: true });
    const unusedCount = await collection.countDocuments({ 
      $or: [
        { isUsed: false },
        { isUsed: { $exists: false } },
        { isUsed: null }
      ]
    });
    
    console.log('\n📊 Updated Database Statistics:');
    console.log(`   Total addresses: ${totalCount}`);
    console.log(`   Used addresses: ${usedCount}`);
    console.log(`   Unused addresses: ${unusedCount}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('🔌 Database connection closed');
  }
}

removeSpecificAddress(); 