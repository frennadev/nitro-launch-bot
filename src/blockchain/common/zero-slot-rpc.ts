import { Connection, VersionedTransaction, TransactionSignature, PublicKey, SystemProgram, Keypair, TransactionInstruction } from "@solana/web3.js";
import { logger } from "./logger";
import { env } from "../../config";
import axios from "axios";

interface ZeroSlotConfig {
  apiKey: string;
  endpoints: string[];
  fallbackRpcUrl: string;
  maxRetries: number;
  rateLimitPerSecond: number;
  paymentWallets: string[];
  minPaymentAmount: number; // 0.001 SOL in lamports
}

interface ZeroSlotResponse {
  id: string;
  jsonrpc: string;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

export class ZeroSlotRPC {
  private config: ZeroSlotConfig;
  private fallbackConnection: Connection;
  private requestCount: number = 0;
  private lastReset: number = Date.now();
  private currentEndpointIndex: number = 0;

  constructor(config?: Partial<ZeroSlotConfig>) {
    this.config = {
      apiKey: "cfd004f5be7c4ec28d467cf0fa46e492",
      endpoints: [
        "http://de1.0slot.trade", // Frankfurt (primary)
        "http://ams1.0slot.trade" // Amsterdam (secondary)
      ],
      fallbackRpcUrl: env.HELIUS_RPC_URL,
      maxRetries: 2,
      rateLimitPerSecond: 5, // Zero Slot allows max 5 calls per second
      paymentWallets: [
        "Eb2KpSC8uMt9GmzyAEm5Eb1AAAgTjRaXWFjKyFXHZxF3",
        "FCjUJZ1qozm1e8romw216qyfQMaaWKxWsuySnumVCCNe",
        "ENxTEjSQ1YabmUpXAdCgevnHQ9MHdLv8tzFiuiYJqa13",
        "6rYLG55Q9RpsPGvqdPNJs4z5WTxJVatMB8zV3WJhs5EK",
        "Cix2bHfqPcKcM233mzxbLk14kSggUUiz2A87fJtGivXr"
      ],
      minPaymentAmount: 1000000, // 0.001 SOL in lamports
      ...config,
    };

    // Initialize fallback connection
    this.fallbackConnection = new Connection(this.config.fallbackRpcUrl, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 30000,
    });

    logger.info("Initialized Zero Slot RPC with fallback to Helius");
    
    // Start rate limit reset timer
    this.startRateLimitTimer();
  }

  private startRateLimitTimer() {
    setInterval(() => {
      this.requestCount = 0;
      this.lastReset = Date.now();
    }, 1000);
  }

  private async waitForRateLimit() {
    const now = Date.now();
    
    // Reset counter if needed
    if (now - this.lastReset >= 1000) {
      this.requestCount = 0;
      this.lastReset = now;
    }

    // Wait if we've hit the rate limit
    if (this.requestCount >= this.config.rateLimitPerSecond) {
      const waitTime = 1000 - (now - this.lastReset);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        this.requestCount = 0;
        this.lastReset = Date.now();
      }
    }
  }

  private getNextEndpoint(): string {
    const endpoint = this.config.endpoints[this.currentEndpointIndex];
    this.currentEndpointIndex = (this.currentEndpointIndex + 1) % this.config.endpoints.length;
    return endpoint;
  }

  private getRandomPaymentWallet(): string {
    const randomIndex = Math.floor(Math.random() * this.config.paymentWallets.length);
    return this.config.paymentWallets[randomIndex];
  }

  /**
   * Adds a payment instruction to the transaction for Zero Slot staked_conn usage
   * This instruction transfers 0.001 SOL to one of the required payment wallets
   */
  public addPaymentInstruction(
    transaction: VersionedTransaction,
    payerPublicKey: PublicKey
  ): TransactionInstruction {
    const paymentWallet = this.getRandomPaymentWallet();
    const paymentInstruction = SystemProgram.transfer({
      fromPubkey: payerPublicKey,
      toPubkey: new PublicKey(paymentWallet),
      lamports: this.config.minPaymentAmount,
    });

    logger.info(`Added Zero Slot payment instruction: ${this.config.minPaymentAmount / 1e9} SOL to ${paymentWallet}`);
    return paymentInstruction;
  }

  /**
   * Sends a transaction using Zero Slot RPC with fallback to Helius
   * Only supports sendTransaction method as per Zero Slot requirements
   */
  public async sendTransaction(
    transaction: VersionedTransaction,
    options?: {
      skipPreflight?: boolean;
      preflightCommitment?: string;
      maxRetries?: number;
    }
  ): Promise<TransactionSignature> {
    const logId = `zero-slot-send-${Date.now()}`;
    
    try {
      // Try Zero Slot first
      const signature = await this.sendWithZeroSlot(transaction, options, logId);
      logger.info(`[${logId}]: Successfully sent transaction via Zero Slot: ${signature}`);
      return signature;
    } catch (zeroSlotError: any) {
      logger.warn(`[${logId}]: Zero Slot failed, falling back to Helius: ${zeroSlotError.message}`);
      
      try {
        // Fallback to Helius
        const signature = await this.fallbackConnection.sendTransaction(transaction, {
          skipPreflight: options?.skipPreflight ?? false,
          preflightCommitment: options?.preflightCommitment as any ?? "processed",
          maxRetries: options?.maxRetries ?? 3,
        });
        
        logger.info(`[${logId}]: Successfully sent transaction via Helius fallback: ${signature}`);
        return signature;
      } catch (heliusError: any) {
        logger.error(`[${logId}]: Both Zero Slot and Helius failed`);
        logger.error(`[${logId}]: Zero Slot error: ${zeroSlotError.message}`);
        logger.error(`[${logId}]: Helius error: ${heliusError.message}`);
        throw new Error(`Transaction failed on both Zero Slot and Helius: ${heliusError.message}`);
      }
    }
  }

  private async sendWithZeroSlot(
    transaction: VersionedTransaction,
    options?: any,
    logId?: string
  ): Promise<TransactionSignature> {
    await this.waitForRateLimit();
    this.requestCount++;

    const serializedTransaction = Buffer.from(transaction.serialize()).toString('base64');
    
    const payload = {
      id: logId || `zero-slot-${Date.now()}`,
      jsonrpc: "2.0",
      method: "sendTransaction",
      params: [
        serializedTransaction,
        {
          skipPreflight: options?.skipPreflight ?? false,
          preflightCommitment: options?.preflightCommitment ?? "processed",
          encoding: "base64",
          maxRetries: options?.maxRetries ?? 0,
        }
      ]
    };

    let lastError: Error;
    
    // Try each endpoint
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      const endpoint = this.getNextEndpoint();
      const url = `${endpoint}?api-key=${this.config.apiKey}`;
      
      try {
        logger.info(`[${logId}]: Attempting Zero Slot request to ${endpoint} (attempt ${attempt + 1})`);
        
        const response = await axios.post<ZeroSlotResponse>(url, payload, {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (response.data.error) {
          const error = response.data.error;
          
          // Handle specific Zero Slot errors
          if (error.code === 403) {
            if (error.message === "API key has expired") {
              throw new Error("Zero Slot API key has expired");
            } else if (error.message === "Invalid method") {
              throw new Error("Zero Slot only supports sendTransaction method");
            }
          } else if (error.code === 419) {
            throw new Error("Zero Slot rate limit exceeded");
          }
          
          throw new Error(`Zero Slot RPC error: ${error.message} (code: ${error.code})`);
        }

        if (response.data.result) {
          return response.data.result as TransactionSignature;
        }
        
        throw new Error("Zero Slot returned no result");
        
      } catch (error: any) {
        lastError = error;
        logger.warn(`[${logId}]: Zero Slot attempt ${attempt + 1} failed: ${error.message}`);
        
        // Don't retry on certain errors
        if (error.message.includes("API key has expired") || 
            error.message.includes("Invalid method") ||
            error.message.includes("Transaction simulation failed")) {
          break;
        }
        
        // Wait before retrying (except on last attempt)
        if (attempt < this.config.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError!;
  }

  /**
   * Health check for Zero Slot endpoints
   */
  public async healthCheck(): Promise<{ endpoint: string; healthy: boolean; responseTime?: number }[]> {
    const results = [];
    
    for (const endpoint of this.config.endpoints) {
      const start = Date.now();
      try {
        const response = await axios.get(`${endpoint}/health`, { timeout: 5000 });
        const responseTime = Date.now() - start;
        
        results.push({
          endpoint,
          healthy: response.status === 200,
          responseTime,
        });
      } catch (error) {
        results.push({
          endpoint,
          healthy: false,
        });
      }
    }
    
    return results;
  }

  /**
   * Get fallback connection for non-transaction operations
   */
  public getFallbackConnection(): Connection {
    return this.fallbackConnection;
  }
}

// Export singleton instance
export const zeroSlotRPC = new ZeroSlotRPC();