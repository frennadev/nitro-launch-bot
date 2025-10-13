# Worker Progress Tracking System

This system provides real-time progress tracking for all background workers using Socket.IO. Frontend applications can connect to receive detailed progress updates for token launches, sells, and other operations.

## Features

- **Real-time Progress Updates**: Get live updates for all worker operations
- **User-specific Rooms**: Each user receives only their own progress updates
- **Detailed Phase Tracking**: Each worker operation is broken down into distinct phases
- **Comprehensive Error Handling**: Failed operations emit detailed error information
- **Step-by-Step Visibility**: Optional granular step tracking within phases

## Event Types

### Worker Progress Events (`worker_progress`)

Emitted when a worker transitions between phases or updates progress:

```typescript
interface WorkerProgressEvent {
  jobId: string;
  workerType:
    | "launch_token"
    | "prepare_launch"
    | "execute_launch"
    | "dev_sell"
    | "wallet_sell";
  tokenAddress: string;
  userId: string;
  userChatId: number;
  phase: number;
  totalPhases: number;
  phaseTitle: string;
  phaseDescription: string;
  progress: number; // 0-100
  status: "started" | "in_progress" | "completed" | "failed";
  timestamp: number;
  details?: {
    tokenName?: string;
    tokenSymbol?: string;
    buyAmount?: number;
    devBuy?: number;
    sellPercent?: number;
    walletsCount?: number;
    error?: string;
    signature?: string;
    [key: string]: unknown;
  };
}
```

### Worker Step Events (`worker_step`)

Emitted for granular step tracking within phases:

```typescript
interface WorkerStepEvent {
  jobId: string;
  workerType: string;
  tokenAddress: string;
  userId: string;
  step: string;
  stepNumber: number;
  totalSteps: number;
  message: string;
  timestamp: number;
  data?: unknown;
}
```

## Worker Progress Phases

### Launch Token Worker (`launch_token`)

1. **Job Started** (0%) - Token launch job initiated
2. **Validating Parameters** (15%) - Checking token parameters
3. **Checking Balances** (30%) - Verifying wallet balances
4. **Creating Token** (45%) - Deploying token contract
5. **Executing Launch** (60%) - Running launch sequence
6. **Finalizing Launch** (85%) - Updating token state
7. **Launch Completed** (100%) - Process complete

### Prepare Launch Worker (`prepare_launch`)

1. **Preparation Started** (5%) - Job initiated
2. **Validating Parameters** (15%) - Checking launch parameters
3. **Collecting Platform Fee** (25%) - Processing fees
4. **Initializing Mixer** (40%) - Setting up privacy mixer
5. **Executing Preparation** (70%) - Running preparation sequence
6. **Preparation Completed** (100%) - Process complete

### Dev Sell Worker (`dev_sell`)

1. **Dev Sell Started** (10%) - Job initiated
2. **Validating Parameters** (25%) - Checking sell parameters
3. **Calculating Amounts** (45%) - Computing sell amounts
4. **Executing Transaction** (70%) - Broadcasting transaction
5. **Dev Sell Completed** (100%) - Process complete

### Wallet Sell Worker (`wallet_sell`)

Similar structure with phases for validation, calculation, execution, and completion.

## Frontend Integration

### React Hook Example

```typescript
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface WorkerProgress {
  [jobId: string]: WorkerProgressEvent;
}

export const useWorkerProgress = (userId: string) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [progress, setProgress] = useState<WorkerProgress>({});
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const newSocket = io('http://localhost:3001');

    newSocket.on('connect', () => {
      setIsConnected(true);
      // Subscribe to user-specific events
      newSocket.emit('subscribe', \`user_\${userId}\`);
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
    });

    newSocket.on('worker_progress', (event: WorkerProgressEvent) => {
      setProgress(prev => ({
        ...prev,
        [event.jobId]: event
      }));
    });

    newSocket.on('worker_step', (event: WorkerStepEvent) => {
      console.log('Worker Step:', event);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [userId]);

  return { socket, progress, isConnected };
};
```

### Vue.js Composable Example

```typescript
import { ref, onMounted, onUnmounted } from 'vue';
import { io, Socket } from 'socket.io-client';

export const useWorkerProgress = (userId: string) => {
  const socket = ref<Socket | null>(null);
  const progress = ref<Record<string, WorkerProgressEvent>>({});
  const isConnected = ref(false);

  onMounted(() => {
    socket.value = io('http://localhost:3001');

    socket.value.on('connect', () => {
      isConnected.value = true;
      socket.value?.emit('subscribe', \`user_\${userId}\`);
    });

    socket.value.on('disconnect', () => {
      isConnected.value = false;
    });

    socket.value.on('worker_progress', (event: WorkerProgressEvent) => {
      progress.value[event.jobId] = event;
    });
  });

  onUnmounted(() => {
    socket.value?.disconnect();
  });

  return { socket, progress, isConnected };
};
```

### Progress Bar Component

```typescript
interface ProgressBarProps {
  progress: WorkerProgressEvent;
}

const WorkerProgressBar: React.FC<ProgressBarProps> = ({ progress }) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500';
      case 'failed': return 'bg-red-500';
      case 'in_progress': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="worker-progress">
      <div className="flex justify-between mb-2">
        <span className="font-medium">{progress.phaseTitle}</span>
        <span className="text-sm text-gray-600">
          {progress.phase}/{progress.totalPhases}
        </span>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={\`h-2 rounded-full transition-all duration-300 \${getStatusColor(progress.status)}\`}
          style={{ width: \`\${progress.progress}%\` }}
        />
      </div>

      <p className="text-sm text-gray-600 mt-1">
        {progress.phaseDescription}
      </p>

      {progress.details && (
        <div className="mt-2 text-xs text-gray-500">
          {progress.details.tokenName && (
            <span>Token: {progress.details.tokenName}</span>
          )}
          {progress.details.error && (
            <span className="text-red-500">Error: {progress.details.error}</span>
          )}
        </div>
      )}
    </div>
  );
};
```

## Connection and Subscription

```typescript
// Connect to Socket.IO server
const socket = io('http://localhost:3001');

// Subscribe to user-specific events
socket.emit('subscribe', \`user_\${userId}\`);

// Listen for progress events
socket.on('worker_progress', (event: WorkerProgressEvent) => {
  console.log(\`Worker \${event.workerType} progress: \${event.progress}%\`);
  // Update UI with progress
});

// Listen for step events (optional, for detailed tracking)
socket.on('worker_step', (event: WorkerStepEvent) => {
  console.log(\`Step \${event.stepNumber}/\${event.totalSteps}: \${event.message}\`);
});

// Listen for legacy token launch events (still supported)
socket.on('token_launch_event', (event) => {
  console.log(\`Token launch stage: \${event.stage}\`);
});
```

## Error Handling

Failed operations emit progress events with `status: 'failed'` and error details:

```typescript
socket.on('worker_progress', (event: WorkerProgressEvent) => {
  if (event.status === 'failed') {
    console.error(\`Worker \${event.workerType} failed:\`, event.details?.error);
    // Show error notification to user
  }
});
```

## Admin Monitoring

Administrators can subscribe to all worker events:

```typescript
socket.emit('subscribe', 'admin_launches');

socket.on('worker_progress', (event: WorkerProgressEvent) => {
  console.log(\`User \${event.userId} - Worker \${event.workerType}: \${event.progress}%\`);
  // Update admin dashboard
});
```

## Testing

Use the provided `worker-progress-demo.ts` script to test the system:

```bash
npx tsx worker-progress-demo.ts
```

This will connect to the Socket.IO server and log all progress events in real-time.

## Benefits

1. **Real-time Visibility**: Users see exactly what's happening with their operations
2. **Better UX**: No more black box waiting - users know progress and current phase
3. **Error Transparency**: Clear error messages when operations fail
4. **Admin Monitoring**: Administrators can monitor all system activity
5. **Debugging**: Detailed logs help identify where issues occur
6. **Performance Insights**: Track how long each phase takes

## Socket.IO Server Configuration

The Socket.IO server runs on port 3001 by default and supports:

- User-specific rooms (`user_{userId}`)
- Admin monitoring room (`admin_launches`)
- Automatic connection handling
- Error resilience
- Structured logging
