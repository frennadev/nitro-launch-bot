/**
 * Frontend Integration Examples for External Buy System
 * Complete React, Vue, and Vanilla JavaScript examples for external token purchases
 */

// ================================
// 1. REACT HOOK FOR EXTERNAL BUYS
// ================================

import { useState, useEffect, useCallback } from "react";
import { io, Socket } from "socket.io-client";

interface ExternalBuyProgress {
  jobId: string;
  tokenAddress: string;
  userId: string;
  phase: number;
  totalPhases: number;
  phaseTitle: string;
  phaseDescription: string;
  progress: number;
  status: "started" | "in_progress" | "completed" | "failed";
  buyAmount: number;
  details?: {
    currentOperation?: string;
    estimatedTimeRemaining?: number;
    error?: string;
    transactionSignature?: string;
    platform?: string;
    actualSolSpent?: string;
  };
}

interface ExternalBuyResult {
  jobId: string;
  success: boolean;
  buyAmount: number;
  actualSolSpent: number;
  transactionSignature: string;
  platform: string;
  error?: string;
}

interface StartExternalBuyRequest {
  tokenAddress: string;
  buyAmount: number;
  walletPrivateKey: string;
  slippage?: number;
  priorityFee?: number;
  platform?: string;
}

export function useExternalBuy(
  userId: string,
  backendUrl: string = "http://localhost:3001"
) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [progress, setProgress] = useState<ExternalBuyProgress | null>(null);
  const [result, setResult] = useState<ExternalBuyResult | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(backendUrl, {
      transports: ["websocket", "polling"],
    });

    newSocket.on("connect", () => {
      console.log("✅ Connected to external buy server");
      setIsConnected(true);
      setError(null);

      // Join user room for progress updates
      newSocket.emit("join_room", `user_${userId}`);
    });

    newSocket.on("disconnect", () => {
      console.log("❌ Disconnected from external buy server");
      setIsConnected(false);
    });

    newSocket.on("connect_error", (err) => {
      console.error("🚨 Connection error:", err);
      setError("Failed to connect to server");
      setIsConnected(false);
    });

    // Listen for external buy progress updates
    newSocket.on(
      "external_buy_progress",
      (progressData: ExternalBuyProgress) => {
        if (progressData.userId === userId) {
          console.log("📊 External buy progress:", progressData);
          setProgress(progressData);

          if (progressData.status === "failed") {
            setError(progressData.details?.error || "External buy failed");
          }
        }
      }
    );

    // Listen for external buy results
    newSocket.on("external_buy_result", (resultData: ExternalBuyResult) => {
      console.log("🎯 External buy result:", resultData);
      setResult(resultData);
      setIsLoading(false);

      if (!resultData.success) {
        setError(resultData.error || "External buy failed");
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.close();
    };
  }, [userId, backendUrl]);

  // Start external buy operation
  const startExternalBuy = useCallback(
    async (request: StartExternalBuyRequest) => {
      if (!socket || !isConnected) {
        setError("Not connected to server");
        return null;
      }

      setIsLoading(true);
      setError(null);
      setProgress(null);
      setResult(null);

      try {
        const response = await fetch(`${backendUrl}/api/external-buy/start`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId,
            userChatId: parseInt(userId) || Math.floor(Math.random() * 1000000),
            ...request,
            socketUserId: `user_${userId}`,
          }),
        });

        const data = await response.json();

        if (data.success) {
          console.log("🚀 External buy started:", data.jobId);
          return data.jobId;
        } else {
          setError(data.error || "Failed to start external buy");
          setIsLoading(false);
          return null;
        }
      } catch (err: any) {
        setError(err.message || "Failed to start external buy");
        setIsLoading(false);
        return null;
      }
    },
    [socket, isConnected, userId, backendUrl]
  );

  // Get job status
  const getJobStatus = useCallback(
    async (jobId: string) => {
      try {
        const response = await fetch(
          `${backendUrl}/api/external-buy/job/${jobId}/status`
        );
        const data = await response.json();
        return data.success ? data.data : null;
      } catch (err) {
        console.error("Failed to get job status:", err);
        return null;
      }
    },
    [backendUrl]
  );

  // Cancel job
  const cancelJob = useCallback(
    async (jobId: string) => {
      try {
        const response = await fetch(
          `${backendUrl}/api/external-buy/job/${jobId}/cancel`,
          {
            method: "POST",
          }
        );
        const data = await response.json();
        return data.success;
      } catch (err) {
        console.error("Failed to cancel job:", err);
        return false;
      }
    },
    [backendUrl]
  );

  return {
    // State
    isConnected,
    isLoading,
    progress,
    result,
    error,

    // Actions
    startExternalBuy,
    getJobStatus,
    cancelJob,
  };
}

// ================================
// 2. REACT PROGRESS COMPONENT
// ================================

interface ExternalBuyProgressTrackerProps {
  progress: ExternalBuyProgress;
  onCancel?: () => void;
}

export function ExternalBuyProgressTracker({
  progress,
  onCancel,
}: ExternalBuyProgressTrackerProps) {
  const getStatusColor = () => {
    switch (progress.status) {
      case "started":
      case "in_progress":
        return "#3B82F6"; // Blue
      case "completed":
        return "#10B981"; // Green
      case "failed":
        return "#EF4444"; // Red
      default:
        return "#6B7280"; // Gray
    }
  };

  const getStatusIcon = () => {
    switch (progress.status) {
      case "started":
      case "in_progress":
        return "⏳";
      case "completed":
        return "✅";
      case "failed":
        return "❌";
      default:
        return "⚪";
    }
  };

  return (
    <div className="external-buy-progress">
      <div className="progress-header">
        <h3>{getStatusIcon()} External Token Purchase</h3>
        <div className="progress-meta">
          <span className="token-address">
            Token: {progress.tokenAddress.slice(0, 6)}...
            {progress.tokenAddress.slice(-6)}
          </span>
          <span className="buy-amount">
            Amount: {progress.buyAmount.toFixed(6)} SOL
          </span>
        </div>
      </div>

      <div className="progress-content">
        <div className="phase-info">
          <div className="phase-title">{progress.phaseTitle}</div>
          <div className="phase-description">{progress.phaseDescription}</div>
          <div className="phase-counter">
            Phase {progress.phase} of {progress.totalPhases}
          </div>
        </div>

        <div className="progress-bar-container">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${progress.progress}%`,
                backgroundColor: getStatusColor(),
              }}
            />
          </div>
          <div className="progress-text">{progress.progress}%</div>
        </div>

        {progress.details?.currentOperation && (
          <div className="current-operation">
            <span className="operation-label">Current:</span>
            <span className="operation-text">
              {progress.details.currentOperation}
            </span>
          </div>
        )}

        {progress.details?.estimatedTimeRemaining && (
          <div className="time-remaining">
            <span className="time-label">ETA:</span>
            <span className="time-text">
              {Math.round(progress.details.estimatedTimeRemaining / 1000)}s
            </span>
          </div>
        )}

        {progress.status === "completed" &&
          progress.details?.transactionSignature && (
            <div className="success-details">
              <div className="transaction-info">
                <span className="tx-label">Transaction:</span>
                <a
                  href={`https://solscan.io/tx/${progress.details.transactionSignature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tx-link"
                >
                  {progress.details.transactionSignature.slice(0, 8)}...
                </a>
              </div>
              {progress.details.platform && (
                <div className="platform-info">
                  <span className="platform-label">Platform:</span>
                  <span className="platform-text">
                    {progress.details.platform}
                  </span>
                </div>
              )}
              {progress.details.actualSolSpent && (
                <div className="spent-info">
                  <span className="spent-label">Spent:</span>
                  <span className="spent-text">
                    {progress.details.actualSolSpent} SOL
                  </span>
                </div>
              )}
            </div>
          )}

        {progress.status === "failed" && progress.details?.error && (
          <div className="error-details">
            <span className="error-label">Error:</span>
            <span className="error-text">{progress.details.error}</span>
          </div>
        )}

        {(progress.status === "started" || progress.status === "in_progress") &&
          onCancel && (
            <div className="progress-actions">
              <button onClick={onCancel} className="cancel-button">
                Cancel Purchase
              </button>
            </div>
          )}
      </div>
    </div>
  );
}

// ================================
// 3. COMPLETE REACT EXAMPLE
// ================================

export function ExternalBuyExample() {
  const userId = "user123"; // Your user ID
  const {
    isConnected,
    isLoading,
    progress,
    result,
    error,
    startExternalBuy,
    cancelJob,
  } = useExternalBuy(userId);

  const [tokenAddress, setTokenAddress] = useState("");
  const [buyAmount, setBuyAmount] = useState("0.1");
  const [walletPrivateKey, setWalletPrivateKey] = useState("");
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  const handleStartBuy = async () => {
    if (!tokenAddress || !buyAmount || !walletPrivateKey) {
      alert("Please fill in all fields");
      return;
    }

    const jobId = await startExternalBuy({
      tokenAddress,
      buyAmount: parseFloat(buyAmount),
      walletPrivateKey,
      slippage: 3,
      priorityFee: 0.002,
    });

    if (jobId) {
      setCurrentJobId(jobId);
    }
  };

  const handleCancel = async () => {
    if (currentJobId) {
      const success = await cancelJob(currentJobId);
      if (success) {
        alert("Purchase cancelled");
        setCurrentJobId(null);
      }
    }
  };

  return (
    <div className="external-buy-example">
      <h2>External Token Purchase</h2>

      <div className="connection-status">
        Status: {isConnected ? "🟢 Connected" : "🔴 Disconnected"}
      </div>

      {!isLoading && !progress && (
        <div className="buy-form">
          <div className="form-group">
            <label>Token Address:</label>
            <input
              type="text"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
              placeholder="Enter Solana token address"
            />
          </div>

          <div className="form-group">
            <label>Buy Amount (SOL):</label>
            <input
              type="number"
              value={buyAmount}
              onChange={(e) => setBuyAmount(e.target.value)}
              placeholder="0.1"
              step="0.001"
            />
          </div>

          <div className="form-group">
            <label>Wallet Private Key:</label>
            <input
              type="password"
              value={walletPrivateKey}
              onChange={(e) => setWalletPrivateKey(e.target.value)}
              placeholder="Your wallet private key"
            />
          </div>

          <button
            onClick={handleStartBuy}
            disabled={!isConnected}
            className="start-buy-button"
          >
            Start Purchase
          </button>
        </div>
      )}

      {progress && (
        <ExternalBuyProgressTracker
          progress={progress}
          onCancel={currentJobId ? handleCancel : undefined}
        />
      )}

      {result && (
        <div className="buy-result">
          <h3>
            {result.success ? "✅ Purchase Successful!" : "❌ Purchase Failed"}
          </h3>
          {result.success ? (
            <div className="success-details">
              <p>Transaction: {result.transactionSignature}</p>
              <p>Platform: {result.platform}</p>
              <p>Amount Spent: {result.actualSolSpent} SOL</p>
            </div>
          ) : (
            <div className="error-details">
              <p>Error: {result.error}</p>
            </div>
          )}
        </div>
      )}

      {error && <div className="error-message">❌ {error}</div>}
    </div>
  );
}

// ================================
// 4. CSS STYLES
// ================================

export const externalBuyStyles = `
.external-buy-progress {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 20px;
  margin: 16px 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}

.progress-header {
  margin-bottom: 16px;
}

.progress-header h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  color: #1a202c;
}

.progress-meta {
  display: flex;
  gap: 16px;
  font-size: 14px;
  color: #4a5568;
}

.progress-content {
  space-y: 16px;
}

.phase-info {
  margin-bottom: 16px;
}

.phase-title {
  font-size: 16px;
  font-weight: 500;
  color: #2d3748;
  margin-bottom: 4px;
}

.phase-description {
  font-size: 14px;
  color: #4a5568;
  margin-bottom: 8px;
}

.phase-counter {
  font-size: 12px;
  color: #718096;
  font-weight: 500;
}

.progress-bar-container {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.progress-bar {
  flex: 1;
  height: 8px;
  background-color: #e2e8f0;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  transition: width 0.3s ease, background-color 0.3s ease;
}

.progress-text {
  font-size: 14px;
  font-weight: 500;
  color: #4a5568;
  min-width: 40px;
}

.current-operation, .time-remaining {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  margin-bottom: 8px;
}

.operation-label, .time-label, .tx-label, .platform-label, .spent-label, .error-label {
  font-weight: 500;
  color: #4a5568;
}

.success-details, .error-details {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.2);
  border-radius: 6px;
  padding: 12px;
  margin-top: 16px;
}

.error-details {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.2);
}

.tx-link {
  color: #3182ce;
  text-decoration: none;
  font-family: monospace;
}

.tx-link:hover {
  text-decoration: underline;
}

.progress-actions {
  margin-top: 16px;
}

.cancel-button {
  background: #e53e3e;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.cancel-button:hover {
  background: #c53030;
}

.external-buy-example {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
}

.connection-status {
  background: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 20px;
  font-size: 14px;
}

.buy-form {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
  color: #2d3748;
}

.form-group input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.form-group input:focus {
  outline: none;
  border-color: #3182ce;
  box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1);
}

.start-buy-button {
  background: #3182ce;
  color: white;
  border: none;
  border-radius: 6px;
  padding: 12px 24px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.start-buy-button:hover:not(:disabled) {
  background: #2c5aa0;
}

.start-buy-button:disabled {
  background: #a0aec0;
  cursor: not-allowed;
}

.buy-result {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.error-message {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 6px;
  padding: 12px;
  color: #c53030;
  margin-top: 16px;
}
`;
