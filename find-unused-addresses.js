import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

async function findUnusedAddresses() {
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
    const total = await collection.countDocuments();
    const unusedCount = await collection.countDocuments({ used: { $ne: true } });
    const unused = await collection.find({ used: { $ne: true } }).limit(10).toArray();
    console.log(`Total addresses in DB: ${total}`);
    console.log(`Addresses not marked as used: ${unusedCount}`);
    console.log('Sample of unused addresses:', unused.map(x => x.address));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

findUnusedAddresses(); 