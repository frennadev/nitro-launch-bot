import { Server, Socket } from "socket.io";
import { createServer, Server as HttpServer } from "http";
import { botLogger } from "../utils/logger";

interface LaunchData {
  initialLiquidity?: number;
  marketCap?: number;
  price?: number;
  devWallet?: string;
  buyerWallets?: number;
}

interface MixingData {
  totalFunds?: number;
  walletsUsed?: number;
  completedAt?: number;
  mixingProgress?: number;
}

interface MixingDetails {
  name?: string;
  symbol?: string;
  stepNumber?: number;
  totalSteps?: number;
  walletsUsed?: number;
  totalFunds?: number;
}

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

class SocketIOServer {
  private io: Server | null = null;
  private httpServer: HttpServer | null = null;
  private port: number;
  private isInitialized = false;

  // Track launch progress for each token
  private launchProgress = new Map<string, LaunchProgress>();

  constructor(port?: number) {
    // Use PORT environment variable for production (Render, Heroku, etc.)
    this.port =
      port ||
      parseInt(process.env.PORT || process.env.WEBSOCKET_PORT || "3001");
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      botLogger.warn("Socket.IO server already initialized");
      return;
    }

    try {
      // Create HTTP server
      this.httpServer = createServer();

      // Initialize Socket.IO with production-ready CORS
      this.io = new Server(this.httpServer, {
        cors: {
          origin: [
            "http://localhost:3000",
            "http://localhost:3001",
            "https://launchbot-ui.vercel.app",
            "https://launchbot-ui.vercel.app/",
            // Add your production frontend domains
            "https://*.vercel.app",
            "https://*.netlify.app",
            // Allow any origin in development
            ...(process.env.NODE_ENV === "development" ? ["*"] : []),
          ],
          methods: ["GET", "POST"],
          credentials: true,
        },
        transports: ["websocket", "polling"],
        // Add production optimizations
        pingTimeout: 60000,
        pingInterval: 25000,
      });

      // Set up event handlers
      this.setupEventHandlers();

      // Start the server with better error handling
      this.httpServer.on("error", (error: Error & { code?: string }) => {
        botLogger.error(`Socket.IO server error on port ${this.port}:`, {
          error: error.message,
          code: error.code,
          port: this.port,
          NODE_ENV: process.env.NODE_ENV,
        });
      });

      this.httpServer.listen(this.port, "0.0.0.0", () => {
        botLogger.info(`🔌 Socket.IO server running on port ${this.port}`, {
          port: this.port,
          NODE_ENV: process.env.NODE_ENV,
          cors: this.io?.engine.opts.cors,
        });
        this.isInitialized = true;

        // Add a health check endpoint
        if (this.httpServer) {
          this.httpServer.on("request", (req, res) => {
            if (req.url === "/health" && req.method === "GET") {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  status: "OK",
                  socketIO: "running",
                  port: this.port,
                  timestamp: new Date().toISOString(),
                })
              );
            }
          });
        }
      });
    } catch (error) {
      botLogger.error("Failed to initialize Socket.IO server:", {
        error: error instanceof Error ? error.message : String(error),
        port: this.port,
        NODE_ENV: process.env.NODE_ENV,
      });
      throw error;
    }
  }

  async initializeWithHttpServer(httpServer: HttpServer): Promise<void> {
    if (this.isInitialized) {
      botLogger.warn("Socket.IO server already initialized");
      return;
    }

    try {
      // Use the provided HTTP server instead of creating our own
      this.httpServer = httpServer;

      // Initialize Socket.IO with production-ready CORS
      this.io = new Server(this.httpServer, {
        cors: {
          origin: [
            "http://localhost:3000",
            "http://localhost:3001",
            "https://launchbot-ui.vercel.app",
            "https://launchbot-ui.vercel.app/",
            // Add your production frontend domains
            "https://*.vercel.app",
            "https://*.netlify.app",
            // Allow any origin in development
            ...(process.env.NODE_ENV === "development" ? ["*"] : []),
          ],
          methods: ["GET", "POST"],
          credentials: true,
        },
        transports: ["websocket", "polling"],
        // Add production optimizations
        pingTimeout: 60000,
        pingInterval: 25000,
      });

      // Set up event handlers
      this.setupEventHandlers();

      this.isInitialized = true;
      botLogger.info(
        "🔌 Socket.IO server initialized with Express HTTP server",
        {
          NODE_ENV: process.env.NODE_ENV,
          cors: this.io?.engine.opts.cors,
        }
      );
    } catch (error) {
      botLogger.error(
        "Failed to initialize Socket.IO server with HTTP server:",
        {
          error: error instanceof Error ? error.message : String(error),
          NODE_ENV: process.env.NODE_ENV,
        }
      );
      throw error;
    }
  }

  private setupEventHandlers(): void {
    if (!this.io) return;

    this.io.on("connection", (socket) => {
      botLogger.info(`📱 Client connected: ${socket.id}`);

      // Handle client subscribing to specific user's launches
      socket.on("subscribe_user_launches", (userId: string) => {
        socket.join(`user_${userId}`);
        botLogger.info(
          `👤 Client ${socket.id} subscribed to user ${userId} launches`
        );

        // Send current progress for any active launches for this user
        this.sendCurrentProgress(socket, userId);
      });

      // Handle client subscribing to all launches (admin view)
      socket.on("subscribe_all_launches", () => {
        socket.join("admin_launches");
        botLogger.info(
          `👑 Admin client ${socket.id} subscribed to all launches`
        );
      });

      // Handle client unsubscribing
      socket.on("unsubscribe", (room: string) => {
        socket.leave(room);
        botLogger.info(`📤 Client ${socket.id} unsubscribed from ${room}`);
      });

      socket.on("disconnect", () => {
        botLogger.info(`📱 Client disconnected: ${socket.id}`);
      });
    });
  }

  private sendCurrentProgress(socket: Socket, userId: string): void {
    // Send any active launch progress for this user
    for (const [, progress] of this.launchProgress.entries()) {
      if (progress.userId === userId) {
        socket.emit("launch_progress_update", {
          ...progress,
          type: "current_progress",
        });
      }
    }
  }

  // Main method to emit token launch events
  emitTokenLaunchEvent(event: TokenLaunchEvent): void {
    if (!this.io || !this.isInitialized) {
      botLogger.warn("Socket.IO server not initialized, cannot emit event");
      return;
    }

    try {
      // Update launch progress tracking
      this.updateLaunchProgress(event);

      // Emit to user-specific room
      this.io.to(`user_${event.userId}`).emit("token_launch_event", event);

      // Emit to admin room
      this.io.to("admin_launches").emit("token_launch_event", event);

      // Emit progress update
      const progress = this.launchProgress.get(event.tokenAddress);
      if (progress) {
        this.io
          .to(`user_${event.userId}`)
          .emit("launch_progress_update", progress);
        this.io.to("admin_launches").emit("launch_progress_update", progress);
      }

      botLogger.info(
        `📡 Emitted ${event.stage} event for token ${event.tokenAddress.slice(0, 8)}...`
      );
    } catch (error) {
      botLogger.error("Failed to emit token launch event:", error);
    }
  }

  private updateLaunchProgress(event: TokenLaunchEvent): void {
    const { tokenAddress, platform, userId, stage, stepNumber, totalSteps } =
      event;

    let progress = this.launchProgress.get(tokenAddress);
    if (!progress) {
      progress = {
        tokenAddress,
        platform,
        userId,
        currentStep: 1,
        totalSteps,
        stages: {
          creation: { completed: false },
          launch: { completed: false },
          mixing: { completed: false },
          ready: { completed: false },
        },
      };
      this.launchProgress.set(tokenAddress, progress);
    }

    // Update current step
    progress.currentStep = stepNumber;
    progress.totalSteps = totalSteps;

    // Update stage completion
    const timestamp = Date.now();
    switch (stage) {
      case "created":
        progress.stages.creation = { completed: true, timestamp };
        break;
      case "launched":
        progress.stages.launch = { completed: true, timestamp };
        break;
      case "mixing_started":
        progress.stages.mixing = {
          completed: false,
          timestamp,
          progress: event.mixingData?.mixingProgress || 0,
        };
        break;
      case "mixing_completed":
        progress.stages.mixing = { completed: true, timestamp, progress: 100 };
        break;
      case "fully_ready":
        progress.stages.ready = { completed: true, timestamp };
        // Clean up after completion (after 5 minutes)
        setTimeout(
          () => {
            this.launchProgress.delete(tokenAddress);
          },
          5 * 60 * 1000
        );
        break;
    }
  }

  // Emit mixing progress updates
  emitMixingProgress(
    tokenAddress: string,
    userId: string,
    progress: number,
    details?: MixingDetails
  ): void {
    if (!this.io || !this.isInitialized) return;

    const mixingEvent: TokenLaunchEvent = {
      tokenAddress,
      platform: "pump", // or detect platform
      name: details?.name || "Unknown",
      symbol: details?.symbol || "UNK",
      timestamp: Date.now(),
      userId,
      stage: progress >= 100 ? "mixing_completed" : "mixing_started",
      stepNumber: details?.stepNumber || 3,
      totalSteps: details?.totalSteps || 4,
      message: `Mixing funds... ${progress.toFixed(1)}% complete`,
      mixingData: {
        mixingProgress: progress,
        walletsUsed: details?.walletsUsed,
        totalFunds: details?.totalFunds,
      },
    };

    this.emitTokenLaunchEvent(mixingEvent);
  }

  // Emit worker progress updates
  emitWorkerProgress(event: WorkerProgressEvent): void {
    if (!this.io || !this.isInitialized) {
      botLogger.warn(
        "Socket.IO server not initialized, cannot emit worker progress"
      );
      return;
    }

    try {
      // Emit to user-specific room
      this.io.to(`user_${event.userId}`).emit("worker_progress", event);

      // Emit to admin room
      this.io.to("admin_launches").emit("worker_progress", event);

      botLogger.info(
        `📊 Emitted ${event.workerType} progress for token ${event.tokenAddress.slice(0, 8)}... - Phase ${event.phase}/${event.totalPhases}: ${event.phaseTitle}`
      );
    } catch (error) {
      botLogger.error("Failed to emit worker progress:", error);
    }
  }

  // Emit worker step updates
  emitWorkerStep(event: WorkerStepEvent): void {
    if (!this.io || !this.isInitialized) {
      botLogger.warn(
        "Socket.IO server not initialized, cannot emit worker step"
      );
      return;
    }

    try {
      // Emit to user-specific room
      this.io.to(`user_${event.userId}`).emit("worker_step", event);

      // Emit to admin room
      this.io.to("admin_launches").emit("worker_step", event);

      botLogger.info(
        `📝 Emitted ${event.workerType} step for token ${event.tokenAddress.slice(0, 8)}... - Step ${event.stepNumber}/${event.totalSteps}: ${event.step}`
      );
    } catch (error) {
      botLogger.error("Failed to emit worker step:", error);
    }
  }

  // Emit error events
  emitLaunchError(
    tokenAddress: string,
    userId: string,
    error: string,
    stage: string
  ): void {
    if (!this.io || !this.isInitialized) return;

    const errorEvent: TokenLaunchEvent = {
      tokenAddress,
      platform: "pump", // or detect platform
      name: "Unknown",
      symbol: "UNK",
      timestamp: Date.now(),
      userId,
      stage: "created", // Keep current stage
      stepNumber: 0,
      totalSteps: 4,
      message: `Error during ${stage}`,
      error: {
        message: error,
        stage,
      },
    };

    this.emitTokenLaunchEvent(errorEvent);
  }

  // Get connected clients count
  getConnectedClientsCount(): number {
    return this.io ? this.io.sockets.sockets.size : 0;
  }

  // Clean shutdown
  async shutdown(): Promise<void> {
    if (this.io) {
      this.io.close();
      botLogger.info("🔌 Socket.IO server closed");
    }

    if (this.httpServer) {
      this.httpServer.close();
      botLogger.info("🔌 HTTP server closed");
    }

    this.isInitialized = false;
  }
}

// Singleton instance
export const socketIOServer = new SocketIOServer(
  parseInt(process.env.WEBSOCKET_PORT || "3001")
);

// Helper functions for easy use throughout the app
export const emitTokenCreated = (
  tokenAddress: string,
  platform: "pump" | "bonk",
  userId: string,
  name: string,
  symbol: string
) => {
  socketIOServer.emitTokenLaunchEvent({
    tokenAddress,
    platform,
    name,
    symbol,
    timestamp: Date.now(),
    userId,
    stage: "created",
    stepNumber: 1,
    totalSteps: 4,
    message: `Token ${symbol} created successfully`,
  });
};

export const emitTokenLaunched = (
  tokenAddress: string,
  platform: "pump" | "bonk",
  userId: string,
  name: string,
  symbol: string,
  launchData?: LaunchData
) => {
  socketIOServer.emitTokenLaunchEvent({
    tokenAddress,
    platform,
    name,
    symbol,
    timestamp: Date.now(),
    userId,
    stage: "launched",
    stepNumber: 2,
    totalSteps: 4,
    message: `Token ${symbol} launched on ${platform}!`,
    launchData,
  });
};

export const emitMixingStarted = (
  tokenAddress: string,
  platform: "pump" | "bonk",
  userId: string,
  name: string,
  symbol: string
) => {
  socketIOServer.emitTokenLaunchEvent({
    tokenAddress,
    platform,
    name,
    symbol,
    timestamp: Date.now(),
    userId,
    stage: "mixing_started",
    stepNumber: 3,
    totalSteps: 4,
    message: `Starting fund mixing for ${symbol}...`,
  });
};

export const emitMixingCompleted = (
  tokenAddress: string,
  platform: "pump" | "bonk",
  userId: string,
  name: string,
  symbol: string,
  mixingData?: MixingData
) => {
  socketIOServer.emitTokenLaunchEvent({
    tokenAddress,
    platform,
    name,
    symbol,
    timestamp: Date.now(),
    userId,
    stage: "mixing_completed",
    stepNumber: 4,
    totalSteps: 4,
    message: `Fund mixing completed for ${symbol}!`,
    mixingData,
  });
};

export const emitTokenFullyReady = (
  tokenAddress: string,
  platform: "pump" | "bonk",
  userId: string,
  name: string,
  symbol: string
) => {
  socketIOServer.emitTokenLaunchEvent({
    tokenAddress,
    platform,
    name,
    symbol,
    timestamp: Date.now(),
    userId,
    stage: "fully_ready",
    stepNumber: 4,
    totalSteps: 4,
    message: `🚀 ${symbol} is fully ready for trading!`,
  });
};

export const emitLaunchError = (
  tokenAddress: string,
  userId: string,
  error: string,
  stage: string
) => {
  socketIOServer.emitLaunchError(tokenAddress, userId, error, stage);
};

// Worker progress tracking helpers
export const emitWorkerProgress = (
  jobId: string,
  workerType: WorkerProgressEvent["workerType"],
  tokenAddress: string,
  userId: string,
  userChatId: number,
  phase: number,
  totalPhases: number,
  phaseTitle: string,
  phaseDescription: string,
  progress: number,
  status: WorkerProgressEvent["status"],
  details?: WorkerProgressEvent["details"]
) => {
  socketIOServer.emitWorkerProgress({
    jobId,
    workerType,
    tokenAddress,
    userId,
    userChatId,
    phase,
    totalPhases,
    phaseTitle,
    phaseDescription,
    progress,
    status,
    timestamp: Date.now(),
    details,
  });
};

export const emitWorkerStep = (
  jobId: string,
  workerType: string,
  tokenAddress: string,
  userId: string,
  step: string,
  stepNumber: number,
  totalSteps: number,
  message: string,
  data?: unknown
) => {
  socketIOServer.emitWorkerStep({
    jobId,
    workerType,
    tokenAddress,
    userId,
    step,
    stepNumber,
    totalSteps,
    message,
    timestamp: Date.now(),
    data,
  });
};
