/**
 * Production Web Server Startup
 * Simple HTTP server that hosts Socket.IO for production deployment
 * Use this for platforms like Render, Heroku, etc.
 */

import { createServer } from "http";
import { botLogger } from "./utils/logger";
import { socketIOServer } from "./websocket/socketio-server";

const PORT = parseInt(process.env.PORT || "3001");

// Create a simple HTTP server with health check
const createProductionServer = () => {
  const server = createServer((req, res) => {
    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "OK",
          service: "nitro-launch-bot-socketio",
          timestamp: new Date().toISOString(),
          port: PORT,
          socketIO: "running",
        })
      );
      return;
    }

    if (req.url === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message: "Nitro Launch Bot Socket.IO Server",
          version: "1.0.0",
          socketIO: {
            endpoint: "/socket.io/",
            status: "running",
          },
          endpoints: {
            health: "/health",
            socketIO: "/socket.io/",
          },
        })
      );
      return;
    }

    // Handle other requests
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  });

  return server;
};

// Start the production web server
const startProductionServer = async () => {
  try {
    botLogger.info("🌐 Starting production Socket.IO server...");

    // Initialize Socket.IO which will use our production server configuration
    await socketIOServer.initialize();

    botLogger.info(
      `🚀 Production Socket.IO server started successfully on port ${PORT}`
    );
  } catch (error) {
    botLogger.error("Failed to start production server:", error);
    throw error;
  }
};

// Only start if this file is run directly (not imported)
if (require.main === module) {
  startProductionServer().catch((error) => {
    botLogger.error("Production server startup failed:", error);
    process.exit(1);
  });
}

export { startProductionServer, createProductionServer };
