import { getPumpFunTokenInfo, calculateTokenHoldingsWorth } from "./src/backend/utils";

async function testEnhancedLaunchMessage() {
  console.log("🧪 Testing Enhanced Launch Message Calculation");
  console.log("=" .repeat(50));

  // Test with a sample token address (you can replace with an actual PumpFun token)
  const testTokenAddress = "FpRGkmWtwPKrLH7cWV6LFvuFVCCX6KSKy7zuA7sRPUmp";
  const testTotalTokens = "2300000000"; // 2.3M tokens in raw format (6 decimals)

  try {
    console.log(`\n📊 Testing PumpFun Token Info for: ${testTokenAddress.slice(0, 8)}...`);
    
    // Test getPumpFunTokenInfo
    const tokenInfo = await getPumpFunTokenInfo(testTokenAddress);
    
    if (tokenInfo) {
      console.log("\n✅ PumpFun Token Info Retrieved:");
      console.log(`   Market Cap: $${tokenInfo.marketCap.toLocaleString()}`);
      console.log(`   Price: $${Number(tokenInfo.priceUsd).toFixed(8)}`);
      console.log(`   Price in SOL: ${Number(tokenInfo.priceNative).toFixed(8)}`);
      console.log(`   Bonding Curve Progress: ${tokenInfo.bondingCurveProgress?.toFixed(2)}%`);
      console.log(`   Liquidity: $${tokenInfo.liquidity.usd.toFixed(2)}`);
    } else {
      console.log("❌ Could not retrieve PumpFun token info (token may not be on PumpFun or bonding curve not found)");
    }

    console.log(`\n💎 Testing Token Holdings Worth Calculation...`);
    
    // Test calculateTokenHoldingsWorth
    const holdingsWorth = await calculateTokenHoldingsWorth(testTokenAddress, testTotalTokens);
    
    console.log("\n✅ Token Holdings Worth Calculated:");
    console.log(`   Holdings: ${(Number(testTotalTokens) / 1e6).toLocaleString()} tokens`);
    console.log(`   Worth in USD: $${holdingsWorth.worthInUsd.toFixed(2)}`);
    console.log(`   Worth in SOL: ${holdingsWorth.worthInSol.toFixed(6)} SOL`);
    console.log(`   Price per Token: $${holdingsWorth.pricePerToken.toFixed(8)}`);
    console.log(`   Market Cap: $${holdingsWorth.marketCap.toLocaleString()}`);
    console.log(`   Bonding Curve Progress: ${holdingsWorth.bondingCurveProgress.toFixed(2)}%`);

    // Simulate launch message format
    console.log("\n🎉 Sample Enhanced Launch Message:");
    console.log("=" .repeat(50));
    
    const formatUSD = (amount: number) => `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    const formatSOL = (amount: number) => `${amount.toFixed(6)} SOL`;
    const formatPercentage = (percentage: number) => `${percentage.toFixed(1)}%`;
    
    // Sample financial stats (simulated)
    const sampleFinancialStats = {
      totalSpent: 5.929982,
      totalDevSpent: 0,
      totalSnipeSpent: 5.929982,
      successfulBuyWallets: 3
    };

    // Calculate P&L
    const estimatedSolPrice = 240;
    const totalSpentUsd = sampleFinancialStats.totalSpent * estimatedSolPrice;
    const profitLoss = holdingsWorth.worthInUsd - totalSpentUsd;
    const profitLossPercentage = (profitLoss / totalSpentUsd) * 100;

    const sampleMessage = [
      `🎉 Token Launched Successfully!`,
      `Name: TokenName`,
      `Symbol: TKN`,
      `Address: ${testTokenAddress}`,
      ``,
      `💰 Financial Overview:`,
      `➡️ Total Spent: ${formatSOL(sampleFinancialStats.totalSpent)}`,
      `➡️ Dev Allocation: ${formatSOL(sampleFinancialStats.totalDevSpent)}`,
      `➡️ Snipe Buys: ${formatSOL(sampleFinancialStats.totalSnipeSpent)}`,
      `➡️ Unique Buy Wallets: ${sampleFinancialStats.successfulBuyWallets}`,
      ``,
      `📊 Current Market Data:`,
      holdingsWorth.marketCap > 0 ? `➡️ Market Cap: ${formatUSD(holdingsWorth.marketCap)}` : "",
      holdingsWorth.pricePerToken > 0 ? `➡️ Price: $${holdingsWorth.pricePerToken.toFixed(8)}` : "",
      holdingsWorth.bondingCurveProgress > 0 ? `➡️ Bonding Curve: ${formatPercentage(holdingsWorth.bondingCurveProgress)}` : "",
      ``,
      `💎 Your Holdings:`,
      holdingsWorth.worthInUsd > 0 ? `➡️ Current Value: ${formatUSD(holdingsWorth.worthInUsd)}` : "",
      holdingsWorth.worthInSol > 0 ? `➡️ Worth in SOL: ${formatSOL(holdingsWorth.worthInSol)}` : "",
      profitLoss !== 0
        ? `➡️ P/L: ${profitLoss >= 0 ? "🟢" : "🔴"} ${formatUSD(profitLoss)} (${profitLossPercentage >= 0 ? "+" : ""}${formatPercentage(profitLossPercentage)})`
        : "",
      ``,
      `Use the buttons below for next steps ⬇️`,
    ]
      .filter(Boolean)
      .join("\n");

    console.log(sampleMessage);

  } catch (error: any) {
    console.error("❌ Test failed:", error.message);
    console.error("Full error:", error);
  }
}

// Run the test
testEnhancedLaunchMessage().catch(console.error); 