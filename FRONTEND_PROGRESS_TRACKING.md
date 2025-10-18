# CTO Progress Tracking for Frontend Applications

This guide explains how to integrate real-time CTO (Call To Others) operation progress tracking in your frontend applications.

## 🎯 Overview

The CTO progress tracking system provides multiple ways for frontend applications to monitor CTO operations:

1. **Real-time Socket.IO Events** - Best for live progress updates
2. **REST API Polling** - Fallback for simpler integrations
3. **WebSocket Integration** - For custom WebSocket implementations
4. **Hybrid Approach** - Combined real-time + polling for reliability

## 🚀 Quick Start

### Option 1: Socket.IO Real-time Tracking (Recommended)

```javascript
// Connect to Socket.IO server
const socket = io("ws://your-server.com");

// Join user-specific room for personalized updates
socket.emit("join_room", `user_${userId}`);

// Listen for CTO progress updates
socket.on("worker_progress", (event) => {
  if (event.workerType === "cto_operation") {
    handleCTOProgress(event);
  }
});

function handleCTOProgress(event) {
  const { jobId, phase, totalPhases, phaseTitle, progress, status, details } =
    event;

  // Update your UI
  updateProgressBar(progress);
  updateStatus(`${phaseTitle} (${phase}/${totalPhases})`);

  if (details) {
    updateDetails(details);
  }
}
```

### Option 2: REST API Polling

```javascript
async function trackCTOJob(jobId) {
  const pollInterval = 2000; // 2 seconds

  const poll = async () => {
    try {
      const response = await fetch(`/api/cto/job/${jobId}/status`);
      const data = await response.json();

      if (data.success && data.data.latestProgress) {
        handleCTOProgress(data.data.latestProgress);

        // Continue polling if not completed
        if (!["completed", "failed"].includes(data.data.status)) {
          setTimeout(poll, pollInterval);
        }
      }
    } catch (error) {
      console.error("Polling error:", error);
      setTimeout(poll, pollInterval * 2); // Retry with longer interval
    }
  };

  poll(); // Start polling
}
```

## 📊 Progress Event Structure

### CTOProgressEvent Interface

```typescript
interface CTOProgressEvent {
  jobId: string; // Unique job identifier
  tokenAddress: string; // Token being traded
  userId: string; // User performing operation
  userChatId: number; // Telegram chat ID
  socketUserId?: string; // Optional socket ID for tracking

  // Progress Information
  phase: number; // Current phase (1-5)
  totalPhases: number; // Total phases (always 5)
  phaseTitle: string; // Human readable phase name
  phaseDescription: string; // Detailed phase description
  progress: number; // Progress percentage (0-100)
  status: "started" | "ain_progress" | "completed" | "failed";
  timestamp: number; // Unix timestamp

  // Operation Details
  mode: "standard" | "prefunded"; // CTO execution mode
  platform: string; // Trading platform (pumpfun, bonk, etc.)
  buyAmount: number; // SOL amount being spent

  // Additional Details
  details?: {
    successfulBuys?: number; // Number of successful buy transactions
    failedBuys?: number; // Number of failed buy transactions
    totalSpent?: number; // Total SOL spent so far
    walletsUsed?: number; // Number of wallets being used
    error?: string; // Error message if failed
    transactionSignatures?: string[]; // Blockchain transaction signatures
    estimatedTimeRemaining?: number; // Milliseconds until completion
    currentOperation?: string; // Current sub-operation description
  };
}
```

## 🔄 CTO Operation Phases

The CTO system has 5 distinct phases:

### Phase 1: CTO Operation Started (10% progress)

- **Title**: "CTO Operation Started"
- **Description**: "Initiating {mode} CTO operation"
- **Details**: Operation initialization and parameter validation

### Phase 2: Validating Parameters (25% progress)

- **Title**: "Validating Parameters"
- **Description**: "Checking wallet balances and operation parameters"
- **Details**: User validation, wallet checks, balance verification

### Phase 3: Platform Detection (45% progress)

- **Title**: "Platform Detection"
- **Description**: "Optimizing for {platform} platform"
- **Details**: Token platform detection and trading strategy optimization

### Phase 4: Executing Operation (70% progress)

- **Title**: "Executing Operation"
- **Description**: "Executing {mode} CTO with {amount} SOL"
- **Details**: Actual buy transactions, mixer operations (if standard mode)

### Phase 5: Operation Completed (100% progress)

- **Title**: "CTO Operation Completed" (success) or "CTO Operation Failed" (failure)
- **Description**: Final results with transaction counts
- **Details**: Complete operation results and statistics

## 🎨 Frontend Integration Examples

### React Hook Implementation

```typescript
import { useState, useEffect } from 'react';
import io from 'socket.io-client';

interface UseCTOProgressOptions {
    socketUrl: string;
    userId: string;
    autoConnect?: boolean;
}

export const useCTOProgress = ({ socketUrl, userId, autoConnect = true }: UseCTOProgressOptions) => {
    const [socket, setSocket] = useState(null);
    const [jobs, setJobs] = useState(new Map());
    const [connected, setConnected] = useState(false);

    useEffect(() => {
        if (!autoConnect) return;

        const socketInstance = io(socketUrl);

        socketInstance.on('connect', () => {
            setConnected(true);
            socketInstance.emit('join_room', `user_${userId}`);
        });

        socketInstance.on('disconnect', () => setConnected(false));

        socketInstance.on('worker_progress', (event) => {
            if (event.workerType === 'cto_operation') {
                setJobs(prev => new Map(prev.set(event.jobId, event)));
            }
        });

        setSocket(socketInstance);
        return () => socketInstance.disconnect();
    }, [socketUrl, userId, autoConnect]);

    return {
        socket,
        connected,
        jobs: Array.from(jobs.values()),
        getJob: (jobId) => jobs.get(jobId),
        trackJob: (jobId) => {
            // Job tracking is automatic via Socket.IO
            console.log(`Tracking job: ${jobId}`);
        }
    };
};

// Usage in component
const CTOTracker = ({ jobId, userId }) => {
    const { jobs, connected, getJob } = useCTOProgress({
        socketUrl: 'ws://localhost:3000',
        userId
    });

    const currentJob = getJob(jobId);

    if (!connected) return <div>Connecting...</div>;
    if (!currentJob) return <div>Waiting for operation...</div>;

    return (
        <div className="cto-tracker">
            <div className="progress-bar">
                <div
                    className="progress-fill"
                    style={{ width: `${currentJob.progress}%` }}
                />
            </div>
            <h3>{currentJob.phaseTitle}</h3>
            <p>{currentJob.phaseDescription}</p>
            <div className="details">
                {currentJob.details?.successfulBuys && (
                    <span>✅ {currentJob.details.successfulBuys} successful</span>
                )}
                {currentJob.details?.failedBuys && (
                    <span>❌ {currentJob.details.failedBuys} failed</span>
                )}
            </div>
        </div>
    );
};
```

### Vue.js Composition API

```vue
<template>
  <div class="cto-progress" v-if="currentJob">
    <div class="progress-container">
      <div
        class="progress-bar"
        :style="{ width: currentJob.progress + '%' }"
      ></div>
    </div>

    <div class="status">
      <h3>{{ currentJob.phaseTitle }}</h3>
      <p>{{ currentJob.phaseDescription }}</p>
      <p>Phase {{ currentJob.phase }}/{{ currentJob.totalPhases }}</p>
    </div>

    <div class="details" v-if="currentJob.details">
      <div v-if="currentJob.details.successfulBuys">
        ✅ Successful: {{ currentJob.details.successfulBuys }}
      </div>
      <div v-if="currentJob.details.failedBuys">
        ❌ Failed: {{ currentJob.details.failedBuys }}
      </div>
      <div v-if="currentJob.details.estimatedTimeRemaining">
        ⏱️ ETA:
        {{ Math.ceil(currentJob.details.estimatedTimeRemaining / 1000) }}s
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import io from "socket.io-client";

const props = defineProps(["jobId", "userId", "socketUrl"]);

const socket = ref(null);
const currentJob = ref(null);
const connected = ref(false);

onMounted(() => {
  socket.value = io(props.socketUrl);

  socket.value.on("connect", () => {
    connected.value = true;
    socket.value.emit("join_room", `user_${props.userId}`);
  });

  socket.value.on("worker_progress", (event) => {
    if (event.workerType === "cto_operation" && event.jobId === props.jobId) {
      currentJob.value = event;
    }
  });
});

onUnmounted(() => {
  if (socket.value) socket.value.disconnect();
});
</script>
```

### Vanilla JavaScript Class

```javascript
class CTOProgressTracker {
  constructor(options) {
    this.socketUrl = options.socketUrl;
    this.userId = options.userId;
    this.socket = null;
    this.jobs = new Map();
    this.callbacks = new Map();

    if (options.autoConnect !== false) {
      this.connect();
    }
  }

  connect() {
    this.socket = io(this.socketUrl);

    this.socket.on("connect", () => {
      this.socket.emit("join_room", `user_${this.userId}`);
    });

    this.socket.on("worker_progress", (event) => {
      if (event.workerType === "cto_operation") {
        this.handleProgress(event);
      }
    });
  }

  handleProgress(event) {
    const { jobId } = event;
    this.jobs.set(jobId, event);

    // Trigger callbacks for this job
    const callbacks = this.callbacks.get(jobId);
    if (callbacks) {
      callbacks.onProgress?.(event);

      if (["completed", "failed"].includes(event.status)) {
        callbacks.onComplete?.(event);
        this.callbacks.delete(jobId); // Clean up
      }
    }
  }

  trackJob(jobId, { onProgress, onComplete }) {
    this.callbacks.set(jobId, { onProgress, onComplete });

    // Return unsubscribe function
    return () => this.callbacks.delete(jobId);
  }

  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

// Usage
const tracker = new CTOProgressTracker({
  socketUrl: "ws://localhost:3000",
  userId: "user123",
});

const unsubscribe = tracker.trackJob("job-456", {
  onProgress: (event) => {
    console.log(`Progress: ${event.progress}% - ${event.phaseTitle}`);
    updateUI(event);
  },
  onComplete: (event) => {
    console.log("CTO operation completed:", event);
    showResults(event);
  },
});

// Later: unsubscribe();
```

## 🔌 Socket.IO Event Details

### Connection Setup

```javascript
// Connect to server
const socket = io("ws://your-server.com", {
  transports: ["websocket", "polling"], // Fallback to polling if needed
  timeout: 20000,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5,
});

// Join user-specific room
socket.emit("join_room", `user_${userId}`);

// Optional: Join admin room for all operations (if authorized)
socket.emit("join_room", "admin_launches");
```

### Event Filtering

```javascript
socket.on("worker_progress", (event) => {
  // Filter for CTO operations only
  if (event.workerType !== "cto_operation") return;

  // Filter for specific job
  if (event.jobId !== targetJobId) return;

  // Filter for specific user
  if (event.userId !== currentUserId) return;

  // Handle the event
  handleCTOProgress(event);
});
```

## 📡 REST API Endpoints

If Socket.IO is not available, you can use these REST endpoints:

### GET /api/cto/job/:jobId/status

Get comprehensive job status including progress history.

```javascript
const response = await fetch("/api/cto/job/job-123/status");
const data = await response.json();

if (data.success) {
  const {
    jobId,
    status, // 'waiting', 'active', 'completed', 'failed'
    progressEvents, // Array of all progress events
    latestProgress, // Most recent progress event
    operationResult, // Final result if completed
    currentPhase,
    currentProgress,
  } = data.data;
}
```

### GET /api/cto/job/:jobId/latest

Get only the latest progress event for a job.

```javascript
const response = await fetch("/api/cto/job/job-123/latest");
const data = await response.json();

if (data.success) {
  const progressEvent = data.data;
  // Same structure as CTOProgressEvent
}
```

### GET /api/cto/jobs/stats?jobIds=job1,job2,job3

Get statistics for multiple jobs.

```javascript
const jobIds = ["job-123", "job-456", "job-789"];
const response = await fetch(`/api/cto/jobs/stats?jobIds=${jobIds.join(",")}`);
const data = await response.json();

if (data.success) {
  const { total, queued, active, completed, failed, averageProgress } =
    data.data;
}
```

## 🎛️ Advanced Features

### Progress History Timeline

```javascript
// Fetch complete progress history for a job
async function getProgressTimeline(jobId) {
  const response = await fetch(`/api/cto/job/${jobId}/events`);
  const data = await response.json();

  if (data.success) {
    return data.data.events.map((event) => ({
      timestamp: new Date(event.timestamp),
      phase: event.phase,
      title: event.phaseTitle,
      progress: event.progress,
      status: event.status,
      details: event.details,
    }));
  }

  return [];
}

// Render timeline in UI
function renderTimeline(events) {
  const timeline = events
    .map(
      (event) => `
        <div class="timeline-event ${event.status}">
            <div class="timestamp">${event.timestamp.toLocaleTimeString()}</div>
            <div class="phase">Phase ${event.phase}: ${event.title}</div>
            <div class="progress">${event.progress}%</div>
        </div>
    `
    )
    .join("");

  document.getElementById("timeline").innerHTML = timeline;
}
```

### Batch Job Monitoring

```javascript
class BatchCTOMonitor {
  constructor(socketUrl, userId) {
    this.socket = io(socketUrl);
    this.userId = userId;
    this.jobs = new Map();
    this.init();
  }

  init() {
    this.socket.emit("join_room", `user_${this.userId}`);

    this.socket.on("worker_progress", (event) => {
      if (event.workerType === "cto_operation") {
        this.jobs.set(event.jobId, event);
        this.updateBatchStats();
      }
    });
  }

  updateBatchStats() {
    const jobs = Array.from(this.jobs.values());

    const stats = {
      total: jobs.length,
      active: jobs.filter((j) => j.status === "in_progress").length,
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      averageProgress:
        jobs.reduce((sum, j) => sum + j.progress, 0) / jobs.length,
    };

    this.onStatsUpdate?.(stats);
  }

  onStatsUpdate = null; // Set this to handle batch updates
}
```

### Error Handling and Retries

```javascript
class RobustCTOTracker {
  constructor(options) {
    this.options = {
      socketUrl: options.socketUrl,
      userId: options.userId,
      pollingFallback: true,
      pollingInterval: 2000,
      maxRetries: 3,
      retryDelay: 1000,
      ...options,
    };

    this.socket = null;
    this.connected = false;
    this.retryCount = 0;
    this.jobs = new Map();

    this.connect();
  }

  connect() {
    try {
      this.socket = io(this.options.socketUrl, {
        timeout: 10000,
        reconnection: true,
        reconnectionAttempts: this.options.maxRetries,
      });

      this.socket.on("connect", () => {
        this.connected = true;
        this.retryCount = 0;
        this.socket.emit("join_room", `user_${this.options.userId}`);
      });

      this.socket.on("disconnect", () => {
        this.connected = false;
        if (this.options.pollingFallback) {
          this.startPollingFallback();
        }
      });

      this.socket.on("worker_progress", (event) => {
        if (event.workerType === "cto_operation") {
          this.handleProgress(event);
        }
      });
    } catch (error) {
      console.error("Socket connection failed:", error);
      if (this.options.pollingFallback) {
        this.startPollingFallback();
      }
    }
  }

  startPollingFallback() {
    if (this.connected) return; // Don't poll if socket is working

    const poll = async () => {
      for (const [jobId] of this.jobs) {
        try {
          const response = await fetch(`/api/cto/job/${jobId}/latest`);
          const data = await response.json();

          if (data.success) {
            this.handleProgress(data.data);
          }
        } catch (error) {
          console.warn(`Polling failed for job ${jobId}:`, error);
        }
      }

      if (!this.connected) {
        setTimeout(poll, this.options.pollingInterval);
      }
    };

    poll();
  }

  handleProgress(event) {
    this.jobs.set(event.jobId, event);
    this.onProgress?.(event);
  }

  trackJob(jobId) {
    this.jobs.set(jobId, null);
  }

  onProgress = null; // Set this to handle progress updates
}
```

## 🔒 Security Considerations

### Authentication and Authorization

```javascript
// Include authentication headers
const socket = io("ws://your-server.com", {
  auth: {
    token: "your-jwt-token",
    userId: "user-123",
  },
});

// Or use query parameters
const socket = io("ws://your-server.com?token=your-jwt-token&userId=user-123");

// For REST API
const response = await fetch("/api/cto/job/job-123/status", {
  headers: {
    Authorization: "Bearer your-jwt-token",
    "Content-Type": "application/json",
  },
});
```

### Rate Limiting

```javascript
// Implement client-side rate limiting for polling
class RateLimitedTracker {
  constructor(maxRequestsPerMinute = 30) {
    this.requests = [];
    this.maxRequests = maxRequestsPerMinute;
  }

  async makeRequest(url) {
    // Clean old requests
    const now = Date.now();
    this.requests = this.requests.filter((time) => now - time < 60000);

    // Check rate limit
    if (this.requests.length >= this.maxRequests) {
      const waitTime = 60000 - (now - this.requests[0]);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    // Make request
    this.requests.push(now);
    return fetch(url);
  }

  async getJobStatus(jobId) {
    const response = await this.makeRequest(`/api/cto/job/${jobId}/status`);
    return response.json();
  }
}
```

## 📱 Mobile Integration

### React Native with Socket.IO

```javascript
import io from "socket.io-client";
import { useState, useEffect } from "react";

const useCTOProgressMobile = (socketUrl, userId) => {
  const [socket, setSocket] = useState(null);
  const [progress, setProgress] = useState({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socketInstance = io(socketUrl, {
      transports: ["websocket"], // Prefer websocket for mobile
      forceNew: true,
    });

    socketInstance.on("connect", () => {
      setConnected(true);
      socketInstance.emit("join_room", `user_${userId}`);
    });

    socketInstance.on("disconnect", () => setConnected(false));

    socketInstance.on("worker_progress", (event) => {
      if (event.workerType === "cto_operation") {
        setProgress((prev) => ({
          ...prev,
          [event.jobId]: event,
        }));
      }
    });

    setSocket(socketInstance);

    return () => {
      socketInstance.disconnect();
    };
  }, []);

  return { socket, progress, connected };
};

// Usage in React Native component
import { View, Text, ProgressBar } from "react-native";

const CTOProgressView = ({ jobId, userId }) => {
  const { progress, connected } = useCTOProgressMobile(
    "ws://your-server.com",
    userId
  );
  const currentProgress = progress[jobId];

  if (!connected) {
    return <Text>Connecting...</Text>;
  }

  if (!currentProgress) {
    return <Text>Waiting for operation...</Text>;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{currentProgress.phaseTitle}</Text>
      <ProgressBar
        progress={currentProgress.progress / 100}
        width={300}
        height={20}
      />
      <Text>{currentProgress.phaseDescription}</Text>
      {currentProgress.details?.successfulBuys && (
        <Text>✅ {currentProgress.details.successfulBuys} successful</Text>
      )}
    </View>
  );
};
```

## 🧪 Testing and Debugging

### Debug Mode

```javascript
// Enable debug logging
localStorage.setItem("debug", "socket.io-client:*");

const socket = io("ws://localhost:3000", {
  debug: true,
});

// Log all events for debugging
socket.onAny((event, ...args) => {
  console.log("Socket event received:", event, args);
});

// Test connection
socket.on("connect", () => {
  console.log("✅ Connected to server");
  console.log("Socket ID:", socket.id);
});

socket.on("disconnect", (reason) => {
  console.log("❌ Disconnected:", reason);
});
```

### Mock Progress Events

```javascript
// For testing UI without actual CTO operations
const mockProgressEvents = [
  {
    phase: 1,
    progress: 10,
    status: "started",
    phaseTitle: "CTO Operation Started",
  },
  {
    phase: 2,
    progress: 25,
    status: "in_progress",
    phaseTitle: "Validating Parameters",
  },
  {
    phase: 3,
    progress: 45,
    status: "in_progress",
    phaseTitle: "Platform Detection",
  },
  {
    phase: 4,
    progress: 70,
    status: "in_progress",
    phaseTitle: "Executing Operation",
  },
  {
    phase: 5,
    progress: 100,
    status: "completed",
    phaseTitle: "CTO Operation Completed",
  },
];

function simulateProgress(onProgress, delay = 2000) {
  let index = 0;

  const simulate = () => {
    if (index < mockProgressEvents.length) {
      onProgress({
        jobId: "mock-job-123",
        tokenAddress: "mock-token",
        ...mockProgressEvents[index],
      });

      index++;
      setTimeout(simulate, delay);
    }
  };

  simulate();
}

// Usage
simulateProgress((event) => {
  console.log("Mock progress:", event);
  updateProgressUI(event);
});
```

---

This comprehensive guide covers all aspects of integrating CTO progress tracking in frontend applications. Choose the approach that best fits your technology stack and requirements!
