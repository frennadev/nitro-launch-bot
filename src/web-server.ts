/**
 * Web Server for Production Deployment
 * This creates an HTTP server that hosts the Socket.IO server
 * Use this for platforms like Render, Heroku, etc. that require web services
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { parse } from "url";
import { botLogger } from "./utils/logger";
import { socketIOServer } from "./websocket/socketio-server";

const PORT = parseInt(process.env.PORT || "3001");

// HTTP request handler
const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
  const parsedUrl = parse(req.url || "", true);
  const pathname = parsedUrl.pathname;

  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check endpoint
  if (pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "OK",
        service: "nitro-launch-bot",
        socketIO: socketIOServer ? "running" : "not initialized",
        timestamp: new Date().toISOString(),
        port: PORT,
      })
    );
    return;
  }

  // Root endpoint
  if (pathname === "/" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
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
      })
    );
    return;
  }

  // Default 404 response for other paths
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Not Found" }));
};

// Initialize the web server
const startWebServer = async () => {
  try {
    botLogger.info("🌐 Starting HTTP server with Socket.IO integration...");

    // Create HTTP server
    const httpServer = createServer(handleRequest);

    // Initialize Socket.IO server with the HTTP server
    await socketIOServer.initializeWithHttpServer(httpServer);

    // Start the combined HTTP server
    httpServer.listen(PORT, "0.0.0.0", () => {
      botLogger.info(`🚀 HTTP server with Socket.IO running on port ${PORT}`, {
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

export { startWebServer };
