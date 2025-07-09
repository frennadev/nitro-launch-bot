# Bonk Services

A comprehensive backend service for interacting with Bonk pools on Solana, providing optimized buy/sell transactions with adaptive slippage and retry logic.

## Features

### 🚀 High Performance
- **Optimized Pool Discovery**: Uses memcmp filters to reduce RPC data transfer by 99.99%
- **Pre-cached Known Pools**: Instant access to frequently used pools
- **Smart Caching**: 5-minute cache for pool data to avoid repeated RPC calls
- **Parallel Processing**: Concurrent pool state fetching with multiple commitment levels

### 🛡️ Robust Transaction Handling
- **Adaptive Slippage**: Automatically adjusts slippage based on price impact and liquidity
- **Retry Logic**: Exponential backoff with increasing slippage for failed transactions
- **Multiple Config Modes**: Conservative, Default, Aggressive, Maximum, Ultra
- **Error Recovery**: Intelligent handling of different error types

### 💰 Advanced Trading Features
- **Percentage-based Selling**: Sell specific percentages of token holdings
- **Price Impact Detection**: Automatic slippage adjustment for high-impact trades
- **Liquidity Analysis**: Pool depth assessment for optimal transaction parameters
- **Fee Optimization**: Optimized compute units and priority fees

## Services Overview

### 1. BonkPoolService (`src/service/bonk-pool-service.ts`)
Handles pool state detection and caching for Bonk pools.

**Key Functions:**
- `getBonkPoolState(tokenMint)`: Find and decode pool state
- `clearPoolCache(tokenMint)`: Clear cache for specific token
- `getPoolCacheStats()`: Get cache statistics

### 2. BonkService (`src/service/bonk-service.ts`)
Core service for creating buy/sell transactions with advanced features.

**Key Methods:**
- `buyTx(buyData)`: Create buy transaction with adaptive slippage
- `sellTx(sellData)`: Create sell transaction with percentage support
- `updateConfig(config)`: Update service configuration at runtime

### 3. BonkTransactionHandler (`src/service/bonk-transaction-handler.ts`)
High-level transaction execution with different configuration modes.

**Key Functions:**
- `executeBonkBuy(privateKey, tokenMint, amount, configMode)`: Execute buy transaction
- `executeBonkSell(percentage, privateKey, tokenMint, configMode)`: Execute sell transaction
- `getAvailableConfigModes()`: Get all available configuration modes

## Configuration Modes

| Mode | Base Slippage | Max Slippage | Retries | Description |
|------|---------------|--------------|---------|-------------|
| **Conservative** | 40% | 60% | 2 | Lower slippage, fewer retries - safer but may fail more often |
| **Default** | 35% | 70% | 3 | Balanced settings for most tokens |
| **Aggressive** | 50% | 80% | 5 | Higher slippage, more retries - better success rate for volatile tokens |
| **Maximum** | 60% | 90% | 3 | Very high slippage for extremely volatile tokens |
| **Ultra** | 70% | 95% | 4 | Maximum settings for the most volatile tokens |

## Usage Examples

### Basic Buy Transaction

```typescript
import { executeBonkBuy } from "./src/service/bonk";

const result = await executeBonkBuy(
  "your_private_key_here",
  "2K2dBWwncM2ySZKMigXNpwgoarUJ5iJTHmqGmM87bonk",
  0.001, // 0.001 SOL
  "aggressive" // config mode
);

if (result.success) {
  console.log("✅ Buy successful!");
  console.log(`Signature: ${result.signature}`);
  console.log(`Explorer: ${result.explorerUrl}`);
} else {
  console.log("❌ Buy failed:", result.message);
}
```

### Percentage-based Sell Transaction

```typescript
import { executeBonkSell } from "./src/service/bonk";

const result = await executeBonkSell(
  50, // 50% of holdings
  "your_private_key_here",
  "2K2dBWwncM2ySZKMigXNpwgoarUJ5iJTHmqGmM87bonk",
  undefined, // tokenAmount (calculated from percentage)
  "conservative" // config mode
);

if (result.success) {
  console.log("✅ Sell successful!");
  console.log(`Signature: ${result.signature}`);
} else {
  console.log("❌ Sell failed:", result.message);
}
```

### Custom BonkService Configuration

```typescript
import { BonkService } from "./src/service/bonk";

const bonkService = new BonkService({
  baseSlippage: 40,
  maxSlippage: 75,
  maxRetries: 4,
  retrySlippageBonus: 15,
  lowLiquidityThreshold: 3,
  mediumLiquidityThreshold: 15,
});

// Create buy transaction
const tx = await bonkService.buyTx({
  mint: new PublicKey("2K2dBWwncM2ySZKMigXNpwgoarUJ5iJTHmqGmM87bonk"),
  amount: BigInt(0.001 * LAMPORTS_PER_SOL),
  privateKey: "your_private_key_here",
});

// Send transaction
const signature = await connection.sendTransaction(tx);
```

### Pool State Detection

```typescript
import { getBonkPoolState, getPoolCacheStats } from "./src/service/bonk";

// Get pool state
const poolState = await getBonkPoolState("2K2dBWwncM2ySZKMigXNpwgoarUJ5iJTHmqGmM87bonk");

if (poolState) {
  console.log("Pool found!");
  console.log(`Pool ID: ${poolState.poolId.toBase58()}`);
  console.log(`Base Mint: ${poolState.baseMint.toBase58()}`);
  console.log(`Quote Mint: ${poolState.quoteMint.toBase58()}`);
  console.log(`Real Base: ${poolState.realBase.toString()}`);
  console.log(`Real Quote: ${poolState.realQuote.toString()}`);
}

// Get cache statistics
const stats = getPoolCacheStats();
console.log("Cache stats:", stats);
```

## Error Handling

The services provide comprehensive error handling with specific error types:

### Common Error Types

- **Timeout**: Transaction timed out - try different RPC endpoint
- **RateLimit**: RPC rate limit exceeded - try again later
- **PoolNotFound**: Token may not have a Bonk pool or pool is inactive
- **ExceededSlippage**: Slippage exceeded maximum - try different config mode
- **NoTokenBalance**: No tokens to sell
- **InsufficientFunds**: Wallet doesn't have enough SOL

### Error Recovery Strategies

```typescript
try {
  const result = await executeBonkBuy(privateKey, tokenMint, amount, "default");
  // Handle success
} catch (error) {
  if (error.message.includes("ExceededSlippage")) {
    // Try with more aggressive settings
    const result = await executeBonkBuy(privateKey, tokenMint, amount, "aggressive");
  } else if (error.message.includes("PoolNotFound")) {
    // Token may not be on Bonk
    console.log("Token not found on Bonk - try different platform");
  }
}
```

## Performance Optimizations

### 1. Memcmp Filters
- Reduces RPC data transfer from 146MB to ~1-10KB (99.99% reduction)
- Searches only pools containing the target token
- Parallel searches for baseMint and quoteMint matches

### 2. Smart Caching
- 5-minute cache for pool data
- Pre-cached known pools for instant access
- Automatic cache invalidation

### 3. Adaptive Slippage
- Calculates optimal slippage based on price impact
- Adjusts for pool liquidity depth
- Increases slippage on retries for better success rate

### 4. Optimized Instructions
- Pre-computed ATA addresses
- Idempotent ATA creation instructions
- Optimized compute units and priority fees

## Configuration Options

### BonkServiceConfig Interface

```typescript
interface BonkServiceConfig {
  baseSlippage: number;           // Base slippage percentage (default: 35%)
  maxSlippage: number;            // Maximum slippage cap (default: 70%)
  maxRetries: number;             // Maximum retry attempts (default: 3)
  lowLiquidityThreshold: number;  // SOL threshold for low liquidity warning (default: 5)
  mediumLiquidityThreshold: number; // SOL threshold for medium liquidity (default: 20)
  feeRateBasisPoints: number;     // Fee rate in basis points (default: 25 = 0.25%)
  retryDelayMs: number;           // Base delay between retries in ms (default: 1000)
  retrySlippageBonus: number;     // Extra slippage per retry attempt (default: 10%)
}
```

## Testing

Run the test file to see examples in action:

```bash
bun run test-bonk-service.ts
```

## Dependencies

- `@solana/web3.js`: Solana web3 library
- `@solana/buffer-layout`: Buffer layout utilities
- `@solana/spl-token`: SPL token utilities
- `@project-serum/anchor`: Anchor framework utilities

## Security Notes

- Always validate private keys and token mints before use
- Use appropriate slippage settings for your risk tolerance
- Monitor transaction confirmations and handle failures gracefully
- Keep private keys secure and never expose them in logs

## Support

For issues or questions:
1. Check the error messages for specific guidance
2. Try different configuration modes
3. Verify token mint addresses and wallet balances
4. Check RPC endpoint status and try alternative endpoints 