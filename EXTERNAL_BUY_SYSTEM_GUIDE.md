# External Buy Queue System Documentation

## Overview

The External Buy Queue System allows your frontend applications to execute token purchases from user wallets through a reliable queue-based system with real-time progress tracking.

## System Architecture

```
Frontend Application
       ↓
REST API Endpoints
       ↓
BullMQ Queue System
       ↓
External Buy Worker
       ↓
Blockchain Execution
       ↑
Socket.IO Progress Updates
       ↑
Frontend Progress Display
```

## Features

- ✅ **Queue-based Processing** - Reliable job processing with retry mechanisms
- ✅ **Real-time Progress Updates** - Live progress via Socket.IO
- ✅ **Multi-platform Support** - Auto-detects best platform (PumpFun, Jupiter, etc.)
- ✅ **Error Handling** - Comprehensive error handling and retry logic
- ✅ **Job Management** - Start, monitor, and cancel operations
- ✅ **Frontend Integration** - Ready-to-use React hooks and components

## Quick Start

### 1. Backend Setup

```typescript
// Import the backend setup
import { startCTOProgressServer } from "./examples/backend-socketio-setup";

// Start the server with external buy support
startCTOProgressServer();
```

### 2. Frontend Integration (React)

```tsx
import {
  useExternalBuy,
  ExternalBuyProgressTracker,
} from "./hooks/useExternalBuy";

function MyComponent() {
  const { startExternalBuy, progress, result, isLoading } =
    useExternalBuy("user123");

  const handleBuy = async () => {
    await startExternalBuy({
      tokenAddress: "ABC123...",
      buyAmount: 0.1,
      walletPrivateKey: "your-private-key",
      slippage: 3,
      priorityFee: 0.002,
    });
  };

  return (
    <div>
      <button onClick={handleBuy} disabled={isLoading}>
        Buy Token
      </button>
      {progress && <ExternalBuyProgressTracker progress={progress} />}
      {result && <div>Result: {result.success ? "Success!" : "Failed"}</div>}
    </div>
  );
}
```

## API Reference

### REST Endpoints

#### Start External Buy Operation

```http
POST /api/external-buy/start
Content-Type: application/json

{
  "userId": "string",
  "tokenAddress": "string",
  "buyAmount": number,
  "walletPrivateKey": "string",
  "slippage": number (optional, default: 3),
  "priorityFee": number (optional, default: 0.002),
  "platform": "string (optional, default: 'auto')"
}
```

**Response:**

```json
{
  "success": true,
  "jobId": "string",
  "message": "string",
  "data": {
    "userId": "string",
    "tokenAddress": "string",
    "buyAmount": number,
    "status": "queued",
    "createdAt": "string"
  }
}
```

#### Get Job Status

```http
GET /api/external-buy/job/:jobId/status
```

**Response:**

```json
{
  "success": true,
  "data": {
    "jobId": "string",
    "status": "queued|active|completed|failed",
    "progress": {
      "phase": number,
      "totalPhases": number,
      "phaseTitle": "string",
      "progress": number,
      "details": {}
    },
    "result": {
      "success": boolean,
      "transactionSignature": "string",
      "platform": "string"
    }
  }
}
```

#### Cancel Job

```http
POST /api/external-buy/job/:jobId/cancel
```

### Socket.IO Events

#### Client → Server Events

- `join_room` - Join user-specific room for updates
- `leave_room` - Leave room

#### Server → Client Events

- `external_buy_progress` - Real-time progress updates
- `external_buy_result` - Final operation result
- `external_buy_job_created` - Job creation confirmation

### Progress Phases

The external buy process consists of 4 phases:

1. **Phase 1: Buy Operation Started (10%)**

   - Initializing buy operation
   - Setting up parameters

2. **Phase 2: Preparing Wallet (35%)**

   - Validating wallet and balance
   - Setting up keypair

3. **Phase 3: Executing Purchase (70%)**

   - Executing buy transaction on platform
   - Platform detection and optimization

4. **Phase 4: Operation Completed (100%)**
   - Transaction confirmation
   - Final result processing

## TypeScript Definitions

```typescript
interface ExternalBuyJob {
  userId: string;
  userChatId: number;
  tokenAddress: string;
  buyAmount: number;
  walletPrivateKey: string;
  slippage?: number;
  priorityFee?: number;
  platform?: string;
  socketUserId?: string;
}

interface ExternalBuyProgress {
  jobId: string;
  tokenAddress: string;
  userId: string;
  phase: number;
  totalPhases: number;
  phaseTitle: string;
  phaseDescription: string;
  progress: number;
  status: "started" | "in_progress" | "completed" | "failed";
  buyAmount: number;
  details?: {
    currentOperation?: string;
    estimatedTimeRemaining?: number;
    error?: string;
    transactionSignature?: string;
    platform?: string;
    actualSolSpent?: string;
  };
}

interface ExternalBuyResult {
  jobId: string;
  success: boolean;
  buyAmount: number;
  actualSolSpent: number;
  transactionSignature: string;
  platform: string;
  error?: string;
  completedAt: number;
  duration: number;
}
```

## Error Handling

The system provides comprehensive error handling:

### Common Errors

- **Invalid token address** - Malformed Solana address
- **Insufficient balance** - Wallet doesn't have enough SOL
- **Transaction failed** - Blockchain transaction error
- **Platform unavailable** - Target platform is down
- **Job not found** - Invalid job ID

### Error Response Format

```json
{
  "success": false,
  "error": "Error message",
  "details": "Additional details (development only)"
}
```

## Security Considerations

⚠️ **Important Security Notes:**

1. **Private Key Handling**

   - Never log private keys
   - Encrypt private keys in transit
   - Consider using secure key management

2. **Rate Limiting**

   - Implement rate limiting on API endpoints
   - Monitor for abuse patterns

3. **Validation**
   - Always validate token addresses
   - Check wallet balances before processing
   - Sanitize all inputs

## Production Deployment

### Environment Variables

```bash
# Redis Configuration
REDIS_URL=redis://localhost:6379

# Server Configuration
PORT=3001
NODE_ENV=production

# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --production

COPY src/ ./src/
COPY examples/ ./examples/

EXPOSE 3001

CMD ["node", "examples/backend-socketio-setup.js"]
```

### Health Checks

Monitor system health via:

- `GET /api/cto/health` - General system health
- `GET /api/cto/debug/connections` - Socket.IO connections (dev only)

## Performance Optimization

### Queue Configuration

```typescript
// High-performance queue setup
const externalBuyQueue = new Queue("external-buy", {
  connection: redisClient,
  defaultJobOptions: {
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 200, // Keep last 200 failed jobs
    attempts: 3, // Retry failed jobs 3 times
    backoff: "exponential", // Exponential backoff strategy
  },
});
```

### Concurrency Settings

```typescript
// Worker concurrency
const externalBuyWorker = new Worker(queue.name, processor, {
  connection: redisClient,
  concurrency: 3, // Process 3 jobs simultaneously
});
```

## Monitoring & Logging

### Key Metrics to Monitor

- Job success rate
- Average processing time
- Queue depth
- Error rates by type
- Socket.IO connection count

### Log Levels

- `INFO` - Job lifecycle events
- `ERROR` - Failures and exceptions
- `DEBUG` - Detailed execution info (development)

## Troubleshooting

### Common Issues

1. **Jobs stuck in queue**

   - Check Redis connection
   - Verify worker is running
   - Check system resources

2. **Socket.IO not connecting**

   - Verify CORS configuration
   - Check firewall settings
   - Confirm port accessibility

3. **Transaction failures**
   - Check Solana RPC health
   - Verify wallet balances
   - Monitor network congestion

### Debug Commands

```bash
# Check Redis queue
redis-cli LLEN bull:external-buy:waiting

# Monitor worker logs
pm2 logs external-buy-worker

# Test Socket.IO connection
wscat -c ws://localhost:3001/socket.io/?EIO=4&transport=websocket
```

## Integration Examples

### React Hook Usage

```tsx
const { startExternalBuy, progress, result } = useExternalBuy("user123");

// Start a buy operation
const jobId = await startExternalBuy({
  tokenAddress: "TokenAddress123...",
  buyAmount: 0.5,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  slippage: 5,
});
```

### Vanilla JavaScript

```javascript
const socket = io("http://localhost:3001");

socket.on("external_buy_progress", (progress) => {
  console.log(`Progress: ${progress.progress}% - ${progress.phaseTitle}`);
});

// Start buy via API
fetch("/api/external-buy/start", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: "user123",
    tokenAddress: "TokenAddr...",
    buyAmount: 0.1,
    walletPrivateKey: "PrivateKey...",
  }),
});
```

## Support

For issues and questions:

1. Check the troubleshooting section
2. Review error logs
3. Verify configuration settings
4. Test with minimal examples

The External Buy Queue System provides a robust, scalable solution for frontend token purchase integration with comprehensive progress tracking and error handling.
