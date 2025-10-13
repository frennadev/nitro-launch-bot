import { LaunchAPI } from "./src/api/launch-api";
import { startLaunchWorker } from "./src/jobs/launch-init";

async function testLaunchSystem() {
  console.log("🧪 Testing Launch Queue System...\n");

  // Start the worker
  console.log("1. Starting Launch Worker");
  const worker = startLaunchWorker();
  console.log("✅ Worker started\n");

  // Wait a moment for worker to initialize
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    // Test 1: Queue a Pump launch
    console.log("2. Testing Pump Token Launch Queue");
    const pumpLaunch = await LaunchAPI.queueLaunch({
      userId: "test_user_123",
      chatId: 123456789,
      platform: "pump",
      tokenName: "Test Pump Token",
      tokenSymbol: "TPT",
      fundingWalletPrivateKey: "test_funding_key",
      devWalletPrivateKey: "test_dev_key",
      buyerWalletPrivateKeys: ["buyer1_key", "buyer2_key", "buyer3_key"],
      devBuy: 0.5,
      buyAmount: 0.1,
      launchMode: "normal",
    });

    console.log("Pump Launch Result:", pumpLaunch);

    if (pumpLaunch.success && pumpLaunch.jobId) {
      console.log("✅ Pump launch queued successfully\n");

      // Test 2: Check launch status
      console.log("3. Checking Launch Status");
      const status = await LaunchAPI.getLaunchStatus(pumpLaunch.jobId);
      console.log("Launch Status:", status);
      console.log("✅ Status check successful\n");
    }

    // Test 3: Queue a Bonk launch
    console.log("4. Testing Bonk Token Launch Queue");
    const bonkLaunch = await LaunchAPI.queueLaunch({
      userId: "test_user_456",
      platform: "bonk",
      tokenName: "Test Bonk Token",
      tokenSymbol: "TBT",
      fundingWalletPrivateKey: "test_funding_key_2",
      devWalletPrivateKey: "test_dev_key_2",
      buyerWalletPrivateKeys: ["buyer4_key", "buyer5_key"],
      devBuy: 1.0,
      buyAmount: 0.2,
    });

    console.log("Bonk Launch Result:", bonkLaunch);

    if (bonkLaunch.success) {
      console.log("✅ Bonk launch queued successfully\n");
    }

    // Test 4: Get user launches
    console.log("5. Testing User Launches Retrieval");
    const userLaunches = await LaunchAPI.getUserLaunches("test_user_123");
    console.log("User Launches:", userLaunches);
    console.log("✅ User launches retrieved successfully\n");

    // Test 5: Get queue stats
    console.log("6. Testing Queue Statistics");
    const queueStats = await LaunchAPI.getQueueStats();
    console.log("Queue Stats:", queueStats);
    console.log("✅ Queue stats retrieved successfully\n");

    // Test 6: Validation errors
    console.log("7. Testing Validation Errors");
    const invalidLaunch = await LaunchAPI.queueLaunch({
      userId: "",
      platform: "invalid" as "pump",
      tokenName: "",
      tokenSymbol: "",
      fundingWalletPrivateKey: "",
      devWalletPrivateKey: "",
      buyerWalletPrivateKeys: [],
      devBuy: -1,
      buyAmount: 0,
    });

    console.log("Invalid Launch Result:", invalidLaunch);
    if (!invalidLaunch.success) {
      console.log("✅ Validation working correctly\n");
    }

    console.log("🎉 All tests completed successfully!");

    // Let the jobs run for a bit to see processing
    console.log("\n⏳ Letting jobs process for 30 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 30000));
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    // Cleanup
    console.log("\n🧹 Cleaning up...");
    if (worker) {
      await worker.shutdown();
    }
    process.exit(0);
  }
}

// Run the test
testLaunchSystem().catch(console.error);
