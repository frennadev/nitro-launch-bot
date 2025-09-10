import { UnifiedMarketCapService } from './unified-marketcap-service';

/**
 * 🔍 CHECK SINGLE TOKEN MARKET CAP
 */

async function checkSingleToken() {
  console.log('🔍 CHECKING TOKEN MARKET CAP');
  
  const heliusRpcUrl = 'https://mainnet.helius-rpc.com/?api-key=417b1887-2994-4d66-a5db-a30a372b7c8e';
  const service = new UnifiedMarketCapService(heliusRpcUrl);
  const mint = 'SesmzykXQ6PDVa7xnuZN7K4pUpE7dKUUdjwBnogUSDH';
  
  console.log(`\n🎯 Analyzing: ${mint}`);
  console.log('═'.repeat(80));
  
  try {
    const result = await service.calculateMarketCap(mint);
    
    if (result.success && result.data) {
      const data = result.data;
      console.log(`✅ SUCCESS!`);
      console.log(`🏷️  Token Type: ${data.tokenType}`);
      console.log(`🔍 Detected By: ${data.detectedBy}`);
      console.log(`💎 Market Cap: $${data.marketCap.toLocaleString()}`);
      console.log(`💰 Price: $${data.price.toExponential(2)}`);
      console.log(`🎯 Status: ${data.isComplete ? '🎓 Graduated' : '🔄 On Curve'}`);
      console.log(`🏊 Migrated: ${data.isMigrated ? '✅ Yes' : '❌ No'}`);
      console.log(`👤 Creator: ${data.creator.slice(0, 8)}...${data.creator.slice(-8)}`);
      
      if (data.name && data.symbol) {
        console.log(`📛 Token: ${data.name} (${data.symbol})`);
      }
      
      console.log(`📊 Total Supply: ${data.totalSupply.toLocaleString()} tokens`);
      console.log(`🔄 Circulating: ${data.circulatingSupply.toLocaleString()} tokens`);
      console.log(`🏊 SOL Reserves: ${data.solReserves.toFixed(4)} SOL`);
      console.log(`🪙 Token Reserves: ${data.tokenReserves.toLocaleString()} tokens`);
      
      if ('graduationProgress' in data && data.graduationProgress !== undefined) {
        console.log(`📈 Graduation Progress: ${data.graduationProgress.toFixed(2)}%`);
      }
      
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }
    
  } catch (error: any) {
    console.log(`💥 Exception: ${error.message}`);
  }
  
  console.log('\n🎉 Analysis complete!');
}

// Run the check
checkSingleToken().catch(console.error);

/**
 * 🔍 CHECK SINGLE TOKEN MARKET CAP
 */

async function checkSingleToken() {
  console.log('🔍 CHECKING TOKEN MARKET CAP');
  
  const heliusRpcUrl = 'https://mainnet.helius-rpc.com/?api-key=417b1887-2994-4d66-a5db-a30a372b7c8e';
  const service = new UnifiedMarketCapService(heliusRpcUrl);
  const mint = 'SesmzykXQ6PDVa7xnuZN7K4pUpE7dKUUdjwBnogUSDH';
  
  console.log(`\n🎯 Analyzing: ${mint}`);
  console.log('═'.repeat(80));
  
  try {
    const result = await service.calculateMarketCap(mint);
    
    if (result.success && result.data) {
      const data = result.data;
      console.log(`✅ SUCCESS!`);
      console.log(`🏷️  Token Type: ${data.tokenType}`);
      console.log(`🔍 Detected By: ${data.detectedBy}`);
      console.log(`💎 Market Cap: $${data.marketCap.toLocaleString()}`);
      console.log(`💰 Price: $${data.price.toExponential(2)}`);
      console.log(`🎯 Status: ${data.isComplete ? '🎓 Graduated' : '🔄 On Curve'}`);
      console.log(`🏊 Migrated: ${data.isMigrated ? '✅ Yes' : '❌ No'}`);
      console.log(`👤 Creator: ${data.creator.slice(0, 8)}...${data.creator.slice(-8)}`);
      
      if (data.name && data.symbol) {
        console.log(`📛 Token: ${data.name} (${data.symbol})`);
      }
      
      console.log(`📊 Total Supply: ${data.totalSupply.toLocaleString()} tokens`);
      console.log(`🔄 Circulating: ${data.circulatingSupply.toLocaleString()} tokens`);
      console.log(`🏊 SOL Reserves: ${data.solReserves.toFixed(4)} SOL`);
      console.log(`🪙 Token Reserves: ${data.tokenReserves.toLocaleString()} tokens`);
      
      if ('graduationProgress' in data && data.graduationProgress !== undefined) {
        console.log(`📈 Graduation Progress: ${data.graduationProgress.toFixed(2)}%`);
      }
      
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }
    
  } catch (error: any) {
    console.log(`💥 Exception: ${error.message}`);
  }
  
  console.log('\n🎉 Analysis complete!');
}

// Run the check
checkSingleToken().catch(console.error);