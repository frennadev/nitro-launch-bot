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
      endpoints: [env.HELIUS_RPC_URL],
      maxRequestsPerSecond: 180, // Leave some buffer from 200 limit
      maxTransactionsPerSecond: 45, // Leave some buffer from 50 limit
      cacheConfig: {
        balanceTTL: 5000, // 5 seconds
        blockhashTTL: 10000, // 10 seconds
        accountInfoTTL: 8000, // 8 seconds
        signatureStatusTTL: 2000, // 2 seconds
      },
      ...config,
    };

    // Initialize connections
    this.connections = this.config.endpoints.map(endpoint => 
      new Connection(endpoint, { commitment: "confirmed" })
    );

    logger.info(`Initialized connection pool with ${this.connections.length} endpoints`);
    
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

    while (true) {
      if (this.requestQueue.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
        continue;
      }

      if (this.requestCount >= this.config.maxRequestsPerSecond) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      const request = this.requestQueue.shift();
      if (!request) continue;

      try {
        this.requestCount++;
        const result = await request.fn();
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }
    }
  }

  private async processTransactionQueue() {
    if (this.isProcessingTransactions) return;
    this.isProcessingTransactions = true;

    while (true) {
      if (this.transactionQueue.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
        continue;
      }

      if (this.transactionCount >= this.config.maxTransactionsPerSecond) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      const request = this.transactionQueue.shift();
      if (!request) continue;

      try {
        this.transactionCount++;
        const result = await request.fn();
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }
    }
  }

  private getNextConnection(): Connection {
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
      const request: RequestQueue = { resolve, reject, fn, type };
      
      if (type === 'transaction') {
        this.transactionQueue.push(request);
      } else {
        this.requestQueue.push(request);
      }
    });
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

// Create singleton instance
export const connectionPool = new SolanaConnectionPool(); 