import { connectDB } from "./src/backend/db";
import { WalletPoolModel } from "./src/backend/models";

async function checkWalletPool() {
  console.log('🔍 Checking Wallet Pool Status...\n');
  
  try {
    await connectDB();
    console.log('✅ Connected to database');
    
    // Get detailed statistics
    const total = await WalletPoolModel.countDocuments({});
    const allocated = await WalletPoolModel.countDocuments({ isAllocated: true });
    const available = await WalletPoolModel.countDocuments({ isAllocated: false });
    
    console.log('📊 Wallet Pool Statistics:');
    console.log(`   Total wallets: ${total}`);
    console.log(`   Allocated wallets: ${allocated}`);
    console.log(`   Available wallets: ${available}`);
    console.log(`   Usage percentage: ${total > 0 ? Math.round((allocated / total) * 100) : 0}%`);
    console.log('');
    
    if (total === 0) {
      console.log('❌ No wallets found in pool');
      return;
    }
    
    // Check allocation details
    const allocatedWallets = await WalletPoolModel.find({ isAllocated: true })
      .select('publicKey allocatedTo allocatedAt')
      .limit(5)
      .lean();
    
    if (allocatedWallets.length > 0) {
      console.log('🔍 Sample of Allocated Wallets:');
      allocatedWallets.forEach((wallet, index) => {
        console.log(`   ${index + 1}. ${wallet.publicKey}`);
        console.log(`      Allocated to: ${wallet.allocatedTo || 'Unknown'}`);
        console.log(`      Allocated at: ${wallet.allocatedAt || 'Unknown'}`);
        console.log('');
      });
    }
    
    // Check available wallets
    const availableWallets = await WalletPoolModel.find({ isAllocated: false })
      .select('publicKey createdAt')
      .limit(5)
      .lean();
    
    if (availableWallets.length > 0) {
      console.log('🔍 Sample of Available Wallets:');
      availableWallets.forEach((wallet, index) => {
        console.log(`   ${index + 1}. ${wallet.publicKey}`);
        console.log(`      Created at: ${wallet.createdAt}`);
        console.log('');
      });
    }
    
    // Check if there are any wallets with null/undefined isAllocated
    const nullAllocated = await WalletPoolModel.countDocuments({ 
      $or: [
        { isAllocated: null },
        { isAllocated: { $exists: false } }
      ]
    });
    
    if (nullAllocated > 0) {
      console.log(`⚠️ Found ${nullAllocated} wallets with null/undefined isAllocated status`);
    }
    
    // Check recent allocations
    const recentAllocations = await WalletPoolModel.find({ 
      isAllocated: true,
      allocatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
    }).countDocuments();
    
    console.log(`📈 Recent activity: ${recentAllocations} wallets allocated in last 24 hours`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    process.exit(0);
  }
}

checkWalletPool(); 