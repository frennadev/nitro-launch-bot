# Zero Slot Integration Guide

## Overview

This document describes the integration of Zero Slot RPC as the primary transaction sender for buy/sell operations in the Nitro Launch Bot, with Helius as a fallback.

## 🚀 What's Been Implemented

### 1. Zero Slot RPC Service (`src/blockchain/common/zero-slot-rpc.ts`)
- **Primary Endpoints**: Frankfurt (`http://de1.0slot.trade`) and Amsterdam (`http://ams1.0slot.trade`)
- **API Key**: `cfd004f5be7c4ec28d467cf0fa46e492`
- **Rate Limiting**: 5 requests per second (as per Zero Slot requirements)
- **Payment System**: Automatically adds 0.001 SOL payment to required wallets
- **Fallback**: Automatic fallback to Helius if Zero Slot fails

### 2. Enhanced Transaction Sender (`src/blockchain/common/enhanced-transaction-sender.ts`)
- **Smart Routing**: Buy/Sell transactions → Zero Slot, Others → Helius
- **Automatic Payment**: Adds payment instructions for Zero Slot transactions
- **Error Handling**: Comprehensive error handling with fallback logic
- **Health Monitoring**: Built-in health checks for both services

### 3. Updated Transaction Services
The following services now use Zero Slot for buy/sell operations:
- **Bonk Service** (`src/service/bonk-service.ts`) - Buy transactions
- **PumpSwap Service** (`src/service/pumpswap-service.ts`) - Buy/Sell transactions  
- **Raydium CPMM Service** (`src/service/raydium-cpmm-service.ts`) - Sell transactions
- **Bonk Handler** (`src/blockchain/pumpfun/bonkHandler.ts`) - Buy transactions
- **Main Functions** (`src/backend/functions.ts`) - Launch buy transactions

## 🔧 Configuration

### Zero Slot Settings
```typescript
{
  apiKey: "cfd004f5be7c4ec28d467cf0fa46e492",
  endpoints: [
    "http://de1.0slot.trade",     // Frankfurt (primary)
    "http://ams1.0slot.trade"     // Amsterdam (secondary)
  ],
  rateLimitPerSecond: 5,          // Max 5 calls per second
  minPaymentAmount: 1000000,      // 0.001 SOL in lamports
  paymentWallets: [
    "Eb2KpSC8uMt9GmzyAEm5Eb1AAAgTjRaXWFjKyFXHZxF3",
    "FCjUJZ1qozm1e8romw216qyfQMaaWKxWsuySnumVCCNe",
    "ENxTEjSQ1YabmUpXAdCgevnHQ9MHdLv8tzFiuiYJqa13",
    "6rYLG55Q9RpsPGvqdPNJs4z5WTxJVatMB8zV3WJhs5EK",
    "Cix2bHfqPcKcM233mzxbLk14kSggUUiz2A87fJtGivXr"
  ]
}
```

## 📋 Transaction Routing Logic

| Transaction Type | Primary Sender | Fallback | Notes |
|------------------|----------------|----------|-------|
| **BUY** | Zero Slot | Helius | Includes 0.001 SOL payment |
| **SELL** | Zero Slot | Helius | Includes 0.001 SOL payment |
| **TRANSFER** | Helius | N/A | Direct to Helius |
| **OTHER** | Helius | N/A | Direct to Helius |

## 🛡️ Safety Features

### 1. Automatic Fallback
```typescript
// If Zero Slot fails, automatically falls back to Helius
try {
  signature = await zeroSlotRPC.sendTransaction(transaction);
} catch (zeroSlotError) {
  signature = await heliusConnection.sendTransaction(transaction);
}
```

### 2. Rate Limiting
- Built-in 5 requests/second limit for Zero Slot
- Automatic queuing and retry logic
- Smart endpoint rotation (Frankfurt → Amsterdam)

### 3. Payment Integration
- Automatically adds 0.001 SOL payment instruction
- Random payment wallet selection
- Payment only added for Zero Slot transactions

### 4. Error Handling
- Specific error codes handled (403, 419)
- Non-retryable errors identified
- Comprehensive logging

## 📊 Health Monitoring

### Health Check Endpoints
```bash
# Zero Slot health checks
curl http://de1.0slot.trade/health
curl http://ams1.0slot.trade/health
```

### Programmatic Health Check
```typescript
import { enhancedTransactionSender } from "./src/blockchain/common/enhanced-transaction-sender";

const health = await enhancedTransactionSender.healthCheck();
console.log("Zero Slot:", health.zeroSlot);
console.log("Helius:", health.helius);
```

## 🔄 Usage Examples

### Basic Usage (Automatic)
```typescript
import { enhancedTransactionSender, TransactionType } from "./src/blockchain/common/enhanced-transaction-sender";

// Buy transaction - will use Zero Slot
const signature = await enhancedTransactionSender.sendSignedTransaction(
  buyTransaction,
  { transactionType: TransactionType.BUY }
);

// Transfer transaction - will use Helius
const signature = await enhancedTransactionSender.sendSignedTransaction(
  transferTransaction,
  { transactionType: TransactionType.TRANSFER }
);
```

### Advanced Usage
```typescript
// Force Zero Slot usage
const signature = await enhancedTransactionSender.sendSignedTransaction(
  transaction,
  { 
    useZeroSlot: true,
    skipPreflight: false,
    preflightCommitment: "processed",
    maxRetries: 3
  }
);

// Force Helius usage
const signature = await enhancedTransactionSender.sendSignedTransaction(
  transaction,
  { 
    useZeroSlot: false,
    maxRetries: 3
  }
);
```

## 🧪 Testing

Run the integration test:
```bash
npx tsx test-zero-slot-integration.ts
```

The test verifies:
- ✅ Health check functionality
- ✅ Configuration verification
- ✅ Transaction type routing
- ✅ Service initialization

## 📈 Performance Benefits

### Zero Slot Advantages
- **Speed**: Direct validator connection
- **Reliability**: Dedicated infrastructure
- **Priority**: Better transaction priority

### Smart Fallback
- **Resilience**: Never breaks existing functionality
- **Redundancy**: Multiple RPC providers
- **Flexibility**: Easy to disable/modify

## 🚨 Important Notes

### Requirements for Zero Slot Usage
1. **Payment**: Each transaction must include 0.001 SOL payment
2. **Rate Limit**: Maximum 5 requests per second
3. **Method**: Only `sendTransaction` method supported
4. **HTTP**: Uses HTTP (not HTTPS) for speed

### Backward Compatibility
- ✅ All existing code continues to work
- ✅ No breaking changes
- ✅ Gradual rollout possible
- ✅ Easy to disable if needed

### Monitoring
- All transactions logged with sender information
- Health status available via API
- Error rates tracked and logged

## 🛠️ Troubleshooting

### Common Issues

1. **API Key Expired**
   ```json
   {"error": {"code": 403, "message": "API key has expired"}}
   ```
   Solution: Update API key in configuration

2. **Rate Limit Exceeded**
   ```json
   {"error": {"code": 419, "message": "Rate limit exceeded"}}
   ```
   Solution: Automatic retry with backoff

3. **Invalid Method**
   ```json
   {"error": {"code": 403, "message": "Invalid method"}}
   ```
   Solution: Only use sendTransaction method

### Logs to Monitor
```bash
# Look for these log patterns
grep "Zero Slot" logs/app.log
grep "Transaction sent via Zero Slot" logs/app.log
grep "falling back to Helius" logs/app.log
```

## 📞 Support

For Zero Slot support:
- Discord: https://discord.com/invite/NKjdddZQWD
- Documentation: Check their GitHub examples

## 🎯 Next Steps

1. **Monitor Performance**: Track transaction success rates
2. **Optimize Settings**: Fine-tune rate limits and timeouts
3. **Expand Usage**: Consider using for more transaction types
4. **Health Dashboard**: Build monitoring dashboard

---

**Status**: ✅ **FULLY INTEGRATED AND READY FOR PRODUCTION**

The Zero Slot integration is complete and safe. All buy/sell transactions will now use Zero Slot with automatic fallback to Helius, while maintaining full backward compatibility.