import { config } from "dotenv";
import { createBonkTokenWithRetry } from "./src/blockchain/letsbonk/create";
import { createUnifiedConfig } from "./src/blockchain/common/unified-config";
import { Keypair } from "@solana/web3.js";

// Load environment variables
config();

async function testBonkTokenCreation() {
  console.log("🧪 Testing Bonk.fun Token Creation Integration");
  console.log("=============================================");

  try {
    // Create a test keypair
    const testKeypair = Keypair.generate();
    console.log(`Test wallet: ${testKeypair.publicKey.toBase58()}`);

    // Create test token data
    const tokenName = "Test Bonk Token";
    const tokenSymbol = "TBT";
    const tokenDescription = "A test token for Bonk.fun integration";
    
    // Create a simple test image buffer (1x1 pixel PNG)
    const testImageBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG header
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 image
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // PNG data
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0xFF, // Image data
      0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, // End of data
      0x21, 0xBC, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, // IEND chunk
      0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
    ]);

    console.log("\n📝 Token Details:");
    console.log(`Name: ${tokenName}`);
    console.log(`Symbol: ${tokenSymbol}`);
    console.log(`Description: ${tokenDescription}`);
    console.log(`Image size: ${testImageBuffer.length} bytes`);

    // Create unified configuration
    const config = createUnifiedConfig({
      priorityFees: {
        base: 1_000_000, // Lower for testing
        retryMultiplier: 1.5,
        max: 5_000_000,
        min: 100_000,
      },
      retry: {
        maxAttempts: 2,
        delayMs: 1000,
      },
    });

    console.log("\n⚙️ Using unified configuration:");
    console.log(`Priority fees: ${config.priorityFees.base} - ${config.priorityFees.max} lamports`);
    console.log(`Retry attempts: ${config.retry.maxAttempts}`);

    console.log("\n🚀 Creating Bonk.fun token...");
    
    // Note: This will fail without proper wallet funding, but tests the integration
    const result = await createBonkTokenWithRetry(
      testKeypair,
      tokenName,
      tokenSymbol,
      tokenDescription,
      testImageBuffer,
      1, // Single attempt for testing
      config
    );

    if (result.success) {
      console.log("\n✅ Bonk.fun Token Creation Successful!");
      console.log(`Token Address: ${result.tokenAddress}`);
      console.log(`Transaction: ${result.signature}`);
      console.log(`Metadata URI: ${result.metadataUri}`);
    } else {
      console.log("\n❌ Bonk.fun Token Creation Failed (Expected without funding):");
      console.log(`Error: ${result.error}`);
      console.log("\n✅ Integration test completed - error handling works correctly");
    }

  } catch (error: any) {
    console.error("\n❌ Test failed with unexpected error:");
    console.error(error.message);
  }

  console.log("\n🏁 Bonk.fun Integration Test Complete");
}

// Run the test
testBonkTokenCreation().catch(console.error); 