import { MongoClient } from 'mongodb';

const MONGODB_URI = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";

async function checkWalletIssue() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    console.log('🔌 Connecting to MongoDB...');
    await client.connect();
    
    const db = client.db();
    const usersCollection = db.collection('users');
    const walletsCollection = db.collection('wallets');
    
    // Find the user who owns the problematic wallet
    const problematicWallet = await walletsCollection.findOne({
      publicKey: 'DdCo32Pr4xj2qHEwWH8ZSEvzpydioi7c5gWHecsgivKj'
    });
    
    if (problematicWallet) {
      console.log(`\n🔍 Problematic wallet details:`);
      console.log(`   Address: ${problematicWallet.publicKey}`);
      console.log(`   User ID: ${problematicWallet.user}`);
      console.log(`   isDev: ${problematicWallet.isDev}`);
      console.log(`   isDefault: ${problematicWallet.isDefault}`);
      console.log(`   isBuyer: ${problematicWallet.isBuyer}`);
      console.log(`   isFunding: ${problematicWallet.isFunding}`);
      console.log(`   Created: ${problematicWallet.createdAt}`);
      
      // Find the user
      const user = await usersCollection.findOne({ _id: problematicWallet.user });
      if (user) {
        console.log(`\n👤 User details:`);
        console.log(`   Name: ${user.firstName || 'Unknown'}`);
        console.log(`   Telegram ID: ${user.telegramId}`);
        console.log(`   User ID: ${user._id}`);
        
        // Check all wallets for this user
        const allWallets = await walletsCollection.find({
          user: user._id.toString()
        }).toArray();
        
        console.log(`\n📋 All wallets for this user (${allWallets.length} total):`);
        allWallets.forEach((wallet, index) => {
          console.log(`   ${index + 1}. ${wallet.publicKey}`);
          console.log(`      isDev: ${wallet.isDev || false}`);
          console.log(`      isDefault: ${wallet.isDefault || false}`);
          console.log(`      isBuyer: ${wallet.isBuyer || false}`);
          console.log(`      isFunding: ${wallet.isFunding || false}`);
        });
        
        // Check specifically for dev wallets
        const devWallets = allWallets.filter(w => w.isDev);
        console.log(`\n🔧 Dev wallets for this user (${devWallets.length}):`);
        devWallets.forEach((wallet, index) => {
          console.log(`   ${index + 1}. ${wallet.publicKey} (default: ${wallet.isDefault || false})`);
        });
        
        // Check if the custom dev wallet exists
        const customDevWallet = allWallets.find(w => w.publicKey === 'H497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF');
        if (customDevWallet) {
          console.log(`\n✅ Custom dev wallet found:`);
          console.log(`   Address: ${customDevWallet.publicKey}`);
          console.log(`   isDev: ${customDevWallet.isDev}`);
          console.log(`   isDefault: ${customDevWallet.isDefault}`);
        } else {
          console.log(`\n❌ Custom dev wallet NOT found in database`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n🔌 Database connection closed');
  }
}

checkWalletIssue(); 