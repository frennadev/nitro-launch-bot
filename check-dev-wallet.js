import { MongoClient } from 'mongodb';
import { getUser, getDefaultDevWallet, getAllDevWallets } from './src/backend/functions.js';

const MONGODB_URI = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";

async function checkDevWallet() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    console.log('🔌 Connecting to MongoDB...');
    await client.connect();
    
    const db = client.db();
    const usersCollection = db.collection('users');
    const walletsCollection = db.collection('wallets');
    
    // Get all users
    const users = await usersCollection.find({}).limit(10).toArray();
    
    console.log(`\n📊 Found ${users.length} users`);
    
    for (const user of users) {
      console.log(`\n👤 User: ${user.firstName || 'Unknown'} (${user.telegramId})`);
      
      // Check dev wallets for this user
      const devWallets = await walletsCollection.find({
        user: user._id.toString(),
        isDev: true
      }).toArray();
      
      console.log(`   Dev wallets found: ${devWallets.length}`);
      
      if (devWallets.length > 0) {
        devWallets.forEach((wallet, index) => {
          console.log(`   ${index + 1}. ${wallet.publicKey} (default: ${wallet.isDefault || false})`);
        });
        
        // Check which one is the default
        const defaultWallet = devWallets.find(w => w.isDefault);
        if (defaultWallet) {
          console.log(`   ✅ Default dev wallet: ${defaultWallet.publicKey}`);
        } else {
          console.log(`   ⚠️ No default dev wallet set`);
        }
      } else {
        console.log(`   ❌ No dev wallets found`);
      }
    }
    
    // Check for the specific problematic address
    const problematicWallet = await walletsCollection.findOne({
      publicKey: 'DdCo32Pr4xj2qHEwWH8ZSEvzpydioi7c5gWHecsgivKj'
    });
    
    if (problematicWallet) {
      console.log(`\n🔍 Found problematic wallet in database:`);
      console.log(`   Address: ${problematicWallet.publicKey}`);
      console.log(`   User: ${problematicWallet.user}`);
      console.log(`   isDev: ${problematicWallet.isDev}`);
      console.log(`   isDefault: ${problematicWallet.isDefault}`);
      console.log(`   Created: ${problematicWallet.createdAt}`);
    } else {
      console.log(`\n✅ Problematic address not found in database`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n🔌 Database connection closed');
  }
}

checkDevWallet(); 