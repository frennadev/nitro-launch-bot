import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

async function searchUsedByUser(userId) {
  const uri = process.env.EXTERNAL_MONGODB_URI;
  if (!uri) {
    console.log('EXTERNAL_MONGODB_URI not found in environment');
    return;
  }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('test'); // Use test database
    const collection = db.collection('pump_addresses');
    
    // Find all addresses where usedBy equals this user ID
    const addresses = await collection.find({ usedBy: userId }).toArray();
    
    if (addresses.length === 0) {
      console.log(`No addresses found with usedBy = '${userId}' in test.pump_addresses.`);
      return;
    }
    
    console.log(`Found ${addresses.length} addresses with usedBy = '${userId}':`);
    addresses.forEach(addr => {
      console.log(`Address: ${addr.address}, Used: ${addr.used}, Used at: ${addr.usedAt || 'N/A'}`);
    });
    
    // Mark all as used
    const result = await collection.updateMany(
      { usedBy: userId },
      { $set: { used: true } }
    );
    console.log(`\nMarked ${result.modifiedCount} addresses as used for user '${userId}'.`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

searchUsedByUser('6844d87bbc12916bc8cedc3a'); 