import { Keypair } from "@solana/web3.js";
import { createPumpFunToken, createPumpFunTokenWithRetry, validateTokenCreationParams } from "./src/blockchain/pumpfun/create";
import { createUnifiedConfig } from "./src/blockchain/common/unified-config";

async function testPumpFunTokenCreation() {
  console.log("🧪 Testing PumpFun Token Creation");
  console.log("==================================\n");

  // Test configuration
  const testConfig = createUnifiedConfig({
    priorityFees: {
      base: 2_000_000, // Higher base fee for token creation
      retryMultiplier: 1.8,
      max: 15_000_000,
      min: 500_000,
    },
    retry: {
      maxAttempts: 3,
      delayMs: 2000,
    },
  });

  console.log("⚙️  Using Configuration:");
  console.log(`   Priority Fee Base: ${testConfig.priorityFees.base / 1_000_000} SOL`);
  console.log(`   Max Retries: ${testConfig.retry.maxAttempts}`);
  console.log(`   Platform Fee: ${testConfig.fees.platformPercentage}%`);
  console.log(`   Maestro Fee: ${testConfig.fees.maestroPercentage}%\n`);

  // Generate a test keypair (in production, use a real wallet)
  const creatorKeypair = Keypair.generate();
  console.log(`👤 Creator: ${creatorKeypair.publicKey.toBase58()}`);

  // Test token parameters
  const tokenName = "TestToken";
  const tokenSymbol = "TEST";
  const tokenDescription = "A test token created with the new launch bot";
  
  // Create a simple test image (1x1 pixel PNG)
  const testImageBuffer = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x00, 0x01, // width: 1
    0x00, 0x00, 0x00, 0x01, // height: 1
    0x08, 0x02, 0x00, 0x00, 0x00, // bit depth, color type, etc.
    0x90, 0x77, 0x53, 0xDE, // CRC
    0x00, 0x00, 0x00, 0x0C, // IDAT chunk length
    0x49, 0x44, 0x41, 0x54, // IDAT
    0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, // compressed data
    0xE2, 0x21, 0xBC, 0x33, // CRC
    0x00, 0x00, 0x00, 0x00, // IEND chunk length
    0x49, 0x45, 0x4E, 0x44, // IEND
    0xAE, 0x42, 0x60, 0x82  // CRC
  ]);

  console.log("📝 Token Details:");
  console.log(`   Name: ${tokenName}`);
  console.log(`   Symbol: ${tokenSymbol}`);
  console.log(`   Description: ${tokenDescription}`);
  console.log(`   Image Size: ${testImageBuffer.length} bytes\n`);

  // Validate parameters
  console.log("🔍 Validating parameters...");
  const validationErrors = validateTokenCreationParams(
    tokenName,
    tokenSymbol,
    tokenDescription,
    testImageBuffer
  );

  if (validationErrors.length > 0) {
    console.error("❌ Validation failed:");
    validationErrors.forEach(error => console.error(`   - ${error}`));
    return;
  }
  console.log("✅ Parameters validated successfully\n");

  // Note: This test requires:
  // 1. PINATA_API_KEY and PINATA_SECRET_KEY environment variables
  // 2. Sufficient SOL balance in the creator wallet
  // 3. Network connectivity

  console.log("⚠️  IMPORTANT NOTES:");
  console.log("   1. This test requires PINATA_API_KEY and PINATA_SECRET_KEY environment variables");
  console.log("   2. The creator wallet needs sufficient SOL balance for fees");
  console.log("   3. This will create a real token on the blockchain");
  console.log("   4. The test image is a minimal 1x1 pixel PNG\n");

  // Check if Pinata credentials are available
  if (!process.env.PINATA_API_KEY || !process.env.PINATA_SECRET_KEY) {
    console.log("❌ Pinata credentials not found in environment variables");
    console.log("   Please set PINATA_API_KEY and PINATA_SECRET_KEY to test token creation");
    console.log("   You can get these from https://app.pinata.cloud/");
    return;
  }

  console.log("✅ Pinata credentials found\n");

  // Check creator balance
  const { connection } = await import("./src/blockchain/common/connection");
  const balance = await connection.getBalance(creatorKeypair.publicKey, "confirmed");
  const requiredBalance = 0.02 * 1e9; // 0.02 SOL in lamports

  if (balance < requiredBalance) {
    console.log(`❌ Insufficient balance: ${balance / 1e9} SOL available, need at least 0.02 SOL`);
    console.log("   Please fund the creator wallet to test token creation");
    return;
  }

  console.log(`✅ Sufficient balance: ${balance / 1e9} SOL\n`);

  // Ask for confirmation
  console.log("🚀 Ready to create token!");
  console.log("   This will create a real token on the Solana blockchain");
  console.log("   Press Ctrl+C to cancel or wait 5 seconds to continue...");

  // Wait 5 seconds for user to cancel
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log("\n🔄 Creating token...");

  try {
    // Create token with retry logic
    const result = await createPumpFunTokenWithRetry(
      creatorKeypair,
      tokenName,
      tokenSymbol,
      tokenDescription,
      testImageBuffer,
      3, // max retries
      testConfig
    );

    if (result.success) {
      console.log("\n🎉 TOKEN CREATION SUCCESSFUL!");
      console.log("==================================");
      console.log(`Token Address: ${result.tokenAddress}`);
      console.log(`Transaction: ${result.signature}`);
      console.log(`Metadata URI: ${result.metadataUri}`);
      console.log(`Creator: ${creatorKeypair.publicKey.toBase58()}`);
      console.log(`Private Key: ${Buffer.from(creatorKeypair.secretKey).toString('base64')}`);
      
      console.log("\n🔗 Links:");
      console.log(`   PumpFun: https://pump.fun/${result.tokenAddress}`);
      console.log(`   Solscan: https://solscan.io/token/${result.tokenAddress}`);
      console.log(`   Solana Explorer: https://explorer.solana.com/address/${result.tokenAddress}`);
      
      console.log("\n⚠️  IMPORTANT:");
      console.log("   - Save the private key securely");
      console.log("   - The token is now live on PumpFun");
      console.log("   - You can buy/sell using the buy/sell functions");
      
    } else {
      console.error("\n❌ TOKEN CREATION FAILED");
      console.error("==========================");
      console.error(`Error: ${result.error}`);
    }

  } catch (error: any) {
    console.error("\n❌ TOKEN CREATION ERROR");
    console.error("========================");
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testPumpFunTokenCreation().catch(console.error);
}

export { testPumpFunTokenCreation }; 