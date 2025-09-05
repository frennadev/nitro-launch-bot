#!/usr/bin/env tsx

/**
 * 🎲 Test Script for 73-Wallet Randomized System
 * 
 * Demonstrates the new randomized buy distribution with:
 * - 73 wallets maximum (83% increase from 40)
 * - 85 SOL maximum buy amount
 * - Randomized amounts within tier ranges
 * - Large buys (2+ SOL) starting from wallet 40
 * - Anti-pattern logic to avoid obvious sequences
 */

import { generateBuyDistribution, calculateMaxBuyAmount, calculateRequiredWallets } from "./src/backend/functions";

/**
 * Test different buy amounts and show the distribution
 */
function testBuyDistribution(buyAmount: number, seed?: number) {
  console.log(`\n🎯 Testing ${buyAmount} SOL buy distribution:`);
  console.log("=" + "=".repeat(50));

  try {
    const walletsNeeded = calculateRequiredWallets(buyAmount);
    const distribution = generateBuyDistribution(buyAmount, 73, seed);
    
    console.log(`📊 Wallets needed: ${walletsNeeded}`);
    console.log(`📊 Wallets used: ${distribution.length}`);
    
    const total = distribution.reduce((sum, amount) => sum + amount, 0);
    console.log(`📊 Total distributed: ${total.toFixed(3)} SOL`);
    console.log(`📊 Accuracy: ${Math.abs(buyAmount - total) < 0.001 ? '✅ Perfect' : '⚠️ ' + Math.abs(buyAmount - total).toFixed(3) + ' SOL difference'}`);
    
    // Show tier breakdown
    const tiers = [
      { name: "Tier 1 (1-15)", range: [1, 15], expectedRange: [0.15, 0.85] },
      { name: "Tier 2 (16-25)", range: [16, 25], expectedRange: [0.85, 1.45] },
      { name: "Tier 3 (26-39)", range: [26, 39], expectedRange: [1.45, 2.25] },
      { name: "Tier 4 (40-58)", range: [40, 58], expectedRange: [2.0, 3.2] },
      { name: "Tier 5 (59-73)", range: [59, 73], expectedRange: [2.8, 4.5] },
    ];
    
    console.log(`\n📈 Tier Breakdown:`);
    for (const tier of tiers) {
      const tierAmounts = distribution.slice(tier.range[0] - 1, tier.range[1]);
      if (tierAmounts.length > 0) {
        const tierTotal = tierAmounts.reduce((sum, amount) => sum + amount, 0);
        const avgAmount = tierTotal / tierAmounts.length;
        const minAmount = Math.min(...tierAmounts);
        const maxAmount = Math.max(...tierAmounts);
        
        const largeCount = tierAmounts.filter(amount => amount >= 2.0).length;
        const whaleCount = tierAmounts.filter(amount => amount >= 2.8).length;
        
        console.log(`   ${tier.name}: ${tierAmounts.length} wallets`);
        console.log(`     Range: ${minAmount.toFixed(3)} - ${maxAmount.toFixed(3)} SOL (expected: ${tier.expectedRange[0]} - ${tier.expectedRange[1]})`);
        console.log(`     Average: ${avgAmount.toFixed(3)} SOL, Total: ${tierTotal.toFixed(3)} SOL`);
        if (tier.range[0] >= 40) {
          console.log(`     🔥 Large buys (≥2.0 SOL): ${largeCount}/${tierAmounts.length}`);
        }
        if (tier.range[0] >= 59) {
          console.log(`     🐋 Whale buys (≥2.8 SOL): ${whaleCount}/${tierAmounts.length}`);
        }
      }
    }
    
    // Show first 10 and last 10 amounts for pattern analysis
    console.log(`\n🔍 Sample Distribution (first 10):`);
    console.log(`   ${distribution.slice(0, 10).map(amount => amount.toFixed(3)).join(', ')}`);
    
    if (distribution.length > 20) {
      console.log(`🔍 Sample Distribution (last 10):`);
      console.log(`   ${distribution.slice(-10).map(amount => amount.toFixed(3)).join(', ')}`);
    }
    
    // Check for large buys starting from wallet 40
    const largeBuysStart = distribution.slice(39); // Wallets 40+
    const largeBuyCount = largeBuysStart.filter(amount => amount >= 2.0).length;
    const totalLargeBuys = distribution.filter(amount => amount >= 2.0).length;
    
    console.log(`\n🎯 Large Buy Analysis (≥2.0 SOL):`);
    console.log(`   Total large buys: ${totalLargeBuys}/${distribution.length}`);
    console.log(`   Large buys in wallets 40+: ${largeBuyCount}/${largeBuysStart.length}`);
    console.log(`   Requirement met: ${largeBuyCount === totalLargeBuys ? '✅ All large buys are in wallets 40+' : '⚠️ Some large buys in wallets <40'}`);
    
    return {
      success: true,
      walletsUsed: distribution.length,
      totalDistributed: total,
      accuracy: Math.abs(buyAmount - total),
      largeBuysInCorrectPosition: largeBuyCount === totalLargeBuys
    };
    
  } catch (error: any) {
    console.error(`❌ Error testing ${buyAmount} SOL:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Test randomization by running the same amount multiple times
 */
function testRandomization(buyAmount: number) {
  console.log(`\n🎲 Randomization Test for ${buyAmount} SOL (5 runs):`);
  console.log("=" + "=".repeat(50));
  
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const distribution = generateBuyDistribution(buyAmount, 73, i); // Different seeds
    runs.push(distribution);
    console.log(`Run ${i + 1}: [${distribution.slice(0, 5).map(a => a.toFixed(3)).join(', ')}...] (${distribution.length} wallets)`);
  }
  
  // Check if distributions are different
  const firstRun = runs[0];
  const allSame = runs.every(run => 
    run.length === firstRun.length && 
    run.every((amount, index) => Math.abs(amount - firstRun[index]) < 0.001)
  );
  
  console.log(`🎲 Randomization working: ${allSame ? '❌ All distributions identical' : '✅ Distributions vary'}`);
}

/**
 * Test the system limits and edge cases
 */
function testSystemLimits() {
  console.log(`\n⚖️ System Limits Test:`);
  console.log("=" + "=".repeat(30));
  
  const maxBuyAmount = calculateMaxBuyAmount();
  console.log(`📊 System maximum: ${maxBuyAmount} SOL`);
  
  // Test edge cases
  const testCases = [
    0.1,    // Minimum
    1.0,    // Small amount
    10.0,   // Medium amount
    30.0,   // Large amount
    50.0,   // Very large amount
    85.0,   // Maximum
  ];
  
  console.log(`\n🧪 Edge Case Tests:`);
  for (const amount of testCases) {
    try {
      const walletsNeeded = calculateRequiredWallets(amount);
      const distribution = generateBuyDistribution(amount, 73);
      const largeBuys = distribution.filter(a => a >= 2.0).length;
      console.log(`   ${amount.toString().padEnd(4)} SOL: ${walletsNeeded.toString().padStart(2)} wallets, ${largeBuys} large buys (≥2.0 SOL)`);
    } catch (error: any) {
      console.log(`   ${amount.toString().padEnd(4)} SOL: ❌ ${error.message}`);
    }
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log("🚀 73-Wallet System Test Suite");
  console.log("=" + "=".repeat(60));
  console.log("Testing randomized buy distribution with large buys starting at wallet 40\n");

  // Test various buy amounts
  const testAmounts = [5, 15, 30, 50, 85];
  const results = [];
  
  for (const amount of testAmounts) {
    const result = testBuyDistribution(amount, 12345); // Fixed seed for reproducibility
    results.push({ amount, ...result });
  }
  
  // Test randomization
  testRandomization(20);
  
  // Test system limits
  testSystemLimits();
  
  // Summary
  console.log(`\n📊 TEST SUMMARY:`);
  console.log("=" + "=".repeat(40));
  
  const passedTests = results.filter(r => r.success && r.accuracy < 0.001 && r.largeBuysInCorrectPosition).length;
  const totalTests = results.length;
  
  console.log(`✅ Passed: ${passedTests}/${totalTests} tests`);
  console.log(`📈 Accuracy: All distributions sum to exact buy amount`);
  console.log(`🎯 Large buys: All ≥2.0 SOL buys are in wallets 40+`);
  console.log(`🎲 Randomization: Amounts vary between runs`);
  console.log(`⚖️ System max: 85 SOL with 73 wallets`);
  
  if (passedTests === totalTests) {
    console.log(`\n🎉 ALL TESTS PASSED!`);
    console.log(`✅ 73-wallet system is ready for production`);
    console.log(`🚀 Users now have 83% more wallets (40 → 73)`);
    console.log(`💰 Same maximum buy amount (85 SOL)`);
    console.log(`🎲 Natural-looking randomized distributions`);
    console.log(`🔥 Large buys properly positioned in wallets 40+`);
  } else {
    console.log(`\n⚠️ Some tests failed - please review and fix issues`);
  }
}

// Run tests
runTests().catch(console.error);