import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const MONGODB_URI = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";

// Constants from the utils file
const ENCRYPTION_ALGORITHM = "aes-256-cbc";
const ENCRYPTION_IV_LENGTH = 16;

// Test decryption function
function testDecryptPrivateKey(encryptedPrivateKey, secretKey) {
  try {
    const [ivHex, encryptedData] = encryptedPrivateKey.split(":");

    if (!ivHex || !encryptedData) {
      throw new Error("Invalid encrypted data format");
    }
    
    const iv = Buffer.from(ivHex, "hex");
    const key = crypto.scryptSync(secretKey, "salt", ENCRYPTION_IV_LENGTH * 2);
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

async function testDecryption() {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    console.log('🔌 Connecting to MongoDB...');
    await client.connect();
    
    const db = client.db();
    const walletsCollection = db.collection('wallets');
    
    // Get the wallet
    const wallet = await walletsCollection.findOne({
      publicKey: 'H497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF'
    });
    
    if (!wallet) {
      console.log('❌ Wallet not found');
      return;
    }
    
    console.log(`\n✅ Found wallet: ${wallet.publicKey}`);
    console.log(`Private key length: ${wallet.privateKey.length}`);
    console.log(`Private key format: ${wallet.privateKey.includes(':') ? 'Valid' : 'Invalid'}`);
    
    // Test with different encryption secrets
    const possibleSecrets = [
      process.env.ENCRYPTION_SECRET || 'default-secret',
      'nitro-launch-secret',
      'solana-bot-secret',
      'pumpfun-secret'
    ];
    
    console.log('\n🔐 Testing decryption with different secrets:');
    
    for (const secret of possibleSecrets) {
      try {
        console.log(`\nTesting with secret: ${secret.substring(0, 10)}...`);
        const decrypted = testDecryptPrivateKey(wallet.privateKey, secret);
        console.log(`✅ SUCCESS! Decrypted key: ${decrypted.substring(0, 20)}...`);
        
        // Validate it's a valid base58 key
        if (decrypted.length === 88) {
          console.log(`✅ Valid base58 length (88 chars)`);
        } else {
          console.log(`⚠️ Unexpected length: ${decrypted.length} chars`);
        }
        
        break; // Found the correct secret
      } catch (error) {
        console.log(`❌ Failed: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
    console.log('\n🔌 Database connection closed');
  }
}

testDecryption(); 