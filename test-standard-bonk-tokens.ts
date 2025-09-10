import { StandardTokenMarketCapService } from './standard-token-marketcap-service';

/**
 * 🧪 TEST STANDARD SPL BONK TOKENS
 * 
 * Testing the user's BONK tokens as standard SPL tokens
 */

const BONK_SPL_TOKENS = [
  {
    name: "BONK SPL Token 1",
    mint: "Boy2c5w2Ti6Bakwj2j8DebqKRH144dskQXfLzJm6bonk",
    description: "Standard SPL token (no bonding curve)"
  },
  {
    name: "BONK SPL Token 2",
    mint: "2LN6ACTjG6YCKfZ6JKcJDTshf3fTBdsa2gDjr37wbonk", 
    description: "Standard SPL token (no bonding curve)"
  }
];

async function testStandardBonkTokens() {
  console.log('🪙 TESTING STANDARD SPL BONK TOKENS\n');
  
  const heliusRpcUrl = process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=417b1887-2994-4d66-a5db-a30a372b7c8e';
  
  const service = new StandardTokenMarketCapService(heliusRpcUrl);
  console.log('🔗 Connected to Standard Token Service');
  console.log(`📡 RPC: ${heliusRpcUrl.replace(/api-key=[\w-]+/, 'api-key=***')}`);
  
  console.log('\n📊 INDIVIDUAL TOKEN ANALYSIS\n');

  for (const token of BONK_SPL_TOKENS) {
    console.log(`🎯 Testing: ${token.name}`);
    console.log(`📍 Mint: ${token.mint}`);
    console.log(`📝 Description: ${token.description}`);
    console.log('────────────────────────────────────────────────────────────');
    
    try {
      const result = await service.calculateMarketCap(token.mint);
      
      if (result.success && result.data) {
        const data = result.data;
        console.log(`✅ Standard SPL token analysis successful!`);
        console.log(`🪙 Type: Standard SPL Token`);
        console.log(`💎 Market Cap: $${data.marketCap.toFixed(2)}`);
        console.log(`💰 Price: $${data.price.toExponential(2)}`);
        console.log(`📊 Total Supply: ${data.totalSupply.toLocaleString()} tokens`);
        console.log(`🔢 Decimals: ${data.decimals}`);
        
        if (data.name && data.symbol) {
          console.log(`📛 Token: ${data.name} (${data.symbol})`);
        }
        
        if (data.poolData) {
          console.log(`🏊 Pool Data Available: ${data.poolData.hasLiquidity ? '✅ Yes' : '❌ No'}`);
          if (data.poolData.hasLiquidity) {
            console.log(`   DEX: ${data.poolData.dex}`);
            console.log(`   SOL Reserves: ${data.poolData.solReserves}`);
            console.log(`   Token Reserves: ${data.poolData.tokenReserves}`);
          }
        } else {
          console.log(`🏊 Pool Data: ❌ No DEX pool found`);
          console.log(`   💡 This token may not have active trading`);
        }
        
      } else {
        console.log(`❌ Failed: ${result.error}`);
      }
      
    } catch (error: any) {
      console.log(`💥 Exception: ${error.message}`);
    }
    
    console.log('════════════════════════════════════════════════════════════\n');
  }

  console.log('🔄 BATCH PROCESSING TEST\n');
  
  console.log(`📦 Processing ${BONK_SPL_TOKENS.length} standard tokens in batch...`);
  const startTime = Date.now();
  
  const batchPromises = BONK_SPL_TOKENS.map(token => 
    service.calculateMarketCap(token.mint)
  );
  
  try {
    const batchResults = await Promise.all(batchPromises);
    const endTime = Date.now();
    
    console.log(`⚡ Batch processing completed in ${endTime - startTime}ms\n`);
    
    batchResults.forEach((result, index) => {
      const token = BONK_SPL_TOKENS[index];
      console.log(`${index + 1}. ${token.name}:`);
      
      if (result.success && result.data) {
        console.log(`   ✅ SPL Token: $${result.data.marketCap.toFixed(2)}`);
        console.log(`   💰 Price: $${result.data.price.toExponential(2)}`);
        console.log(`   📊 Supply: ${result.data.totalSupply.toLocaleString()}`);
        console.log(`   🔢 Decimals: ${result.data.decimals}`);
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
      }
      console.log('');
    });
    
  } catch (error: any) {
    console.log(`💥 Batch processing failed: ${error.message}`);
  }

  console.log('🎉 STANDARD BONK TOKEN TESTING COMPLETE!\n');
  
  console.log('📊 ANALYSIS SUMMARY:');
  console.log('🪙 Your BONK tokens are standard SPL tokens');
  console.log('🚫 They do NOT use bonding curves');
  console.log('💱 Market cap depends on DEX pool liquidity');
  console.log('📈 Price discovery happens on DEXs like Raydium/Orca');
  console.log('💡 To get accurate prices, need to integrate with DEX APIs');
}

// Run the test
testStandardBonkTokens().catch(console.error);

/**
 * 🧪 TEST STANDARD SPL BONK TOKENS
 * 
 * Testing the user's BONK tokens as standard SPL tokens
 */

const BONK_SPL_TOKENS = [
  {
    name: "BONK SPL Token 1",
    mint: "Boy2c5w2Ti6Bakwj2j8DebqKRH144dskQXfLzJm6bonk",
    description: "Standard SPL token (no bonding curve)"
  },
  {
    name: "BONK SPL Token 2",
    mint: "2LN6ACTjG6YCKfZ6JKcJDTshf3fTBdsa2gDjr37wbonk", 
    description: "Standard SPL token (no bonding curve)"
  }
];

async function testStandardBonkTokens() {
  console.log('🪙 TESTING STANDARD SPL BONK TOKENS\n');
  
  const heliusRpcUrl = process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=417b1887-2994-4d66-a5db-a30a372b7c8e';
  
  const service = new StandardTokenMarketCapService(heliusRpcUrl);
  console.log('🔗 Connected to Standard Token Service');
  console.log(`📡 RPC: ${heliusRpcUrl.replace(/api-key=[\w-]+/, 'api-key=***')}`);
  
  console.log('\n📊 INDIVIDUAL TOKEN ANALYSIS\n');

  for (const token of BONK_SPL_TOKENS) {
    console.log(`🎯 Testing: ${token.name}`);
    console.log(`📍 Mint: ${token.mint}`);
    console.log(`📝 Description: ${token.description}`);
    console.log('────────────────────────────────────────────────────────────');
    
    try {
      const result = await service.calculateMarketCap(token.mint);
      
      if (result.success && result.data) {
        const data = result.data;
        console.log(`✅ Standard SPL token analysis successful!`);
        console.log(`🪙 Type: Standard SPL Token`);
        console.log(`💎 Market Cap: $${data.marketCap.toFixed(2)}`);
        console.log(`💰 Price: $${data.price.toExponential(2)}`);
        console.log(`📊 Total Supply: ${data.totalSupply.toLocaleString()} tokens`);
        console.log(`🔢 Decimals: ${data.decimals}`);
        
        if (data.name && data.symbol) {
          console.log(`📛 Token: ${data.name} (${data.symbol})`);
        }
        
        if (data.poolData) {
          console.log(`🏊 Pool Data Available: ${data.poolData.hasLiquidity ? '✅ Yes' : '❌ No'}`);
          if (data.poolData.hasLiquidity) {
            console.log(`   DEX: ${data.poolData.dex}`);
            console.log(`   SOL Reserves: ${data.poolData.solReserves}`);
            console.log(`   Token Reserves: ${data.poolData.tokenReserves}`);
          }
        } else {
          console.log(`🏊 Pool Data: ❌ No DEX pool found`);
          console.log(`   💡 This token may not have active trading`);
        }
        
      } else {
        console.log(`❌ Failed: ${result.error}`);
      }
      
    } catch (error: any) {
      console.log(`💥 Exception: ${error.message}`);
    }
    
    console.log('════════════════════════════════════════════════════════════\n');
  }

  console.log('🔄 BATCH PROCESSING TEST\n');
  
  console.log(`📦 Processing ${BONK_SPL_TOKENS.length} standard tokens in batch...`);
  const startTime = Date.now();
  
  const batchPromises = BONK_SPL_TOKENS.map(token => 
    service.calculateMarketCap(token.mint)
  );
  
  try {
    const batchResults = await Promise.all(batchPromises);
    const endTime = Date.now();
    
    console.log(`⚡ Batch processing completed in ${endTime - startTime}ms\n`);
    
    batchResults.forEach((result, index) => {
      const token = BONK_SPL_TOKENS[index];
      console.log(`${index + 1}. ${token.name}:`);
      
      if (result.success && result.data) {
        console.log(`   ✅ SPL Token: $${result.data.marketCap.toFixed(2)}`);
        console.log(`   💰 Price: $${result.data.price.toExponential(2)}`);
        console.log(`   📊 Supply: ${result.data.totalSupply.toLocaleString()}`);
        console.log(`   🔢 Decimals: ${result.data.decimals}`);
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
      }
      console.log('');
    });
    
  } catch (error: any) {
    console.log(`💥 Batch processing failed: ${error.message}`);
  }

  console.log('🎉 STANDARD BONK TOKEN TESTING COMPLETE!\n');
  
  console.log('📊 ANALYSIS SUMMARY:');
  console.log('🪙 Your BONK tokens are standard SPL tokens');
  console.log('🚫 They do NOT use bonding curves');
  console.log('💱 Market cap depends on DEX pool liquidity');
  console.log('📈 Price discovery happens on DEXs like Raydium/Orca');
  console.log('💡 To get accurate prices, need to integrate with DEX APIs');
}

// Run the test
testStandardBonkTokens().catch(console.error);