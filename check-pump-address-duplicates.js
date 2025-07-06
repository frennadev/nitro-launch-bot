import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

async function checkPumpAddressDuplicates() {
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
    
    // Check for duplicate public keys
    console.log('\n🔍 Checking for duplicate public keys...');
    const duplicates = await collection.aggregate([
      {
        $group: {
          _id: "$publicKey",
          count: { $sum: 1 },
          docs: { $push: "$$ROOT" }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]).toArray();
    
    if (duplicates.length > 0) {
      console.log(`❌ Found ${duplicates.length} duplicate public keys:`);
      duplicates.forEach(dup => {
        console.log(`\nPublic Key: ${dup._id}`);
        console.log(`Count: ${dup.count}`);
        dup.docs.forEach((doc, i) => {
          console.log(`  ${i + 1}. ID: ${doc._id}, UsedBy: ${doc.usedBy || 'null'}, IsUsed: ${doc.isUsed}, CreatedAt: ${doc.createdAt}`);
        });
      });
    } else {
      console.log('✅ No duplicate public keys found');
    }
    
    // Check for addresses with same public key but different secret keys
    console.log('\n🔍 Checking for public keys with different secret keys...');
    const samePublicKeyDifferentSecrets = await collection.aggregate([
      {
        $group: {
          _id: "$publicKey",
          secretKeys: { $addToSet: "$secretKey" },
          count: { $sum: 1 }
        }
      },
      {
        $match: {
          $expr: { $gt: [{ $size: "$secretKeys" }, 1] }
        }
      }
    ]).toArray();
    
    if (samePublicKeyDifferentSecrets.length > 0) {
      console.log(`❌ Found ${samePublicKeyDifferentSecrets.length} public keys with different secret keys:`);
      samePublicKeyDifferentSecrets.forEach(item => {
        console.log(`\nPublic Key: ${item._id}`);
        console.log(`Secret Keys: ${item.secretKeys.join(', ')}`);
      });
    } else {
      console.log('✅ No public keys with different secret keys found');
    }
    
    // Check allocation status
    console.log('\n📊 Checking allocation status...');
    const total = await collection.countDocuments({});
    const allocated = await collection.countDocuments({ 
      $or: [
        { usedBy: { $exists: true, $ne: null } },
        { usedBy: { $ne: "" } }
      ]
    });
    const unallocated = await collection.countDocuments({
      $or: [
        { usedBy: { $exists: false } },
        { usedBy: null },
        { usedBy: "" }
      ]
    });
    
    console.log(`Total addresses: ${total}`);
    console.log(`Allocated addresses: ${allocated}`);
    console.log(`Unallocated addresses: ${unallocated}`);
    console.log(`Sum check: ${allocated + unallocated} (should equal ${total})`);
    
    // Check for inconsistencies between isUsed and usedBy
    console.log('\n🔍 Checking for inconsistencies between isUsed and usedBy...');
    const inconsistent = await collection.find({
      $or: [
        { isUsed: true, usedBy: { $exists: false } },
        { isUsed: true, usedBy: null },
        { isUsed: true, usedBy: "" },
        { isUsed: false, usedBy: { $exists: true, $ne: null } },
        { isUsed: false, usedBy: { $ne: "" } }
      ]
    }).limit(10).toArray();
    
    if (inconsistent.length > 0) {
      console.log(`❌ Found ${inconsistent.length} addresses with inconsistent isUsed/usedBy fields:`);
      inconsistent.forEach(addr => {
        console.log(`  Public Key: ${addr.publicKey}, IsUsed: ${addr.isUsed}, UsedBy: ${addr.usedBy || 'null'}`);
      });
    } else {
      console.log('✅ No inconsistencies found between isUsed and usedBy fields');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

checkPumpAddressDuplicates(); 