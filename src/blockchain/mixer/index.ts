#!/usr/bin/env ts-node

import * as dotenv from "dotenv";
import { runMixer } from "./mixer";

// Load environment variables
dotenv.config();

// CLI usage (only when run directly)
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.log("🔀 Solana Mixer - Privacy-focused SOL mixing");
    console.log("");
    console.log("Usage:");
    console.log(
      "  npm run mixer <funding_private_key> <fee_funding_private_key> <total_amount_sol> <destination1> [destination2] [destination3] ..."
    );
    console.log("");
    console.log("Arguments:");
    console.log(
      "  funding_private_key      - Base58 private key of wallet containing SOL to mix"
    );
    console.log(
      "  fee_funding_private_key  - Base58 private key of wallet that pays transaction fees"
    );
    console.log(
      "  total_amount_sol         - Total amount of SOL to mix (e.g., 1.5)"
    );
    console.log(
      "  destination1, 2, 3...    - Public keys of wallets to receive mixed SOL"
    );
    console.log("");
    console.log("Amount Distribution:");
    console.log("  • Each destination receives 0.01 to 2.0 SOL randomly");
    console.log("  • Total amount is split randomly among all destinations");
    console.log("  • Minimum total: 0.01 × number_of_destinations SOL");
    console.log("  • Maximum total: 2.0 × number_of_destinations SOL");
    console.log("");
    console.log("Example:");
    console.log(
      "  npm run mixer <your_funding_private_key> <your_fee_funding_private_key> 1.5 <destination_wallet_1> <destination_wallet_2>"
    );
    console.log("");
    console.log("Features:");
    console.log("  • Mixes SOL through intermediate wallets for privacy");
    console.log("  • Uses separate wallet for transaction fees");
    console.log("  • Completes mixing in 3-7 seconds regardless of size");
    console.log(
      "  • Randomly distributes amounts between 0.01-2 SOL per destination"
    );
    console.log("  • Stores intermediate wallets in MongoDB for reuse");
    process.exit(1);
  }

  const [fundingKey, feeKey, totalAmountStr, ...destinations] = args;
  const totalAmount = parseFloat(totalAmountStr);

  if (isNaN(totalAmount) || totalAmount <= 0) {
    console.error("❌ Invalid total amount. Must be a positive number.");
    process.exit(1);
  }

  runMixer(fundingKey, feeKey, totalAmount, destinations)
    .then((result) => {
      console.log(
        `\n✅ Mixing completed: ${result.successCount}/${result.totalRoutes} routes successful`
      );
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error("❌ Mixing failed:", error.message);
      process.exit(1);
    });
}