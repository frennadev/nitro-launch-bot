import { MongoClient } from 'mongodb';

async function testAllocationRace() {
  console.log('🔍 Testing Address Allocation Race Condition...\n');
  
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  const testUserId = "6844d87bbc12916bc8cedc3a";
  
  let client;
  
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    
    const db = client.db();
    const collection = db.collection('pump_addresses');
    
    console.log('📋 Testing allocation process...\n');
    
    // Step 1: Find an unused address
    const query = { 
      $or: [
        { isUsed: false },
        { isUsed: { $exists: false } },
        { isUsed: null }
      ]
    };
    
    const unusedAddress = await collection.findOne(query);
    if (!unusedAddress) {
      console.log('❌ No unused addresses found');
      return;
    }
    
    console.log(`🔍 Found unused address: ${unusedAddress.publicKey}`);
    console.log(`   isUsed: ${unusedAddress.isUsed}`);
    console.log(`   usedBy: ${unusedAddress.usedBy || 'null'}`);
    console.log('');
    
    // Step 2: Simulate the allocation (findOneAndUpdate)
    console.log('🔄 Simulating allocation...');
    const result = await collection.findOneAndUpdate(
      { publicKey: unusedAddress.publicKey },
      {
        $set: {
          isUsed: true,
          usedBy: testUserId,
          usedAt: new Date(),
        },
      },
      {
        returnDocument: 'after'
      }
    );
    
    console.log(`✅ Allocation result:`);
    console.log(`   publicKey: ${result.publicKey}`);
    console.log(`   isUsed: ${result.isUsed}`);
    console.log(`   usedBy: ${result.usedBy}`);
    console.log(`   usedAt: ${result.usedAt}`);
    console.log('');
    
    // Step 3: Check if the address is now marked as used
    const checkAddress = await collection.findOne({ publicKey: unusedAddress.publicKey });
    console.log(`🔍 Verification check:`);
    console.log(`   publicKey: ${checkAddress.publicKey}`);
    console.log(`   isUsed: ${checkAddress.isUsed}`);
    console.log(`   usedBy: ${checkAddress.usedBy}`);
    console.log('');
    
    // Step 4: Release the address back
    console.log('🔄 Releasing address back to pool...');
    await collection.findOneAndUpdate(
      { publicKey: unusedAddress.publicKey },
      {
        $set: {
          isUsed: false,
          usedBy: null,
          usedAt: null,
        },
      }
    );
    
    console.log('✅ Address released back to pool');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

testAllocationRace(); 