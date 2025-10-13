// Worker Progress Tracking Demo
// This demonstrates how to connect to and receive worker progress events

import { io, Socket } from "socket.io-client";

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
    [key: string]: any;
  };
}

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
  data?: any;
}

// Connect to the Socket.IO server
const socket: Socket = io("http://localhost:3001");

// Example: Connect as a specific user
const userId = "YOUR_USER_ID_HERE";

socket.on("connect", () => {
  console.log("🔌 Connected to Socket.IO server");

  // Subscribe to user-specific events
  socket.emit("subscribe", `user_${userId}`);
  console.log(`📡 Subscribed to user_${userId} events`);
});

// Listen for worker progress events
socket.on("worker_progress", (event: WorkerProgressEvent) => {
  console.log("\n📊 WORKER PROGRESS UPDATE:");
  console.log(`  Job ID: ${event.jobId}`);
  console.log(`  Worker: ${event.workerType}`);
  console.log(`  Token: ${event.tokenAddress.slice(0, 8)}...`);
  console.log(
    `  Phase: ${event.phase}/${event.totalPhases} - ${event.phaseTitle}`
  );
  console.log(`  Progress: ${event.progress}%`);
  console.log(`  Status: ${event.status}`);
  console.log(`  Description: ${event.phaseDescription}`);

  if (event.details) {
    console.log(`  Details:`, event.details);
  }

  // Progress bar visualization
  const progressBar =
    "█".repeat(Math.floor(event.progress / 5)) +
    "░".repeat(20 - Math.floor(event.progress / 5));
  console.log(`  [${progressBar}] ${event.progress}%`);
});

// Listen for worker step events
socket.on("worker_step", (event: WorkerStepEvent) => {
  console.log("\n📝 WORKER STEP UPDATE:");
  console.log(`  Job ID: ${event.jobId}`);
  console.log(`  Worker: ${event.workerType}`);
  console.log(
    `  Step: ${event.stepNumber}/${event.totalSteps} - ${event.step}`
  );
  console.log(`  Message: ${event.message}`);
  console.log(`  Token: ${event.tokenAddress.slice(0, 8)}...`);
});

// Listen for token launch events (existing system)
socket.on("token_launch_event", (event: any) => {
  console.log("\n🚀 TOKEN LAUNCH EVENT:");
  console.log(`  Stage: ${event.stage}`);
  console.log(`  Token: ${event.name} (${event.symbol})`);
  console.log(`  Address: ${event.tokenAddress.slice(0, 8)}...`);
  console.log(`  Step: ${event.stepNumber}/${event.totalSteps}`);
  console.log(`  Message: ${event.message}`);
});

socket.on("disconnect", () => {
  console.log("❌ Disconnected from Socket.IO server");
});

socket.on("error", (error) => {
  console.error("🚨 Socket.IO Error:", error);
});

console.log("🎯 Worker Progress Tracking Demo Started");
console.log("📡 Connecting to Socket.IO server at http://localhost:3001");
console.log(`👤 Listening for events for user: ${userId}`);
console.log("\n--- Waiting for events ---\n");

// Keep the process running
process.on("SIGINT", () => {
  console.log("\n👋 Disconnecting...");
  socket.disconnect();
  process.exit(0);
});
