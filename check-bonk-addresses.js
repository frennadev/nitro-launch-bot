import { connectDB } from "./src/backend/db";
import { BonkAddressModel } from "./src/backend/models";

async function checkBonkAddresses() {
  console.log('🔍 Checking Bonk Addresses in Database...\n');
  
  try {
    await connectDB();
    console.log('✅ Connected to database');
    
    // Get total counts
    const total = await BonkAddressModel.countDocuments({});
    const used = await BonkAddressModel.countDocuments({ isUsed: true });
    const unused = await BonkAddressModel.countDocuments({ isUsed: false });
    const bonkAddresses = await BonkAddressModel.countDocuments({ isBonk: true });
    
    console.log('📊 Bonk Address Database Statistics:');
    console.log(`   Total addresses: ${total}`);
    console.log(`   Used addresses: ${used}`);
    console.log(`   Unused addresses: ${unused}`);
    console.log(`   Bonk addresses: ${bonkAddresses}`);
    console.log('');
    
    if (total === 0) {
      console.log('❌ No Bonk addresses found in database');
      console.log('💡 You may need to run the Bonk address finder first:');
      console.log('   bun run src/bonk-address-finder.ts');
      return;
    }
    
    // Show some sample addresses
    const sampleAddresses = await BonkAddressModel.find({ isUsed: false }).limit(5).lean();
    
    console.log('🔍 Sample of Unused Bonk Addresses:');
    sampleAddresses.forEach((addr, index) => {
      console.log(`   ${index + 1}. ${addr.publicKey}`);
      console.log(`      isUsed: ${addr.isUsed}`);
      console.log(`      isBonk: ${addr.isBonk}`);
      console.log(`      selected: ${addr.selected}`);
      console.log('');
    });
    
    // Check if any addresses are marked as used
    const usedAddresses = await BonkAddressModel.find({ isUsed: true }).limit(3).lean();
    
    if (usedAddresses.length > 0) {
      console.log('🔍 Sample of Used Bonk Addresses:');
      usedAddresses.forEach((addr, index) => {
        console.log(`   ${index + 1}. ${addr.publicKey}`);
        console.log(`      isUsed: ${addr.isUsed}`);
        console.log(`      isBonk: ${addr.isBonk}`);
        console.log(`      selected: ${addr.selected}`);
        console.log('');
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    process.exit(0);
  }
}

checkBonkAddresses(); 