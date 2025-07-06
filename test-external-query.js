import { MongoClient } from 'mongodb';

async function testExternalQuery() {
  console.log('🔍 Testing External Database Query...\n');
  
  const mongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  const testUserId = "6844d87bbc12916bc8cedc3a";
  
  let client;
  
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    
    const db = client.db();
    const collection = db.collection('pump_addresses');
    
    console.log('📋 Testing query logic...\n');
    
    // Test the exact query from the service
    const query = { 
      $or: [
        { isUsed: false },
        { isUsed: { $exists: false } },
        { isUsed: null }
      ]
    };
    
    console.log('🔍 Query:', JSON.stringify(query, null, 2));
    
    // Get a sample of addresses that match this query
    const sampleAddresses = await collection.find(query).limit(5).toArray();
    
    console.log(`📊 Found ${sampleAddresses.length} addresses matching query:`);
    sampleAddresses.forEach((addr, index) => {
      console.log(`  ${index + 1}. ${addr.publicKey}`);
      console.log(`     isUsed: ${addr.isUsed}`);
      console.log(`     usedBy: ${addr.usedBy || 'null'}`);
      console.log(`     usedAt: ${addr.usedAt || 'null'}`);
      console.log('');
    });
    
    // Check if any of these are actually used
    const usedAddresses = sampleAddresses.filter(addr => addr.isUsed === true);
    if (usedAddresses.length > 0) {
      console.log('❌ PROBLEM FOUND: Query is returning used addresses!');
      usedAddresses.forEach(addr => {
        console.log(`  - ${addr.publicKey} is marked as used by ${addr.usedBy}`);
      });
    } else {
      console.log('✅ Query is working correctly - no used addresses returned');
    }
    
    // Test a simpler, more reliable query
    console.log('\n🔧 Testing improved query...');
    const improvedQuery = { isUsed: { $ne: true } };
    console.log('🔍 Improved Query:', JSON.stringify(improvedQuery, null, 2));
    
    const improvedSample = await collection.find(improvedQuery).limit(5).toArray();
    console.log(`📊 Found ${improvedSample.length} addresses with improved query:`);
    improvedSample.forEach((addr, index) => {
      console.log(`  ${index + 1}. ${addr.publicKey} - isUsed: ${addr.isUsed}`);
    });
    
    const improvedUsedAddresses = improvedSample.filter(addr => addr.isUsed === true);
    if (improvedUsedAddresses.length > 0) {
      console.log('❌ Improved query also has issues');
    } else {
      console.log('✅ Improved query works correctly');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

testExternalQuery(); 