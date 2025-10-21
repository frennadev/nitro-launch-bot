#!/usr/bin/env ts-node

import { connectDB } from './src/jobs/db.ts';
import { WalletModel, UserModel } from './src/backend/models.ts';
import { walletWarmingQueue } from './src/jobs/queues.ts';
import { logger } from './src/jobs/logger.ts';
import type { WalletWarmingJob } from './src/jobs/types.ts';

async function testWalletWarming() {
  try {
    console.log('🚀 Starting Wallet Warming Test...');
    
    // Connect to database
    await connectDB();
    console.log('✅ Connected to database');

    // Test parameters
    const userId = '68492054bc12916bc8cedcb3';
    const walletToWarm = '7d5TJ9MBaciEE1UUL3dpN2gGViVPP8JdnYVLCMBRg9br';
    const tokenAddress = 'Hcekdr1nt43jvAi9aznxM2jrxGNBEVK8GWnwTHoVpump';
    const fundingAmount = 0.01; // 0.01 SOL

    console.log('📋 Test Parameters:');
    console.log(`- User ID: ${userId}`);
    console.log(`- Wallet to warm: ${walletToWarm}`);
    console.log(`- Token: ${tokenAddress}`);
    console.log(`- Funding amount: ${fundingAmount} SOL`);

    // Get user and populate their funding wallet
    const user = await UserModel.findById(userId).populate('fundingWallet');
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }
    console.log(`✅ Found user: ${user.userName || user.firstName || 'Unknown'}`);

    // Check if user has a funding wallet
    if (!user.fundingWallet) {
      throw new Error('User does not have a funding wallet configured');
    }
    
    // Get the populated funding wallet document
    const populatedFundingWallet = user.fundingWallet as unknown as { publicKey: string };
    console.log(`✅ Found funding wallet: ${populatedFundingWallet.publicKey}`);

    // Check if the wallet to warm exists
    const walletToWarmDoc = await WalletModel.findOne({ publicKey: walletToWarm });
    if (!walletToWarmDoc) {
      throw new Error(`Wallet to warm not found: ${walletToWarm}`);
    }
    console.log(`✅ Found wallet to warm: ${walletToWarm}`);

    // Check current warming state
    console.log('\n🔍 Current Warming State:');
    console.log(`- Is warming: ${walletToWarmDoc.warming?.isWarming || false}`);
    console.log(`- Current stage: ${walletToWarmDoc.warming?.stage || 0}`);
    console.log(`- Has error: ${walletToWarmDoc.warming?.hasError || false}`);
    if (walletToWarmDoc.warming?.hasError) {
      console.log(`- Error stage: ${walletToWarmDoc.warming?.errorStage}`);
      console.log(`- Error message: ${walletToWarmDoc.warming?.errorMessage}`);
    }

    // Add wallet warming job to queue
    console.log('\n🎯 Adding wallet warming job to queue...');
    const jobData: WalletWarmingJob = {
      userId: userId,
      userChatId: 12345, // Mock chat ID for testing
      walletIds: [walletToWarmDoc._id.toString()],
      warmingTokenAddress: tokenAddress
    };

    const job = await walletWarmingQueue.add('warm-wallets', jobData);
    console.log(`✅ Wallet warming job added with ID: ${job.id}`);
    console.log(`📊 Job data:`, JSON.stringify(jobData, null, 2));

    console.log('\n🎉 Test setup completed successfully!');
    console.log('📝 The wallet warming job has been queued and should start processing.');
    console.log('🔄 You can monitor the progress through the Socket.IO events or check the wallet document in the database.');
    
    // Show how to monitor progress
    console.log('\n📊 To monitor progress:');
    console.log('1. Check wallet document warming state in MongoDB');
    console.log('2. Monitor Socket.IO events for real-time progress updates');
    console.log('3. Check job logs for detailed execution information');

    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    logger.error('Wallet warming test failed:', error);
    process.exit(1);
  }
}

// Run the test
testWalletWarming().catch(console.error);