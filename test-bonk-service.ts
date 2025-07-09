import { 
  BonkService, 
  executeBonkBuy, 
  executeBonkSell, 
  getAvailableConfigModes,
  validateTokenMint,
  validatePrivateKey 
} from "./src/service/bonk";

// Example usage of Bonk services

async function testBonkServices() {
  console.log("🚀 Testing Bonk Services...\n");

  // 1. Show available configuration modes
  console.log("📋 Available Configuration Modes:");
  const configModes = getAvailableConfigModes();
  configModes.forEach(mode => {
    console.log(`   ${mode.name}: ${mode.description}`);
    console.log(`   Settings: ${JSON.stringify(mode.settings, null, 2)}\n`);
  });

  // 2. Validate inputs
  const testMint = "2K2dBWwncM2ySZKMigXNpwgoarUJ5iJTHmqGmM87bonk";
  const testPrivateKey = "your_private_key_here"; // Replace with actual private key

  console.log("🔍 Input Validation:");
  console.log(`   Token Mint Valid: ${validateTokenMint(testMint)}`);
  console.log(`   Private Key Valid: ${validatePrivateKey(testPrivateKey)}\n`);

  // 3. Create BonkService instance with custom config
  console.log("🔧 Creating BonkService with custom configuration...");
  const bonkService = new BonkService({
    baseSlippage: 40,
    maxSlippage: 75,
    maxRetries: 4,
    retrySlippageBonus: 15,
    lowLiquidityThreshold: 3,
    mediumLiquidityThreshold: 15,
  });

  console.log("✅ BonkService created successfully!\n");

  // 4. Example buy transaction (commented out for safety)
  /*
  console.log("🛒 Example Buy Transaction:");
  try {
    const buyResult = await executeBonkBuy(
      testPrivateKey,
      testMint,
      0.001, // 0.001 SOL
      "aggressive" // config mode
    );
    
    if (buyResult.success) {
      console.log("✅ Buy successful!");
      console.log(`   Signature: ${buyResult.signature}`);
      console.log(`   Explorer: ${buyResult.explorerUrl}`);
    } else {
      console.log("❌ Buy failed:");
      console.log(`   Error: ${buyResult.error}`);
      console.log(`   Message: ${buyResult.message}`);
    }
  } catch (error) {
    console.error("❌ Buy transaction error:", error);
  }
  */

  // 5. Example sell transaction (commented out for safety)
  /*
  console.log("\n💰 Example Sell Transaction:");
  try {
    const sellResult = await executeBonkSell(
      50, // 50% of holdings
      testPrivateKey,
      testMint,
      undefined, // tokenAmount (will be calculated from percentage)
      "conservative" // config mode
    );
    
    if (sellResult.success) {
      console.log("✅ Sell successful!");
      console.log(`   Signature: ${sellResult.signature}`);
      console.log(`   Explorer: ${sellResult.explorerUrl}`);
    } else {
      console.log("❌ Sell failed:");
      console.log(`   Error: ${sellResult.error}`);
      console.log(`   Message: ${sellResult.message}`);
    }
  } catch (error) {
    console.error("❌ Sell transaction error:", error);
  }
  */

  console.log("\n📝 Usage Examples:");
  console.log(`
// Buy tokens
const buyResult = await executeBonkBuy(
  privateKey,
  tokenMint,
  0.001, // SOL amount
  "aggressive" // config mode
);

// Sell tokens (percentage)
const sellResult = await executeBonkSell(
  50, // 50% of holdings
  privateKey,
  tokenMint,
  undefined, // tokenAmount (calculated from percentage)
  "conservative" // config mode
);

// Create custom BonkService
const bonkService = new BonkService({
  baseSlippage: 40,
  maxSlippage: 75,
  maxRetries: 4,
  retrySlippageBonus: 15,
  lowLiquidityThreshold: 3,
  mediumLiquidityThreshold: 15,
});

// Use service directly
const tx = await bonkService.buyTx({
  mint: new PublicKey(tokenMint),
  amount: BigInt(0.001 * LAMPORTS_PER_SOL),
  privateKey: privateKey,
});
  `);
}

// Run the test
testBonkServices().catch(console.error); 