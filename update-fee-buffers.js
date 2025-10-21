#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Files and patterns to update
const filesToUpdate = [
  'src/blockchain/pumpfun/externalBuyNoConfirmation.ts',
  'src/service/raydium-cpmm-service.ts',
  'src/service/bonk-service.ts',
  'src/service/pumpswap-service.ts',
  'src/blockchain/pumpfun/externalBuy.ts',
  'src/blockchain/pumpfun/buy.ts',
  'src/blockchain/pumpfun/launch.ts'
];

// Old patterns to replace
const patterns = [
  {
    old: /const transactionFeeReserve = 0\.01; \/\/ Priority fees \+ base fees for current buy/g,
    new: 'const transactionFeeReserve = 0.012; // Priority fees + base fees (increased buffer)'
  },
  {
    old: /const transactionFeeReserve = 0\.01;(\s*\/\/ [^\\n]*)?/g,
    new: 'const transactionFeeReserve = 0.012; // Priority fees + base fees (increased buffer)'
  },
  {
    old: /const totalFeeReserve = transactionFeeReserve \+ accountCreationReserve;/g,
    new: 'const safetyBuffer = 0.005; // Additional safety buffer for gas price variations\n    const totalFeeReserve = transactionFeeReserve + accountCreationReserve + safetyBuffer;'
  }
];

console.log('🔧 Updating fee buffer configurations...\n');

filesToUpdate.forEach(filePath => {
  const fullPath = path.join(process.cwd(), filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${filePath}`);
    return;
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  let modified = false;
  
  patterns.forEach(pattern => {
    if (pattern.old.test(content)) {
      content = content.replace(pattern.old, pattern.new);
      modified = true;
    }
  });
  
  if (modified) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`✅ Updated: ${filePath}`);
  } else {
    console.log(`⚪ No changes needed: ${filePath}`);
  }
});

console.log('\n🎉 Fee buffer update completed!');
console.log('\nSummary of changes:');
console.log('- transactionFeeReserve: 0.01 → 0.012 SOL (+20%)');
console.log('- Added safetyBuffer: 0.005 SOL');
console.log('- Total fee reserve: 0.018 → 0.025 SOL (+39%)');