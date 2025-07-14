import { connection } from "./src/blockchain/common/connection";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// Import all implementations
import { executePumpFunBuy } from "./src/blockchain/pumpfun/buy";
import { executePumpSwapBuy } from "./src/blockchain/pumpswap/buy";
import { executeBonkBuy } from "./src/blockchain/bonk/buy";
import RaydiumCpmmService from "./src/blockchain/cpmm/buy";

// Import sell functions
import { executePumpFunSell } from "./src/blockchain/pumpfun/sell";
import { executePumpSwapSell } from "./src/blockchain/pumpswap/sell";
import { executeBonkSell } from "./src/blockchain/bonk/sell";

// Import unified configuration
import { createUnifiedConfig, toPlatformConfig, toPriorityFeeConfig } from "./src/blockchain/common/unified-config";

interface TestResult {
  platform: string;
  tokenMint: string;
  buySuccess: boolean;
  buySignature?: string;
  tokensReceived?: bigint;
  sellSuccess: boolean;
  sellSignature?: string;
  error?: string;
}

async function testAllImplementations() {
  console.log("🧪 Testing All Blockchain Implementations");
  console.log("==========================================");

  // Unified configuration setup
  const unifiedConfig = createUnifiedConfig({
    slippage: {
      base: 35,
      max: 70,
      retryBonus: 10,
      userOverride: 1.0, // User sets 1% slippage
    },
    priorityFees: {
      base: 1_500_000, // 1.5M microLamports (0.0015 SOL)
      retryMultiplier: 1.5,
      max: 12_000_000, // 12M microLamports (0.012 SOL)
      min: 300_000, // 300K microLamports (0.0003 SOL)
    },
    retry: {
      maxAttempts: 3,
      delayMs: 1000,
    },
    fees: {
      platformPercentage: 1.0,
      maestroPercentage: 0.25,
      maestroFixed: 1_000_000,
    },
    liquidity: {
      lowThreshold: 5,
      mediumThreshold: 20,
    },
  });

  console.log("⚙️  Using Unified Configuration:");
  console.log(`   Slippage: ${unifiedConfig.slippage.userOverride || unifiedConfig.slippage.base}%`);
  console.log(`   Priority Fee Base: ${unifiedConfig.priorityFees.base / 1_000_000} SOL`);
  console.log(`   Platform Fee: ${unifiedConfig.fees.platformPercentage}%`);
  console.log(`   Maestro Fee: ${unifiedConfig.fees.maestroPercentage}%`);
  console.log(`   Max Retries: ${unifiedConfig.retry.maxAttempts}\n`);

  // Test configuration
  const privateKey = "43WgY2ekSNR8hxAAS62qq5MC4UWCakiFxaDVBir9qsHVJvGH9HnpnwNi9fNmxRUL4nxjVQwsGFfNnaHKXBKn3CgU";
  const buyAmount = BigInt(5_000_000); // 0.005 SOL in lamports
  const owner = Keypair.fromSecretKey(bs58.decode(privateKey));

  // Test tokens for each platform
  const testTokens = [
    {
      platform: "CPMM",
      tokenMint: "BmjaULzZoEKnGpwGMfdCSEeTio3giS1qgbGBnU5Gbonk",
      service: new RaydiumCpmmService()
    },
    {
      platform: "PumpSwap",
      tokenMint: "3oQwNvAfZMuPWjVPC12ukY7RPA9JiGwLod6Pr4Lkpump",
      service: null // Use function directly
    },
    {
      platform: "BONK",
      tokenMint: "35DgaTrLcUjgp5rfCHy2NSUVh88vFpuCrUYUa4zmbonk",
      service: null // Use function directly
    },
    {
      platform: "PumpFun",
      tokenMint: "3mzTK45TCwEypxDnv85dXvNJoU8L78fa77AEV4fFpump",
      service: null // Use function directly
    }
  ];

  const results: TestResult[] = [];

  for (const test of testTokens) {
    console.log(`\n🚀 Testing ${test.platform} Implementation`);
    console.log(`🎯 Token: ${test.tokenMint}`);
    console.log(`💰 Amount: ${Number(buyAmount) / 1e9} SOL`);
    console.log("─".repeat(50));

    const result: TestResult = {
      platform: test.platform,
      tokenMint: test.tokenMint,
      buySuccess: false,
      sellSuccess: false
    };

    try {
      // Step 1: Buy Transaction
      console.log(`📈 Executing ${test.platform} Buy...`);
      
      let buyResult;
      if (test.platform === "CPMM") {
        buyResult = await (test.service as RaydiumCpmmService).buyTx({
          mint: test.tokenMint,
          privateKey: privateKey,
          amount_in: buyAmount
        });
        // Send CPMM transaction
        const buySignature = await connection.sendTransaction(buyResult);
        const buyConfirmation = await connection.confirmTransaction(buySignature, "confirmed");
        if (buyConfirmation.value.err) {
          throw new Error(`Buy transaction failed: ${JSON.stringify(buyConfirmation.value.err)}`);
        }
        result.buySuccess = true;
        result.buySignature = buySignature;
      } else if (test.platform === "PumpSwap") {
        const pumpSwapConfig = toPlatformConfig(unifiedConfig, 'pumpswap') as any;
        buyResult = await executePumpSwapBuy(
          test.tokenMint,
          owner,
          Number(buyAmount) / 1e9, // Convert to SOL
          pumpSwapConfig.platformFeePercentage,
          pumpSwapConfig.slippagePercentage
        );
        if (!buyResult.success) {
          throw new Error(buyResult.error || "PumpSwap buy failed");
        }
        result.buySuccess = true;
        result.buySignature = buyResult.signature;
      } else if (test.platform === "BONK") {
        const bonkConfig = toPlatformConfig(unifiedConfig, 'bonk') as any;
        buyResult = await executeBonkBuy(
          test.tokenMint,
          owner,
          Number(buyAmount) / 1e9, // Convert to SOL
          bonkConfig.baseSlippage
        );
        if (!buyResult.success) {
          throw new Error(buyResult.error || "BONK buy failed");
        }
        result.buySuccess = true;
        result.buySignature = buyResult.signature;
      } else if (test.platform === "PumpFun") {
        const pumpFunConfig = toPlatformConfig(unifiedConfig, 'pumpfun') as any;
        buyResult = await executePumpFunBuy(
          test.tokenMint,
          owner,
          Number(buyAmount) / 1e9, // Convert to SOL
          pumpFunConfig.platformFeePercentage,
          pumpFunConfig.slippagePercentage
        );
        if (!buyResult.success) {
          throw new Error(buyResult.error || "PumpFun buy failed");
        }
        result.buySuccess = true;
        result.buySignature = buyResult.signature;
      }

      console.log(`✅ ${test.platform} Buy Successful!`);
      console.log(`📤 Buy Transaction: ${result.buySignature}`);

      // Step 2: Check token balance
      const tokenMintPubkey = new PublicKey(test.tokenMint);
      const tokenAta = getAssociatedTokenAddressSync(tokenMintPubkey, owner.publicKey);
      
      console.log(`💰 Checking token balance...`);
      const tokenBalanceInfo = await connection.getTokenAccountBalance(tokenAta);
      const tokenBalance = BigInt(tokenBalanceInfo.value?.amount || 0);
      result.tokensReceived = tokenBalance;
      
      console.log(`📊 Tokens received: ${tokenBalance}`);

      if (tokenBalance === BigInt(0)) {
        throw new Error("No tokens received from buy transaction");
      }

      // Step 3: Wait before selling
      console.log(`⏳ Waiting 3 seconds before selling...`);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Step 4: Sell Transaction
      console.log(`📉 Executing ${test.platform} Sell...`);
      
      let sellResult;
      if (test.platform === "CPMM") {
        sellResult = await (test.service as RaydiumCpmmService).sellTx({
          mint: test.tokenMint,
          privateKey: privateKey,
          amount_in: tokenBalance
        });
        // Send CPMM sell transaction
        const sellSignature = await connection.sendTransaction(sellResult);
        const sellConfirmation = await connection.confirmTransaction(sellSignature, "confirmed");
        if (sellConfirmation.value.err) {
          throw new Error(`Sell transaction failed: ${JSON.stringify(sellConfirmation.value.err)}`);
        }
        result.sellSuccess = true;
        result.sellSignature = sellSignature;
      } else if (test.platform === "PumpSwap") {
        const pumpSwapConfig = toPlatformConfig(unifiedConfig, 'pumpswap') as any;
        sellResult = await executePumpSwapSell(
          test.tokenMint,
          owner,
          tokenBalance, // Sell entire balance
          pumpSwapConfig.platformFeePercentage,
          pumpSwapConfig.slippagePercentage
        );
        if (!sellResult.success) {
          throw new Error(sellResult.error || "PumpSwap sell failed");
        }
        result.sellSuccess = true;
        result.sellSignature = sellResult.signature;
      } else if (test.platform === "BONK") {
        const bonkConfig = toPlatformConfig(unifiedConfig, 'bonk') as any;
        sellResult = await executeBonkSell(
          test.tokenMint,
          owner,
          tokenBalance, // Sell entire balance
          bonkConfig.baseSlippage
        );
        if (!sellResult.success) {
          throw new Error(sellResult.error || "BONK sell failed");
        }
        result.sellSuccess = true;
        result.sellSignature = sellResult.signature;
      } else if (test.platform === "PumpFun") {
        const pumpFunConfig = toPlatformConfig(unifiedConfig, 'pumpfun') as any;
        sellResult = await executePumpFunSell(
          test.tokenMint,
          owner,
          Number(tokenBalance), // Convert to number for PumpFun
          pumpFunConfig.platformFeePercentage
        );
        if (!sellResult.success) {
          throw new Error(sellResult.error || "PumpFun sell failed");
        }
        result.sellSuccess = true;
        result.sellSignature = sellResult.signature;
      }

      console.log(`✅ ${test.platform} Sell Successful!`);

      // Step 5: Check final balance
      const finalTokenBalanceInfo = await connection.getTokenAccountBalance(tokenAta);
      const finalTokenBalance = BigInt(finalTokenBalanceInfo.value?.amount || 0);
      console.log(`📊 Final token balance: ${finalTokenBalance}`);

    } catch (error: any) {
      console.error(`❌ ${test.platform} Test Failed:`, error.message);
      result.error = error.message;
    }

    results.push(result);
    
    // Wait between tests
    console.log(`⏳ Waiting 5 seconds before next test...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  // Print final results
  console.log("\n" + "=".repeat(60));
  console.log("📊 FINAL TEST RESULTS");
  console.log("=".repeat(60));

  results.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.platform}`);
    console.log(`   Token: ${result.tokenMint}`);
    console.log(`   Buy: ${result.buySuccess ? '✅ Success' : '❌ Failed'}`);
    if (result.buySignature) {
      console.log(`   Buy Signature: ${result.buySignature}`);
    }
    if (result.tokensReceived) {
      console.log(`   Tokens Received: ${result.tokensReceived}`);
    }
    console.log(`   Sell: ${result.sellSuccess ? '✅ Success' : '❌ Failed'}`);
    if (result.sellSignature) {
      console.log(`   Sell Signature: ${result.sellSignature}`);
    }
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  // Summary
  const successfulBuys = results.filter(r => r.buySuccess).length;
  const successfulSells = results.filter(r => r.sellSuccess).length;
  
  console.log(`\n📈 SUMMARY:`);
  console.log(`   Successful Buys: ${successfulBuys}/4`);
  console.log(`   Successful Sells: ${successfulSells}/4`);
  console.log(`   Success Rate: ${((successfulBuys + successfulSells) / 8 * 100).toFixed(1)}%`);
}

// Run the comprehensive test
testAllImplementations().catch(console.error); 