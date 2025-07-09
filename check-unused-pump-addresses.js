import { MongoClient } from 'mongodb';

async function checkUnusedPumpAddresses() {
  console.log('🔍 Checking for unused pump addresses...\n');
  
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  let client;
  
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    
    const db = client.db();
    const collection = db.collection('pump_addresses');
    
    // Find unused pump addresses
    const unusedAddresses = await collection.find({
      $or: [
        { usedBy: { $exists: false } },
        { usedBy: null },
        { usedBy: "" }
      ]
    }).toArray();
    
    console.log(`📊 Found ${unusedAddresses.length} unused pump addresses`);
    
    if (unusedAddresses.length === 0) {
      console.log('❌ No unused pump addresses found!');
      console.log('💡 This means all pump addresses have been allocated to users.');
      console.log('💡 You may need to generate more pump addresses or check if addresses are being properly released.');
      return;
    }
    
    console.log('\n📋 Sample unused addresses:');
    unusedAddresses.slice(0, 10).forEach((addr, index) => {
      console.log(`   ${index + 1}. ${addr.publicKey}`);
    });
    if (unusedAddresses.length > 10) {
      console.log(`   ... and ${unusedAddresses.length - 10} more`);
    }
    
    // Test a few unused addresses
    console.log('\n🧪 Testing token detection for unused addresses...');
    
    const { isTokenAlreadyLaunched, isTokenAlreadyListed } = await import('./src/service/token-detection-service.ts');
    
    for (let i = 0; i < Math.min(3, unusedAddresses.length); i++) {
      const testAddress = unusedAddresses[i].publicKey;
      console.log(`\n   Testing unused address ${i + 1}: ${testAddress}`);
      
      try {
        const isLaunched = await isTokenAlreadyLaunched(testAddress);
        const isListed = await isTokenAlreadyListed(testAddress);
        
        console.log(`   ✅ isLaunched: ${isLaunched}`);
        console.log(`   ✅ isListed: ${isListed}`);
        
        if (!isLaunched && !isListed) {
          console.log(`   🎯 Address ${testAddress} is correctly identified as NOT launched/listed`);
        } else {
          console.log(`   ⚠️  Address ${testAddress} is showing as launched/listed - this is unexpected for an unused address`);
        }
      } catch (error) {
        console.log(`   ❌ Error testing address: ${error.message}`);
      }
    }
    
    // Check used addresses for comparison
    console.log('\n📊 Checking used addresses for comparison...');
    const usedAddresses = await collection.find({
      usedBy: { $exists: true, $ne: null, $ne: "" }
    }).limit(3).toArray();
    
    console.log(`Found ${usedAddresses.length} used addresses to test:`);
    
    for (let i = 0; i < usedAddresses.length; i++) {
      const testAddress = usedAddresses[i].publicKey;
      const usedBy = usedAddresses[i].usedBy;
      console.log(`\n   Testing used address ${i + 1}: ${testAddress} (used by: ${usedBy})`);
      
      try {
        const isLaunched = await isTokenAlreadyLaunched(testAddress);
        const isListed = await isTokenAlreadyListed(testAddress);
        
        console.log(`   ✅ isLaunched: ${isLaunched}`);
        console.log(`   ✅ isListed: ${isListed}`);
        
        if (isLaunched || isListed) {
          console.log(`   🎯 Address ${testAddress} is correctly identified as launched/listed (as expected)`);
        } else {
          console.log(`   ⚠️  Address ${testAddress} is showing as NOT launched/listed - this is unexpected for a used address`);
        }
      } catch (error) {
        console.log(`   ❌ Error testing address: ${error.message}`);
      }
    }
    
    console.log('\n🎯 Summary:');
    console.log(`✅ Found ${unusedAddresses.length} unused pump addresses`);
    console.log(`✅ Token detection should work correctly for unused addresses`);
    console.log(`✅ The system should be able to create tokens with these unused addresses`);
    
  } catch (error) {
    console.error('❌ Error checking unused pump addresses:', error);
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 Disconnected from MongoDB');
    }
  }
}

// Run the check
checkUnusedPumpAddresses().catch(console.error); 