import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

async function markUserAddressesUsed(userIdOrName) {
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
    // Find all addresses used by this user
    const addresses = await collection.find({ usedBy: userIdOrName }).toArray();
    if (addresses.length === 0) {
      console.log(`No addresses found for user '${userIdOrName}'.`);
      return;
    }
    // Mark all as used
    const result = await collection.updateMany(
      { usedBy: userIdOrName },
      { $set: { used: true } }
    );
    console.log(`Marked ${result.modifiedCount} addresses as used for user '${userIdOrName}'.`);
    // List the addresses
    addresses.forEach(addr => console.log(addr.address));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

markUserAddressesUsed('frennadev'); 