const { initializeWalletPool, getWalletPoolStats } = require('../src/backend/functions-main');
const mongoose = require('mongoose');
const { env } = require('../src/config');

async function initPool() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('📊 Checking current wallet pool status...');
    const currentStats = await getWalletPoolStats();
    console.log(`Current pool stats:`, currentStats);

    console.log('🚀 Initializing wallet pool...');
    await initializeWalletPool(2000);

    console.log('📊 Final wallet pool status...');
    const finalStats = await getWalletPoolStats();
    console.log(`Final pool stats:`, finalStats);

    console.log('✅ Wallet pool initialization completed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to initialize wallet pool:', error);
    process.exit(1);
  }
}

initPool(); 