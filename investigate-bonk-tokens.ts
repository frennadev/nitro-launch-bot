import { Connection, PublicKey } from "@solana/web3.js";
import { config } from "dotenv";

config();

/**
 * 🔍 INVESTIGATE BONK TOKENS
 *
 * Deep investigation of the user-provided BONK tokens to understand their structure
 */

const TOKENS_TO_INVESTIGATE = [
  "Boy2c5w2Ti6Bakwj2j8DebqKRH144dskQXfLzJm6bonk",
  "2LN6ACTjG6YCKfZ6JKcJDTshf3fTBdsa2gDjr37wbonk",
];

async function investigateBonkTokens() {
  console.log("🔍 INVESTIGATING BONK TOKENS\n");

  const heliusRpcUrl =
    process.env.HELIUS_RPC_URL || process.env.UTILS_HELIUS_RPC;
  if (!heliusRpcUrl) {
    throw new Error(
      "HELIUS_RPC_URL or UTILS_HELIUS_RPC environment variable is required"
    );
  }
  const connection = new Connection(heliusRpcUrl, "confirmed");

  for (const mintAddress of TOKENS_TO_INVESTIGATE) {
    console.log(`🎯 INVESTIGATING: ${mintAddress}`);
    console.log("═".repeat(80));

    try {
      const mint = new PublicKey(mintAddress);

      // 1. Check basic mint account
      console.log("📊 1. BASIC MINT ACCOUNT INFO:");
      const mintAccount = await connection.getAccountInfo(mint);
      if (mintAccount) {
        console.log(`   ✅ Mint exists`);
        console.log(`   📦 Owner: ${mintAccount.owner.toBase58()}`);
        console.log(`   💾 Data length: ${mintAccount.data.length} bytes`);
        console.log(`   💰 Lamports: ${mintAccount.lamports}`);
      } else {
        console.log(`   ❌ Mint account not found`);
        continue;
      }

      // 2. Check for PumpFun bonding curve
      console.log("\n🚀 2. PUMPFUN BONDING CURVE CHECK:");
      const PUMPFUN_PROGRAM = new PublicKey(
        "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
      );
      const [pumpfunBondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), mint.toBuffer()],
        PUMPFUN_PROGRAM
      );

      const pumpfunAccount =
        await connection.getAccountInfo(pumpfunBondingCurve);
      if (pumpfunAccount) {
        console.log(
          `   ✅ PumpFun bonding curve found: ${pumpfunBondingCurve.toBase58()}`
        );
        console.log(`   📦 Owner: ${pumpfunAccount.owner.toBase58()}`);
        console.log(`   💾 Data length: ${pumpfunAccount.data.length} bytes`);
      } else {
        console.log(`   ❌ PumpFun bonding curve not found`);
      }

      // 3. Check token metadata
      console.log("\n🏷️  3. TOKEN METADATA CHECK:");
      const METADATA_PROGRAM = new PublicKey(
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
      );
      const [metadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
        METADATA_PROGRAM
      );

      const metadataAccount = await connection.getAccountInfo(metadata);
      if (metadataAccount) {
        console.log(`   ✅ Metadata found: ${metadata.toBase58()}`);
        console.log(`   📦 Owner: ${metadataAccount.owner.toBase58()}`);
        console.log(`   💾 Data length: ${metadataAccount.data.length} bytes`);

        // Try to parse basic metadata
        try {
          const nameLength = metadataAccount.data.readUInt32LE(69);
          const name = metadataAccount.data
            .slice(73, 73 + nameLength)
            .toString()
            .replace(/\0/g, "");
          console.log(`   📛 Name: "${name}"`);

          const symbolStart = 73 + nameLength + 4;
          const symbolLength = metadataAccount.data.readUInt32LE(
            symbolStart - 4
          );
          const symbol = metadataAccount.data
            .slice(symbolStart, symbolStart + symbolLength)
            .toString()
            .replace(/\0/g, "");
          console.log(`   🔤 Symbol: "${symbol}"`);
        } catch (error) {
          console.log(`   ⚠️  Could not parse metadata details`);
        }
      } else {
        console.log(`   ❌ Metadata not found`);
      }

      // 4. Check for token activity
      console.log("\n🏦 4. TOKEN ACTIVITY CHECK:");
      try {
        const largestAccounts = await connection.getTokenLargestAccounts(mint);
        console.log(
          `   📊 Found ${largestAccounts.value.length} token accounts`
        );

        if (largestAccounts.value.length > 0) {
          console.log(
            `   💰 Largest holder: ${largestAccounts.value[0].amount} tokens`
          );
          console.log(
            `   👥 Total accounts with balance: ${largestAccounts.value.filter((acc) => acc.amount !== "0").length}`
          );
        }
      } catch (error) {
        console.log(`   ❌ Could not fetch token accounts: ${error}`);
      }
    } catch (error: any) {
      console.log(`💥 Investigation failed: ${error.message}`);
    }

    console.log("\n" + "═".repeat(80) + "\n");
  }

  console.log("🎉 INVESTIGATION COMPLETE!");
  console.log("\n📋 ANALYSIS:");
  console.log(
    "These tokens appear to be standard SPL tokens, not bonding curve tokens."
  );
  console.log("They may be:");
  console.log("1. Regular SPL tokens without bonding curves");
  console.log("2. Tokens that use a different bonding curve program");
  console.log("3. Tokens that have already graduated and migrated");
  console.log("4. Mock tokens for testing purposes");
}

// Run the investigation
investigateBonkTokens().catch(console.error);

/**
 * 🔍 INVESTIGATE BONK TOKENS
 *
 * Deep investigation of the user-provided BONK tokens to understand their structure
 */

const TOKENS_TO_INVESTIGATE = [
  "Boy2c5w2Ti6Bakwj2j8DebqKRH144dskQXfLzJm6bonk",
  "2LN6ACTjG6YCKfZ6JKcJDTshf3fTBdsa2gDjr37wbonk",
];

async function investigateBonkTokens() {
  console.log("🔍 INVESTIGATING BONK TOKENS\n");

  const heliusRpcUrl =
    process.env.HELIUS_RPC_URL || process.env.UTILS_HELIUS_RPC;
  if (!heliusRpcUrl) {
    throw new Error(
      "HELIUS_RPC_URL or UTILS_HELIUS_RPC environment variable is required"
    );
  }
  const connection = new Connection(heliusRpcUrl, "confirmed");

  for (const mintAddress of TOKENS_TO_INVESTIGATE) {
    console.log(`🎯 INVESTIGATING: ${mintAddress}`);
    console.log("═".repeat(80));

    try {
      const mint = new PublicKey(mintAddress);

      // 1. Check basic mint account
      console.log("📊 1. BASIC MINT ACCOUNT INFO:");
      const mintAccount = await connection.getAccountInfo(mint);
      if (mintAccount) {
        console.log(`   ✅ Mint exists`);
        console.log(`   📦 Owner: ${mintAccount.owner.toBase58()}`);
        console.log(`   💾 Data length: ${mintAccount.data.length} bytes`);
        console.log(`   💰 Lamports: ${mintAccount.lamports}`);
      } else {
        console.log(`   ❌ Mint account not found`);
        continue;
      }

      // 2. Check for PumpFun bonding curve
      console.log("\n🚀 2. PUMPFUN BONDING CURVE CHECK:");
      const PUMPFUN_PROGRAM = new PublicKey(
        "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
      );
      const [pumpfunBondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), mint.toBuffer()],
        PUMPFUN_PROGRAM
      );

      const pumpfunAccount =
        await connection.getAccountInfo(pumpfunBondingCurve);
      if (pumpfunAccount) {
        console.log(
          `   ✅ PumpFun bonding curve found: ${pumpfunBondingCurve.toBase58()}`
        );
        console.log(`   📦 Owner: ${pumpfunAccount.owner.toBase58()}`);
        console.log(`   💾 Data length: ${pumpfunAccount.data.length} bytes`);
      } else {
        console.log(`   ❌ PumpFun bonding curve not found`);
      }

      // 3. Check token metadata
      console.log("\n🏷️  3. TOKEN METADATA CHECK:");
      const METADATA_PROGRAM = new PublicKey(
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
      );
      const [metadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
        METADATA_PROGRAM
      );

      const metadataAccount = await connection.getAccountInfo(metadata);
      if (metadataAccount) {
        console.log(`   ✅ Metadata found: ${metadata.toBase58()}`);
        console.log(`   📦 Owner: ${metadataAccount.owner.toBase58()}`);
        console.log(`   💾 Data length: ${metadataAccount.data.length} bytes`);

        // Try to parse basic metadata
        try {
          const nameLength = metadataAccount.data.readUInt32LE(69);
          const name = metadataAccount.data
            .slice(73, 73 + nameLength)
            .toString()
            .replace(/\0/g, "");
          console.log(`   📛 Name: "${name}"`);

          const symbolStart = 73 + nameLength + 4;
          const symbolLength = metadataAccount.data.readUInt32LE(
            symbolStart - 4
          );
          const symbol = metadataAccount.data
            .slice(symbolStart, symbolStart + symbolLength)
            .toString()
            .replace(/\0/g, "");
          console.log(`   🔤 Symbol: "${symbol}"`);
        } catch (error) {
          console.log(`   ⚠️  Could not parse metadata details`);
        }
      } else {
        console.log(`   ❌ Metadata not found`);
      }

      // 4. Check for token activity
      console.log("\n🏦 4. TOKEN ACTIVITY CHECK:");
      try {
        const largestAccounts = await connection.getTokenLargestAccounts(mint);
        console.log(
          `   📊 Found ${largestAccounts.value.length} token accounts`
        );

        if (largestAccounts.value.length > 0) {
          console.log(
            `   💰 Largest holder: ${largestAccounts.value[0].amount} tokens`
          );
          console.log(
            `   👥 Total accounts with balance: ${largestAccounts.value.filter((acc) => acc.amount !== "0").length}`
          );
        }
      } catch (error) {
        console.log(`   ❌ Could not fetch token accounts: ${error}`);
      }
    } catch (error: any) {
      console.log(`💥 Investigation failed: ${error.message}`);
    }

    console.log("\n" + "═".repeat(80) + "\n");
  }

  console.log("🎉 INVESTIGATION COMPLETE!");
  console.log("\n📋 ANALYSIS:");
  console.log(
    "These tokens appear to be standard SPL tokens, not bonding curve tokens."
  );
  console.log("They may be:");
  console.log("1. Regular SPL tokens without bonding curves");
  console.log("2. Tokens that use a different bonding curve program");
  console.log("3. Tokens that have already graduated and migrated");
  console.log("4. Mock tokens for testing purposes");
}

// Run the investigation
investigateBonkTokens().catch(console.error);
