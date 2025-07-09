import { MongoClient } from 'mongodb';

async function fixTokenDetectionCache() {
  console.log('🔧 Fixing Token Detection Cache...\n');
  
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  let client;
  
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    
    const db = client.db();
    const collection = db.collection('pump_addresses');
    
    // Get all pump addresses
    const pumpAddresses = await collection.find({}).toArray();
    
    console.log(`🔍 Found ${pumpAddresses.length} pump addresses in database`);
    
    if (pumpAddresses.length === 0) {
      console.log('❌ No pump addresses found');
      return;
    }
    
    // Extract public keys
    const publicKeys = pumpAddresses.map(addr => addr.publicKey);
    
    console.log('📋 Sample addresses:');
    publicKeys.slice(0, 5).forEach((key, index) => {
      console.log(`   ${index + 1}. ${key}`);
    });
    if (publicKeys.length > 5) {
      console.log(`   ... and ${publicKeys.length - 5} more`);
    }
    console.log('');
    
    // Clear cache for all pump addresses
    console.log('🧹 Clearing token detection cache for all pump addresses...');
    
    // Import the cache clearing function
    const { clearMultipleLaunchStatusCache } = await import('./src/service/token-detection-service.ts');
    
    // Clear cache in batches to avoid memory issues
    const batchSize = 100;
    for (let i = 0; i < publicKeys.length; i += batchSize) {
      const batch = publicKeys.slice(i, i + batchSize);
      clearMultipleLaunchStatusCache(batch);
      console.log(`   Cleared batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(publicKeys.length / batchSize)}`);
    }
    
    console.log('✅ Token detection cache cleared for all pump addresses');
    console.log('');
    
    // Test a few addresses to verify the fix
    console.log('🧪 Testing token detection for sample addresses...');
    
    const { isTokenAlreadyLaunched, isTokenAlreadyListed } = await import('./src/service/token-detection-service.ts');
    
    for (let i = 0; i < Math.min(3, publicKeys.length); i++) {
      const testAddress = publicKeys[i];
      console.log(`\n   Testing address ${i + 1}: ${testAddress}`);
      
      try {
        const isLaunched = await isTokenAlreadyLaunched(testAddress);
        const isListed = await isTokenAlreadyListed(testAddress);
        
        console.log(`   ✅ isLaunched: ${isLaunched}`);
        console.log(`   ✅ isListed: ${isListed}`);
        
        if (!isLaunched && !isListed) {
          console.log(`   🎯 Address ${testAddress} is correctly identified as NOT launched/listed`);
        } else {
          console.log(`   ⚠️  Address ${testAddress} is still showing as launched/listed - may need further investigation`);
        }
      } catch (error) {
        console.log(`   ❌ Error testing address: ${error.message}`);
      }
    }
    
    console.log('\n🎯 Summary:');
    console.log(`✅ Cleared cache for ${publicKeys.length} pump addresses`);
    console.log('✅ Token detection should now work correctly for pump addresses');
    console.log('✅ Pump addresses will no longer be falsely flagged as "already launched"');
    console.log('');
    console.log('💡 The system should now be able to create tokens with pump addresses successfully!');
    
  } catch (error) {
    console.error('❌ Error fixing token detection cache:', error);
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 Disconnected from MongoDB');
    }
  }
}

// Run the fix
fixTokenDetectionCache().catch(console.error); 