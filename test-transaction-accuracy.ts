#!/usr/bin/env bun

import { 
  compareSpendingCalculations, 
  getAccurateSpendingStats, 
  getDetailedSpendingBreakdown,
  getTransactionFinancialStats,
  getSellTransactionHistory,
  getDetailedSellSummary
} from "./src/backend/functions";

async function testTransactionAccuracy() {
  // Replace with an actual token address from your database
  const tokenAddress = process.argv[2];
  
  if (!tokenAddress) {
    console.log("Usage: bun run test-transaction-accuracy.ts <token_address>");
    console.log("Example: bun run test-transaction-accuracy.ts 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    process.exit(1);
  }

  console.log(`\n🔍 Analyzing transaction accuracy for token: ${tokenAddress}\n`);

  try {
    // Test 1: Compare old vs new spending calculations
    console.log("📊 TEST 1: SPENDING CALCULATION COMPARISON");
    console.log("=" .repeat(60));
    
    const comparison = await compareSpendingCalculations(tokenAddress);
    
    console.log("\n💰 OLD METHOD (Simple Sum):");
    console.log(`  Total Spent: ${comparison.comparison.oldMethod.totalSpent.toFixed(6)} SOL`);
    console.log(`  Dev Spent: ${comparison.comparison.oldMethod.totalDevSpent.toFixed(6)} SOL`);
    console.log(`  Snipe Spent: ${comparison.comparison.oldMethod.totalSnipeSpent.toFixed(6)} SOL`);
    console.log(`  Successful Buys: ${comparison.comparison.oldMethod.successfulBuys}`);
    
    console.log("\n🎯 NEW METHOD (Wallet-Grouped):");
    console.log(`  Total Spent: ${comparison.comparison.newMethod.totalSpent.toFixed(6)} SOL`);
    console.log(`  Dev Spent: ${comparison.comparison.newMethod.totalDevSpent.toFixed(6)} SOL`);
    console.log(`  Snipe Spent: ${comparison.comparison.newMethod.totalSnipeSpent.toFixed(6)} SOL`);
    console.log(`  Unique Buy Wallets: ${comparison.comparison.newMethod.successfulBuyWallets}`);
    
    console.log("\n📈 DIFFERENCES:");
    console.log(`  Total Spent Difference: ${comparison.comparison.differences.totalSpentDifference.toFixed(6)} SOL`);
    console.log(`  Difference Percentage: ${comparison.comparison.differences.totalSpentDifferencePercentage.toFixed(2)}%`);
    console.log(`  Transaction Count Difference: ${comparison.comparison.differences.transactionCountDifference}`);
    console.log(`  Wallet Count Difference: ${comparison.comparison.differences.walletCountDifference}`);

    // Test 2: Check sell transaction recording
    console.log("\n\n📊 TEST 2: SELL TRANSACTION RECORDING");
    console.log("=" .repeat(60));
    
    const sellHistory = await getSellTransactionHistory(tokenAddress);
    const sellSummary = await getDetailedSellSummary(tokenAddress);
    
    console.log(`\n📋 SELL TRANSACTION SUMMARY:`);
    console.log(`  Total Sell Transactions: ${sellSummary.totalSells}`);
    console.log(`  Successful Sells: ${sellSummary.successfulSells}`);
    console.log(`  Failed Sells: ${sellSummary.failedSells}`);
    console.log(`  Total SOL Earned: ${sellSummary.totalSolEarned.toFixed(6)} SOL`);
    console.log(`  Total Tokens Sold: ${sellSummary.totalTokensSold}`);
    
    if (sellHistory.length > 0) {
      console.log(`\n📝 RECENT SELL TRANSACTIONS:`);
      sellHistory.slice(0, 5).forEach((sell, index) => {
        console.log(`  ${index + 1}. ${sell.walletAddress.slice(0, 8)}...${sell.walletAddress.slice(-8)}`);
        console.log(`     Type: ${sell.transactionType}`);
        console.log(`     SOL Received: ${sell.solReceived.toFixed(6)} SOL`);
        console.log(`     Tokens Sold: ${sell.tokensSold}`);
        console.log(`     Success: ${sell.success ? '✅' : '❌'}`);
        console.log(`     Signature: ${sell.signature.slice(0, 8)}...${sell.signature.slice(-8)}`);
        console.log("");
      });
    } else {
      console.log("  ❌ No sell transactions found in database");
    }

    // Test 3: Check if sell transactions are being recorded
    console.log("\n\n📊 TEST 3: SELL TRANSACTION RECORDING STATUS");
    console.log("=" .repeat(60));
    
    const accurateStats = await getAccurateSpendingStats(tokenAddress);
    
    console.log(`\n💰 EARNINGS FROM SELLS:`);
    console.log(`  Total Earned: ${accurateStats.totalEarned.toFixed(6)} SOL`);
    console.log(`  Dev Earned: ${accurateStats.totalDevEarned.toFixed(6)} SOL`);
    console.log(`  Wallet Earned: ${accurateStats.totalWalletEarned.toFixed(6)} SOL`);
    console.log(`  External Earned: ${accurateStats.totalExternalEarned.toFixed(6)} SOL`);
    console.log(`  Unique Sell Wallets: ${accurateStats.uniqueSellWallets}`);
    
    console.log(`\n🪙 TOKENS SOLD:`);
    console.log(`  Total Tokens Sold: ${accurateStats.totalTokensSold}`);
    console.log(`  Dev Tokens Sold: ${accurateStats.totalDevTokensSold}`);
    console.log(`  Wallet Tokens Sold: ${accurateStats.totalWalletTokensSold}`);
    console.log(`  External Tokens Sold: ${accurateStats.totalExternalTokensSold}`);
    
    console.log(`\n📊 P&L CALCULATION:`);
    console.log(`  Total Spent: ${accurateStats.totalSpent.toFixed(6)} SOL`);
    console.log(`  Total Earned: ${accurateStats.totalEarned.toFixed(6)} SOL`);
    console.log(`  Net P&L: ${accurateStats.netProfitLoss.toFixed(6)} SOL`);
    console.log(`  P&L Percentage: ${accurateStats.profitLossPercentage.toFixed(2)}%`);
    console.log(`  Is Profit: ${accurateStats.isProfit ? '🟢 Yes' : '🔴 No'}`);

    // Test 4: Detailed breakdown
    console.log("\n\n📊 TEST 4: DETAILED WALLET BREAKDOWN");
    console.log("=" .repeat(60));
    
    const detailedBreakdown = await getDetailedSpendingBreakdown(tokenAddress);
    
    console.log(`\n📋 SUMMARY:`);
    console.log(`  Total Wallets: ${detailedBreakdown.summary.totalWallets}`);
    console.log(`  Wallets with Buys: ${detailedBreakdown.summary.walletsWithBuys}`);
    console.log(`  Wallets with Sells: ${detailedBreakdown.summary.walletsWithSells}`);
    console.log(`  Total Buy Transactions: ${detailedBreakdown.summary.totalBuyTransactions}`);
    console.log(`  Total Sell Transactions: ${detailedBreakdown.summary.totalSellTransactions}`);
    
    if (detailedBreakdown.walletBreakdown.length > 0) {
      console.log(`\n🏆 TOP 5 WALLETS BY ACTIVITY:`);
      detailedBreakdown.walletBreakdown.slice(0, 5).forEach((wallet, index) => {
        console.log(`\n${index + 1}. ${wallet.walletAddress.slice(0, 8)}...${wallet.walletAddress.slice(-8)}`);
        console.log(`   Total Spent: ${wallet.totalSpent.toFixed(6)} SOL`);
        console.log(`   Total Earned: ${wallet.totalEarned.toFixed(6)} SOL`);
        console.log(`   Net P&L: ${wallet.netProfitLoss.toFixed(6)} SOL`);
        console.log(`   Buy Transactions: ${wallet.buyTransactionCount} (${wallet.devBuys.length} dev + ${wallet.snipeBuys.length} snipe)`);
        console.log(`   Sell Transactions: ${wallet.sellTransactionCount} (${wallet.devSells.length} dev + ${wallet.walletSells.length} wallet + ${wallet.externalSells.length} external)`);
        
        if (wallet.snipeBuys.length > 1) {
          console.log(`   ⚠️  Multiple snipe transactions detected (${wallet.snipeBuys.length})`);
        }
        
        if (wallet.walletSells.length > 0 || wallet.devSells.length > 0 || wallet.externalSells.length > 0) {
          console.log(`   ✅ Has sell transactions`);
        } else {
          console.log(`   ❌ No sell transactions recorded`);
        }
      });
    }

    // Test 5: Accuracy assessment
    console.log("\n\n📊 TEST 5: ACCURACY ASSESSMENT");
    console.log("=" .repeat(60));
    
    const issues: string[] = [];
    const improvements: string[] = [];
    
    // Check for spending calculation issues
    if (comparison.comparison.differences.totalSpentDifference > 0.001) {
      issues.push(`Spending amounts inflated by ${comparison.comparison.differences.totalSpentDifference.toFixed(6)} SOL (${comparison.comparison.differences.totalSpentDifferencePercentage.toFixed(2)}%)`);
    } else {
      improvements.push("Spending calculations are accurate");
    }
    
    // Check for sell transaction recording
    if (accurateStats.totalEarned === 0 && accurateStats.totalSpent > 0) {
      issues.push("No sell transactions recorded despite having buy transactions");
    } else if (accurateStats.totalEarned > 0) {
      improvements.push("Sell transactions are being recorded");
    }
    
    // Check for multiple transactions per wallet
    if (comparison.comparison.differences.transactionCountDifference > 0) {
      issues.push(`${comparison.comparison.differences.transactionCountDifference} wallets have multiple buy transactions`);
    } else {
      improvements.push("No multiple transactions per wallet detected");
    }
    
    console.log("\n❌ ISSUES FOUND:");
    if (issues.length === 0) {
      console.log("  ✅ No issues detected");
    } else {
      issues.forEach((issue, index) => {
        console.log(`  ${index + 1}. ${issue}`);
      });
    }
    
    console.log("\n✅ IMPROVEMENTS:");
    improvements.forEach((improvement, index) => {
      console.log(`  ${index + 1}. ${improvement}`);
    });
    
    console.log("\n🎯 RECOMMENDATIONS:");
    if (issues.length === 0) {
      console.log("  ✅ Transaction data appears to be accurate");
    } else {
      console.log("  🔧 Consider implementing the fixes for the issues above");
    }

  } catch (error: any) {
    console.error("❌ Error analyzing transaction accuracy:", error.message);
    process.exit(1);
  }
}

// Run the test
testTransactionAccuracy(); 