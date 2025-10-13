# Distributed Architecture Setup Guide

## Overview

This guide explains how to set up the Nitro Launch Bot in a distributed architecture where the **Bot Server** and **Job Server** run separately, with Redis pub/sub handling communication between them.

## Architecture

```
┌─────────────────┐    Redis Pub/Sub    ┌─────────────────┐
│   Bot Server    │◄─────────────────────►│   Job Server    │
│                 │   worker_progress     │                 │
│ - Telegram Bot  │                       │ - BullMQ Workers│
│ - Socket.IO     │                       │ - Background Jobs│
│ - Web Interface │                       │ - Token Operations│
└─────────────────┘                       └─────────────────┘
        │                                          │
        │                                          │
    ┌───▼───┐                                  ┌───▼───┐
    │ Redis │                                  │ Redis │
    │(Bot DB)│                                  │(Jobs) │
    └───────┘                                  └───────┘
```

## Setup Instructions

### 1. Bot Server Configuration

#### Environment Variables

Add to your Bot Server's `.env`:

```env
# Set distributed mode
NODE_ENV=distributed
DISTRIBUTED_MODE=true

# Redis connection for pub/sub
REDIS_URI=redis://your-redis-server:6379
```

#### Bot Server Startup Code

```typescript
// src/index.ts (Bot Server)
import { initializeProgressSubscriber } from "./websocket/progress-subscriber";

// Initialize Socket.IO server
import "./websocket/socketio-server";

// Initialize Redis subscriber for worker progress events
initializeProgressSubscriber();

// Start Telegram bot
// ... rest of bot initialization
```

### 2. Job Server Configuration

#### Environment Variables

Add to your Job Server's `.env`:

```env
# Set distributed mode
NODE_ENV=distributed
DISTRIBUTED_MODE=true

# Redis connection for pub/sub and BullMQ
REDIS_URI=redis://your-redis-server:6379
```

#### Job Server Startup Code

```typescript
// src/jobs/index.ts (Job Server)
import "./workers"; // This will use the distributed progress service

// Workers will automatically detect distributed mode and use Redis pub/sub
console.log("🚀 Job server started in distributed mode");
```

### 3. Progress Tracking Flow

#### In Distributed Mode:

1. **Job Server** workers emit progress events
2. **Progress Service** detects `DISTRIBUTED_MODE=true`
3. Events are published to Redis channel `worker_progress`
4. **Bot Server** subscribes to `worker_progress` channel
5. **Progress Subscriber** forwards events to Socket.IO clients
6. **Frontend** receives real-time progress updates

#### In Monolith Mode:

1. **Workers** emit progress events directly to Socket.IO
2. **Frontend** receives real-time progress updates

## Code Changes Made

### New Files Created:

#### `src/jobs/progress-service.ts`

- **Purpose**: Unified progress tracking service
- **Features**: Automatic detection of monolith vs distributed mode
- **Functionality**: Emits to Socket.IO (monolith) or Redis (distributed)

#### `src/websocket/progress-subscriber.ts`

- **Purpose**: Redis subscriber for bot server
- **Features**: Subscribes to worker progress events from job server
- **Functionality**: Forwards Redis events to Socket.IO clients

### Modified Files:

#### `src/jobs/workers.ts`

- **Change**: Replaced direct Socket.IO import with distributed progress service
- **Benefit**: Workers now work in both monolith and distributed modes
- **Backward Compatibility**: Maintains all existing functionality

## Environment Detection

The system automatically detects the architecture mode:

### Monolith Mode (Default)

```env
# No special configuration needed
NODE_ENV=production
```

### Distributed Mode

```env
NODE_ENV=distributed
# OR
DISTRIBUTED_MODE=true
```

## Redis Channel Structure

### Channel: `worker_progress`

**Message Format:**

```json
{
  "jobId": "12345",
  "workerType": "launch_token",
  "tokenAddress": "0x...",
  "userId": "user123",
  "userChatId": 123456789,
  "phase": 3,
  "totalPhases": 6,
  "phaseTitle": "Executing Launch",
  "phaseDescription": "Creating token on blockchain",
  "progress": 60,
  "status": "in_progress",
  "timestamp": 1697123456789,
  "details": {
    "tokenName": "MyToken",
    "error": null
  }
}
```

## Benefits of Distributed Architecture

### 1. **Scalability**

- Job server can be horizontally scaled
- Bot server handles only user interactions
- Resource isolation between bot and job processing

### 2. **Reliability**

- Job failures don't affect bot responsiveness
- Bot restarts don't interrupt running jobs
- Independent deployment and updates

### 3. **Performance**

- Heavy job processing doesn't block bot responses
- Real-time progress tracking maintained via Redis
- Efficient resource utilization

### 4. **Monitoring**

- Separate logging and monitoring per service
- Clear separation of concerns
- Better debugging and troubleshooting

## Deployment Examples

### Docker Compose Example

```yaml
version: "3.8"
services:
  bot-server:
    build:
      context: .
      dockerfile: Dockerfile.bot
    environment:
      - NODE_ENV=distributed
      - REDIS_URI=redis://redis:6379
    depends_on:
      - redis

  job-server:
    build:
      context: .
      dockerfile: Dockerfile.job
    environment:
      - NODE_ENV=distributed
      - REDIS_URI=redis://redis:6379
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

### Kubernetes Example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bot-server
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: bot
          image: nitro-bot:latest
          env:
            - name: NODE_ENV
              value: "distributed"
            - name: REDIS_URI
              value: "redis://redis-service:6379"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: job-server
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: jobs
          image: nitro-jobs:latest
          env:
            - name: NODE_ENV
              value: "distributed"
            - name: REDIS_URI
              value: "redis://redis-service:6379"
```

## Testing the Setup

### 1. Start Redis

```bash
redis-server
```

### 2. Start Job Server

```bash
cd job-server
NODE_ENV=distributed npm start
```

### 3. Start Bot Server

```bash
cd bot-server
NODE_ENV=distributed npm start
```

### 4. Verify Progress Tracking

- Check bot server logs for: `✅ Subscribed to worker progress events from job server`
- Submit a job via Telegram bot
- Watch for progress events in bot server logs: `📊 Forwarded progress event: launch_token - Executing Launch (60%)`

## Troubleshooting

### Common Issues:

1. **No progress events received**

   - Check Redis connection on both servers
   - Verify `NODE_ENV=distributed` is set
   - Check Redis pub/sub subscription

2. **Events not reaching frontend**

   - Verify Socket.IO server is running on bot server
   - Check progress subscriber initialization
   - Confirm client connection to Socket.IO

3. **Jobs failing**
   - Check job server Redis connection
   - Verify BullMQ queue configuration
   - Review worker error logs

### Debug Commands:

```bash
# Check Redis pub/sub activity
redis-cli monitor

# Check Redis connections
redis-cli client list

# Test progress event publishing
redis-cli publish worker_progress '{"test": "event"}'
```

This distributed architecture provides a robust, scalable solution for running the Nitro Launch Bot in production environments while maintaining full progress tracking capabilities.
