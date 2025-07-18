console.log("Final verification of 84 SOL distribution");

// New distribution with reduced first 7 wallets
const firstSevenReduced = [0.41, 0.574, 0.738, 0.82, 0.902, 0.984, 1.066];
const nextEightSequence = [1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1];

const firstSevenTotal = firstSevenReduced.reduce((sum, amount) => sum + amount, 0);
const nextEightTotal = nextEightSequence.reduce((sum, amount) => sum + amount, 0);
const firstFifteenTotal = firstSevenTotal + nextEightTotal;

const nextFiveTotal = 5 * 3.6; // 18.0 SOL
const nextTenTotal = 10 * 2.8; // 28.0 SOL

// Calculate exact amount needed for last 10 wallets to get 84 SOL total
const remainingForLast10 = 84 - firstFifteenTotal - nextFiveTotal - nextTenTotal;
const lastTenAmount = remainingForLast10 / 10;
const lastTenTotal = 10 * lastTenAmount;

const total = firstFifteenTotal + nextFiveTotal + nextTenTotal + lastTenTotal;

console.log("📊 NEW DISTRIBUTION BREAKDOWN:");
console.log("Wallets 1-7 (reduced by 18%):", firstSevenReduced.map(x => x.toFixed(3)));
console.log("  Total: ", firstSevenTotal.toFixed(3), "SOL");
console.log("Wallets 8-15 (unchanged):", nextEightSequence);
console.log("  Total: ", nextEightTotal.toFixed(3), "SOL");
console.log("Wallets 16-20: 5 wallets at 3.6 SOL each");
console.log("  Total: ", nextFiveTotal.toFixed(3), "SOL");
console.log("Wallets 21-30: 10 wallets at 2.8 SOL each");
console.log("  Total: ", nextTenTotal.toFixed(3), "SOL");
console.log("Wallets 31-40: 10 wallets at", lastTenAmount.toFixed(3), "SOL each");
console.log("  Total: ", lastTenTotal.toFixed(3), "SOL");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("GRAND TOTAL: ", total.toFixed(3), "SOL");
console.log("Expected: 84.000 SOL");
console.log("Match: ", Math.abs(total - 84) < 0.001 ? "✅ YES" : "❌ NO");

console.log("\n🎯 REDUCTION SUMMARY:");
const originalFirst7 = [0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3];
const originalFirst7Total = originalFirst7.reduce((sum, amount) => sum + amount, 0);
const reduction = originalFirst7Total - firstSevenTotal;
console.log("Original first 7 total:", originalFirst7Total.toFixed(3), "SOL");
console.log("Reduced first 7 total:", firstSevenTotal.toFixed(3), "SOL");
console.log("Reduction amount:", reduction.toFixed(3), "SOL");
console.log("Reduction percentage:", ((reduction / originalFirst7Total) * 100).toFixed(1), "%"); 