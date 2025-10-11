import { Connection, PublicKey } from "@solana/web3.js";
import type { TransactionSignature, TransactionConfirmationStatus } from "@solana/web3.js";
import { logger } from "./logger";
import { env } from "../../config";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface ConnectionPoolConfig {
  endpoints: string[];
  maxRequestsPerSecond: number;
  maxTransactionsPerSecond: number;
  cacheConfig: {
    balanceTTL: number;
    blockhashTTL: number;
    accountInfoTTL: number;
    signatureStatusTTL: number;
  };
}

interface RequestQueue {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  fn: () => Promise<any>;
  type: 'read' | 'transaction';
}

export class SolanaConnectionPool {
  private connections: Connection[];
  private currentConnectionIndex: number = 0;
  private requestQueue: RequestQueue[] = [];
  private transactionQueue: RequestQueue[] = [];
  private isProcessingRequests: boolean = false;
  private isProcessingTransactions: boolean = false;
  
  // Rate limiting
  private requestCount: number = 0;
  private transactionCount: number = 0;
  private lastRequestReset: number = Date.now();
  private lastTransactionReset: number = Date.now();
  
  // Caching
  private cache: Map<string, CacheEntry<any>> = new Map();
  
  private config: ConnectionPoolConfig;

  constructor(config?: Partial<ConnectionPoolConfig>) {
    this.config = {
      endpoints: [env.HELIUS_MIXER_RPC_URL, env.HELIUS_BACKUP_RPC_URL], // Use multiple RPC endpoints for rate limit distribution
      maxRequestsPerSecond: 195, // Increase from 180 (more aggressive)
      maxTransactionsPerSecond: 48, // Increase from 45 (more aggressive)
      cacheConfig: {
        balanceTTL: 1000, // Balanced updates: 1 second
        blockhashTTL: 2000, // Balanced blockhashes: 2 seconds
        accountInfoTTL: 1000, // Balanced account info: 1 second
        signatureStatusTTL: 500, // Balanced confirmation: 500ms
      },
      ...config,
    };

    // Initialize connections with optimized settings
    this.connections = this.config.endpoints.map(endpoint => 
      new Connection(endpoint, { 
        commitment: "processed", // Use "processed" instead of "confirmed" for speed
        confirmTransactionInitialTimeout: 30000, // 30s timeout
        disableRetryOnRateLimit: false,
        httpHeaders: {
          'Content-Type': 'application/json',
        }
      })
    );

    logger.info(`Initialized optimized connection pool with ${this.connections.length} endpoints for rate limit distribution`);
    
    // Start rate limit reset timers
    this.startRateLimitResetTimers();
    
    // Start queue processors
    this.processRequestQueue();
    this.processTransactionQueue();
  }

  private startRateLimitResetTimers() {
    // Reset request counter every second
    setInterval(() => {
      this.requestCount = 0;
      this.lastRequestReset = Date.now();
    }, 1000);

    // Reset transaction counter every second
    setInterval(() => {
      this.transactionCount = 0;
      this.lastTransactionReset = Date.now();
    }, 1000);
  }

  private async processRequestQueue() {
    if (this.isProcessingRequests) return;
    this.isProcessingRequests = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();
      
      // Reset rate limit counter if needed
      if (now - this.lastRequestReset >= 1000) {
        this.requestCount = 0;
        this.lastRequestReset = now;
      }

      // Check rate limit
      if (this.requestCount >= this.config.maxRequestsPerSecond) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      const request = this.requestQueue.shift();
      if (!request) break;

      try {
        this.requestCount++;
        const result = await this.executeWithRetry(request.fn);
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }
    }

    this.isProcessingRequests = false;
  }

  private async processTransactionQueue() {
    if (this.isProcessingTransactions) return;
    this.isProcessingTransactions = true;

    while (this.transactionQueue.length > 0) {
      const now = Date.now();
      
      // Reset rate limit counter if needed
      if (now - this.lastTransactionReset >= 1000) {
        this.transactionCount = 0;
        this.lastTransactionReset = now;
      }

      // Check rate limit
      if (this.transactionCount >= this.config.maxTransactionsPerSecond) {
        await new Promise(resolve => setTimeout(resolve, 200));
        continue;
      }

      const request = this.transactionQueue.shift();
      if (!request) break;

      try {
        this.transactionCount++;
        const result = await this.executeWithRetry(request.fn, 2); // Fewer retries for transactions
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }
    }

    this.isProcessingTransactions = false;
  }

  private getNextConnection(): Connection {
    // Health check connections and remove failed ones
    this.connections = this.connections.filter(conn => {
      try {
        // Simple check - if connection object is still valid
        return conn && typeof conn.getBalance === 'function';
      } catch {
        return false;
      }
    });

    if (this.connections.length === 0) {
      throw new Error('No healthy RPC connections available');
    }

    const connection = this.connections[this.currentConnectionIndex];
    this.currentConnectionIndex = (this.currentConnectionIndex + 1) % this.connections.length;
    return connection;
  }

  private getCacheKey(method: string, ...args: any[]): string {
    return `${method}:${JSON.stringify(args)}`;
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  private setCache<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  }

  private async queueRequest<T>(fn: () => Promise<T>, type: 'read' | 'transaction' = 'read'): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestItem: RequestQueue = { resolve, reject, fn, type };
      
      if (type === 'transaction') {
        this.transactionQueue.push(requestItem);
        if (!this.isProcessingTransactions) {
          this.processTransactionQueue();
        }
      } else {
        this.requestQueue.push(requestItem);
        if (!this.isProcessingRequests) {
          this.processRequestQueue();
        }
      }
    });
  }

  private async executeWithRetry<T>(fn: () => Promise<T>, maxRetries: number = 3): Promise<T> {
    let lastError: Error = new Error('Unknown error');
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          throw error;
        }
        
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
          logger.warn(`Connection pool: Request failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    logger.error(`Connection pool: Request failed after ${maxRetries} attempts: ${lastError.message}`);
    throw lastError;
  }

  private isNonRetryableError(error: any): boolean {
    // Don't retry on these types of errors
    const nonRetryableMessages = [
      'Invalid signature',
      'Transaction simulation failed',
      'Blockhash not found',
      'Account not found',
      'Invalid account data',
    ];
    
    return nonRetryableMessages.some(msg => 
      error.message?.toLowerCase().includes(msg.toLowerCase())
    );
  }

  // Cached balance checking
  async getBalance(publicKey: PublicKey): Promise<number> {
    const cacheKey = this.getCacheKey('getBalance', publicKey.toBase58());
    const cached = this.getFromCache<number>(cacheKey);
    
    if (cached !== null) {
      return cached;
    }

    const balance = await this.queueRequest(async () => {
      const connection = this.getNextConnection();
      return await connection.getBalance(publicKey);
    });

    this.setCache(cacheKey, balance, this.config.cacheConfig.balanceTTL);
    return balance;
  }

  // Cached blockhash fetching
  async getLatestBlockhash(commitment: any = "confirmed"): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    const cacheKey = this.getCacheKey('getLatestBlockhash', commitment);
    const cached = this.getFromCache<{ blockhash: string; lastValidBlockHeight: number }>(cacheKey);
    
    if (cached !== null) {
      return cached;
    }

    const blockhash = await this.queueRequest(async () => {
      const connection = this.getNextConnection();
      return await connection.getLatestBlockhash(commitment);
    });

    this.setCache(cacheKey, blockhash, this.config.cacheConfig.blockhashTTL);
    return blockhash;
  }

  // Cached account info
  async getAccountInfo(publicKey: PublicKey, commitment: any = "confirmed"): Promise<any> {
    const cacheKey = this.getCacheKey('getAccountInfo', publicKey.toBase58(), commitment);
    const cached = this.getFromCache<any>(cacheKey);
    
    if (cached !== null) {
      return cached;
    }
    
    const accountInfo = await this.queueRequest(async () => {
      const connection = this.getNextConnection();
      return await connection.getAccountInfo(publicKey, commitment);
    });
    
    this.setCache(cacheKey, accountInfo, this.config.cacheConfig.accountInfoTTL);
    return accountInfo;
  }

  // Cached token account balance
  async getTokenAccountBalance(publicKey: PublicKey, commitment: any = "confirmed"): Promise<any> {
    const cacheKey = this.getCacheKey('getTokenAccountBalance', publicKey.toBase58(), commitment);
    const cached = this.getFromCache<any>(cacheKey);
    
    if (cached !== null) {
      return cached;
    }

    const balance = await this.queueRequest(async () => {
      const connection = this.getNextConnection();
      return await connection.getTokenAccountBalance(publicKey, commitment);
    });

    this.setCache(cacheKey, balance, this.config.cacheConfig.balanceTTL);
    return balance;
  }

  // Cached parsed token accounts
  async getParsedTokenAccountsByOwner(owner: PublicKey, filter: any, commitment: any = "confirmed"): Promise<any> {
    const cacheKey = this.getCacheKey('getParsedTokenAccountsByOwner', owner.toBase58(), JSON.stringify(filter), commitment);
    const cached = this.getFromCache<any>(cacheKey);
    
    if (cached !== null) {
      return cached;
    }

    const accounts = await this.queueRequest(async () => {
      const connection = this.getNextConnection();
      return await connection.getParsedTokenAccountsByOwner(owner, filter, commitment);
    });

    this.setCache(cacheKey, accounts, this.config.cacheConfig.balanceTTL);
    return accounts;
  }

  // Transaction sending (rate limited)
  async sendTransaction(transaction: any, options?: any): Promise<TransactionSignature> {
    return await this.queueRequest(async () => {
      const connection = this.getNextConnection();
      return await connection.sendTransaction(transaction, options);
    }, 'transaction');
  }

  // Optimized signature status checking with caching
  async getSignatureStatuses(signatures: TransactionSignature[], config?: any): Promise<any> {
    const cacheKey = this.getCacheKey('getSignatureStatuses', signatures, JSON.stringify(config));
    const cached = this.getFromCache<any>(cacheKey);
    
    if (cached !== null) {
      return cached;
    }

    const statuses = await this.queueRequest(async () => {
      const connection = this.getNextConnection();
      return await connection.getSignatureStatuses(signatures, config);
    });

    // Only cache successful status checks for a short time
    if (statuses && statuses.value && statuses.value.some((status: any) => status !== null)) {
      this.setCache(cacheKey, statuses, this.config.cacheConfig.signatureStatusTTL);
    }

    return statuses;
  }

  // Batch balance checking for multiple wallets
  async getBatchBalances(publicKeys: PublicKey[]): Promise<number[]> {
    const cacheKey = this.getCacheKey('getBatchBalances', publicKeys.map(pk => pk.toBase58()));
    const cached = this.getFromCache<number[]>(cacheKey);
    
    if (cached !== null) {
      return cached;
    }

    // Check individual caches first
    const results: (number | null)[] = publicKeys.map(pk => {
      const individualCacheKey = this.getCacheKey('getBalance', pk.toBase58());
      return this.getFromCache<number>(individualCacheKey);
    });

    const uncachedIndices: number[] = [];
    const uncachedKeys: PublicKey[] = [];

    results.forEach((result, index) => {
      if (result === null) {
        uncachedIndices.push(index);
        uncachedKeys.push(publicKeys[index]);
      }
    });

    if (uncachedKeys.length > 0) {
      const uncachedBalances = await this.queueRequest(async () => {
        const connection = this.getNextConnection();
        const balancePromises = uncachedKeys.map(pk => connection.getBalance(pk));
        return await Promise.all(balancePromises);
      });

      // Update results and cache individual balances
      uncachedIndices.forEach((originalIndex, uncachedIndex) => {
        const balance = uncachedBalances[uncachedIndex];
        results[originalIndex] = balance;
        
        // Cache individual balance
        const individualCacheKey = this.getCacheKey('getBalance', publicKeys[originalIndex].toBase58());
        this.setCache(individualCacheKey, balance, this.config.cacheConfig.balanceTTL);
      });
    }

    const finalResults = results as number[];
    this.setCache(cacheKey, finalResults, this.config.cacheConfig.balanceTTL);
    return finalResults;
  }

  // Get connection for direct access (when needed)
  getConnection(): Connection {
    return this.getNextConnection();
  }

  // Get pool statistics
  getPoolStats() {
    return {
      connections: this.connections.length,
      requestQueueLength: this.requestQueue.length,
      transactionQueueLength: this.transactionQueue.length,
      requestCount: this.requestCount,
      transactionCount: this.transactionCount,
      cacheSize: this.cache.size,
      rateLimits: {
        maxRequestsPerSecond: this.config.maxRequestsPerSecond,
        maxTransactionsPerSecond: this.config.maxTransactionsPerSecond,
      },
    };
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
    logger.info("Connection pool cache cleared");
  }

  // Add additional RPC endpoint
  addEndpoint(endpoint: string) {
    const connection = new Connection(endpoint, { commitment: "confirmed" });
    this.connections.push(connection);
    logger.info(`Added new RPC endpoint to pool: ${endpoint}`);
  }
}

// Create a singleton instance for general operations
export const connectionPool = new SolanaConnectionPool();

/**
 * Create a dedicated connection pool optimized for mixer operations
 * Uses the dedicated mixer RPC endpoint with aggressive optimization
 */
export function createMixerConnectionPool(): SolanaConnectionPool {
  return new SolanaConnectionPool({
    endpoints: [env.HELIUS_MIXER_RPC_URL, env.HELIUS_BACKUP_RPC_URL],
    maxRequestsPerSecond: 195, // Aggressive rate limiting for mixer
    maxTransactionsPerSecond: 48, // Aggressive transaction rate
          cacheConfig: {
        balanceTTL: 1000, // Balanced updates for mixer operations: 1 second
        blockhashTTL: 2000, // Balanced blockhashes for mixer: 2 seconds
        accountInfoTTL: 1000, // Balanced account info updates: 1 second
        signatureStatusTTL: 500, // Balanced confirmation checks: 500ms
      },
  });
}

/**
 * Singleton mixer connection pool instance
 */
export const mixerConnectionPool = createMixerConnectionPool(); 