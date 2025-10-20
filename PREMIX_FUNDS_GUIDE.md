# Premix Funds Queue & Worker System

## Overview

The Premix Funds system allows users to pre-distribute SOL from their funding wallet to their buyer wallets before token launches. This improves launch speed and ensures wallets are ready for immediate token purchases.

## Features

- **Smart Distribution**: Uses the 73-wallet distribution system for optimal amounts
- **Two Modes**: Standard (secure) and Fast (optimized for speed)
- **Intelligent Wallet Selection**: Only uses the number of wallets needed for the amount
- **Progress Tracking**: Real-time progress updates and notifications
- **Error Handling**: Comprehensive error handling and user feedback

## Architecture

```
User Request → enqueuePremixFunds() → premixFundsQueue → premixFundsWorker → Mixer
```

### Components

1. **Queue**: `premixFundsQueue` - BullMQ queue for job management
2. **Worker**: `premixFundsWorker` - Processes premix jobs
3. **Job Type**: `PremixFundsJob` - Defines job structure
4. **Enqueue Function**: `enqueuePremixFunds()` - Adds jobs to queue

## Usage

### Basic Usage

```typescript
import { enqueuePremixFunds } from "./src/backend/functions-main";

const result = await enqueuePremixFunds(
  userId, // User ID
  userChatId, // Telegram chat ID
  0.5 // Amount in SOL to premix
);

if (result.success) {
  console.log("Premix job queued successfully!");
} else {
  console.log("Error:", result.message);
}
```

### Advanced Usage with Options

```typescript
const result = await enqueuePremixFunds(userId, userChatId, 1.0, {
  maxWallets: 20, // Limit to first 20 buyer wallets
  mode: "fast", // Use fast mixing mode
  socketUserId: "socket123", // For real-time updates
});
```

## Mixing Modes

### Standard Mode (Default)

- Uses `initializeMixerWithCustomAmounts()`
- Full privacy protection through intermediate wallets
- Slower but more secure
- Recommended for larger amounts

### Fast Mode

- Uses `initializeFastMixer()`
- Optimized for speed
- Reduced privacy protection
- Recommended for smaller amounts or quick testing

## Job Structure

```typescript
interface PremixFundsJob {
  userId: string; // User identifier
  userChatId: number; // Telegram chat ID for notifications
  mixAmount: number; // Amount in SOL to mix
  maxWallets?: number; // Maximum wallets to use (optional)
  mode?: "standard" | "fast"; // Mixing mode (default: "standard")
  socketUserId?: string; // Socket ID for real-time updates (optional)
}
```

## Worker Phases

The premix worker processes jobs in 6 phases:

1. **Job Started** (10%): Initialize job
2. **Validating Parameters** (20%): Check user wallets and parameters
3. **Calculating Distribution** (35%): Compute 73-wallet distribution
4. **Checking Balances** (50%): Verify funding wallet balance
5. **Initializing Mixer** (70%): Start mixing operation
6. **Premix Complete** (100%): Finalize and notify user

## Error Handling

The system handles various error scenarios:

- **Insufficient Balance**: Checks funding wallet has enough SOL
- **Missing Wallets**: Validates funding and buyer wallets exist
- **Invalid Parameters**: Validates mix amount and options
- **Mixer Failures**: Handles blockchain transaction failures

## Prerequisites

Before using the premix system, ensure:

1. **Funding Wallet**: User must have a funding wallet with sufficient balance
2. **Buyer Wallets**: User must have created buyer wallets (up to 73)
3. **Minimum Balance**: Funding wallet must have mix amount + 0.01 SOL buffer
4. **Services Running**: MongoDB, Redis, and workers must be running

## Integration with Token Launches

Premixed buyer wallets work seamlessly with the existing token launch system:

1. **Before Launch**: Use premix to distribute funds to buyer wallets
2. **During Launch**: Launch system detects pre-funded wallets
3. **Faster Execution**: Skips funding phase, goes straight to token purchases

## Monitoring

### Progress Tracking

- Real-time progress updates via `emitWorkerProgress()`
- Phase-by-phase status reporting
- Success/failure notifications

### Logs

- Worker logs all operations for debugging
- Error details logged for troubleshooting
- Job completion status tracked

## Testing

Use the provided test script to verify functionality:

```bash
npx ts-node test-premix-funds.ts
```

The test script demonstrates:

- Standard mode premixing
- Fast mode premixing
- Error handling scenarios

## Configuration

### Queue Settings

- **Concurrency**: 1 (processes one premix at a time per worker)
- **Redis Connection**: Uses shared Redis client
- **Job Naming**: `premix-{userId}-{timestamp}`

### Mixer Settings

- **73-Wallet Distribution**: Automatically calculated
- **Custom Amounts**: Uses `generateBuyDistribution()`
- **Fee Buffer**: 0.01 SOL reserved for transaction fees

## API Reference

### enqueuePremixFunds()

Enqueues a premix funds job for processing.

**Parameters:**

- `userId: string` - User identifier
- `userChatId: number` - Telegram chat ID
- `mixAmount: number` - Amount in SOL to premix
- `options?: PremixOptions` - Optional configuration

**Returns:**

```typescript
{
  success: boolean;
  message: string;
}
```

### PremixOptions

```typescript
interface PremixOptions {
  maxWallets?: number; // Maximum buyer wallets to use
  mode?: "standard" | "fast"; // Mixing mode
  socketUserId?: string; // Socket ID for real-time updates
}
```

## Best Practices

1. **Amount Planning**: Only premix what you need for upcoming launches
2. **Mode Selection**: Use fast mode for testing, standard for production
3. **Wallet Limits**: Consider limiting wallets for smaller amounts
4. **Balance Management**: Keep 10% reserve in funding wallet
5. **Timing**: Premix during low-traffic periods for better performance

## Troubleshooting

### Common Issues

1. **"Funding wallet not found"**

   - Solution: Create funding wallet first

2. **"No buyer wallets found"**

   - Solution: Create buyer wallets before premixing

3. **"Insufficient funding wallet balance"**

   - Solution: Add more SOL to funding wallet

4. **"Mixer operation failed"**
   - Solution: Check RPC connection and retry

### Debug Information

Check these logs for troubleshooting:

- Worker logs: `[jobs-premix-funds]`
- Mixer logs: Look for mixer operation details
- Queue logs: Check job status in Redis

## Security Considerations

- **Private Key Handling**: Private keys encrypted in database
- **Amount Validation**: Prevents negative or zero amounts
- **Balance Checks**: Validates sufficient funds before processing
- **Error Isolation**: Failures don't affect other operations

## Future Enhancements

Potential improvements:

- **Batch Processing**: Multiple users in single mixer operation
- **Scheduled Premixing**: Automatic premixing at specified times
- **Smart Amount Calculation**: AI-driven optimal amount suggestions
- **Cross-Platform Support**: Support for other blockchain platforms
