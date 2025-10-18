/**
 * Complete Backend Setup Example for CTO Progress Tracking (TypeScript)
 * This shows how to set up your backend to work with frontend progress tracking
 */

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import {
  enqueueCTOOperation,
  getCTOJobStatus,
  cancelCTOJob,
} from "../src/jobs/cto-external";

const app = express();
const server = createServer(app);

// Configure Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:3000", // React dev server
      "http://localhost:3001", // Alternative frontend port
      "https://yourdomain.com", // Your production domain
      "https://your-frontend-app.com", // Your app domain
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"], // Support both for reliability
});

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://yourdomain.com",
    ],
    credentials: true,
  })
);
app.use(express.json());

// Store active Socket.IO connections for progress emission
const activeConnections = new Map<string, string>(); // userId -> socketId mapping

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("🔌 Client connected:", socket.id);

  // Handle room joining for user-specific updates
  socket.on("join_room", (roomName: string) => {
    socket.join(roomName);
    console.log(`👤 Socket ${socket.id} joined room: ${roomName}`);

    // Extract userId from room name if it follows pattern "user_123"
    if (roomName.startsWith("user_")) {
      const userId = roomName.replace("user_", "");
      activeConnections.set(userId, socket.id);
    }

    // Send confirmation
    socket.emit("room_joined", { room: roomName, success: true });
  });

  // Handle leaving rooms
  socket.on("leave_room", (roomName: string) => {
    socket.leave(roomName);
    console.log(`👋 Socket ${socket.id} left room: ${roomName}`);

    if (roomName.startsWith("user_")) {
      const userId = roomName.replace("user_", "");
      activeConnections.delete(userId);
    }
  });

  // Handle disconnection
  socket.on("disconnect", (reason: string) => {
    console.log("📡 Client disconnected:", socket.id, "Reason:", reason);

    // Clean up active connections
    for (const [userId, socketId] of activeConnections.entries()) {
      if (socketId === socket.id) {
        activeConnections.delete(userId);
        break;
      }
    }
  });

  // Optional: Handle ping/pong for connection health
  socket.on("ping", () => {
    socket.emit("pong");
  });
});

// Make io instance available globally for progress emission
(global as any).socketIO = io;

// API Routes

/**
 * POST /api/cto/start
 * Start a new CTO operation
 */
app.post("/api/cto/start", async (req, res) => {
  try {
    const {
      userId,
      tokenAddress,
      buyAmount,
      mode = "standard",
      platform = "pumpfun",
    } = req.body;

    // Validate required fields
    if (!userId || !tokenAddress || !buyAmount) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: userId, tokenAddress, buyAmount",
      });
    }

    // Validate mode
    if (!["standard", "prefunded"].includes(mode)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mode. Must be "standard" or "prefunded"',
      });
    }

    console.log("🚀 Starting CTO operation:", {
      userId,
      tokenAddress: tokenAddress.slice(0, 8) + "...",
      buyAmount,
      mode,
      platform,
    });

    // Enqueue the CTO operation
    const job = await enqueueCTOOperation({
      userId: userId,
      userChatId: parseInt(userId) || Math.floor(Math.random() * 1000000), // Fallback if not a number
      tokenAddress,
      buyAmount: parseFloat(buyAmount),
      mode,
      platform,
      socketUserId: `user_${userId}`, // This enables progress tracking
    });

    // Send success response
    res.json({
      success: true,
      jobId: job.jobId,
      data: {
        userId,
        tokenAddress,
        buyAmount,
        mode,
        platform,
        status: "queued",
        createdAt: new Date().toISOString(),
      },
      message: `CTO operation started successfully. Job ID: ${job.jobId}`,
    });

    // Notify the user via Socket.IO that their job was created
    io.to(`user_${userId}`).emit("cto_job_created", {
      jobId: job.jobId,
      tokenAddress,
      buyAmount,
      mode,
      platform,
      status: "queued",
    });
  } catch (error: any) {
    console.error("❌ Error starting CTO operation:", error);

    res.status(500).json({
      success: false,
      error: error.message || "Failed to start CTO operation",
      details: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
});

/**
 * GET /api/cto/job/:jobId/status
 * Get detailed status of a CTO job
 */
app.get("/api/cto/job/:jobId/status", async (req, res) => {
  try {
    const { jobId } = req.params;

    console.log("📊 Getting status for job:", jobId);

    const status = await getCTOJobStatus(jobId);

    if (status.status === "not_found") {
      return res.status(404).json({
        success: false,
        error: "Job not found",
        jobId,
      });
    }

    res.json({
      success: true,
      data: status,
      jobId,
    });
  } catch (error: any) {
    console.error("❌ Error getting job status:", error);

    res.status(500).json({
      success: false,
      error: error.message || "Failed to get job status",
      jobId: req.params.jobId,
    });
  }
});

/**
 * GET /api/cto/user/:userId/jobs
 * Get all jobs for a specific user (optional endpoint)
 */
app.get("/api/cto/user/:userId/jobs", async (req, res) => {
  try {
    const { userId } = req.params;

    // This would require implementing a user job tracking system
    // For now, return a placeholder response
    res.json({
      success: true,
      data: {
        userId,
        jobs: [], // You'd implement this based on your needs
        totalJobs: 0,
        activeJobs: 0,
        completedJobs: 0,
      },
    });
  } catch (error: any) {
    console.error("❌ Error getting user jobs:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/cto/job/:jobId/cancel
 * Cancel a pending CTO job (optional)
 */
app.post("/api/cto/job/:jobId/cancel", async (req, res) => {
  try {
    const { jobId } = req.params;

    const result = await cancelCTOJob(jobId);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        jobId,
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        jobId,
      });
    }
  } catch (error: any) {
    console.error("❌ Error cancelling job:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      jobId: req.params.jobId,
    });
  }
});

/**
 * GET /api/cto/health
 * Health check endpoint
 */
app.get("/api/cto/health", (_, res) => {
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    connections: {
      total: io.engine.clientsCount,
      active: activeConnections.size,
    },
    services: {
      socketIO: io ? "running" : "stopped",
      ctoQueue: "running", // You could check actual queue health here
    },
  });
});

/**
 * GET /api/cto/debug/connections
 * Debug endpoint to see active connections (development only)
 */
if (process.env.NODE_ENV === "development") {
  app.get("/api/cto/debug/connections", (_, res) => {
    res.json({
      success: true,
      data: {
        totalSockets: io.engine.clientsCount,
        activeConnections: Object.fromEntries(activeConnections),
        rooms: Array.from(io.sockets.adapter.rooms.keys()),
      },
    });
  });
}

// Error handling middleware
app.use(
  (
    error: any,
    req: express.Request,
    res: express.Response,
    _: express.NextFunction
  ) => {
    console.error("🚨 Unhandled error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    path: req.path,
  });
});

// Start server function
export function startCTOProgressServer() {
  const PORT = process.env.PORT || 3001;

  server.listen(PORT, () => {
    console.log(`🚀 CTO Progress Server running on port ${PORT}`);
    console.log(`🔌 Socket.IO enabled on ws://localhost:${PORT}`);
    console.log(
      `📡 API endpoints available at http://localhost:${PORT}/api/cto`
    );

    // Start your CTO workers here
    console.log("🔧 Starting CTO workers...");
    // You would import and start your job system here
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("📤 Shutdown signal received, closing server gracefully");
    server.close(() => {
      console.log("✅ Server closed");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return { app, server, io };
}

export { app, server, io };
