import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

async function checkTokenStatus(tokenAddress) {
  const uri = process.env.EXTERNAL_MONGODB_URI;
  if (!uri) {
    console.log('EXTERNAL_MONGODB_URI not found in environment');
    return;
  }
  
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('Connected to external MongoDB');
    
    const db = client.db('pump_addresses');
    const collection = db.collection('addresses');
    
    const token = await collection.findOne({ 
      address: tokenAddress 
    });
    
    if (token) {
      console.log('\nToken found in database:');
      console.log('Address:', token.address);
      console.log('Used:', token.used);
      console.log('Used by:', token.usedBy || 'N/A');
      console.log('Used at:', token.usedAt || 'N/A');
      console.log('Created at:', token.createdAt);
      
      if (token.used) {
        console.log('\n⚠️  This token is marked as USED');
      } else {
        console.log('\n✅ This token is available');
      }
    } else {
      console.log('\n❌ Token not found in database');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

// Check the specific token
checkTokenStatus('HzWB5dfs7epj5QbNwrwzdfJpRpjb4PphQjZLaaK8PUMp'); 