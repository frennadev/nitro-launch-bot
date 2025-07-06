import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.EXTERNAL_MONGODB_URI || 'mongodb://localhost:27017';
const DATABASE_NAME = process.env.EXTERNAL_DATABASE_NAME || 'pump_addresses';
const COLLECTION_NAME = process.env.EXTERNAL_COLLECTION_NAME || 'pump_addresses';

const PROBLEMATIC_ADDRESS = 'YSseuXX93i7kHVuSGnPviCKDdY6tHeW9yJPJnFnpUmP';

async function removeSpecificAddress() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    console.log('🔌 Connecting to external MongoDB...');
    await client.connect();
    
    const db = client.db(DATABASE_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    console.log(`🔍 Looking for address: ${PROBLEMATIC_ADDRESS}`);
    
    // Check if the address exists
    const existingAddress = await collection.findOne({ address: PROBLEMATIC_ADDRESS });
    
    if (!existingAddress) {
      console.log('❌ Address not found in database');
      return;
    }
    
    console.log('📋 Found address details:');
    console.log(`   Address: ${existingAddress.address}`);
    console.log(`   isUsed: ${existingAddress.isUsed}`);
    console.log(`   usedBy: ${existingAddress.usedBy || 'N/A'}`);
    console.log(`   usedAt: ${existingAddress.usedAt || 'N/A'}`);
    console.log(`   createdAt: ${existingAddress.createdAt || 'N/A'}`);
    
    // Remove the address
    console.log('🗑️ Removing address from database...');
    const result = await collection.deleteOne({ address: PROBLEMATIC_ADDRESS });
    
    if (result.deletedCount > 0) {
      console.log('✅ Address successfully removed from database');
    } else {
      console.log('❌ Failed to remove address');
    }
    
    // Verify removal
    const verifyAddress = await collection.findOne({ address: PROBLEMATIC_ADDRESS });
    if (!verifyAddress) {
      console.log('✅ Verification: Address no longer exists in database');
    } else {
      console.log('❌ Verification failed: Address still exists');
    }
    
    // Show updated statistics
    const totalCount = await collection.countDocuments();
    const usedCount = await collection.countDocuments({ isUsed: true });
    const unusedCount = await collection.countDocuments({ isUsed: false });
    
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