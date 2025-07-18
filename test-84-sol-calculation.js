console.log("Testing 84 SOL calculation");
const first15 = [0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1];
const total15 = first15.reduce((sum, amount) => sum + amount, 0);
const total20 = total15 + (5 * 3.5);
const total30 = total20 + (10 * 2.75);
const total40 = total30 + (10 * 1.75);
console.log("Total 40 wallets:", total40, "SOL");
console.log("Expected: 84.0 SOL");
console.log("Match:", Math.abs(total40 - 84) < 0.1 ? "YES" : "NO");
