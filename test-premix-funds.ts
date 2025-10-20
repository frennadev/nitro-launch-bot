#!/usr/bin/env ts-node

/**
 * Test script for premix funds functionality
 * This script demonstrates how to use the premix funds queue and worker
 */

import { enqueuePremixFunds } from "./src/backend/functions-main";
import { logger } from "./src/blockchain/common/logger";

async function testPremixFunds() {
  try {
    console.log("🚀 Testing Premix Funds Queue System");
    console.log("=====================================");

    // Test parameters (replace with actual user data)
    const userId = "test-user-id"; // Replace with actual user ID
    const userChatId = 123456789; // Replace with actual chat ID
    const mixAmount = 0.1; // Amount in SOL to premix

    const options = {
      maxWallets: 10, // Limit to first 10 buyer wallets
      mode: "standard" as const, // Use standard mixing mode
      socketUserId: "test-socket-id", // Optional socket ID
    };

    console.log(`📋 Test Parameters:`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Chat ID: ${userChatId}`);
    console.log(`   Mix Amount: ${mixAmount} SOL`);
    console.log(`   Max Wallets: ${options.maxWallets}`);
    console.log(`   Mode: ${options.mode}`);
    console.log("");

    // Enqueue the premix funds job
    console.log("🔄 Enqueuing premix funds job...");
    const result = await enqueuePremixFunds(
      userId,
      userChatId,
      mixAmount,
      options
    );

    if (result.success) {
      console.log("✅ Premix funds job enqueued successfully!");
      console.log(`📄 Message: ${result.message}`);
      console.log("");
      console.log(
        "💡 The job is now in the queue and will be processed by the worker."
      );
      console.log("   Check the worker logs to see the progress.");
    } else {
      console.log("❌ Failed to enqueue premix funds job:");
      console.log(`📄 Error: ${result.message}`);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Test failed:", error);
    console.log(`❌ Test failed: ${errorMessage}`);
  }
}

// Test with fast mode
async function testPremixFundsFast() {
  try {
    console.log("\n🚀 Testing Premix Funds - Fast Mode");
    console.log("====================================");

    const userId = "test-user-id"; // Replace with actual user ID
    const userChatId = 123456789; // Replace with actual chat ID
    const mixAmount = 0.05; // Smaller amount for fast mode

    const options = {
      mode: "fast" as const, // Use fast mixing mode
    };

    console.log(`📋 Test Parameters:`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Chat ID: ${userChatId}`);
    console.log(`   Mix Amount: ${mixAmount} SOL`);
    console.log(`   Mode: ${options.mode}`);
    console.log("");

    console.log("🔄 Enqueuing fast premix funds job...");
    const result = await enqueuePremixFunds(
      userId,
      userChatId,
      mixAmount,
      options
    );

    if (result.success) {
      console.log("✅ Fast premix funds job enqueued successfully!");
      console.log(`📄 Message: ${result.message}`);
    } else {
      console.log("❌ Failed to enqueue fast premix funds job:");
      console.log(`📄 Error: ${result.message}`);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logger.error("Fast test failed:", error);
    console.log(`❌ Fast test failed: ${errorMessage}`);
  }
}

// Run the tests
async function runTests() {
  console.log("🧪 Premix Funds Queue & Worker Test Suite");
  console.log("==========================================");
  console.log("");

  console.log("⚠️  NOTE: Before running this test, ensure:");
  console.log("   1. MongoDB is running and connected");
  console.log("   2. Redis is running for queue management");
  console.log("   3. User has a funding wallet with sufficient balance");
  console.log("   4. User has created buyer wallets");
  console.log("   5. Workers are running to process the jobs");
  console.log("");

  // Test standard mode
  await testPremixFunds();

  // Wait a bit between tests
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Test fast mode
  await testPremixFundsFast();

  console.log("\n🏁 Tests completed!");
  console.log("   Check worker logs for job processing details.");
}

// Execute if run directly
if (require.main === module) {
  runTests().catch(console.error);
}

export { testPremixFunds, testPremixFundsFast };
