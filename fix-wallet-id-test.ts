import mongoose from 'mongoose';
import { WalletModel, UserModel } from './src/backend/models.ts';
import { walletWarmingQueue } from './src/jobs/queues.ts';
import { connectDB } from './src/jobs/db.ts';

async function findAndTestWalletWarming() {
  try {
    console.log('🔍 Finding correct wallet document ID...');
    
    await connectDB();
    console.log('✅ Connected to database');

    // Test parameters
    const userId = '68492054bc12916bc8cedcb3';
    const walletPublicKey = '7d5TJ9MBaciEE1UUL3dpN2gGViVPP8JdnYVLCMBRg9br';
    const tokenAddress = 'Hcekdr1nt43jvAi9aznxM2jrxGNBEVK8GWnwTHoVpump';

    // Find the wallet document by public key
    const walletDoc = await WalletModel.findOne({ publicKey: walletPublicKey });
    if (!walletDoc) {
      console.log('❌ Wallet not found with public key:', walletPublicKey);
      console.log('🔧 Creating wallet document...');
      
      // Create a new wallet document for testing
      const newWallet = new WalletModel({
        publicKey: walletPublicKey,
        privateKey: 'dummy_private_key_for_testing', // This should be encrypted in real use
        userId: new mongoose.Types.ObjectId(userId),
        createdAt: new Date(),
        warming: {
          isWarming: false,
          stage: 0,
          hasError: false,
          retryCount: 0,
          maxRetries: 3
        }
      });
      
      const savedWallet = await newWallet.save();
      console.log('✅ Created wallet document with ID:', savedWallet._id.toString());
      
      // Now queue the job with the correct wallet document ID
      const jobData = {
        userId: userId,
        userChatId: parseInt(userId.slice(-8), 16), // Use a valid chat ID derived from user ID
        walletIds: [savedWallet._id.toString()], // Use the MongoDB document ID
        warmingTokenAddress: tokenAddress
      };

      console.log('🎯 Queueing wallet warming job with correct data:');
      console.log(JSON.stringify(jobData, null, 2));

      const job = await walletWarmingQueue.add('warm-wallets', jobData);
      console.log(`✅ Wallet warming job queued with ID: ${job.id}`);
      
    } else {
      console.log('✅ Found existing wallet document with ID:', walletDoc._id.toString());
      
      // Queue the job with the correct wallet document ID
      const jobData = {
        userId: userId,
        userChatId: parseInt(userId.slice(-8), 16), // Use a valid chat ID derived from user ID
        walletIds: [walletDoc._id.toString()], // Use the MongoDB document ID
        warmingTokenAddress: tokenAddress
      };

      console.log('🎯 Queueing wallet warming job with correct data:');
      console.log(JSON.stringify(jobData, null, 2));

      const job = await walletWarmingQueue.add('warm-wallets', jobData);
      console.log(`✅ Wallet warming job queued with ID: ${job.id}`);
    }

    // Display current warming state
    const updatedWallet = await WalletModel.findOne({ publicKey: walletPublicKey });
    console.log('\n📊 Current wallet warming state:');
    console.log(`- Is warming: ${updatedWallet?.warming?.isWarming || false}`);
    console.log(`- Stage: ${updatedWallet?.warming?.stage || 0}`);
    console.log(`- Has error: ${updatedWallet?.warming?.hasError || false}`);
    if (updatedWallet?.warming?.hasError) {
      console.log(`- Error stage: ${updatedWallet.warming.errorStage}`);
      console.log(`- Error message: ${updatedWallet.warming.errorMessage}`);
    }

    console.log('\n🎉 Test completed successfully!');
    console.log('📝 The wallet warming job has been queued with the correct MongoDB document ID.');
    console.log('🔄 Monitor the worker logs to see the warming process in action.');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

findAndTestWalletWarming().catch(console.error);