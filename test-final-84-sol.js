console.log("Final verification of new 84 SOL distribution");

// New distribution with user-specified wallet group totals:
// Wallets 8-15: 10 SOL total
// Wallets 16-20: 11 SOL total  
// Wallets 21-30: 22.506 SOL total
// Wallets 31-40: 35 SOL total

// First 7 wallets (reduced by 18%)
const firstSevenReduced = [0.41, 0.574, 0.738, 0.82, 0.902, 0.984, 1.066];
const firstSevenTotal = firstSevenReduced.reduce((sum, amount) => sum + amount, 0);

// New wallet group totals
const nextEightTotal = 10.0; // Wallets 8-15
const nextFiveTotal = 11.0;  // Wallets 16-20
const nextTenTotal = 22.506; // Wallets 21-30
const lastTenTotal = 35.0;   // Wallets 31-40

const total = firstSevenTotal + nextEightTotal + nextFiveTotal + nextTenTotal + lastTenTotal;

console.log("📊 FINAL DISTRIBUTION BREAKDOWN:");
console.log("Wallets 1-7 (reduced by 18%):", firstSevenReduced.map(x => x.toFixed(3)));
console.log("  Total: ", firstSevenTotal.toFixed(3), "SOL");
console.log("Wallets 8-15: 10.0 SOL total");
console.log("  Amount per wallet: ", (nextEightTotal / 8).toFixed(3), "SOL each");
console.log("Wallets 16-20: 11.0 SOL total");
console.log("  Amount per wallet: ", (nextFiveTotal / 5).toFixed(3), "SOL each");
console.log("Wallets 21-30: 22.506 SOL total");
console.log("  Amount per wallet: ", (nextTenTotal / 10).toFixed(3), "SOL each");
console.log("Wallets 31-40: 35.0 SOL total");
console.log("  Amount per wallet: ", (lastTenTotal / 10).toFixed(3), "SOL each");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("GRAND TOTAL: ", total.toFixed(3), "SOL");
console.log("Expected: 84.0 SOL");
console.log("Match: ", Math.abs(total - 84) < 0.001 ? "✅ YES" : "❌ NO");

console.log("\n🎯 REDUCTION SUMMARY:");
const originalFirst7 = [0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3];
const originalFirst7Total = originalFirst7.reduce((sum, amount) => sum + amount, 0);
const reduction = originalFirst7Total - firstSevenTotal;
console.log("Original first 7 total:", originalFirst7Total.toFixed(3), "SOL");
console.log("Reduced first 7 total:", firstSevenTotal.toFixed(3), "SOL");
console.log("Reduction amount:", reduction.toFixed(3), "SOL");
console.log("Reduction percentage:", ((reduction / originalFirst7Total) * 100).toFixed(1), "%");

console.log("\n📋 NEW WALLET AMOUNTS:");
console.log("Wallets 8-15: ", (nextEightTotal / 8).toFixed(3), "SOL each");
console.log("Wallets 16-20: ", (nextFiveTotal / 5).toFixed(3), "SOL each");
console.log("Wallets 21-30: ", (nextTenTotal / 10).toFixed(3), "SOL each");
console.log("Wallets 31-40: ", (lastTenTotal / 10).toFixed(3), "SOL each");

console.log("\n🔍 DISTRIBUTION ANALYSIS:");
console.log("First 7 wallets: ", ((firstSevenTotal / total) * 100).toFixed(1), "% of total");
console.log("Wallets 8-15: ", ((nextEightTotal / total) * 100).toFixed(1), "% of total");
console.log("Wallets 16-20: ", ((nextFiveTotal / total) * 100).toFixed(1), "% of total");
console.log("Wallets 21-30: ", ((nextTenTotal / total) * 100).toFixed(1), "% of total");
console.log("Wallets 31-40: ", ((lastTenTotal / total) * 100).toFixed(1), "% of total"); 