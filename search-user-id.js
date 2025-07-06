import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

async function searchUserId(userId) {
  const uri = process.env.EXTERNAL_MONGODB_URI;
  if (!uri) {
    console.log('EXTERNAL_MONGODB_URI not found in environment');
    return;
  }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('pump_addresses');
    const collection = db.collection('addresses');
    // Find all addresses for this user ID
    const addresses = await collection.find({ user: userId }).toArray();
    if (addresses.length === 0) {
      console.log(`No addresses found for user ID '${userId}'.`);
      return;
    }
    console.log(`Found ${addresses.length} addresses for user ID '${userId}':`);
    addresses.forEach(addr => {
      console.log(`Address: ${addr.address}, Used: ${addr.used}, Used by: ${addr.usedBy || 'N/A'}, Used at: ${addr.usedAt || 'N/A'}`);
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

searchUserId('6844d87bbc12916bc8cedc3a'); 