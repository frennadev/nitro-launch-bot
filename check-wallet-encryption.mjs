import { MongoClient } from 'mongodb';

const MONGODB_URI = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";

async function checkWalletEncryption() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    console.log('🔌 Connecting to MongoDB...');
    await client.connect();
    
    const db = client.db();
    const walletsCollection = db.collection('wallets');
    
    // Find the correct dev wallet
    const correctWallet = await walletsCollection.findOne({
      publicKey: 'H497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF',
      user: '6844d87bbc12916bc8cedc3a',
      isDev: true
    });
    
    if (correctWallet) {
      console.log(`\n✅ Found correct dev wallet:`);
      console.log(`   Address: ${correctWallet.publicKey}`);
      console.log(`   User: ${correctWallet.user}`);
      console.log(`   isDev: ${correctWallet.isDev}`);
      console.log(`   isDefault: ${correctWallet.isDefault}`);
      console.log(`   Created: ${correctWallet.createdAt}`);
      
      // Check private key format
      const privateKey = correctWallet.privateKey;
      console.log(`\n🔐 Private key analysis:`);
      console.log(`   Length: ${privateKey.length}`);
      console.log(`   Contains colon: ${privateKey.includes(':')}`);
      console.log(`   First 50 chars: ${privateKey.substring(0, 50)}...`);
      console.log(`   Last 50 chars: ...${privateKey.substring(privateKey.length - 50)}`);
      
      // Check if it's properly encrypted
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
      console.log(`\n❌ Correct dev wallet not found`);
    }
    
    // Check all dev wallets for this user
    const allDevWallets = await walletsCollection.find({
      user: '6844d87bbc12916bc8cedc3a',
      isDev: true
    }).toArray();
    
    console.log(`\n📋 All dev wallets for user (${allDevWallets.length}):`);
    allDevWallets.forEach((wallet, index) => {
      console.log(`   ${index + 1}. ${wallet.publicKey}`);
      console.log(`      isDefault: ${wallet.isDefault || false}`);
      console.log(`      privateKey format: ${wallet.privateKey.includes(':') ? '✅ Valid' : '❌ Invalid'}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n🔌 Database connection closed');
  }
}

checkWalletEncryption(); 