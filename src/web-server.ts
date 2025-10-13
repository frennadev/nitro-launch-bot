/**
 * Web Server for Production Deployment
 * This creates a simple Express server that hosts the Socket.IO server
 * Use this for platforms like Render, Heroku, etc. that require web services
 */

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { botLogger } from "./utils/logger";
import { socketIOServer } from "./websocket/socketio-server";

const app = express();
const PORT = parseInt(process.env.PORT || "3001");

// Health check endpoint for render/deployment platforms
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    service: "nitro-launch-bot",
    socketIO: socketIOServer ? "running" : "not initialized",
    timestamp: new Date().toISOString(),
    port: PORT,
  });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Nitro Launch Bot API",
    version: "1.0.0",
    socketIO: {
      endpoint: "/socket.io/",
      status: socketIOServer ? "running" : "not initialized",
    },
    endpoints: {
      health: "/health",
      socketIO: "/socket.io/",
    },
  });
});

// Initialize the web server
const startWebServer = async () => {
  try {
    botLogger.info("🌐 Starting web server for production deployment...");

    // Initialize Socket.IO server first
    await socketIOServer.initialize();

    // Start Express server
    app.listen(PORT, "0.0.0.0", () => {
      botLogger.info(`🚀 Web server running on port ${PORT}`, {
        port: PORT,
        NODE_ENV: process.env.NODE_ENV,
        endpoints: ["/health", "/", "/socket.io/"],
      });
    });
  } catch (error) {
    botLogger.error("Failed to start web server:", error);
    process.exit(1);
  }
};

export { startWebServer, app };
