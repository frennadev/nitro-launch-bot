# Test Scripts for Bonk and CPMM Services

This directory contains comprehensive test scripts for testing the Bonk and CPMM (Raydium) services locally.

## 📁 Files Overview

- `test-bonk-service.ts` - Tests for Bonk token trading service
- `test-cpmm-service.ts` - Tests for CPMM (graduated Bonk) trading service  
- `test-runner.ts` - Combined test runner for both services
- `setup-test-env.ts` - Environment setup and validation script
- `TEST_SCRIPTS_README.md` - This documentation file

## 🚀 Quick Start

### 1. Setup Environment

First, run the setup script to validate your configuration:

```bash
npx ts-node setup-test-env.ts
```

### 2. Configure Test Data

Update the test files with your actual data:

#### For Bonk Tests (`test-bonk-service.ts`):
```typescript
const TEST_TOKENS = {
  BONK_TOKEN_1: "YOUR_ACTUAL_BONK_TOKEN_ADDRESS",
  BONK_TOKEN_2: "YOUR_ACTUAL_BONK_TOKEN_ADDRESS_2",
};

const TEST_WALLET = {
  privateKey: "YOUR_ACTUAL_PRIVATE_KEY",
  publicKey: "YOUR_ACTUAL_PUBLIC_KEY",
};
```

#### For CPMM Tests (`test-cpmm-service.ts`):
```typescript
const TEST_TOKENS = {
  GRADUATED_BONK_1: "YOUR_ACTUAL_GRADUATED_BONK_TOKEN_ADDRESS",
  GRADUATED_BONK_2: "YOUR_ACTUAL_GRADUATED_BONK_TOKEN_ADDRESS_2",
};

const TEST_WALLET = {
  privateKey: "YOUR_ACTUAL_PRIVATE_KEY",
  publicKey: "YOUR_ACTUAL_PUBLIC_KEY",
};
```

### 3. Run Tests

#### Run Individual Tests:
```bash
# Test Bonk service only
npx ts-node test-bonk-service.ts

# Test CPMM service only  
npx ts-node test-cpmm-service.ts
```

#### Run All Tests:
```bash
npx ts-node test-runner.ts
```

## 🧪 Test Coverage

### Bonk Service Tests (`test-bonk-service.ts`)

1. **Pool Detection** - Tests Bonk pool discovery and validation
2. **Service Initialization** - Tests service creation and configuration
3. **Output Estimation** - Tests buy/sell amount calculations
4. **Buy Transactions** - Tests buy transaction creation (0.01 SOL)
5. **Sell Transactions** - Tests sell transaction creation (1000 tokens)

### CPMM Service Tests (`test-cpmm-service.ts`)

1. **Pool Detection** - Tests CPMM pool discovery and validation
2. **Service Initialization** - Tests service creation
3. **Pool Information** - Tests pool state and metrics
4. **Buy Transactions** - Tests buy transaction creation (0.01 SOL)
5. **Sell Transactions** - Tests sell transaction creation (1000 tokens)

## ⚙️ Configuration

### Test Amounts

The test scripts use conservative amounts for safety:

- **Buy Tests**: 0.01 SOL (10,000,000 lamports)
- **Sell Tests**: 1,000 tokens (1,000,000,000 units, assuming 9 decimals)

### Slippage Settings

- **Bonk**: 35% base slippage, 70% max slippage
- **CPMM**: 25% base slippage, 60% max slippage

### Retry Logic

- **Max Retries**: 2 (reduced for testing)
- **Retry Delay**: 500ms (reduced for testing)
- **Slippage Bonus**: 10% per retry

## 🔍 What Each Test Does

### Pool Detection Tests
- Validates token addresses
- Discovers pools on-chain
- Measures detection performance
- Logs pool details (reserves, fees, etc.)

### Service Initialization Tests
- Creates service instances
- Validates configuration
- Tests config updates (Bonk only)

### Transaction Tests
- Creates buy/sell transactions
- Validates transaction structure
- Measures creation time
- Logs transaction details (signatures, instructions, etc.)

### Estimation Tests
- Tests output calculation logic
- Validates slippage calculations
- Checks transaction sizes

## 📊 Expected Output

Successful test runs will show:

```
🚀 Starting Bonk Service Tests...
==================================================

🔍 Testing Bonk Pool Detection...

📊 Testing pool detection for BONK_TOKEN_1: YOUR_TOKEN_ADDRESS
✅ Pool found in 150ms
   Pool ID: ABC123...
   Base Mint: DEF456...
   Quote Mint: GHI789...
   Real Base: 1000000000
   Real Quote: 5000000000

🔧 Testing Bonk Service Initialization...
✅ Bonk service initialized successfully
   Config loaded successfully
✅ Config update successful

📊 Testing Bonk Output Estimation...
🧮 Testing estimation for BONK_TOKEN_1: YOUR_TOKEN_ADDRESS
   Buy estimation for 10000000 lamports (0.01 SOL)
   ✅ Buy transaction created successfully
   Transaction size: 1234 bytes

🚀 Testing Bonk Buy Transaction...
💰 Testing buy for BONK_TOKEN_1: YOUR_TOKEN_ADDRESS
   Buy amount: 10000000 lamports (0.01 SOL)
✅ Buy transaction created in 200ms
   Transaction signature: ABC123...
   Instructions count: 8

==================================================
✅ All Bonk tests completed!
```

## ⚠️ Important Notes

### Security
- **Never commit private keys** to version control
- Use test wallets with limited funds
- Test with small amounts first

### Prerequisites
- Sufficient SOL balance for testing
- Valid token addresses with active pools
- Proper network connectivity

### Error Handling
- Tests gracefully handle missing pools
- Invalid addresses are caught and reported
- Insufficient balance errors are expected without real funds

## 🐛 Troubleshooting

### Common Issues

1. **"Pool not found" errors**
   - Verify token addresses are correct
   - Check if tokens have active pools
   - Ensure you're on the correct network

2. **"Invalid private key" errors**
   - Check private key format (base58)
   - Ensure public key matches private key

3. **"Insufficient funds" errors**
   - Expected when testing without real balance
   - Tests will still validate transaction creation

4. **Import errors**
   - Ensure all dependencies are installed
   - Check TypeScript configuration
   - Verify file paths are correct

### Debug Mode

For detailed logging, the services include comprehensive debug output:
- Pool discovery timing
- Transaction creation details
- Slippage calculations
- Error messages with context

## 📈 Performance Metrics

The tests measure and report:
- Pool discovery time
- Transaction creation time
- Transaction size
- Instruction count
- Memory usage patterns

## 🔄 Continuous Testing

For development, you can run tests in watch mode:

```bash
# Install nodemon for auto-restart
npm install -g nodemon

# Run tests with auto-restart
nodemon --exec "npx ts-node test-runner.ts"
```

## 📝 Customization

### Adding New Tests

1. Create new test functions in the respective test files
2. Add them to the main test runner
3. Follow the existing pattern for consistency

### Modifying Test Parameters

Update the constants at the top of each test file:
- `TEST_CONFIG` - Service configuration
- `TEST_TOKENS` - Token addresses
- `TEST_WALLET` - Wallet information
- Test amounts and retry settings

### Environment Variables

For production testing, consider using environment variables:
```bash
export BONK_TOKEN_1="your_token_address"
export CPMM_TOKEN_1="your_cpmm_token_address"
export TEST_PRIVATE_KEY="your_private_key"
```

Then update the test files to use `process.env.*` instead of hardcoded values 