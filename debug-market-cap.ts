import { BonkMarketCapService } from "./bonk-marketcap-service";

/**
 * 🔍 DEBUG MARKET CAP CALCULATION
 *
 * Let's break down exactly how we're calculating market cap vs reality
 */

async function debugMarketCapCalculation() {
  console.log("🔍 DEBUGGING MARKET CAP CALCULATION");
  console.log("═".repeat(60));

  const heliusRpcUrl =
    process.env.HELIUS_RPC_URL || process.env.UTILS_HELIUS_RPC;
  if (!heliusRpcUrl) {
    throw new Error(
      "HELIUS_RPC_URL or UTILS_HELIUS_RPC environment variable is required"
    );
  }
  const service = new BonkMarketCapService(heliusRpcUrl);
  const mint = "SesmzykXQ6PDVa7xnuZN7K4pUpE7dKUUdjwBnogUSDH";

  console.log(`🎯 Token: ${mint}`);
  console.log(`📈 Expected Market Cap: $11,700`);
  console.log(`📊 Our Calculation: $6,050.35`);

  try {
    const result = await service.calculateMarketCap(mint);

    if (result.success && result.data) {
      const data = result.data;

      console.log("\n📊 DETAILED BREAKDOWN:");
      console.log("─".repeat(40));

      // Raw pool state data
      const poolData = data.poolStateData;
      console.log(
        `🔢 Pool Status: ${poolData.status} (0=funding, 1=waiting migration, 2=migrated)`
      );
      console.log(`🔢 Base Decimals: ${poolData.baseDecimals}`);
      console.log(`🔢 Quote Decimals: ${poolData.quoteDecimals}`);

      // Supply calculations
      console.log("\n💰 SUPPLY ANALYSIS:");
      const rawSupply = Number(poolData.supply);
      const decimals = poolData.baseDecimals;
      const adjustedSupply = rawSupply / Math.pow(10, decimals);

      console.log(`📊 Raw Supply: ${rawSupply.toLocaleString()}`);
      console.log(`🔢 Decimals: ${decimals}`);
      console.log(`📊 Adjusted Supply: ${adjustedSupply.toLocaleString()}`);
      console.log(`📊 Our Total Supply: ${data.totalSupply.toLocaleString()}`);

      // Reserve analysis
      console.log("\n🏊 RESERVE ANALYSIS:");
      const rawVirtualBase = Number(poolData.virtualBase);
      const rawVirtualQuote = Number(poolData.virtualQuote);
      const rawRealBase = Number(poolData.realBase);
      const rawRealQuote = Number(poolData.realQuote);

      console.log(`🔵 Raw Virtual Base: ${rawVirtualBase.toLocaleString()}`);
      console.log(`🔵 Raw Virtual Quote: ${rawVirtualQuote.toLocaleString()}`);
      console.log(`🟢 Raw Real Base: ${rawRealBase.toLocaleString()}`);
      console.log(`🟢 Raw Real Quote: ${rawRealQuote.toLocaleString()}`);

      const adjustedVirtualBase = rawVirtualBase / Math.pow(10, decimals);
      const adjustedVirtualQuote = rawVirtualQuote / 1e9; // SOL is 9 decimals
      const adjustedRealBase = rawRealBase / Math.pow(10, decimals);
      const adjustedRealQuote = rawRealQuote / 1e9;

      console.log(
        `🔵 Adjusted Virtual Base: ${adjustedVirtualBase.toLocaleString()}`
      );
      console.log(
        `🔵 Adjusted Virtual Quote: ${adjustedVirtualQuote.toFixed(4)} SOL`
      );
      console.log(
        `🟢 Adjusted Real Base: ${adjustedRealBase.toLocaleString()}`
      );
      console.log(
        `🟢 Adjusted Real Quote: ${adjustedRealQuote.toFixed(4)} SOL`
      );

      // Price calculations
      console.log("\n💱 PRICE CALCULATION METHODS:");

      // Method 1: Virtual reserves (our current method)
      const priceMethod1 = adjustedVirtualQuote / adjustedVirtualBase;
      console.log(
        `💰 Method 1 (Virtual): ${adjustedVirtualQuote.toFixed(4)} / ${adjustedVirtualBase.toLocaleString()} = ${priceMethod1.toExponential(4)} SOL per token`
      );

      // Method 2: Real reserves
      const priceMethod2 =
        adjustedRealBase > 0 ? adjustedRealQuote / adjustedRealBase : 0;
      console.log(
        `💰 Method 2 (Real): ${adjustedRealQuote.toFixed(4)} / ${adjustedRealBase.toLocaleString()} = ${priceMethod2.toExponential(4)} SOL per token`
      );

      // Method 3: Combined reserves
      const totalQuote = adjustedVirtualQuote + adjustedRealQuote;
      const totalBase = adjustedVirtualBase + adjustedRealBase;
      const priceMethod3 = totalQuote / totalBase;
      console.log(
        `💰 Method 3 (Combined): ${totalQuote.toFixed(4)} / ${totalBase.toLocaleString()} = ${priceMethod3.toExponential(4)} SOL per token`
      );

      // Current SOL price
      console.log(`\n💵 SOL Price: $${(data.price / priceMethod1).toFixed(2)}`);

      // Market cap calculations with different methods
      console.log("\n📈 MARKET CAP WITH DIFFERENT METHODS:");
      const solPrice = data.price / priceMethod1;

      const marketCap1 = adjustedSupply * priceMethod1 * solPrice;
      const marketCap2 = adjustedSupply * priceMethod2 * solPrice;
      const marketCap3 = adjustedSupply * priceMethod3 * solPrice;

      console.log(`📊 Method 1 Market Cap: $${marketCap1.toLocaleString()}`);
      console.log(`📊 Method 2 Market Cap: $${marketCap2.toLocaleString()}`);
      console.log(`📊 Method 3 Market Cap: $${marketCap3.toLocaleString()}`);
      console.log(
        `📊 Current Calculation: $${data.marketCap.toLocaleString()}`
      );
      console.log(`🎯 Expected: $11,700`);

      // Check if any method gets closer to 11.7k
      const target = 11700;
      const diff1 = Math.abs(marketCap1 - target);
      const diff2 = Math.abs(marketCap2 - target);
      const diff3 = Math.abs(marketCap3 - target);
      const diffCurrent = Math.abs(data.marketCap - target);

      console.log("\n🎯 ACCURACY COMPARISON:");
      console.log(`📊 Method 1 difference: $${diff1.toLocaleString()}`);
      console.log(`📊 Method 2 difference: $${diff2.toLocaleString()}`);
      console.log(`📊 Method 3 difference: $${diff3.toLocaleString()}`);
      console.log(`📊 Current difference: $${diffCurrent.toLocaleString()}`);

      // Find closest method
      const minDiff = Math.min(diff1, diff2, diff3, diffCurrent);
      if (minDiff === diff1) console.log("🏆 Method 1 (Virtual) is closest!");
      else if (minDiff === diff2) console.log("🏆 Method 2 (Real) is closest!");
      else if (minDiff === diff3)
        console.log("🏆 Method 3 (Combined) is closest!");
      else console.log("🏆 Current method is closest!");

      // Check circulating supply approach
      console.log("\n🔄 CIRCULATING SUPPLY APPROACH:");
      const circulatingMarketCap =
        data.circulatingSupply * priceMethod1 * solPrice;
      console.log(
        `📊 Circulating Supply: ${data.circulatingSupply.toLocaleString()}`
      );
      console.log(
        `📊 Circulating Market Cap: $${circulatingMarketCap.toLocaleString()}`
      );
    } else {
      console.log(`❌ Failed to get data: ${result.error}`);
    }
  } catch (error: any) {
    console.log(`💥 Error: ${error.message}`);
  }

  console.log("\n🎉 DEBUG COMPLETE!");
}

// Run the debug
debugMarketCapCalculation().catch(console.error);

/**
 * 🔍 DEBUG MARKET CAP CALCULATION
 *
 * Let's break down exactly how we're calculating market cap vs reality
 */

async function debugMarketCapCalculation() {
  console.log("🔍 DEBUGGING MARKET CAP CALCULATION");
  console.log("═".repeat(60));

  const heliusRpcUrl =
    process.env.HELIUS_RPC_URL || process.env.UTILS_HELIUS_RPC;
  if (!heliusRpcUrl) {
    throw new Error(
      "HELIUS_RPC_URL or UTILS_HELIUS_RPC environment variable is required"
    );
  }
  const service = new BonkMarketCapService(heliusRpcUrl);
  const mint = "SesmzykXQ6PDVa7xnuZN7K4pUpE7dKUUdjwBnogUSDH";

  console.log(`🎯 Token: ${mint}`);
  console.log(`📈 Expected Market Cap: $11,700`);
  console.log(`📊 Our Calculation: $6,050.35`);

  try {
    const result = await service.calculateMarketCap(mint);

    if (result.success && result.data) {
      const data = result.data;

      console.log("\n📊 DETAILED BREAKDOWN:");
      console.log("─".repeat(40));

      // Raw pool state data
      const poolData = data.poolStateData;
      console.log(
        `🔢 Pool Status: ${poolData.status} (0=funding, 1=waiting migration, 2=migrated)`
      );
      console.log(`🔢 Base Decimals: ${poolData.baseDecimals}`);
      console.log(`🔢 Quote Decimals: ${poolData.quoteDecimals}`);

      // Supply calculations
      console.log("\n💰 SUPPLY ANALYSIS:");
      const rawSupply = Number(poolData.supply);
      const decimals = poolData.baseDecimals;
      const adjustedSupply = rawSupply / Math.pow(10, decimals);

      console.log(`📊 Raw Supply: ${rawSupply.toLocaleString()}`);
      console.log(`🔢 Decimals: ${decimals}`);
      console.log(`📊 Adjusted Supply: ${adjustedSupply.toLocaleString()}`);
      console.log(`📊 Our Total Supply: ${data.totalSupply.toLocaleString()}`);

      // Reserve analysis
      console.log("\n🏊 RESERVE ANALYSIS:");
      const rawVirtualBase = Number(poolData.virtualBase);
      const rawVirtualQuote = Number(poolData.virtualQuote);
      const rawRealBase = Number(poolData.realBase);
      const rawRealQuote = Number(poolData.realQuote);

      console.log(`🔵 Raw Virtual Base: ${rawVirtualBase.toLocaleString()}`);
      console.log(`🔵 Raw Virtual Quote: ${rawVirtualQuote.toLocaleString()}`);
      console.log(`🟢 Raw Real Base: ${rawRealBase.toLocaleString()}`);
      console.log(`🟢 Raw Real Quote: ${rawRealQuote.toLocaleString()}`);

      const adjustedVirtualBase = rawVirtualBase / Math.pow(10, decimals);
      const adjustedVirtualQuote = rawVirtualQuote / 1e9; // SOL is 9 decimals
      const adjustedRealBase = rawRealBase / Math.pow(10, decimals);
      const adjustedRealQuote = rawRealQuote / 1e9;

      console.log(
        `🔵 Adjusted Virtual Base: ${adjustedVirtualBase.toLocaleString()}`
      );
      console.log(
        `🔵 Adjusted Virtual Quote: ${adjustedVirtualQuote.toFixed(4)} SOL`
      );
      console.log(
        `🟢 Adjusted Real Base: ${adjustedRealBase.toLocaleString()}`
      );
      console.log(
        `🟢 Adjusted Real Quote: ${adjustedRealQuote.toFixed(4)} SOL`
      );

      // Price calculations
      console.log("\n💱 PRICE CALCULATION METHODS:");

      // Method 1: Virtual reserves (our current method)
      const priceMethod1 = adjustedVirtualQuote / adjustedVirtualBase;
      console.log(
        `💰 Method 1 (Virtual): ${adjustedVirtualQuote.toFixed(4)} / ${adjustedVirtualBase.toLocaleString()} = ${priceMethod1.toExponential(4)} SOL per token`
      );

      // Method 2: Real reserves
      const priceMethod2 =
        adjustedRealBase > 0 ? adjustedRealQuote / adjustedRealBase : 0;
      console.log(
        `💰 Method 2 (Real): ${adjustedRealQuote.toFixed(4)} / ${adjustedRealBase.toLocaleString()} = ${priceMethod2.toExponential(4)} SOL per token`
      );

      // Method 3: Combined reserves
      const totalQuote = adjustedVirtualQuote + adjustedRealQuote;
      const totalBase = adjustedVirtualBase + adjustedRealBase;
      const priceMethod3 = totalQuote / totalBase;
      console.log(
        `💰 Method 3 (Combined): ${totalQuote.toFixed(4)} / ${totalBase.toLocaleString()} = ${priceMethod3.toExponential(4)} SOL per token`
      );

      // Current SOL price
      console.log(`\n💵 SOL Price: $${(data.price / priceMethod1).toFixed(2)}`);

      // Market cap calculations with different methods
      console.log("\n📈 MARKET CAP WITH DIFFERENT METHODS:");
      const solPrice = data.price / priceMethod1;

      const marketCap1 = adjustedSupply * priceMethod1 * solPrice;
      const marketCap2 = adjustedSupply * priceMethod2 * solPrice;
      const marketCap3 = adjustedSupply * priceMethod3 * solPrice;

      console.log(`📊 Method 1 Market Cap: $${marketCap1.toLocaleString()}`);
      console.log(`📊 Method 2 Market Cap: $${marketCap2.toLocaleString()}`);
      console.log(`📊 Method 3 Market Cap: $${marketCap3.toLocaleString()}`);
      console.log(
        `📊 Current Calculation: $${data.marketCap.toLocaleString()}`
      );
      console.log(`🎯 Expected: $11,700`);

      // Check if any method gets closer to 11.7k
      const target = 11700;
      const diff1 = Math.abs(marketCap1 - target);
      const diff2 = Math.abs(marketCap2 - target);
      const diff3 = Math.abs(marketCap3 - target);
      const diffCurrent = Math.abs(data.marketCap - target);

      console.log("\n🎯 ACCURACY COMPARISON:");
      console.log(`📊 Method 1 difference: $${diff1.toLocaleString()}`);
      console.log(`📊 Method 2 difference: $${diff2.toLocaleString()}`);
      console.log(`📊 Method 3 difference: $${diff3.toLocaleString()}`);
      console.log(`📊 Current difference: $${diffCurrent.toLocaleString()}`);

      // Find closest method
      const minDiff = Math.min(diff1, diff2, diff3, diffCurrent);
      if (minDiff === diff1) console.log("🏆 Method 1 (Virtual) is closest!");
      else if (minDiff === diff2) console.log("🏆 Method 2 (Real) is closest!");
      else if (minDiff === diff3)
        console.log("🏆 Method 3 (Combined) is closest!");
      else console.log("🏆 Current method is closest!");

      // Check circulating supply approach
      console.log("\n🔄 CIRCULATING SUPPLY APPROACH:");
      const circulatingMarketCap =
        data.circulatingSupply * priceMethod1 * solPrice;
      console.log(
        `📊 Circulating Supply: ${data.circulatingSupply.toLocaleString()}`
      );
      console.log(
        `📊 Circulating Market Cap: $${circulatingMarketCap.toLocaleString()}`
      );
    } else {
      console.log(`❌ Failed to get data: ${result.error}`);
    }
  } catch (error: any) {
    console.log(`💥 Error: ${error.message}`);
  }

  console.log("\n🎉 DEBUG COMPLETE!");
}

// Run the debug
debugMarketCapCalculation().catch(console.error);
