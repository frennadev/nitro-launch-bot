import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

async function checkUserField() {
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
    // Find all addresses where user field contains 'frenna'
    const addresses = await collection.find({ user: { $regex: /frenna/i } }).toArray();
    if (addresses.length === 0) {
      console.log("No addresses found with user field containing 'frenna'.");
      return;
    }
    console.log(`Found ${addresses.length} addresses with user field containing 'frenna':`);
    addresses.forEach(addr => {
      console.log(`Address: ${addr.address}, User: ${addr.user}, Used: ${addr.used}`);
    });
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkUserField(); 