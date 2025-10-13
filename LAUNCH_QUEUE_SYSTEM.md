# Launch Queue System Documentation

## Overview

The Launch Queue System allows external platforms to queue token launches for both Pump.fun and Bonk platforms. The system uses Redis-based job queues with BullMQ for scalable, reliable processing.

## Architecture

```
External Platform → Launch Service → Launch Queue → Launch Worker → Blockchain
                                                  ↓
                                            Socket.IO (Real-time updates)
```

### Components

1. **Launch Service** (`src/services/launch-service.ts`): API interface for external platforms
2. **Launch Queue** (`src/jobs/launch-queue.ts`): Redis-based job queue management
3. **Launch Worker** (`src/jobs/launch-worker.ts`): Job processing and blockchain integration
4. **Launch Types** (`src/jobs/launch-types.ts`): TypeScript interfaces and types

## Usage

### 1. Queue a Token Launch

```typescript
import { LaunchService } from "./src/services/launch-service";

const response = await LaunchService.queueLaunch({
  userId: "user_123",
  chatId: 123456789, // Optional
  platform: "pump", // or "bonk"
  tokenName: "My Token",
  tokenSymbol: "MTK",
  fundingWalletPrivateKey: "your_funding_wallet_key",
  devWalletPrivateKey: "your_dev_wallet_key",
  buyerWalletPrivateKeys: ["buyer1_key", "buyer2_key", "buyer3_key"],
  devBuy: 0.5, // SOL amount for dev buy
  buyAmount: 0.1, // SOL amount per buyer wallet
  launchMode: "normal", // or "prefunded"
});

if (response.success) {
  console.log("Launch queued with job ID:", response.jobId);
}
```

### 2. Check Launch Status

```typescript
const status = await LaunchService.getLaunchStatus(jobId);

console.log("Job State:", status.state); // waiting, active, completed, failed
console.log("Progress:", status.progress); // 0-100
console.log("Result:", status.result); // Launch result if completed
```

### 3. Get User's Launch History

```typescript
const launches = await LaunchService.getUserLaunches("user_123", 10, 0);

launches.launches.forEach((launch) => {
  console.log(`${launch.tokenName} (${launch.tokenSymbol}) - ${launch.state}`);
});
```

### 4. Cancel a Launch

```typescript
const result = await LaunchService.cancelLaunch(jobId);
// Note: Can only cancel jobs in "waiting" state
```

## Launch Flow

### Pump.fun Launch Process

1. **Validation** (10%): Validate launch parameters and wallet keys
2. **Wallet Setup** (20%): Initialize and validate all wallets
3. **Token Creation** (40%): Deploy token on Pump.fun platform
4. **Mixing** (70%): Distribute funds across buyer wallets
5. **Finalization** (90%): Complete launch and save data
6. **Completion** (100%): Return final results with trading links

### Bonk Launch Process

Similar to Pump.fun but with platform-specific token deployment logic.

## Job States

- **waiting**: Job is queued but not yet processing
- **active**: Job is currently being processed
- **completed**: Job finished successfully
- **failed**: Job failed with error
- **stalled**: Job processing stalled (will be retried)

## Error Handling

The system includes comprehensive error handling:

- **Validation Errors**: Invalid parameters, missing keys, etc.
- **Blockchain Errors**: Network issues, insufficient funds, etc.
- **System Errors**: Redis connection, worker failures, etc.

All errors are logged and returned in the job results.

## Retry Logic

- **Automatic Retries**: 3 attempts with exponential backoff
- **Retry Delay**: Starting at 5 seconds, doubling each attempt
- **Smart Retry**: Failed jobs can be manually retried with updated parameters

## Integration Examples

### Express.js API Integration

```typescript
import express from "express";
import { LaunchService } from "./src/services/launch-service";

const app = express();
app.use(express.json());

// Queue a launch
app.post("/api/launch", async (req, res) => {
  const result = await LaunchService.queueLaunch(req.body);
  res.json(result);
});

// Get launch status
app.get("/api/launch/:jobId", async (req, res) => {
  const result = await LaunchService.getLaunchStatus(req.params.jobId);
  res.json(result);
});

// Get user launches
app.get("/api/user/:userId/launches", async (req, res) => {
  const result = await LaunchService.getUserLaunches(req.params.userId);
  res.json(result);
});
```

### Socket.IO Real-time Updates

The system integrates with Socket.IO for real-time launch progress updates:

```typescript
// Listen for launch events
socket.on("launch_started", (data) => {
  console.log(`Launch started for ${data.tokenName}`);
});

socket.on("launch_progress", (data) => {
  console.log(`Progress: ${data.progress}% - ${data.message}`);
});

socket.on("launch_completed", (data) => {
  console.log(`Launch completed! Token: ${data.tokenAddress}`);
});

socket.on("launch_error", (data) => {
  console.log(`Launch failed: ${data.error}`);
});
```

## Starting the System

### 1. Start the Launch Worker

```typescript
import { startLaunchWorker } from "./src/jobs/launch-init";

// Start the worker
const worker = startLaunchWorker();

// Graceful shutdown
process.on("SIGTERM", async () => {
  await worker.shutdown();
  process.exit(0);
});
```

### 2. Environment Requirements

- **Redis**: Required for job queue
- **MongoDB**: Required for user data
- **Solana RPC**: Required for blockchain operations

## Testing

Run the test suite to validate the system:

```bash
bun run test-launch-system.ts
```

This will:

1. Start the launch worker
2. Queue test launches for both platforms
3. Check job statuses
4. Validate error handling
5. Display queue statistics

## Security Considerations

1. **Private Key Handling**: Private keys are handled securely and not logged
2. **User Validation**: All user IDs are validated using MongoDB ObjectId format
3. **Input Sanitization**: All inputs are validated before processing
4. **Rate Limiting**: Consider implementing rate limiting for production use

## Monitoring

Monitor the system using:

1. **Queue Statistics**: Check waiting/active/completed/failed job counts
2. **Worker Health**: Monitor worker status and processing times
3. **Error Rates**: Track failed job rates and common error types
4. **Performance**: Monitor job completion times and throughput

## Configuration

Key configuration options:

```typescript
// Worker concurrency
const worker = new Worker("launch-token", processJob, {
  concurrency: 3, // Process up to 3 launches simultaneously
});

// Job retry options
await launchTokenQueue.add(jobName, jobData, {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000,
  },
});
```

## Production Deployment

For production deployment:

1. **Horizontal Scaling**: Run multiple worker instances
2. **Redis Clustering**: Use Redis cluster for high availability
3. **Health Checks**: Implement health check endpoints
4. **Monitoring**: Set up comprehensive monitoring and alerting
5. **Logging**: Implement structured logging for better debugging

## Support

For issues or questions about the Launch Queue System, check:

1. Job logs for processing details
2. Redis queue status for job states
3. Worker health and error logs
4. System monitoring dashboards
