import { MongoClient } from 'mongodb';

const MONGODB_URI = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";

async function findCustomWallet() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    console.log('🔌 Connecting to MongoDB...');
    await client.connect();
    
    const db = client.db();
    const walletsCollection = db.collection('wallets');
    
    // Search for the custom dev wallet
    const customWallet = await walletsCollection.findOne({
      publicKey: 'H497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF'
    });
    
    if (customWallet) {
      console.log(`\n✅ Custom dev wallet found:`);
      console.log(`   Address: ${customWallet.publicKey}`);
      console.log(`   User ID: ${customWallet.user}`);
      console.log(`   isDev: ${customWallet.isDev}`);
      console.log(`   isDefault: ${customWallet.isDefault}`);
      console.log(`   Created: ${customWallet.createdAt}`);
      
      // Find the user who owns this wallet
      const usersCollection = db.collection('users');
      const user = await usersCollection.findOne({ _id: customWallet.user });
      if (user) {
        console.log(`\n👤 Owner: ${user.firstName || 'Unknown'} (${user.telegramId})`);
      }
    } else {
      console.log(`\n❌ Custom dev wallet NOT found in database`);
      
      // Check if there are any dev wallets at all
      const allDevWallets = await walletsCollection.find({ isDev: true }).toArray();
      console.log(`\n📊 Total dev wallets in database: ${allDevWallets.length}`);
      
      if (allDevWallets.length > 0) {
        console.log(`\n🔧 All dev wallets:`);
        allDevWallets.forEach((wallet, index) => {
          console.log(`   ${index + 1}. ${wallet.publicKey} (User: ${wallet.user}, Default: ${wallet.isDefault || false})`);
        });
      }
    }
    
    // Check for any wallets with similar patterns
    const similarWallets = await walletsCollection.find({
      publicKey: { $regex: /^H497/ }
    }).toArray();
    
    if (similarWallets.length > 0) {
      console.log(`\n🔍 Found ${similarWallets.length} wallets starting with 'H497':`);
      similarWallets.forEach((wallet, index) => {
        console.log(`   ${index + 1}. ${wallet.publicKey} (isDev: ${wallet.isDev || false})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n🔌 Database connection closed');
  }
}

findCustomWallet(); 