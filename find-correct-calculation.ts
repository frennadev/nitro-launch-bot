import { BonkMarketCapService } from './bonk-marketcap-service';

/**
 * 🔍 FIND THE CORRECT CALCULATION FOR $11.7K
 * 
 * Let's test every possible calculation method to find what gives us $11,700
 */

async function findCorrectCalculation() {
  console.log('🔍 FINDING CORRECT CALCULATION FOR $11,700 TARGET');
  console.log('═'.repeat(60));
  
  const heliusRpcUrl = 'https://mainnet.helius-rpc.com/?api-key=417b1887-2994-4d66-a5db-a30a372b7c8e';
  const service = new BonkMarketCapService(heliusRpcUrl);
  const mint = 'SesmzykXQ6PDVa7xnuZN7K4pUpE7dKUUdjwBnogUSDH';
  const target = 11700;
  
  try {
    const result = await service.calculateMarketCap(mint);
    
    if (result.success && result.data) {
      const data = result.data;
      const poolData = data.poolStateData;
      
      console.log('📊 RAW DATA:');
      console.log(`   Supply: ${Number(poolData.supply).toLocaleString()}`);
      console.log(`   Decimals: ${poolData.baseDecimals}`);
      console.log(`   Virtual Base: ${Number(poolData.virtualBase).toLocaleString()}`);
      console.log(`   Virtual Quote: ${Number(poolData.virtualQuote).toLocaleString()}`);
      console.log(`   Real Base: ${Number(poolData.realBase).toLocaleString()}`);
      console.log(`   Real Quote: ${Number(poolData.realQuote).toLocaleString()}`);
      
      // Adjusted values
      const decimals = poolData.baseDecimals;
      const totalSupply = Number(poolData.supply) / Math.pow(10, decimals);
      const virtualBase = Number(poolData.virtualBase) / Math.pow(10, decimals);
      const virtualQuote = Number(poolData.virtualQuote) / 1e9;
      const realBase = Number(poolData.realBase) / Math.pow(10, decimals);
      const realQuote = Number(poolData.realQuote) / 1e9;
      
      console.log(`\n📊 ADJUSTED VALUES:`);
      console.log(`   Total Supply: ${totalSupply.toLocaleString()}`);
      console.log(`   Virtual Base: ${virtualBase.toLocaleString()}`);
      console.log(`   Virtual Quote: ${virtualQuote.toFixed(4)} SOL`);
      console.log(`   Real Base: ${realBase.toLocaleString()}`);
      console.log(`   Real Quote: ${realQuote.toFixed(4)} SOL`);
      
      // Get current SOL price from our calculation
      const currentPrice = data.price;
      const virtualPrice = virtualQuote / virtualBase;
      const solPrice = currentPrice / virtualPrice;
      
      console.log(`\n💰 PRICE INFO:`);
      console.log(`   Current Token Price: $${currentPrice.toExponential(4)}`);
      console.log(`   Virtual SOL Price: ${virtualPrice.toExponential(4)} SOL/token`);
      console.log(`   SOL/USD Rate: $${solPrice.toFixed(2)}`);
      
      console.log(`\n🧮 TESTING ALL CALCULATION METHODS:`);
      console.log('─'.repeat(60));
      
      const methods = [
        {
          name: 'Current (Virtual)',
          price: virtualPrice,
          supply: totalSupply,
          description: 'virtualQuote / virtualBase * totalSupply'
        },
        {
          name: 'Real Reserves',
          price: realBase > 0 ? realQuote / realBase : 0,
          supply: totalSupply,
          description: 'realQuote / realBase * totalSupply'
        },
        {
          name: 'Combined Reserves',
          price: (virtualQuote + realQuote) / (virtualBase + realBase),
          supply: totalSupply,
          description: '(virtual + real) / (virtual + real) * totalSupply'
        },
        {
          name: 'Circulating Virtual',
          price: virtualPrice,
          supply: data.circulatingSupply,
          description: 'virtualPrice * circulatingSupply'
        },
        {
          name: 'Circulating Real',
          price: realBase > 0 ? realQuote / realBase : 0,
          supply: data.circulatingSupply,
          description: 'realPrice * circulatingSupply'
        },
        {
          name: 'Real/Virtual Ratio',
          price: virtualPrice * (realQuote / virtualQuote),
          supply: totalSupply,
          description: 'virtualPrice * (realQuote/virtualQuote) * totalSupply'
        },
        {
          name: 'Weighted Average',
          price: (virtualPrice * virtualQuote + (realBase > 0 ? realQuote / realBase : 0) * realQuote) / (virtualQuote + realQuote),
          supply: totalSupply,
          description: 'Weighted by quote amounts'
        },
        {
          name: 'Total Liquidity',
          price: (virtualQuote + realQuote) / totalSupply,
          supply: totalSupply,
          description: 'Total SOL liquidity / total supply'
        }
      ];
      
      // Calculate market caps and find closest
      let closest = { name: '', marketCap: 0, diff: Infinity, ratio: 0 };
      
      methods.forEach((method, index) => {
        const marketCapSOL = method.price * method.supply;
        const marketCapUSD = marketCapSOL * solPrice;
        const diff = Math.abs(marketCapUSD - target);
        const ratio = marketCapUSD / target;
        
        console.log(`${index + 1}. ${method.name}:`);
        console.log(`   Price: ${method.price.toExponential(4)} SOL/token`);
        console.log(`   Supply: ${method.supply.toLocaleString()}`);
        console.log(`   Market Cap: $${marketCapUSD.toLocaleString()}`);
        console.log(`   Difference: $${diff.toLocaleString()} (${((diff/target)*100).toFixed(1)}% off)`);
        console.log(`   Ratio: ${ratio.toFixed(3)}x`);
        console.log(`   Method: ${method.description}`);
        
        if (diff < closest.diff) {
          closest = { name: method.name, marketCap: marketCapUSD, diff, ratio };
        }
        console.log('');
      });
      
      console.log('🏆 WINNER:');
      console.log(`   Best Method: ${closest.name}`);
      console.log(`   Market Cap: $${closest.marketCap.toLocaleString()}`);
      console.log(`   Difference: $${closest.diff.toLocaleString()}`);
      console.log(`   Accuracy: ${(100 - (closest.diff/target)*100).toFixed(1)}%`);
      
      // Let's also try some reverse engineering
      console.log('\n🔄 REVERSE ENGINEERING:');
      console.log('─'.repeat(40));
      
      // What price per token would give us exactly $11,700?
      const targetPriceSOL = target / (totalSupply * solPrice);
      const targetPriceUSD = target / totalSupply;
      
      console.log(`Target price for $11,700 market cap:`);
      console.log(`   Per token (SOL): ${targetPriceSOL.toExponential(4)}`);
      console.log(`   Per token (USD): ${targetPriceUSD.toExponential(4)}`);
      console.log(`   Current virtual: ${virtualPrice.toExponential(4)}`);
      console.log(`   Multiplier needed: ${(targetPriceSOL / virtualPrice).toFixed(3)}x`);
      
      // What if we use different reserve combinations?
      console.log('\n🧪 EXPERIMENTAL CALCULATIONS:');
      console.log('─'.repeat(40));
      
      const experiments = [
        {
          name: 'Real Quote / Virtual Base',
          price: realQuote / virtualBase,
          desc: 'Real SOL / Virtual tokens'
        },
        {
          name: 'Virtual Quote / Real Base',
          price: realBase > 0 ? virtualQuote / realBase : 0,
          desc: 'Virtual SOL / Real tokens'
        },
        {
          name: 'Total Quote / Virtual Base',
          price: (virtualQuote + realQuote) / virtualBase,
          desc: 'All SOL / Virtual tokens'
        },
        {
          name: 'Virtual Quote / Total Base',
          price: virtualQuote / (virtualBase + realBase),
          desc: 'Virtual SOL / All tokens'
        },
        {
          name: 'Sqrt(Virtual * Real)',
          price: Math.sqrt(virtualPrice * (realBase > 0 ? realQuote / realBase : 0)),
          desc: 'Geometric mean of prices'
        }
      ];
      
      experiments.forEach((exp, i) => {
        const marketCap = exp.price * totalSupply * solPrice;
        const diff = Math.abs(marketCap - target);
        console.log(`${i + 1}. ${exp.name}: $${marketCap.toLocaleString()} (${exp.desc})`);
        console.log(`   Difference: $${diff.toLocaleString()}`);
      });
      
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }
    
  } catch (error: any) {
    console.log(`💥 Error: ${error.message}`);
  }
  
  console.log('\n🎯 ANALYSIS COMPLETE!');
}

// Run the calculation finder
findCorrectCalculation().catch(console.error);

/**
 * 🔍 FIND THE CORRECT CALCULATION FOR $11.7K
 * 
 * Let's test every possible calculation method to find what gives us $11,700
 */

async function findCorrectCalculation() {
  console.log('🔍 FINDING CORRECT CALCULATION FOR $11,700 TARGET');
  console.log('═'.repeat(60));
  
  const heliusRpcUrl = 'https://mainnet.helius-rpc.com/?api-key=417b1887-2994-4d66-a5db-a30a372b7c8e';
  const service = new BonkMarketCapService(heliusRpcUrl);
  const mint = 'SesmzykXQ6PDVa7xnuZN7K4pUpE7dKUUdjwBnogUSDH';
  const target = 11700;
  
  try {
    const result = await service.calculateMarketCap(mint);
    
    if (result.success && result.data) {
      const data = result.data;
      const poolData = data.poolStateData;
      
      console.log('📊 RAW DATA:');
      console.log(`   Supply: ${Number(poolData.supply).toLocaleString()}`);
      console.log(`   Decimals: ${poolData.baseDecimals}`);
      console.log(`   Virtual Base: ${Number(poolData.virtualBase).toLocaleString()}`);
      console.log(`   Virtual Quote: ${Number(poolData.virtualQuote).toLocaleString()}`);
      console.log(`   Real Base: ${Number(poolData.realBase).toLocaleString()}`);
      console.log(`   Real Quote: ${Number(poolData.realQuote).toLocaleString()}`);
      
      // Adjusted values
      const decimals = poolData.baseDecimals;
      const totalSupply = Number(poolData.supply) / Math.pow(10, decimals);
      const virtualBase = Number(poolData.virtualBase) / Math.pow(10, decimals);
      const virtualQuote = Number(poolData.virtualQuote) / 1e9;
      const realBase = Number(poolData.realBase) / Math.pow(10, decimals);
      const realQuote = Number(poolData.realQuote) / 1e9;
      
      console.log(`\n📊 ADJUSTED VALUES:`);
      console.log(`   Total Supply: ${totalSupply.toLocaleString()}`);
      console.log(`   Virtual Base: ${virtualBase.toLocaleString()}`);
      console.log(`   Virtual Quote: ${virtualQuote.toFixed(4)} SOL`);
      console.log(`   Real Base: ${realBase.toLocaleString()}`);
      console.log(`   Real Quote: ${realQuote.toFixed(4)} SOL`);
      
      // Get current SOL price from our calculation
      const currentPrice = data.price;
      const virtualPrice = virtualQuote / virtualBase;
      const solPrice = currentPrice / virtualPrice;
      
      console.log(`\n💰 PRICE INFO:`);
      console.log(`   Current Token Price: $${currentPrice.toExponential(4)}`);
      console.log(`   Virtual SOL Price: ${virtualPrice.toExponential(4)} SOL/token`);
      console.log(`   SOL/USD Rate: $${solPrice.toFixed(2)}`);
      
      console.log(`\n🧮 TESTING ALL CALCULATION METHODS:`);
      console.log('─'.repeat(60));
      
      const methods = [
        {
          name: 'Current (Virtual)',
          price: virtualPrice,
          supply: totalSupply,
          description: 'virtualQuote / virtualBase * totalSupply'
        },
        {
          name: 'Real Reserves',
          price: realBase > 0 ? realQuote / realBase : 0,
          supply: totalSupply,
          description: 'realQuote / realBase * totalSupply'
        },
        {
          name: 'Combined Reserves',
          price: (virtualQuote + realQuote) / (virtualBase + realBase),
          supply: totalSupply,
          description: '(virtual + real) / (virtual + real) * totalSupply'
        },
        {
          name: 'Circulating Virtual',
          price: virtualPrice,
          supply: data.circulatingSupply,
          description: 'virtualPrice * circulatingSupply'
        },
        {
          name: 'Circulating Real',
          price: realBase > 0 ? realQuote / realBase : 0,
          supply: data.circulatingSupply,
          description: 'realPrice * circulatingSupply'
        },
        {
          name: 'Real/Virtual Ratio',
          price: virtualPrice * (realQuote / virtualQuote),
          supply: totalSupply,
          description: 'virtualPrice * (realQuote/virtualQuote) * totalSupply'
        },
        {
          name: 'Weighted Average',
          price: (virtualPrice * virtualQuote + (realBase > 0 ? realQuote / realBase : 0) * realQuote) / (virtualQuote + realQuote),
          supply: totalSupply,
          description: 'Weighted by quote amounts'
        },
        {
          name: 'Total Liquidity',
          price: (virtualQuote + realQuote) / totalSupply,
          supply: totalSupply,
          description: 'Total SOL liquidity / total supply'
        }
      ];
      
      // Calculate market caps and find closest
      let closest = { name: '', marketCap: 0, diff: Infinity, ratio: 0 };
      
      methods.forEach((method, index) => {
        const marketCapSOL = method.price * method.supply;
        const marketCapUSD = marketCapSOL * solPrice;
        const diff = Math.abs(marketCapUSD - target);
        const ratio = marketCapUSD / target;
        
        console.log(`${index + 1}. ${method.name}:`);
        console.log(`   Price: ${method.price.toExponential(4)} SOL/token`);
        console.log(`   Supply: ${method.supply.toLocaleString()}`);
        console.log(`   Market Cap: $${marketCapUSD.toLocaleString()}`);
        console.log(`   Difference: $${diff.toLocaleString()} (${((diff/target)*100).toFixed(1)}% off)`);
        console.log(`   Ratio: ${ratio.toFixed(3)}x`);
        console.log(`   Method: ${method.description}`);
        
        if (diff < closest.diff) {
          closest = { name: method.name, marketCap: marketCapUSD, diff, ratio };
        }
        console.log('');
      });
      
      console.log('🏆 WINNER:');
      console.log(`   Best Method: ${closest.name}`);
      console.log(`   Market Cap: $${closest.marketCap.toLocaleString()}`);
      console.log(`   Difference: $${closest.diff.toLocaleString()}`);
      console.log(`   Accuracy: ${(100 - (closest.diff/target)*100).toFixed(1)}%`);
      
      // Let's also try some reverse engineering
      console.log('\n🔄 REVERSE ENGINEERING:');
      console.log('─'.repeat(40));
      
      // What price per token would give us exactly $11,700?
      const targetPriceSOL = target / (totalSupply * solPrice);
      const targetPriceUSD = target / totalSupply;
      
      console.log(`Target price for $11,700 market cap:`);
      console.log(`   Per token (SOL): ${targetPriceSOL.toExponential(4)}`);
      console.log(`   Per token (USD): ${targetPriceUSD.toExponential(4)}`);
      console.log(`   Current virtual: ${virtualPrice.toExponential(4)}`);
      console.log(`   Multiplier needed: ${(targetPriceSOL / virtualPrice).toFixed(3)}x`);
      
      // What if we use different reserve combinations?
      console.log('\n🧪 EXPERIMENTAL CALCULATIONS:');
      console.log('─'.repeat(40));
      
      const experiments = [
        {
          name: 'Real Quote / Virtual Base',
          price: realQuote / virtualBase,
          desc: 'Real SOL / Virtual tokens'
        },
        {
          name: 'Virtual Quote / Real Base',
          price: realBase > 0 ? virtualQuote / realBase : 0,
          desc: 'Virtual SOL / Real tokens'
        },
        {
          name: 'Total Quote / Virtual Base',
          price: (virtualQuote + realQuote) / virtualBase,
          desc: 'All SOL / Virtual tokens'
        },
        {
          name: 'Virtual Quote / Total Base',
          price: virtualQuote / (virtualBase + realBase),
          desc: 'Virtual SOL / All tokens'
        },
        {
          name: 'Sqrt(Virtual * Real)',
          price: Math.sqrt(virtualPrice * (realBase > 0 ? realQuote / realBase : 0)),
          desc: 'Geometric mean of prices'
        }
      ];
      
      experiments.forEach((exp, i) => {
        const marketCap = exp.price * totalSupply * solPrice;
        const diff = Math.abs(marketCap - target);
        console.log(`${i + 1}. ${exp.name}: $${marketCap.toLocaleString()} (${exp.desc})`);
        console.log(`   Difference: $${diff.toLocaleString()}`);
      });
      
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }
    
  } catch (error: any) {
    console.log(`💥 Error: ${error.message}`);
  }
  
  console.log('\n🎯 ANALYSIS COMPLETE!');
}

// Run the calculation finder
findCorrectCalculation().catch(console.error);