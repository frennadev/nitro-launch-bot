# Unified Configuration System

## Overview

The unified configuration system ensures consistent slippage and priority fee behavior across all blockchain platforms (PumpFun, PumpSwap, BONK, and CPMM). This system allows users to set their preferences once and have them applied uniformly across all trading operations.

## Key Features

### 1. **Centralized Configuration**
- Single configuration object for all platforms
- Consistent behavior across buy/sell operations
- User-configurable parameters with sensible defaults

### 2. **Platform-Agnostic Design**
- Works with all supported platforms
- Automatic conversion to platform-specific formats
- Maintains platform-specific optimizations

### 3. **Preset Configurations**
- Conservative: Lower slippage, safer trading
- Balanced: Default settings for most tokens
- Aggressive: Higher slippage, better success rate
- Ultra: Maximum settings for volatile tokens

## Configuration Structure

```typescript
interface UnifiedConfig {
  // Slippage Configuration
  slippage: {
    base: number;           // Base slippage percentage (default: 35%)
    max: number;            // Maximum slippage cap (default: 70%)
    retryBonus: number;     // Extra slippage per retry (default: 10%)
    userOverride?: number;  // User's custom slippage (optional)
  };

  // Priority Fee Configuration
  priorityFees: {
    base: number;           // Base priority fee in microLamports
    retryMultiplier: number; // Multiplier for each retry (default: 1.5)
    max: number;            // Maximum priority fee
    min: number;            // Minimum priority fee
  };

  // Retry Configuration
  retry: {
    maxAttempts: number;    // Maximum retry attempts (default: 3)
    delayMs: number;        // Delay between retries (default: 1000ms)
  };

  // Fee Configuration
  fees: {
    platformPercentage: number; // Platform fee percentage (default: 1.0%)
    maestroPercentage: number;  // Maestro fee percentage (default: 0.25%)
    maestroFixed: number;       // Fixed Maestro fee in lamports
  };

  // Liquidity Configuration
  liquidity: {
    lowThreshold: number;       // SOL threshold for low liquidity
    mediumThreshold: number;    // SOL threshold for medium liquidity
  };
}
```

## Usage Examples

### Basic Usage with Defaults

```typescript
import { createUnifiedConfig } from "./src/blockchain/common/unified-config";

// Use default configuration
const config = createUnifiedConfig();

// Use in trading operations
const result = await executePumpSwapBuy(
  tokenMint,
  wallet,
  amount,
  config.fees.platformPercentage,
  config.slippage.userOverride || config.slippage.base
);
```

### Custom Configuration

```typescript
// Custom configuration with user preferences
const config = createUnifiedConfig({
  slippage: {
    userOverride: 2.0, // User wants 2% slippage
    base: 25,
    max: 60,
    retryBonus: 8,
  },
  priorityFees: {
    base: 2_000_000, // Higher base fee for faster execution
    retryMultiplier: 1.8,
    max: 15_000_000,
    min: 500_000,
  },
  retry: {
    maxAttempts: 4,
    delayMs: 800,
  },
  fees: {
    platformPercentage: 1.5, // Higher platform fee
    maestroPercentage: 0.3,
    maestroFixed: 1_200_000,
  },
});
```

### Using Presets

```typescript
// Conservative trading
const conservativeConfig = createUnifiedConfig({}, 'conservative');

// Aggressive trading for volatile tokens
const aggressiveConfig = createUnifiedConfig({}, 'aggressive');

// Ultra-fast trading for launches
const ultraConfig = createUnifiedConfig({}, 'ultra');
```

## Preset Configurations

### Conservative
- **Slippage**: 20% base, 40% max
- **Priority Fees**: 1M base, 8M max
- **Retries**: 2 attempts, 1.5s delay
- **Best for**: Stable tokens, risk-averse users

### Balanced (Default)
- **Slippage**: 35% base, 70% max
- **Priority Fees**: 1.5M base, 12M max
- **Retries**: 3 attempts, 1s delay
- **Best for**: Most tokens, general trading

### Aggressive
- **Slippage**: 50% base, 80% max
- **Priority Fees**: 2M base, 15M max
- **Retries**: 4 attempts, 800ms delay
- **Best for**: Volatile tokens, higher success rate

### Ultra
- **Slippage**: 70% base, 95% max
- **Priority Fees**: 3M base, 25M max
- **Retries**: 5 attempts, 500ms delay
- **Best for**: Token launches, maximum speed

## Platform-Specific Conversion

The system automatically converts unified configuration to platform-specific formats:

### PumpFun/PumpSwap
```typescript
{
  platformFeePercentage: 1.0,
  slippagePercentage: 1.0, // User override or base
  maxRetries: 3,
}
```

### BONK/CPMM
```typescript
{
  baseSlippage: 35,
  maxSlippage: 70,
  maxRetries: 3,
  retrySlippageBonus: 10,
  platformFeePercentage: 1.0,
  maestroFeePercentage: 0.25,
  lowLiquidityThreshold: 5,
  mediumLiquidityThreshold: 20,
  retryDelayMs: 1000,
}
```

## Priority Fee Management

### Smart Priority Fee Calculation
```typescript
// Calculate fee for retry attempt
const fee = Math.floor(
  config.priorityFees.base * Math.pow(config.priorityFees.retryMultiplier, retryCount)
);
const finalFee = Math.max(config.priorityFees.min, Math.min(fee, config.priorityFees.max));
```

### Transaction Type Optimization
- **Buy**: Higher base fees for faster execution
- **Sell**: Standard fees for cost efficiency
- **Ultra-fast**: Maximum fees for launches

## Integration with Existing Code

### Before (Platform-Specific)
```typescript
// Different configurations per platform
await executePumpSwapBuy(token, wallet, amount, 1.0, 1.0);
await executeBonkBuy(token, wallet, amount, 35);
await executePumpFunBuy(token, wallet, amount, 1.0, 1.0);
```

### After (Unified)
```typescript
// Single configuration for all platforms
const config = createUnifiedConfig({
  slippage: { userOverride: 1.0 },
  priorityFees: { base: 2_000_000 },
});

const pumpSwapConfig = toPlatformConfig(config, 'pumpswap');
const bonkConfig = toPlatformConfig(config, 'bonk');
const pumpFunConfig = toPlatformConfig(config, 'pumpfun');

await executePumpSwapBuy(token, wallet, amount, 
  pumpSwapConfig.platformFeePercentage, 
  pumpSwapConfig.slippagePercentage
);
await executeBonkBuy(token, wallet, amount, bonkConfig.baseSlippage);
await executePumpFunBuy(token, wallet, amount, 
  pumpFunConfig.platformFeePercentage, 
  pumpFunConfig.slippagePercentage
);
```

## Validation

The system includes comprehensive validation:

```typescript
const errors = validateConfig(config);
if (errors.length > 0) {
  console.error('Configuration errors:', errors);
  return;
}
```

### Validation Rules
- Slippage must be between 0-100%
- Max slippage must be >= base slippage
- Priority fees must be non-negative
- Max priority fee must be >= base priority fee
- Retry attempts must be non-negative

## Benefits

### 1. **Consistency**
- Same behavior across all platforms
- Predictable trading experience
- Reduced configuration errors

### 2. **User Control**
- Single place to configure all settings
- Easy to adjust for different trading strategies
- Preset configurations for common scenarios

### 3. **Maintainability**
- Centralized configuration management
- Easy to add new platforms
- Consistent code structure

### 4. **Performance**
- Optimized priority fees per transaction type
- Smart retry logic with increasing fees
- Adaptive slippage based on market conditions

## Future Enhancements

### Planned Features
1. **Dynamic Configuration**: Adjust settings based on market conditions
2. **User Profiles**: Save and load different configurations
3. **A/B Testing**: Compare different configurations
4. **Analytics**: Track success rates by configuration
5. **Auto-Optimization**: Learn optimal settings per token type

### Configuration Persistence
```typescript
// Save user configuration
localStorage.setItem('tradingConfig', JSON.stringify(config));

// Load user configuration
const savedConfig = JSON.parse(localStorage.getItem('tradingConfig') || '{}');
const config = createUnifiedConfig(savedConfig);
```

This unified configuration system ensures that all trading operations use consistent, user-configurable settings while maintaining the flexibility to optimize for different market conditions and trading strategies. 