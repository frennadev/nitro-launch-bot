# Frontend Integration Guide for CTO Progress Tracking

This guide shows you exactly how to integrate CTO progress tracking into your frontend application.

## 🚀 Quick Integration Steps

### Step 1: Install Required Dependencies

```bash
# For Socket.IO real-time tracking
npm install socket.io-client

# For TypeScript support (optional)
npm install @types/socket.io-client
```

### Step 2: Basic Integration

Choose your approach based on your frontend framework:

## 📱 React Integration

### Option A: Simple React Hook (Recommended)

Create `hooks/useCTOProgress.js`:

```javascript
import { useState, useEffect, useCallback } from "react";
import io from "socket.io-client";

export const useCTOProgress = (socketUrl, userId) => {
  const [socket, setSocket] = useState(null);
  const [jobs, setJobs] = useState(new Map());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Connect to your backend Socket.IO server
    const socketInstance = io(socketUrl, {
      transports: ["websocket", "polling"], // Fallback to polling if needed
      timeout: 10000,
      reconnection: true,
    });

    // Connection events
    socketInstance.on("connect", () => {
      setConnected(true);
      console.log("✅ Connected to CTO progress tracking");

      // Join user-specific room to get only your progress updates
      socketInstance.emit("join_room", `user_${userId}`);
    });

    socketInstance.on("disconnect", () => {
      setConnected(false);
      console.log("❌ Disconnected from progress tracking");
    });

    // Listen for CTO progress updates
    socketInstance.on("worker_progress", (event) => {
      // Filter for CTO operations only
      if (event.workerType === "cto_operation") {
        console.log("📊 CTO Progress Update:", event);

        setJobs((prev) => {
          const newJobs = new Map(prev);
          newJobs.set(event.jobId, event);
          return newJobs;
        });
      }
    });

    setSocket(socketInstance);

    // Cleanup on unmount
    return () => {
      socketInstance.disconnect();
    };
  }, [socketUrl, userId]);

  // Helper function to get specific job progress
  const getJobProgress = useCallback(
    (jobId) => {
      return jobs.get(jobId);
    },
    [jobs]
  );

  // Helper to get all active jobs
  const getAllJobs = useCallback(() => {
    return Array.from(jobs.values());
  }, [jobs]);

  return {
    socket,
    connected,
    jobs: getAllJobs(),
    getJobProgress,
    jobCount: jobs.size,
  };
};
```

### React Component Example

Create `components/CTOProgressTracker.jsx`:

```javascript
import React from "react";
import { useCTOProgress } from "../hooks/useCTOProgress";
import "./CTOProgressTracker.css"; // We'll create this next

const CTOProgressTracker = ({
  jobId,
  userId,
  socketUrl = "ws://localhost:3000", // Replace with your backend URL
}) => {
  const { connected, getJobProgress } = useCTOProgress(socketUrl, userId);
  const progress = getJobProgress(jobId);

  // Connection status
  if (!connected) {
    return (
      <div className="cto-progress connecting">
        <div className="spinner"></div>
        <p>Connecting to progress tracking...</p>
      </div>
    );
  }

  // Waiting for operation to start
  if (!progress) {
    return (
      <div className="cto-progress waiting">
        <div className="pulse-dot"></div>
        <h3>Waiting for CTO Operation</h3>
        <p>Your operation will start shortly...</p>
        <small>Job ID: {jobId}</small>
      </div>
    );
  }

  // Active progress tracking
  const {
    phase,
    totalPhases,
    phaseTitle,
    phaseDescription,
    progress: progressPercent,
    status,
    mode,
    platform,
    buyAmount,
    details,
  } = progress;

  const getStatusColor = (status) => {
    switch (status) {
      case "started":
        return "#2196F3";
      case "in_progress":
        return "#FF9800";
      case "completed":
        return "#4CAF50";
      case "failed":
        return "#F44336";
      default:
        return "#9E9E9E";
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case "started":
        return "🚀";
      case "in_progress":
        return "⚙️";
      case "completed":
        return "✅";
      case "failed":
        return "❌";
      default:
        return "⏳";
    }
  };

  return (
    <div className={`cto-progress ${status}`}>
      {/* Header */}
      <div className="progress-header">
        <h3>
          {getStatusIcon(status)} {phaseTitle}
        </h3>
        <div className="progress-meta">
          <span className="phase-indicator">
            Phase {phase}/{totalPhases}
          </span>
          <span className="mode-badge">
            {mode === "prefunded" ? "⚡ Prefunded" : "🏦 Standard"}
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="progress-bar-container">
        <div
          className="progress-bar-fill"
          style={{
            width: `${progressPercent}%`,
            backgroundColor: getStatusColor(status),
            transition: "width 0.5s ease-in-out",
          }}
        >
          <span className="progress-text">{progressPercent}%</span>
        </div>
      </div>

      {/* Description */}
      <p className="progress-description">{phaseDescription}</p>

      {/* Operation Details */}
      <div className="operation-details">
        <div className="detail-item">
          <span className="label">Platform:</span>
          <span className="value">{platform}</span>
        </div>
        <div className="detail-item">
          <span className="label">Amount:</span>
          <span className="value">{buyAmount} SOL</span>
        </div>
        {details?.estimatedTimeRemaining && (
          <div className="detail-item">
            <span className="label">ETA:</span>
            <span className="value">
              {Math.ceil(details.estimatedTimeRemaining / 1000)}s
            </span>
          </div>
        )}
      </div>

      {/* Transaction Details */}
      {details && (
        <div className="transaction-details">
          {details.successfulBuys > 0 && (
            <div className="success-count">
              ✅ {details.successfulBuys} successful buys
            </div>
          )}
          {details.failedBuys > 0 && (
            <div className="failed-count">
              ❌ {details.failedBuys} failed buys
            </div>
          )}
          {details.currentOperation && (
            <div className="current-operation">
              🔄 {details.currentOperation}
            </div>
          )}
          {details.error && (
            <div className="error-message">⚠️ {details.error}</div>
          )}
        </div>
      )}

      {/* Completion Message */}
      {status === "completed" && (
        <div className="completion-message">
          🎉 CTO Operation completed successfully!
        </div>
      )}

      {status === "failed" && (
        <div className="failure-message">
          💔 CTO Operation failed. Please try again.
        </div>
      )}
    </div>
  );
};

export default CTOProgressTracker;
```

### CSS Styles

Create `components/CTOProgressTracker.css`:

```css
.cto-progress {
  max-width: 500px;
  margin: 20px auto;
  padding: 20px;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-left: 4px solid #2196f3;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.cto-progress.completed {
  border-left-color: #4caf50;
}

.cto-progress.failed {
  border-left-color: #f44336;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.progress-header h3 {
  margin: 0;
  font-size: 18px;
  color: #333;
}

.progress-meta {
  display: flex;
  gap: 10px;
  align-items: center;
}

.phase-indicator {
  background: #f0f0f0;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
  color: #666;
}

.mode-badge {
  background: #e3f2fd;
  color: #1976d2;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.progress-bar-container {
  width: 100%;
  height: 24px;
  background: #f5f5f5;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 15px;
  position: relative;
}

.progress-bar-fill {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 10px;
  min-width: 60px;
}

.progress-text {
  color: white;
  font-size: 12px;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.progress-description {
  color: #666;
  margin: 10px 0;
  line-height: 1.4;
}

.operation-details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 15px 0;
  padding: 12px;
  background: #f9f9f9;
  border-radius: 8px;
}

.detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.detail-item .label {
  font-size: 13px;
  color: #666;
}

.detail-item .value {
  font-size: 13px;
  font-weight: 500;
  color: #333;
}

.transaction-details {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #eee;
}

.transaction-details > div {
  margin: 5px 0;
  font-size: 14px;
}

.success-count {
  color: #4caf50;
}

.failed-count {
  color: #f44336;
}

.current-operation {
  color: #ff9800;
  font-style: italic;
}

.error-message {
  color: #f44336;
  background: #ffebee;
  padding: 8px;
  border-radius: 4px;
  font-size: 13px;
}

.completion-message {
  background: #e8f5e8;
  color: #2e7d32;
  padding: 12px;
  border-radius: 8px;
  text-align: center;
  font-weight: 500;
  margin-top: 15px;
}

.failure-message {
  background: #ffebee;
  color: #c62828;
  padding: 12px;
  border-radius: 8px;
  text-align: center;
  font-weight: 500;
  margin-top: 15px;
}

/* Loading states */
.cto-progress.connecting {
  text-align: center;
  padding: 40px 20px;
}

.cto-progress.waiting {
  text-align: center;
  padding: 40px 20px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #2196f3;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 15px;
}

.pulse-dot {
  width: 12px;
  height: 12px;
  background: #2196f3;
  border-radius: 50%;
  margin: 0 auto 15px;
  animation: pulse 2s infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(1.2);
  }
}

/* Responsive design */
@media (max-width: 600px) {
  .cto-progress {
    margin: 10px;
    padding: 15px;
  }

  .operation-details {
    grid-template-columns: 1fr;
  }

  .progress-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
```

### Usage in Your App

```javascript
// App.js or your main component
import React, { useState } from "react";
import CTOProgressTracker from "./components/CTOProgressTracker";

function App() {
  const [jobId, setJobId] = useState(null);
  const userId = "your-user-id"; // Get from your auth system

  // Function to start a CTO operation
  const startCTOOperation = async () => {
    try {
      // Call your backend API to start CTO
      const response = await fetch("/api/cto/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          tokenAddress: "your-token-address",
          buyAmount: 1.5,
          mode: "standard", // or 'prefunded'
          platform: "pumpfun",
        }),
      });

      const data = await response.json();

      if (data.success) {
        setJobId(data.jobId); // This will trigger progress tracking
      }
    } catch (error) {
      console.error("Failed to start CTO:", error);
    }
  };

  return (
    <div className="App">
      <h1>CTO Operation Dashboard</h1>

      {!jobId ? (
        <button onClick={startCTOOperation}>Start CTO Operation</button>
      ) : (
        <CTOProgressTracker
          jobId={jobId}
          userId={userId}
          socketUrl="ws://your-backend-url.com" // Replace with your backend
        />
      )}
    </div>
  );
}

export default App;
```

## 🌐 Vanilla JavaScript Integration

If you're not using React, here's a vanilla JavaScript version:

### HTML Structure

```html
<!DOCTYPE html>
<html>
  <head>
    <title>CTO Progress Tracker</title>
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
    <style>
      /* Use the same CSS as above */
    </style>
  </head>
  <body>
    <div id="cto-container">
      <h1>CTO Operation</h1>
      <button id="start-cto">Start CTO Operation</button>
      <div id="progress-tracker" style="display: none;"></div>
    </div>

    <script src="cto-tracker.js"></script>
  </body>
</html>
```

### JavaScript Implementation

Create `cto-tracker.js`:

```javascript
class CTOProgressTracker {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.socketUrl = options.socketUrl || "ws://localhost:3000";
    this.userId = options.userId;
    this.socket = null;
    this.currentJob = null;

    this.init();
  }

  init() {
    // Connect to Socket.IO
    this.socket = io(this.socketUrl, {
      transports: ["websocket", "polling"],
      timeout: 10000,
      reconnection: true,
    });

    // Setup event listeners
    this.socket.on("connect", () => {
      console.log("✅ Connected to CTO progress tracking");
      this.socket.emit("join_room", `user_${this.userId}`);
      this.showConnectionStatus(true);
    });

    this.socket.on("disconnect", () => {
      console.log("❌ Disconnected from progress tracking");
      this.showConnectionStatus(false);
    });

    this.socket.on("worker_progress", (event) => {
      if (event.workerType === "cto_operation") {
        this.handleProgressUpdate(event);
      }
    });
  }

  showConnectionStatus(connected) {
    if (connected) {
      this.updateUI(`
                <div class="connection-status connected">
                    ✅ Connected to progress tracking
                </div>
            `);
    } else {
      this.updateUI(`
                <div class="connection-status disconnected">
                    ❌ Disconnected from progress tracking
                </div>
            `);
    }
  }

  trackJob(jobId) {
    this.currentJobId = jobId;
    this.updateUI(`
            <div class="waiting">
                <div class="pulse-dot"></div>
                <h3>Waiting for CTO Operation</h3>
                <p>Job ID: ${jobId}</p>
            </div>
        `);
  }

  handleProgressUpdate(event) {
    if (event.jobId !== this.currentJobId) return;

    this.currentJob = event;
    this.renderProgress(event);
  }

  renderProgress(progress) {
    const {
      phase,
      totalPhases,
      phaseTitle,
      phaseDescription,
      progress: progressPercent,
      status,
      mode,
      platform,
      buyAmount,
      details,
    } = progress;

    const statusIcon = this.getStatusIcon(status);
    const statusColor = this.getStatusColor(status);

    const html = `
            <div class="cto-progress ${status}">
                <div class="progress-header">
                    <h3>${statusIcon} ${phaseTitle}</h3>
                    <div class="progress-meta">
                        <span class="phase-indicator">Phase ${phase}/${totalPhases}</span>
                        <span class="mode-badge">${mode === "prefunded" ? "⚡ Prefunded" : "🏦 Standard"}</span>
                    </div>
                </div>

                <div class="progress-bar-container">
                    <div class="progress-bar-fill" 
                         style="width: ${progressPercent}%; background-color: ${statusColor};">
                        <span class="progress-text">${progressPercent}%</span>
                    </div>
                </div>

                <p class="progress-description">${phaseDescription}</p>

                <div class="operation-details">
                    <div class="detail-item">
                        <span class="label">Platform:</span>
                        <span class="value">${platform}</span>
                    </div>
                    <div class="detail-item">
                        <span class="label">Amount:</span>
                        <span class="value">${buyAmount} SOL</span>
                    </div>
                    ${
                      details?.estimatedTimeRemaining
                        ? `
                        <div class="detail-item">
                            <span class="label">ETA:</span>
                            <span class="value">${Math.ceil(details.estimatedTimeRemaining / 1000)}s</span>
                        </div>
                    `
                        : ""
                    }
                </div>

                ${this.renderTransactionDetails(details)}
                ${this.renderStatusMessage(status)}
            </div>
        `;

    this.updateUI(html);
  }

  renderTransactionDetails(details) {
    if (!details) return "";

    let html = '<div class="transaction-details">';

    if (details.successfulBuys > 0) {
      html += `<div class="success-count">✅ ${details.successfulBuys} successful buys</div>`;
    }

    if (details.failedBuys > 0) {
      html += `<div class="failed-count">❌ ${details.failedBuys} failed buys</div>`;
    }

    if (details.currentOperation) {
      html += `<div class="current-operation">🔄 ${details.currentOperation}</div>`;
    }

    if (details.error) {
      html += `<div class="error-message">⚠️ ${details.error}</div>`;
    }

    html += "</div>";
    return html;
  }

  renderStatusMessage(status) {
    if (status === "completed") {
      return '<div class="completion-message">🎉 CTO Operation completed successfully!</div>';
    } else if (status === "failed") {
      return '<div class="failure-message">💔 CTO Operation failed. Please try again.</div>';
    }
    return "";
  }

  getStatusIcon(status) {
    const icons = {
      started: "🚀",
      in_progress: "⚙️",
      completed: "✅",
      failed: "❌",
    };
    return icons[status] || "⏳";
  }

  getStatusColor(status) {
    const colors = {
      started: "#2196F3",
      in_progress: "#FF9800",
      completed: "#4CAF50",
      failed: "#F44336",
    };
    return colors[status] || "#9E9E9E";
  }

  updateUI(html) {
    this.container.innerHTML = html;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Initialize when page loads
document.addEventListener("DOMContentLoaded", () => {
  const tracker = new CTOProgressTracker("progress-tracker", {
    socketUrl: "ws://localhost:3000", // Replace with your backend URL
    userId: "your-user-id", // Replace with actual user ID
  });

  // Handle start CTO button
  document.getElementById("start-cto").addEventListener("click", async () => {
    try {
      // Hide start button and show progress tracker
      document.getElementById("start-cto").style.display = "none";
      document.getElementById("progress-tracker").style.display = "block";

      // Start CTO operation (replace with your API call)
      const response = await fetch("/api/cto/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "your-user-id",
          tokenAddress: "your-token-address",
          buyAmount: 1.5,
          mode: "standard",
          platform: "pumpfun",
        }),
      });

      const data = await response.json();

      if (data.success) {
        tracker.trackJob(data.jobId);
      } else {
        alert("Failed to start CTO operation: " + data.error);
      }
    } catch (error) {
      console.error("Error starting CTO:", error);
      alert("Failed to start CTO operation");
    }
  });
});
```

## 🔧 Backend Integration

Make sure your backend is set up to emit progress events. Here's what you need:

### 1. Enable Socket.IO in your backend

```javascript
// Your backend server setup
const { Server } = require("socket.io");
const server = require("http").createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000", "https://yourdomain.com"],
    methods: ["GET", "POST"],
  },
});

// Handle client connections
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Handle room joining
  socket.on("join_room", (room) => {
    socket.join(room);
    console.log(`Client ${socket.id} joined room: ${room}`);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});
```

### 2. Start CTO Operation Endpoint

```javascript
// API endpoint to start CTO operation
app.post("/api/cto/start", async (req, res) => {
  try {
    const { userId, tokenAddress, buyAmount, mode, platform } = req.body;

    // Import your CTO external functions
    const { enqueueCTOOperation } = require("./src/jobs/cto-external");

    // Enqueue the CTO operation
    const job = await enqueueCTOOperation({
      userId,
      userChatId: parseInt(userId), // or get from your user system
      tokenAddress,
      buyAmount,
      mode,
      platform,
      socketUserId: `user_${userId}`, // For progress tracking
    });

    res.json({
      success: true,
      jobId: job.jobId,
      message: "CTO operation started",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
```

## 🚀 Quick Setup Checklist

1. **✅ Install dependencies**: `npm install socket.io-client`
2. **✅ Copy the React component** or vanilla JS code above
3. **✅ Update the `socketUrl`** to point to your backend
4. **✅ Replace `userId`** with your actual user identification
5. **✅ Ensure your backend** has Socket.IO enabled and CTO queue running
6. **✅ Test the connection** by checking browser console for connection messages

## 🎯 Testing Your Integration

1. **Start your backend** with the CTO worker running
2. **Open your frontend** application
3. **Check browser console** for connection messages
4. **Start a CTO operation** and watch the real-time progress
5. **Verify progress updates** appear instantly

## 📱 Next Steps

Once you have basic integration working, you can:

- **Add multiple job tracking** for batch operations
- **Implement polling fallback** for reliability
- **Add push notifications** for mobile apps
- **Create progress history** views
- **Add error recovery** mechanisms
- **Style the components** to match your design system

The system is designed to be plug-and-play with your existing frontend architecture!
