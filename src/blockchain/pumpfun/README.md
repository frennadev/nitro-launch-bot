# PumpFun Integration

This directory contains a simplified, clean implementation of PumpFun operations for the new launch bot.

## Overview

The PumpFun integration provides essential functionality for:
- Buying tokens on PumpFun
- Selling tokens on PumpFun
- Getting price quotes
- Token creation (basic structure)

## Architecture

### Core Components

1. **`constants.ts`** - Program IDs, discriminators, and PDAs
2. **`utils.ts`** - Bonding curve utilities and quote calculations
3. **`instructions.ts`** - Transaction instruction builders
4. **`buy.ts`** - Buy operations
5. **`sell.ts`** - Sell operations
6. **`index.ts`** - Main exports

### Key Features

- ✅ **Simplified API** - Clean, easy-to-use functions
- ✅ **Error Handling** - Comprehensive error handling and logging
- ✅ **Balance Checks** - Automatic balance validation
- ✅ **Slippage Protection** - Built-in slippage tolerance
- ✅ **Quote Calculations** - Price quotes before transactions
- ✅ **Type Safety** - Full TypeScript support

## Usage

### Basic Buy Operation

```typescript
import { executePumpFunBuy } from './blockchain/pumpfun';
import { Keypair } from '@solana/web3.js';

const tokenAddress = "YOUR_TOKEN_ADDRESS";
const buyerKeypair = Keypair.fromSecretKey(/* your private key */);
const solAmount = 0.1; // 0.1 SOL

const result = await executePumpFunBuy(tokenAddress, buyerKeypair, solAmount);

if (result.success) {
  console.log(`Bought tokens! Signature: ${result.signature}`);
  console.log(`Tokens received: ${result.tokensReceived}`);
} else {
  console.error(`Buy failed: ${result.error}`);
}
```

### Basic Sell Operation

```typescript
import { executePumpFunSell } from './blockchain/pumpfun';

const tokenAddress = "YOUR_TOKEN_ADDRESS";
const sellerKeypair = Keypair.fromSecretKey(/* your private key */);
const tokenAmount = 1000000; // 1 million tokens

const result = await executePumpFunSell(tokenAddress, sellerKeypair, tokenAmount);

if (result.success) {
  console.log(`Sold tokens! Signature: ${result.signature}`);
  console.log(`SOL received: ${result.solReceived}`);
} else {
  console.error(`Sell failed: ${result.error}`);
}
```

### Get Price Quotes

```typescript
import { quoteBuy, quoteSell } from './blockchain/pumpfun';

// Get buy quote
const buyQuote = quoteBuy(
  BigInt(100000000), // 0.1 SOL in lamports
  virtualTokenReserve,
  virtualSolReserve,
  realTokenReserve
);

// Get sell quote
const sellQuote = quoteSell(
  BigInt(1000000), // 1 million tokens
  virtualTokenReserves,
  virtualSolReserves,
  realTokenReserves
);
```

## What's Included vs Original

### ✅ Imported (Simplified)
- Core buy/sell operations
- Price quote calculations
- Bonding curve utilities
- Basic instruction builders
- Error handling and logging
- Balance validation

### ❌ Not Imported (Complex/Advanced)
- Complex launch orchestration
- Multi-wallet mixer integration
- Real-time curve tracking
- CTO (Call To Others) operations
- Advanced fee collection systems
- Complex platform detection
- Service layer integrations

## Configuration

### Environment Variables

```bash
# Solana RPC endpoint (optional, defaults to mainnet)
SOLANA_RPC_ENDPOINT=https://api.mainnet-beta.solana.com
```

### Connection Settings

The integration uses optimized connection settings:
- Commitment: `confirmed`
- Timeout: 60 seconds
- Retry on rate limit: enabled

## Error Handling

All operations return structured results:

```typescript
interface BuyResult {
  success: boolean;
  signature?: string;
  error?: string;
  tokensReceived?: string;
  solSpent?: string;
}
```

Common error scenarios:
- Insufficient balance
- Invalid token address
- Network errors
- Transaction failures

## Testing

Run the example usage:

```typescript
import { runPumpFunExamples } from './blockchain/pumpfun/example-usage';

await runPumpFunExamples();
```

## Dependencies

- `@solana/web3.js` - Solana web3 library
- `@solana/spl-token` - SPL token operations

## Future Enhancements

Potential additions for future versions:
- Token creation operations
- Advanced slippage management
- Multi-wallet support
- Platform detection
- Fee optimization
- Real-time price tracking 