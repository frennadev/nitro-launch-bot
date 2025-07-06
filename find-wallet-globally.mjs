import { MongoClient } from 'mongodb';

const MONGODB_URI = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";

async function findWalletGlobally() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    console.log('🔌 Connecting to MongoDB...');
    await client.connect();
    
    const db = client.db();
    const walletsCollection = db.collection('wallets');
    const usersCollection = db.collection('users');
    
    // Search for the wallet globally
    const wallet = await walletsCollection.findOne({
      publicKey: 'H497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF'
    });
    
    if (wallet) {
      console.log(`\n✅ Found wallet globally:`);
      console.log(`   Address: ${wallet.publicKey}`);
      console.log(`   User ID: ${wallet.user}`);
      console.log(`   isDev: ${wallet.isDev}`);
      console.log(`   isDefault: ${wallet.isDefault}`);
      console.log(`   Created: ${wallet.createdAt}`);
      
      // Find the user who owns this wallet
      const user = await usersCollection.findOne({ _id: wallet.user });
      if (user) {
        console.log(`\n👤 Owner: ${user.firstName || 'Unknown'} (${user.telegramId})`);
        console.log(`   User ID: ${user._id}`);
      }
      
      // Check private key format
      const privateKey = wallet.privateKey;
      console.log(`\n🔐 Private key analysis:`);
      console.log(`   Length: ${privateKey.length}`);
      console.log(`   Contains colon: ${privateKey.includes(':')}`);
      console.log(`   First 50 chars: ${privateKey.substring(0, 50)}...`);
      
      if (privateKey.includes(':')) {
        const [ivHex, encryptedData] = privateKey.split(':');
        console.log(`\n✅ Properly encrypted format:`);
        console.log(`   IV length: ${ivHex.length}`);
        console.log(`   Encrypted data length: ${encryptedData.length}`);
      } else {
        console.log(`\n❌ INVALID FORMAT: Missing colon separator`);
        console.log(`   Expected format: iv:encryptedData`);
        console.log(`   Actual format: ${privateKey.substring(0, 100)}...`);
      }
    } else {
      console.log(`\n❌ Wallet not found globally`);
      
      // Check if there are any wallets with similar addresses
      const similarWallets = await walletsCollection.find({
        publicKey: { $regex: /^H497/ }
      }).toArray();
      
      if (similarWallets.length > 0) {
        console.log(`\n🔍 Found ${similarWallets.length} wallets starting with 'H497':`);
        similarWallets.forEach((w, index) => {
          console.log(`   ${index + 1}. ${w.publicKey} (User: ${w.user}, isDev: ${w.isDev || false})`);
        });
      }
    }
    
    // Check all users to see if there's a mismatch
    const users = await usersCollection.find({}).limit(10).toArray();
    console.log(`\n👥 All users in database:`);
    users.forEach((user, index) => {
      console.log(`   ${index + 1}. ${user.firstName || 'Unknown'} (${user.telegramId}) - ID: ${user._id}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n🔌 Database connection closed');
  }
}

findWalletGlobally(); 