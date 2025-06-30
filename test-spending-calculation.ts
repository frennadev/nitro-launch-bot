#!/usr/bin/env bun

import { compareSpendingCalculations, getAccurateSpendingStats, getDetailedSpendingBreakdown } from "./src/backend/functions";

async function testSpendingCalculation() {
  // Replace with an actual token address from your database
  const tokenAddress = process.argv[2];
  
  if (!tokenAddress) {
    console.log("Usage: bun run test-spending-calculation.ts <token_address>");
    console.log("Example: bun run test-spending-calculation.ts 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    process.exit(1);
  }

  console.log(`\n🔍 Analyzing spending calculations for token: ${tokenAddress}\n`);

  try {
    // Compare old vs new methods
    const comparison = await compareSpendingCalculations(tokenAddress);
    
    console.log("📊 SPENDING CALCULATION COMPARISON");
    console.log("=" .repeat(50));
    
    console.log("\n💰 OLD METHOD (Simple Sum):");
    console.log(`  Total Spent: ${comparison.comparison.oldMethod.totalSpent.toFixed(6)} SOL`);
    console.log(`  Dev Spent: ${comparison.comparison.oldMethod.totalDevSpent.toFixed(6)} SOL`);
    console.log(`  Snipe Spent: ${comparison.comparison.oldMethod.totalSnipeSpent.toFixed(6)} SOL`);
    console.log(`  Successful Buys: ${comparison.comparison.oldMethod.successfulBuys}`);
    console.log(`  Avg Per Wallet: ${comparison.comparison.oldMethod.averageSpentPerWallet.toFixed(6)} SOL`);
    
    console.log("\n🎯 NEW METHOD (Wallet-Grouped):");
    console.log(`  Total Spent: ${comparison.comparison.newMethod.totalSpent.toFixed(6)} SOL`);
    console.log(`  Dev Spent: ${comparison.comparison.newMethod.totalDevSpent.toFixed(6)} SOL`);
    console.log(`  Snipe Spent: ${comparison.comparison.newMethod.totalSnipeSpent.toFixed(6)} SOL`);
    console.log(`  Unique Buy Wallets: ${comparison.comparison.newMethod.successfulBuyWallets}`);
    console.log(`  Avg Per Wallet: ${comparison.comparison.newMethod.averageSpentPerWallet.toFixed(6)} SOL`);
    
    console.log("\n📈 DIFFERENCES:");
    console.log(`  Total Spent Difference: ${comparison.comparison.differences.totalSpentDifference.toFixed(6)} SOL`);
    console.log(`  Difference Percentage: ${comparison.comparison.differences.totalSpentDifferencePercentage.toFixed(2)}%`);
    console.log(`  Transaction Count Difference: ${comparison.comparison.differences.transactionCountDifference}`);
    console.log(`  Wallet Count Difference: ${comparison.comparison.differences.walletCountDifference}`);
    
    console.log("\n📋 DETAILED BREAKDOWN:");
    console.log(`  Total Wallets: ${comparison.detailedBreakdown.totalWallets}`);
    console.log(`  Wallets with Buys: ${comparison.detailedBreakdown.walletsWithBuys}`);
    console.log(`  Wallets with Sells: ${comparison.detailedBreakdown.walletsWithSells}`);
    console.log(`  Total Buy Transactions: ${comparison.detailedBreakdown.totalBuyTransactions}`);
    console.log(`  Total Sell Transactions: ${comparison.detailedBreakdown.totalSellTransactions}`);
    
    console.log("\n❌ OLD METHOD ISSUES:");
    comparison.explanation.oldMethodIssues.forEach((issue, index) => {
      console.log(`  ${index + 1}. ${issue}`);
    });
    
    console.log("\n✅ NEW METHOD IMPROVEMENTS:");
    comparison.explanation.newMethodImprovements.forEach((improvement, index) => {
      console.log(`  ${index + 1}. ${improvement}`);
    });

    // Get detailed breakdown for top 5 wallets
    const detailedBreakdown = await getDetailedSpendingBreakdown(tokenAddress);
    console.log("\n🏆 TOP 5 WALLETS BY SPENDING:");
    console.log("=" .repeat(80));
    
    detailedBreakdown.walletBreakdown.slice(0, 5).forEach((wallet, index) => {
      console.log(`\n${index + 1}. ${wallet.walletAddress.slice(0, 8)}...${wallet.walletAddress.slice(-8)}`);
      console.log(`   Total Spent: ${wallet.totalSpent.toFixed(6)} SOL`);
      console.log(`   Buy Transactions: ${wallet.buyTransactionCount} (${wallet.devBuys.length} dev + ${wallet.snipeBuys.length} snipe)`);
      console.log(`   Sell Transactions: ${wallet.sellTransactionCount}`);
      console.log(`   Net P&L: ${wallet.netProfitLoss.toFixed(6)} SOL`);
      
      if (wallet.snipeBuys.length > 1) {
        console.log(`   ⚠️  Multiple snipe transactions detected (${wallet.snipeBuys.length})`);
        wallet.snipeBuys.forEach((buy, buyIndex) => {
          console.log(`      Buy ${buyIndex + 1}: ${buy.amountSol?.toFixed(6)} SOL -> ${buy.amountTokens} tokens`);
        });
      }
    });

  } catch (error: any) {
    console.error("❌ Error analyzing spending calculations:", error.message);
    process.exit(1);
  }
}

// Run the test
testSpendingCalculation(); 