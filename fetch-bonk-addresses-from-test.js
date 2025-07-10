import { MongoClient } from 'mongodb';
import { connectDB } from "./src/backend/db";
import { BonkAddressModel } from "./src/backend/models";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

async function fetchBonkAddressesFromTest() {
  console.log('🔍 Fetching Bonk Addresses from Test Database...\n');
  
  const testMongoUri = "mongodb+srv://nitro-launch:LFJ7WFVPyKIKKspK@bundler.bladbsz.mongodb.net/?retryWrites=true&w=majority&appName=Bundler";
  
  let testClient;
  
  try {
    // Connect to test database
    testClient = new MongoClient(testMongoUri);
    await testClient.connect();
    console.log('✅ Connected to test database');
    
    // Connect to main database
    await connectDB();
    console.log('✅ Connected to main database');
    
    const testDb = testClient.db('test');
    const testCollection = testDb.collection('mixer_wallets');
    
    // Get all available wallets from test database
    const testWallets = await testCollection.find({ 
      status: "available",
      isActive: true
    }).toArray();
    
    console.log(`📊 Found ${testWallets.length} available wallets in test database`);
    
    if (testWallets.length === 0) {
      console.log('❌ No available wallets found in test database');
      return;
    }
    
    // Check how many Bonk addresses we already have
    const existingBonkCount = await BonkAddressModel.countDocuments({ isBonk: true });
    console.log(`📊 Existing Bonk addresses in main database: ${existingBonkCount}`);
    
    let importedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    console.log('\n🔄 Importing wallets as Bonk addresses...');
    
    for (const testWallet of testWallets) {
      try {
        // Check if this address already exists in main database
        const existingAddress = await BonkAddressModel.findOne({ 
          publicKey: testWallet.publicKey 
        });
        
        if (existingAddress) {
          console.log(`⏭️ Skipping ${testWallet.publicKey.substring(0, 8)}... (already exists)`);
          skippedCount++;
          continue;
        }
        
        // Decrypt the private key from test database
        // Note: This assumes the test database uses the same encryption
        let decryptedPrivateKey;
        try {
          // Try to decrypt using the same method as the mixer
          const { decryptPrivateKey } = await import("./src/backend/utils");
          decryptedPrivateKey = decryptPrivateKey(testWallet.privateKey);
        } catch (decryptError) {
          console.log(`⚠️ Could not decrypt private key for ${testWallet.publicKey.substring(0, 8)}... (skipping)`);
          skippedCount++;
          continue;
        }
        
        // Convert to Keypair to get raw secret key
        const keypair = Keypair.fromSecretKey(bs58.decode(decryptedPrivateKey));
        
        // Create new Bonk address record
        const newBonkAddress = new BonkAddressModel({
          publicKey: testWallet.publicKey,
          secretKey: decryptedPrivateKey,
          rawSecretKey: Array.from(keypair.secretKey),
          isUsed: false,
          isBonk: true,
          selected: false,
        });
        
        await newBonkAddress.save();
        
        console.log(`✅ Imported ${testWallet.publicKey.substring(0, 8)}... as Bonk address`);
        importedCount++;
        
        // Progress indicator
        if (importedCount % 10 === 0) {
          console.log(`📈 Progress: ${importedCount} addresses imported...`);
        }
        
      } catch (error) {
        console.error(`❌ Error importing ${testWallet.publicKey.substring(0, 8)}...:`, error.message);
        errorCount++;
      }
    }
    
    // Final statistics
    const finalBonkCount = await BonkAddressModel.countDocuments({ isBonk: true });
    
    console.log('\n📊 Import Summary:');
    console.log(`   Total wallets in test DB: ${testWallets.length}`);
    console.log(`   Successfully imported: ${importedCount}`);
    console.log(`   Skipped (already exists): ${skippedCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log(`   Total Bonk addresses now: ${finalBonkCount}`);
    
    if (importedCount > 0) {
      console.log(`\n🎉 Successfully imported ${importedCount} Bonk addresses!`);
      console.log(`   Available for Bonk token launches: ${finalBonkCount}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (testClient) {
      await testClient.close();
      console.log('\n🔌 Test database connection closed');
    }
    process.exit(0);
  }
}

fetchBonkAddressesFromTest(); 