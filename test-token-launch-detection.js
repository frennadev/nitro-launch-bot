import { detectTokenLaunchStatus, isTokenAlreadyLaunched, isTokenAlreadyListed } from './src/service/token-detection-service.js';

async function testTokenLaunchDetection() {
  console.log('🧪 Testing Token Launch Detection System\n');
  
  // Test cases - mix of real and fake token addresses
  const testTokens = [
    {
      name: 'Fake Token (should be unlaunched)',
      address: '11111111111111111111111111111111' // System program (definitely not a token)
    },
    {
      name: 'USDC (should be launched)',
      address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC mint
    },
    {
      name: 'SOL (should be launched)',
      address: 'So11111111111111111111111111111111111111112' // Wrapped SOL
    },
    {
      name: 'Random Address (should be unlaunched)',
      address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU' // Random address
    }
  ];
  
  for (const testToken of testTokens) {
    console.log(`\n🔍 Testing: ${testToken.name}`);
    console.log(`📍 Address: ${testToken.address}`);
    
    try {
      // Test comprehensive detection
      console.log('📊 Running comprehensive detection...');
      const startTime = performance.now();
      const status = await detectTokenLaunchStatus(testToken.address);
      const detectionTime = performance.now() - startTime;
      
      console.log(`⏱️  Detection time: ${Math.round(detectionTime)}ms`);
      console.log('📈 Results:');
      console.log(`  • Launched: ${status.isLaunched ? '✅ Yes' : '❌ No'}`);
      console.log(`  • Listed: ${status.isListed ? '✅ Yes' : '❌ No'}`);
      console.log(`  • Platform: ${status.platform || 'Unknown'}`);
      console.log(`  • Has Liquidity: ${status.hasLiquidity ? '✅ Yes' : '❌ No'}`);
      console.log(`  • Has Trading Volume: ${status.hasTradingVolume ? '✅ Yes' : '❌ No'}`);
      if (status.lastActivity) {
        console.log(`  • Last Activity: ${status.lastActivity.toISOString()}`);
      }
      if (status.error) {
        console.log(`  • Error: ${status.error}`);
      }
      
      // Test quick checks
      console.log('\n⚡ Testing quick checks...');
      const isLaunched = await isTokenAlreadyLaunched(testToken.address);
      const isListed = await isTokenAlreadyListed(testToken.address);
      
      console.log(`  • Quick Launched Check: ${isLaunched ? '✅ Yes' : '❌ No'}`);
      console.log(`  • Quick Listed Check: ${isListed ? '✅ Yes' : '❌ No'}`);
      
      // Verify consistency
      if (isLaunched !== status.isLaunched || isListed !== status.isListed) {
        console.log('⚠️  WARNING: Quick checks don\'t match comprehensive results!');
      } else {
        console.log('✅ Quick checks match comprehensive results');
      }
      
    } catch (error) {
      console.error(`❌ Error testing ${testToken.name}:`, error.message);
    }
    
    console.log('─'.repeat(60));
  }
  
  console.log('\n🎉 Token launch detection test completed!');
}

// Run the test
testTokenLaunchDetection().catch(console.error); 