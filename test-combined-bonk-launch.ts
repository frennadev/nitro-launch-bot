import { launchBonkTokenWithDevBuy } from "./src/blockchain/letsbonk/integrated-token-creator";

async function testCombinedBonkLaunch() {
  try {
    console.log("=== Testing Combined Bonk Token Launch ===");
    
    // Test parameters
    const tokenAddress = "YOUR_TOKEN_ADDRESS_HERE"; // Replace with actual token address
    const userId = "YOUR_USER_ID_HERE"; // Replace with actual user ID
    const devBuy = 0.1; // 0.1 SOL dev buy
    
    console.log(`Testing with token: ${tokenAddress}`);
    console.log(`User ID: ${userId}`);
    console.log(`Dev buy amount: ${devBuy} SOL`);
    
    // Test the combined function
    const result = await launchBonkTokenWithDevBuy(tokenAddress, userId, devBuy);
    
    console.log("\n=== Test Results ===");
    console.log(`Success: ${result.success}`);
    console.log(`Signature: ${result.signature}`);
    console.log(`Token Name: ${result.tokenName}`);
    console.log(`Token Symbol: ${result.tokenSymbol}`);
    console.log(`Dev Buy Amount: ${result.devBuyAmount}`);
    console.log(`Transaction Type: ${result.transactionType}`);
    
    console.log("\n✅ Combined launch test completed successfully!");
    
  } catch (error: any) {
    console.error("❌ Combined launch test failed:", error.message);
    console.error("Stack trace:", error.stack);
  }
}

// Run the test
testCombinedBonkLaunch(); 