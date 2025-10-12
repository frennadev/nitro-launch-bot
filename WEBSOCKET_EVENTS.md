# 🔌 Real-time Launch Events with Socket.IO

The Nitro Launch Bot includes a built-in Socket.IO server that emits real-time events during token launches and fund mixing operations. This allows you to build frontend applications that can monitor launch progress in real-time.

## 🚀 Features

- **Real-time Launch Monitoring**: Get instant updates on token launch progress
- **Fund Mixing Progress**: Monitor mixing operations with progress percentages
- **Multi-platform Support**: Events for both Pump and Bonk token launches
- **User-specific Subscriptions**: Subscribe to events for specific users
- **Admin Monitoring**: Monitor all launches across all users
- **Error Handling**: Real-time error notifications with detailed messages

## 📡 Event Types

### Token Launch Events

```typescript
interface TokenLaunchEvent {
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
```

### Launch Progress Events

```typescript
interface LaunchProgress {
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

## 🛠️ Setup & Configuration

### Environment Variables

```bash
# WebSocket Server Port
WEBSOCKET_PORT=3001
```

### Server Initialization

The Socket.IO server is automatically initialized when the bot starts. You can see the initialization status in the logs:

```
✅ Socket.IO server initialized successfully
🔌 Socket.IO server running on port 3001
```

## 👥 Client Connection

### Basic Connection

```javascript
const socket = io("http://localhost:3001");

socket.on("connect", () => {
  console.log("Connected to launch bot server");
});
```

### Subscribe to User Events

```javascript
// Subscribe to launches for a specific user (by Telegram ID)
socket.emit("subscribe_user_launches", "USER_TELEGRAM_ID");
```

### Subscribe to All Events (Admin)

```javascript
// Subscribe to all launches (admin view)
socket.emit("subscribe_all_launches");
```

## 📊 Listening to Events

### Token Launch Events

```javascript
socket.on("token_launch_event", (event) => {
  console.log(`${event.stage}: ${event.name} (${event.symbol})`);
  console.log(`Message: ${event.message}`);
  console.log(`Step: ${event.stepNumber}/${event.totalSteps}`);

  if (event.error) {
    console.error(`Error: ${event.error.message}`);
  }
});
```

### Launch Progress Updates

```javascript
socket.on("launch_progress_update", (progress) => {
  console.log(`Progress: ${progress.currentStep}/${progress.totalSteps}`);
  console.log(`Token: ${progress.tokenAddress}`);

  // Check individual stages
  if (progress.stages.creation.completed) {
    console.log("✅ Token creation completed");
  }
  if (progress.stages.mixing.completed) {
    console.log("✅ Fund mixing completed");
  }
});
```

## 🎯 Launch Stage Flow

### Pump Token Launch

1. **`created`** - Token created in database
2. **`launched`** - Token submitted to launch queue
3. **`mixing_started`** - Fund mixing begins
4. **`mixing_completed`** - Fund mixing finished
5. **`fully_ready`** - Token fully ready for trading

### Bonk Token Launch

1. **`created`** - Token created in database
2. **`mixing_started`** - Fund mixing begins (before launch)
3. **`launched`** - Token launched on Raydium
4. **`mixing_completed`** - Fund mixing finished
5. **`fully_ready`** - Token fully ready for trading

## 🖥️ Frontend Example

A complete HTML example is provided at `/public/launch-monitor.html` that demonstrates:

- Real-time connection status
- User subscription management
- Active launch monitoring with progress bars
- Event logging with timestamps
- Visual stage indicators

To use the example:

1. Start the bot server
2. Open `http://localhost:3001/launch-monitor.html` in your browser
3. Enter a Telegram user ID and subscribe to events
4. Monitor launches in real-time!

## 🔧 CORS Configuration

The Socket.IO server is configured with CORS for local development:

```javascript
cors: {
  origin: [
    "http://localhost:3000",
    "http://localhost:3001",
    "https://your-frontend-domain.com"
  ],
  methods: ["GET", "POST"],
  credentials: true
}
```

Update the `origin` array in `/src/websocket/socketio-server.ts` to include your frontend domain.

## 📈 Use Cases

1. **Launch Dashboard**: Build a real-time dashboard showing all active launches
2. **User Notifications**: Send push notifications when launches complete
3. **Analytics**: Track launch success rates and timing metrics
4. **Monitoring**: Alert administrators of launch failures
5. **Progress Tracking**: Show users detailed progress of their launches

## 🐛 Error Handling

All launch errors are emitted as events with detailed information:

```javascript
socket.on("token_launch_event", (event) => {
  if (event.error) {
    console.error(`Launch Error in ${event.error.stage}:`, event.error.message);
    // Handle error - show notification, retry, etc.
  }
});
```

## 🚦 Connection Management

The server tracks connected clients and provides connection statistics:

```javascript
// In the backend, you can check connected clients
const connectedClients = socketIOServer.getConnectedClientsCount();
console.log(`${connectedClients} clients connected`);
```

The server automatically handles client disconnections and room cleanup.

---

This real-time event system makes it easy to build responsive frontend applications that provide users with immediate feedback on their token launches and mixing operations.
