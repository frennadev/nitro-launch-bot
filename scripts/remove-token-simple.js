const { MongoClient } = require('mongodb');

// You'll need to replace this with your actual MongoDB URI
const MONGODB_URI = process.env.MONGODB_URI || 'your_mongodb_uri_here';
const FAILED_TOKEN_ADDRESS = "4PsSzzPA4NkrbCstre2YBpHAxJBntD1eKTwi6PmXpump";

async function removeFailedToken() {
  let client;
  
  try {
    console.log("🔌 Connecting to MongoDB...");
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db();
    
    // Find and remove the token
    console.log(`🔍 Looking for token with address: ${FAILED_TOKEN_ADDRESS}`);
    
    const tokensCollection = db.collection('tokens');
    const deletedToken = await tokensCollection.findOneAndDelete({
      tokenAddress: FAILED_TOKEN_ADDRESS
    });

    if (deletedToken.value) {
      console.log("✅ Successfully deleted token from database:");
      console.log(`   - Name: ${deletedToken.value.name}`);
      console.log(`   - Symbol: ${deletedToken.value.symbol}`);
      console.log(`   - Address: ${deletedToken.value.tokenAddress}`);
    } else {
      console.log("⚠️  Token not found in database");
    }

    // Mark the pump address as used to prevent reuse
    console.log(`🔒 Marking pump address as used: ${FAILED_TOKEN_ADDRESS}`);
    
    const pumpAddressesCollection = db.collection('pumpaddresses');
    const updatedAddress = await pumpAddressesCollection.findOneAndUpdate(
      { publicKey: FAILED_TOKEN_ADDRESS },
      { 
        $set: {
          isUsed: true,
          usedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (updatedAddress.value) {
      console.log("✅ Successfully marked pump address as used");
      console.log(`   - Address: ${updatedAddress.value.publicKey}`);
      console.log(`   - Marked as used: ${updatedAddress.value.isUsed}`);
    } else {
      console.log("⚠️  Pump address not found in address pool");
    }

    console.log("\n🎯 Summary:");
    console.log(`✅ Token removed: ${deletedToken.value ? 'YES' : 'NO'}`);
    console.log(`✅ Address marked as used: ${updatedAddress.value ? 'YES' : 'NO'}`);
    console.log(`🔒 Address ${FAILED_TOKEN_ADDRESS} will not be reused`);
    
  } catch (error) {
    console.error("❌ Error removing failed token:", error);
  } finally {
    if (client) {
      await client.close();
      console.log("🔌 Disconnected from MongoDB");
    }
  }
}

// Run the script
removeFailedToken().then(() => {
  console.log("🏁 Script completed");
  process.exit(0);
}).catch((error) => {
  console.error("💥 Script failed:", error);
  process.exit(1);
}); 