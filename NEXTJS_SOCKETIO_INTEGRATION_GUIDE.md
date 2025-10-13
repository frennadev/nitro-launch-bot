# Next.js Socket.IO Integration Guide - Nitro Launch Bot

## Overview

This comprehensive guide covers integrating the Nitro Launch Bot's Socket.IO system with your Next.js frontend, including all possible events, TypeScript types, React hooks, and UI components.

## Table of Contents

1. [Installation & Setup](#installation--setup)
2. [TypeScript Types](#typescript-types)
3. [Socket.IO Connection Management](#socketio-connection-management)
4. [Event Listeners & Handlers](#event-listeners--handlers)
5. [React Hooks](#react-hooks)
6. [UI Components](#ui-components)
7. [Complete Integration Examples](#complete-integration-examples)
8. [Error Handling & Best Practices](#error-handling--best-practices)

## Installation & Setup

### 1. Install Dependencies

```bash
npm install socket.io-client
npm install @types/socket.io-client # For TypeScript
```

### 2. Environment Variables

```env
# .env.local
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

### 3. Socket.IO Client Configuration

````typescript
### 3. Socket.IO Client Configuration
```typescript
// lib/socket.ts
import { io, Socket } from "socket.io-client";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

let socket: Socket | null = null;

export const initializeSocket = (): Socket => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      timeout: 20000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      // Add these for production debugging
      forceNew: true,
      upgrade: true,
    });

    // Add connection debugging
    socket.on('connect', () => {
      console.log('✅ Socket.IO connected:', socket?.id);
    });

    socket.on('connect_error', (error) => {
      console.error('❌ Socket.IO connection error:', error);
    });

    socket.on('disconnect', (reason) => {
      console.log('🔌 Socket.IO disconnected:', reason);
    });
  }
  return socket;
};

export const getSocket = (): Socket | null => socket;

export const disconnectSocket = (): void => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
````

## 🔧 **Troubleshooting Connection Issues**

### Common Issues & Solutions

#### **1. 500 Internal Server Error**

```
Error: Unexpected server response: 500
Request URL: https://your-domain.com/socket.io/?EIO=4&transport=websocket
```

**Causes & Solutions:**

- **Server not properly initialized**: Ensure Socket.IO server is running
- **Port conflicts**: Check if the server is listening on the correct port
- **CORS issues**: Verify CORS configuration includes your domain

**Debug Steps:**

```typescript
// 1. Test server health endpoint
fetch("https://your-domain.com/health")
  .then((res) => res.json())
  .then((data) => console.log("Server health:", data));

// 2. Check Socket.IO with polling first
const socket = io("https://your-domain.com", {
  transports: ["polling"], // Force polling first
  upgrade: false,
});
```

#### **2. CORS Policy Errors**

```
Access to XMLHttpRequest blocked by CORS policy
```

**Solution**: Update server CORS configuration:

```typescript
// Server-side configuration needed
cors: {
  origin: [
    "https://your-frontend-domain.com",
    "http://localhost:3000" // for development
  ],
  methods: ["GET", "POST"],
  credentials: true
}
```

#### **3. Connection Timeout**

```
Error: xhr poll error
```

**Solutions:**

```typescript
// Increase timeout values
const socket = io(SOCKET_URL, {
  timeout: 60000, // Increase timeout
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
  transports: ["polling", "websocket"], // Try polling first
});
```

#### **4. Production vs Development URLs**

```typescript
// Environment-specific configuration
const getSocketURL = () => {
  if (process.env.NODE_ENV === "production") {
    return "https://nitro-launch-bot-service.onrender.com";
  }
  return "http://localhost:3001";
};

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || getSocketURL();
```

### **Production Deployment Checklist**

✅ **Server Configuration:**

- [ ] Socket.IO server listening on `process.env.PORT`
- [ ] CORS configured for production domain
- [ ] Health check endpoint responding
- [ ] Server binding to `0.0.0.0` not `localhost`

✅ **Client Configuration:**

- [ ] Correct production URL in environment variables
- [ ] HTTPS URL for production (not HTTP)
- [ ] Proper error handling for connection failures
- [ ] Fallback to polling transport

✅ **Network & Infrastructure:**

- [ ] Firewall/proxy allows WebSocket connections
- [ ] Load balancer configured for WebSocket upgrade
- [ ] CDN (if used) passes through WebSocket connections

### **Testing Connection**

```typescript
// Debug connection step by step
const testConnection = async () => {
  // 1. Test basic HTTP connectivity
  try {
    const response = await fetch(
      "https://nitro-launch-bot-service.onrender.com/health"
    );
    console.log("Health check:", await response.json());
  } catch (error) {
    console.error("Health check failed:", error);
    return;
  }

  // 2. Test Socket.IO with polling only
  const socket = io("https://nitro-launch-bot-service.onrender.com", {
    transports: ["polling"],
    timeout: 30000,
  });

  socket.on("connect", () => {
    console.log("✅ Polling connection successful");

    // 3. Try upgrading to WebSocket
    socket.io.opts.transports = ["polling", "websocket"];
  });

  socket.on("connect_error", (error) => {
    console.error("❌ Connection failed:", error);
  });
};
```

## TypeScript Types

```typescript
// types/socket.ts

export interface WorkerProgressEvent {
  jobId: string;
  workerType:
    | "launch_token"
    | "prepare_launch"
    | "execute_launch"
    | "dev_sell"
    | "wallet_sell"
    | "create_token_metadata"
    | "launch_token_from_dapp";
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
    [key: string]: any;
  };
}

export interface WorkerStepEvent {
  jobId: string;
  workerType: string;
  tokenAddress: string;
  userId: string;
  step: string;
  stepNumber: number;
  totalSteps: number;
  message: string;
  timestamp: number;
  data?: any;
}

export interface TokenLaunchEvent {
  tokenAddress: string;
  platform: "pump" | "bonk";
  name: string;
  symbol: string;
  timestamp: number;
  userId: string;
  stage:
    | "created"
    | "launched"
    | "mixing_started"
    | "mixing_completed"
    | "fully_ready";
  stepNumber: number;
  totalSteps: number;
  message: string;
  launchData?: {
    initialLiquidity?: number;
    marketCap?: number;
    price?: number;
    devWallet?: string;
    buyerWallets?: number;
  };
  mixingData?: {
    totalFunds?: number;
    walletsUsed?: number;
    completedAt?: number;
    mixingProgress?: number; // 0-100
  };
  error?: {
    message: string;
    code?: string;
    stage: string;
  };
}

export interface LaunchProgress {
  tokenAddress: string;
  platform: "pump" | "bonk";
  userId: string;
  currentStep: number;
  totalSteps: number;
  stages: {
    creation: { completed: boolean; timestamp?: number };
    launch: { completed: boolean; timestamp?: number };
    mixing: { completed: boolean; timestamp?: number; progress?: number };
    ready: { completed: boolean; timestamp?: number };
  };
}
```

## Socket.IO Connection Management

### Connection Context Provider

```typescript
// context/SocketContext.tsx
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Socket } from 'socket.io-client';
import { initializeSocket, getSocket, disconnectSocket } from '@/lib/socket';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

interface SocketProviderProps {
  children: ReactNode;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const connect = () => {
    if (!socket) {
      const newSocket = initializeSocket();
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('✅ Connected to Socket.IO server');
        setIsConnected(true);
      });

      newSocket.on('disconnect', () => {
        console.log('❌ Disconnected from Socket.IO server');
        setIsConnected(false);
      });

      newSocket.on('connect_error', (error) => {
        console.error('❌ Connection error:', error);
        setIsConnected(false);
      });
    }
  };

  const disconnect = () => {
    if (socket) {
      disconnectSocket();
      setSocket(null);
      setIsConnected(false);
    }
  };

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected, connect, disconnect }}>
      {children}
    </SocketContext.Provider>
  );
};
```

## 🔒 **Security & User Authentication**

**⚠️ CRITICAL SECURITY NOTICE**: The Socket.IO system relies on proper user authentication and room isolation to prevent data leaks between users.

### **Authentication Requirements**

```typescript
// You MUST authenticate users before subscribing to their rooms
const authenticatedUserId = await getUserFromSession(); // Your auth system
if (!authenticatedUserId) {
  throw new Error("User must be authenticated to access Socket.IO events");
}

// Only subscribe to the authenticated user's room
socket.emit("subscribe_user_launches", authenticatedUserId);
```

### **Security Best Practices**

1. **Never hardcode user IDs** - Always get userId from authenticated session
2. **Validate user permissions** - Ensure user can only access their own data
3. **Admin access control** - Only allow verified admins to use `subscribe_all_launches`
4. **Session validation** - Verify user session before Socket.IO subscription
5. **Room validation** - The server should validate userId matches the authenticated user

### **Example with Next.js Auth**

```typescript
// hooks/useAuthenticatedSocket.ts
import { useSession } from "next-auth/react";
import { useSocket } from "@/context/SocketContext";

export const useAuthenticatedSocket = () => {
  const { data: session } = useSession();
  const { socket, isConnected } = useSocket();

  const subscribeToUserEvents = useCallback(() => {
    if (!session?.user?.id) {
      console.warn("Cannot subscribe: User not authenticated");
      return;
    }

    if (socket && isConnected) {
      socket.emit("subscribe_user_launches", session.user.id);
    }
  }, [socket, isConnected, session?.user?.id]);

  return {
    userId: session?.user?.id,
    isAuthenticated: !!session?.user?.id,
    subscribeToUserEvents,
  };
};
```

## Event Listeners & Handlers

### All Available Events

#### 1. **Outgoing Events (Client → Server)**

````typescript
## Event Listeners & Handlers

### 🔐 **User-Specific Room System**

**CRITICAL**: The Socket.IO server uses a room-based isolation system where each user only receives events for their own operations. This ensures privacy and prevents users from seeing other users' data.

#### **How Room Isolation Works:**
```typescript
// When you subscribe to user launches:
socket.emit('subscribe_user_launches', 'user_123');

// The server adds your socket to room: `user_user_123`
// All events for user_123 are only sent to sockets in that room
````

#### **Room Structure:**

- **User Rooms**: `user_${userId}` - Only receives events for that specific user
- **Admin Room**: `admin_launches` - Receives ALL events from ALL users (admin only)

#### **Event Privacy:**

- `worker_progress` events are only sent to `user_${event.userId}` room
- `token_launch_event` events are only sent to `user_${event.userId}` room
- `launch_progress_update` events are only sent to `user_${event.userId}` room
- Users CANNOT see other users' operations unless they have admin access

#### **Privacy Example:**

```typescript
// User A (user_123) launches a token
// Server emits to room: user_user_123
socket.to("user_user_123").emit("worker_progress", {
  userId: "user_123",
  tokenAddress: "0xABC...",
  // ... other data
});

// User B (user_456) will NEVER receive this event
// Even if they're connected, they're in room: user_user_456
// Complete isolation guaranteed by Socket.IO rooms
```

### All Available Events

#### 1. **Outgoing Events (Client → Server)**

```typescript
// Events you can emit to the server

socket.emit('subscribe_user_launches', userId: string);
socket.emit('subscribe_all_launches'); // Admin only - subscribes to ALL users
socket.emit('unsubscribe', room: string);
```

````

#### 2. **Incoming Events (Server → Client)**

```typescript
// Events the server will emit to your client

// Worker Progress Events
socket.on("worker_progress", (event: WorkerProgressEvent) => {
  // Detailed worker progress with phases
});

// Worker Step Events
socket.on("worker_step", (event: WorkerStepEvent) => {
  // Individual step updates within workers
});

// Token Launch Events
socket.on("token_launch_event", (event: TokenLaunchEvent) => {
  // High-level token launch lifecycle events
});

// Launch Progress Updates
socket.on("launch_progress_update", (progress: LaunchProgress) => {
  // Overall launch progress with stage completion
});

// Connection Events
socket.on("connect", () => {
  // Successfully connected
});

socket.on("disconnect", () => {
  // Connection lost
});

socket.on("connect_error", (error: Error) => {
  // Connection failed
});
````

### 🎯 **Event Filtering & What You'll Receive**

**IMPORTANT**: When you subscribe to `user_${userId}`, you will ONLY receive events where `event.userId` matches your subscribed userId.

#### **Events You WILL Receive:**

```typescript
// All worker progress for YOUR tokens only
socket.on("worker_progress", (event: WorkerProgressEvent) => {
  // event.userId === 'your_user_id'
  // event.tokenAddress = tokens YOU created/launched
});

// All launch events for YOUR tokens only
socket.on("token_launch_event", (event: TokenLaunchEvent) => {
  // event.userId === 'your_user_id'
  // event.tokenAddress = tokens YOU created/launched
});
```

#### **Events You Will NOT Receive:**

- Worker progress for other users' tokens
- Launch events for other users' tokens
- Any data from other users (unless you're an admin)

#### **Server-Side Room Filtering:**

```typescript
// Server code (for reference):
// Events are sent ONLY to your specific room
this.io.to(`user_${event.userId}`).emit("worker_progress", event);
this.io.to(`user_${event.userId}`).emit("token_launch_event", event);

// This ensures complete privacy and isolation between users
```

## React Hooks

### 1. Worker Progress Tracking Hook

```typescript
// hooks/useWorkerProgress.ts
import { useState, useEffect, useCallback } from "react";
import { useSocket } from "@/context/SocketContext";
import { WorkerProgressEvent } from "@/types/socket";

export const useWorkerProgress = (userId?: string) => {
  const { socket, isConnected } = useSocket();
  const [workerProgress, setWorkerProgress] = useState<
    Record<string, WorkerProgressEvent>
  >({});
  const [latestEvent, setLatestEvent] = useState<WorkerProgressEvent | null>(
    null
  );

  const subscribeToUserProgress = useCallback(() => {
    if (!userId) {
      console.warn(
        "🚨 SECURITY: Cannot subscribe without authenticated userId"
      );
      return;
    }

    if (socket && isConnected) {
      // CRITICAL: Only subscribe to the authenticated user's room
      socket.emit("subscribe_user_launches", userId);
      console.log(
        `📡 Subscribed to progress for authenticated user: ${userId}`
      );
    }
  }, [socket, isConnected, userId]);

  const clearProgress = useCallback((jobId: string) => {
    setWorkerProgress((prev) => {
      const updated = { ...prev };
      delete updated[jobId];
      return updated;
    });
  }, []);

  const clearAllProgress = useCallback(() => {
    setWorkerProgress({});
    setLatestEvent(null);
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleWorkerProgress = (event: WorkerProgressEvent) => {
      console.log("📊 Worker Progress:", event);

      setWorkerProgress((prev) => ({
        ...prev,
        [event.jobId]: event,
      }));

      setLatestEvent(event);

      // Auto-cleanup completed/failed jobs after 30 seconds
      if (event.status === "completed" || event.status === "failed") {
        setTimeout(() => {
          clearProgress(event.jobId);
        }, 30000);
      }
    };

    socket.on("worker_progress", handleWorkerProgress);

    // Subscribe when connected
    if (isConnected) {
      subscribeToUserProgress();
    }

    return () => {
      socket.off("worker_progress", handleWorkerProgress);
    };
  }, [socket, isConnected, subscribeToUserProgress, clearProgress]);

  // Re-subscribe when user changes
  useEffect(() => {
    if (isConnected) {
      subscribeToUserProgress();
    }
  }, [userId, subscribeToUserProgress]);

  return {
    workerProgress,
    latestEvent,
    clearProgress,
    clearAllProgress,
    isConnected,
    subscribeToUserProgress,
  };
};
```

### 2. Token Launch Events Hook

```typescript
// hooks/useTokenLaunch.ts
import { useState, useEffect, useCallback } from "react";
import { useSocket } from "@/context/SocketContext";
import { TokenLaunchEvent, LaunchProgress } from "@/types/socket";

export const useTokenLaunch = (userId?: string) => {
  const { socket, isConnected } = useSocket();
  const [launchEvents, setLaunchEvents] = useState<TokenLaunchEvent[]>([]);
  const [launchProgress, setLaunchProgress] = useState<
    Record<string, LaunchProgress>
  >({});
  const [latestLaunch, setLatestLaunch] = useState<TokenLaunchEvent | null>(
    null
  );

  const subscribeToLaunches = useCallback(() => {
    if (socket && isConnected && userId) {
      socket.emit("subscribe_user_launches", userId);
    }
  }, [socket, isConnected, userId]);

  const clearLaunchHistory = useCallback(() => {
    setLaunchEvents([]);
    setLatestLaunch(null);
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleTokenLaunchEvent = (event: TokenLaunchEvent) => {
      console.log("🚀 Token Launch Event:", event);

      setLaunchEvents((prev) => [event, ...prev.slice(0, 49)]); // Keep last 50 events
      setLatestLaunch(event);
    };

    const handleLaunchProgressUpdate = (progress: LaunchProgress) => {
      console.log("📈 Launch Progress Update:", progress);

      setLaunchProgress((prev) => ({
        ...prev,
        [progress.tokenAddress]: progress,
      }));
    };

    socket.on("token_launch_event", handleTokenLaunchEvent);
    socket.on("launch_progress_update", handleLaunchProgressUpdate);

    if (isConnected) {
      subscribeToLaunches();
    }

    return () => {
      socket.off("token_launch_event", handleTokenLaunchEvent);
      socket.off("launch_progress_update", handleLaunchProgressUpdate);
    };
  }, [socket, isConnected, subscribeToLaunches]);

  return {
    launchEvents,
    launchProgress,
    latestLaunch,
    clearLaunchHistory,
    isConnected,
  };
};
```

### 3. Admin Dashboard Hook

```typescript
// hooks/useAdminDashboard.ts
import { useState, useEffect, useCallback } from "react";
import { useSocket } from "@/context/SocketContext";
import { WorkerProgressEvent, TokenLaunchEvent } from "@/types/socket";

export const useAdminDashboard = () => {
  const { socket, isConnected } = useSocket();
  const [allWorkerProgress, setAllWorkerProgress] = useState<
    WorkerProgressEvent[]
  >([]);
  const [allLaunchEvents, setAllLaunchEvents] = useState<TokenLaunchEvent[]>(
    []
  );
  const [isSubscribed, setIsSubscribed] = useState(false);

  const subscribeToAllLaunches = useCallback(() => {
    if (socket && isConnected && !isSubscribed) {
      socket.emit("subscribe_all_launches");
      setIsSubscribed(true);
      console.log("👑 Subscribed to all launches (Admin mode)");
    }
  }, [socket, isConnected, isSubscribed]);

  const unsubscribeFromAll = useCallback(() => {
    if (socket && isSubscribed) {
      socket.emit("unsubscribe", "admin_launches");
      setIsSubscribed(false);
      console.log("👑 Unsubscribed from admin launches");
    }
  }, [socket, isSubscribed]);

  useEffect(() => {
    if (!socket) return;

    const handleWorkerProgress = (event: WorkerProgressEvent) => {
      setAllWorkerProgress((prev) => [event, ...prev.slice(0, 99)]); // Keep last 100
    };

    const handleTokenLaunchEvent = (event: TokenLaunchEvent) => {
      setAllLaunchEvents((prev) => [event, ...prev.slice(0, 99)]); // Keep last 100
    };

    socket.on("worker_progress", handleWorkerProgress);
    socket.on("token_launch_event", handleTokenLaunchEvent);

    if (isConnected) {
      subscribeToAllLaunches();
    }

    return () => {
      socket.off("worker_progress", handleWorkerProgress);
      socket.off("token_launch_event", handleTokenLaunchEvent);
    };
  }, [socket, isConnected, subscribeToAllLaunches]);

  return {
    allWorkerProgress,
    allLaunchEvents,
    isSubscribed,
    isConnected,
    subscribeToAllLaunches,
    unsubscribeFromAll,
  };
};
```

## UI Components

### 1. Worker Progress Component

```typescript
// components/WorkerProgress.tsx
'use client';

import React from 'react';
import { WorkerProgressEvent } from '@/types/socket';

interface WorkerProgressProps {
  event: WorkerProgressEvent;
  showDetails?: boolean;
}

const WorkerProgress: React.FC<WorkerProgressProps> = ({
  event,
  showDetails = true
}) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-600 bg-green-100';
      case 'failed': return 'text-red-600 bg-red-100';
      case 'in_progress': return 'text-blue-600 bg-blue-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getWorkerTypeLabel = (type: string) => {
    const labels = {
      'launch_token': 'Token Launch',
      'prepare_launch': 'Prepare Launch',
      'execute_launch': 'Execute Launch',
      'dev_sell': 'Dev Sell',
      'wallet_sell': 'Wallet Sell',
      'create_token_metadata': 'Create Metadata',
      'launch_token_from_dapp': 'Launch from dApp'
    };
    return labels[type as keyof typeof labels] || type;
  };

  return (
    <div className="border rounded-lg p-4 mb-4 bg-white shadow-sm">
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-semibold text-lg">
            {getWorkerTypeLabel(event.workerType)}
          </h3>
          <p className="text-sm text-gray-600">
            Token: {event.tokenAddress.slice(0, 8)}...
          </p>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(event.status)}`}>
          {event.status.toUpperCase()}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span className="font-medium">{event.phaseTitle}</span>
          <span>{event.progress}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${
              event.status === 'failed' ? 'bg-red-500' :
              event.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${event.progress}%` }}
          />
        </div>
        <p className="text-sm text-gray-600 mt-1">{event.phaseDescription}</p>
      </div>

      {/* Phase Progress */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Phase {event.phase} of {event.totalPhases}</span>
          <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
        </div>
        <div className="flex space-x-1">
          {Array.from({ length: event.totalPhases }, (_, i) => (
            <div
              key={i}
              className={`flex-1 h-1 rounded ${
                i < event.phase ? 'bg-blue-500' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Details */}
      {showDetails && event.details && Object.keys(event.details).length > 0 && (
        <div className="border-t pt-3">
          <h4 className="text-sm font-medium mb-2">Details:</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(event.details).map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <span className="text-gray-600 capitalize">
                  {key.replace(/([A-Z])/g, ' $1').trim()}:
                </span>
                <span className="font-medium">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error Display */}
      {event.status === 'failed' && event.details?.error && (
        <div className="border-t pt-3 mt-3">
          <div className="bg-red-50 border border-red-200 rounded p-3">
            <h4 className="text-sm font-medium text-red-800 mb-1">Error:</h4>
            <p className="text-sm text-red-700">{event.details.error}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkerProgress;
```

### 2. Launch Progress Dashboard

```typescript
// components/LaunchDashboard.tsx
'use client';

import React from 'react';
import { useWorkerProgress } from '@/hooks/useWorkerProgress';
import { useTokenLaunch } from '@/hooks/useTokenLaunch';
import WorkerProgress from './WorkerProgress';

interface LaunchDashboardProps {
  userId: string;
}

const LaunchDashboard: React.FC<LaunchDashboardProps> = ({ userId }) => {
  const {
    workerProgress,
    latestEvent,
    clearAllProgress,
    isConnected
  } = useWorkerProgress(userId);

  const {
    launchEvents,
    launchProgress,
    latestLaunch
  } = useTokenLaunch(userId);

  const activeProgress = Object.values(workerProgress).filter(
    progress => progress.status === 'in_progress' || progress.status === 'started'
  );

  const completedProgress = Object.values(workerProgress).filter(
    progress => progress.status === 'completed'
  );

  const failedProgress = Object.values(workerProgress).filter(
    progress => progress.status === 'failed'
  );

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Connection Status */}
      <div className="mb-6">
        <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm ${
          isConnected
            ? 'bg-green-100 text-green-800'
            : 'bg-red-100 text-red-800'
        }`}>
          <div className={`w-2 h-2 rounded-full mr-2 ${
            isConnected ? 'bg-green-500' : 'bg-red-500'
          }`} />
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-blue-800">Active</h3>
          <p className="text-2xl font-bold text-blue-600">{activeProgress.length}</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-green-800">Completed</h3>
          <p className="text-2xl font-bold text-green-600">{completedProgress.length}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-red-800">Failed</h3>
          <p className="text-2xl font-bold text-red-600">{failedProgress.length}</p>
        </div>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-purple-800">Total Launches</h3>
          <p className="text-2xl font-bold text-purple-600">{launchEvents.length}</p>
        </div>
      </div>

      {/* Latest Event Alert */}
      {latestEvent && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h3 className="font-semibold text-yellow-800 mb-2">Latest Update</h3>
          <p className="text-yellow-700">
            <strong>{latestEvent.workerType}</strong>: {latestEvent.phaseTitle}
            ({latestEvent.progress}%) - {latestEvent.phaseDescription}
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="mb-6">
        <button
          onClick={clearAllProgress}
          className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg"
        >
          Clear Progress History
        </button>
      </div>

      {/* Active Progress */}
      {activeProgress.length > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">🔄 Active Operations</h2>
          <div className="space-y-4">
            {activeProgress.map(progress => (
              <WorkerProgress key={progress.jobId} event={progress} />
            ))}
          </div>
        </div>
      )}

      {/* Recent Completed */}
      {completedProgress.length > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">✅ Recently Completed</h2>
          <div className="space-y-4">
            {completedProgress.slice(0, 5).map(progress => (
              <WorkerProgress key={progress.jobId} event={progress} showDetails={false} />
            ))}
          </div>
        </div>
      )}

      {/* Failed Operations */}
      {failedProgress.length > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">❌ Failed Operations</h2>
          <div className="space-y-4">
            {failedProgress.slice(0, 5).map(progress => (
              <WorkerProgress key={progress.jobId} event={progress} />
            ))}
          </div>
        </div>
      )}

      {/* No Active Progress */}
      {Object.keys(workerProgress).length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-500 text-lg">No active operations</div>
          <p className="text-gray-400 mt-2">Worker progress will appear here when operations start</p>
        </div>
      )}
    </div>
  );
};

export default LaunchDashboard;
```

### 3. Real-time Toast Notifications

```typescript
// components/ToastNotifications.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { useWorkerProgress } from '@/hooks/useWorkerProgress';
import { WorkerProgressEvent } from '@/types/socket';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  duration: number;
}

interface ToastNotificationsProps {
  userId: string;
}

const ToastNotifications: React.FC<ToastNotificationsProps> = ({ userId }) => {
  const { latestEvent } = useWorkerProgress(userId);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (!latestEvent) return;

    const createToast = (event: WorkerProgressEvent) => {
      let message = '';
      let type: 'success' | 'error' | 'info' = 'info';

      if (event.status === 'completed') {
        message = `✅ ${event.phaseTitle} completed successfully!`;
        type = 'success';
      } else if (event.status === 'failed') {
        message = `❌ ${event.phaseTitle} failed: ${event.details?.error || 'Unknown error'}`;
        type = 'error';
      } else if (event.progress === 100) {
        message = `🎉 ${event.workerType} completed!`;
        type = 'success';
      } else {
        // Don't show toast for in-progress updates to avoid spam
        return;
      }

      const toast: Toast = {
        id: `${event.jobId}-${event.timestamp}`,
        message,
        type,
        duration: type === 'error' ? 7000 : 4000
      };

      setToasts(prev => [...prev, toast]);

      // Auto remove toast
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, toast.duration);
    };

    createToast(latestEvent);
  }, [latestEvent]);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`max-w-sm p-4 rounded-lg shadow-lg border transform transition-all duration-300 ${
            toast.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : toast.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          <div className="flex justify-between items-start">
            <p className="text-sm font-medium">{toast.message}</p>
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-2 text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ToastNotifications;
```

## Complete Integration Examples

### 1. App Layout Integration

```typescript
// app/layout.tsx
import { SocketProvider } from '@/context/SocketContext';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SocketProvider>
          {children}
        </SocketProvider>
      </body>
    </html>
  );
}
```

### 2. Dashboard Page

```typescript
// app/dashboard/page.tsx
'use client';

import React from 'react';
import { useSession } from 'next-auth/react'; // If using auth
import LaunchDashboard from '@/components/LaunchDashboard';
import ToastNotifications from '@/components/ToastNotifications';

const DashboardPage = () => {
  // CRITICAL: Get authenticated user ID from your auth system
  const { data: session } = useSession();
  const authenticatedUserId = session?.user?.id;

  // Prevent access without authentication
  if (!authenticatedUserId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Authentication Required</h1>
          <p className="text-gray-600">Please log in to view your dashboard</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold">
            Nitro Launch Dashboard - User: {authenticatedUserId}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            🔒 Showing only YOUR token operations and progress
          </p>
        </div>
      </header>

      <main>
        {/* Pass authenticated user ID - will only show their data */}
        <LaunchDashboard userId={authenticatedUserId} />
        <ToastNotifications userId={authenticatedUserId} />
      </main>
    </div>
  );
};export default DashboardPage;
```

### 3. Admin Dashboard

```typescript
// app/admin/page.tsx
'use client';

import React from 'react';
import { useAdminDashboard } from '@/hooks/useAdminDashboard';
import WorkerProgress from '@/components/WorkerProgress';

const AdminDashboard = () => {
  const {
    allWorkerProgress,
    allLaunchEvents,
    isConnected,
    isSubscribed
  } = useAdminDashboard();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
            <div className="flex space-x-2">
              <span className={`px-3 py-1 rounded-full text-sm ${
                isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
              <span className={`px-3 py-1 rounded-full text-sm ${
                isSubscribed ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
              }`}>
                {isSubscribed ? 'Subscribed' : 'Not Subscribed'}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {/* Statistics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-lg p-6 shadow-sm border">
            <h3 className="text-lg font-semibold mb-2">Total Operations</h3>
            <p className="text-3xl font-bold text-blue-600">{allWorkerProgress.length}</p>
          </div>
          <div className="bg-white rounded-lg p-6 shadow-sm border">
            <h3 className="text-lg font-semibold mb-2">Active Operations</h3>
            <p className="text-3xl font-bold text-orange-600">
              {allWorkerProgress.filter(p => p.status === 'in_progress').length}
            </p>
          </div>
          <div className="bg-white rounded-lg p-6 shadow-sm border">
            <h3 className="text-lg font-semibold mb-2">Launch Events</h3>
            <p className="text-3xl font-bold text-green-600">{allLaunchEvents.length}</p>
          </div>
        </div>

        {/* Recent Progress */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">Recent Worker Progress</h2>
          {allWorkerProgress.length > 0 ? (
            <div className="space-y-4">
              {allWorkerProgress.slice(0, 10).map((progress, index) => (
                <WorkerProgress key={`${progress.jobId}-${index}`} event={progress} />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No worker progress events yet
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
```

## Error Handling & Best Practices

### 1. Connection Resilience

```typescript
// hooks/useSocketResilience.ts
import { useEffect, useState } from "react";
import { useSocket } from "@/context/SocketContext";

export const useSocketResilience = () => {
  const { socket, isConnected } = useSocket();
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [lastConnected, setLastConnected] = useState<Date | null>(null);

  useEffect(() => {
    if (!socket) return;

    const handleConnect = () => {
      setConnectionAttempts(0);
      setLastConnected(new Date());
    };

    const handleDisconnect = (reason: string) => {
      console.log("Disconnected:", reason);
    };

    const handleConnectError = () => {
      setConnectionAttempts((prev) => prev + 1);
    };

    const handleReconnect = (attemptNumber: number) => {
      console.log(`Reconnection attempt ${attemptNumber}`);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("reconnect", handleReconnect);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("reconnect", handleReconnect);
    };
  }, [socket]);

  return {
    connectionAttempts,
    lastConnected,
    isConnected,
  };
};
```

### 2. Event Debugging Hook

```typescript
// hooks/useSocketDebug.ts (Development only)
import { useEffect } from "react";
import { useSocket } from "@/context/SocketContext";

export const useSocketDebug = (
  enabled: boolean = process.env.NODE_ENV === "development"
) => {
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket || !enabled) return;

    const logEvent = (eventName: string) => (data: any) => {
      console.group(`🔌 Socket.IO Event: ${eventName}`);
      console.log("Timestamp:", new Date().toISOString());
      console.log("Data:", data);
      console.groupEnd();
    };

    // Log all events
    socket.onAny(logEvent);

    return () => {
      socket.offAny(logEvent);
    };
  }, [socket, enabled]);
};
```

### 3. Performance Considerations

```typescript
// utils/socketOptimization.ts
import { throttle, debounce } from "lodash";

// Throttle progress updates to prevent UI spam
export const throttleProgressUpdate = throttle(
  (callback: Function, data: any) => {
    callback(data);
  },
  100
); // Max 10 updates per second

// Debounce final completion events
export const debounceCompletion = debounce((callback: Function, data: any) => {
  callback(data);
}, 500); // Wait 500ms after last completion event

// Batch multiple events
export class EventBatcher {
  private events: any[] = [];
  private timeout: NodeJS.Timeout | null = null;

  constructor(
    private callback: (events: any[]) => void,
    private delay: number = 250
  ) {}

  add(event: any) {
    this.events.push(event);

    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.timeout = setTimeout(() => {
      this.callback([...this.events]);
      this.events = [];
      this.timeout = null;
    }, this.delay);
  }
}
```

## Summary

This comprehensive guide provides:

### ✅ **Complete Socket.IO Integration**

- Full TypeScript type definitions
- Connection management with React Context
- All available events documented

### ✅ **Production-Ready Hooks**

- `useWorkerProgress` - Detailed worker progress tracking
- `useTokenLaunch` - Token launch lifecycle events
- `useAdminDashboard` - Admin monitoring capabilities

### ✅ **UI Components**

- Real-time progress bars and status indicators
- Toast notifications for important events
- Comprehensive dashboard layouts

### ✅ **Best Practices**

- Error handling and connection resilience
- Performance optimization with throttling/debouncing
- Development debugging tools

### 🎯 **All Socket Events Covered**

**Outgoing (Client → Server):**

- `subscribe_user_launches` - Subscribe to user-specific events
- `subscribe_all_launches` - Admin subscription to all events
- `unsubscribe` - Unsubscribe from specific rooms

**Incoming (Server → Client):**

- `worker_progress` - Detailed worker progress with phases (user-specific)
- `worker_step` - Individual step updates (user-specific)
- `token_launch_event` - High-level launch lifecycle events (user-specific)
- `launch_progress_update` - Overall launch progress tracking (user-specific)

### 🔐 **Security & Privacy Features**

- **User-Specific Rooms**: Each user only receives events for their own operations
- **Complete Isolation**: Users cannot see other users' data or progress
- **Admin Monitoring**: Separate admin room for monitoring all users (admin only)
- **Authentication Required**: All subscriptions require authenticated user IDs
- **Server-Side Filtering**: Events are filtered at the server level, not client level

This integration provides **secure, real-time visibility** into all 7 workers with their detailed progress phases, ensuring users only see their own data while maintaining complete privacy and security! 🚀🔒
