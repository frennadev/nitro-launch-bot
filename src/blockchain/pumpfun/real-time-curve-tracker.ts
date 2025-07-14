import { PublicKey } from "@solana/web3.js";
import { quoteBuy } from "./utils";
import { getBondingCurveData } from "./utils";
import { logger } from "../common/logger";

/**
 * Bonding curve data structure
 */
export interface BondingCurveData {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: string;
}

/**
 * Real-time bonding curve tracker that maintains curve state mathematically
 * without additional RPC calls during execution
 */
export class BondingCurveTracker {
  private virtualSolReserves: bigint;
  private virtualTokenReserves: bigint;
  private realTokenReserves: bigint;
  private lastUpdateTime: number;
  private readonly tokenAddress: string;
  private readonly logIdentifier: string;

  constructor(tokenAddress: string, initialCurveData: BondingCurveData) {
    this.tokenAddress = tokenAddress;
    this.virtualSolReserves = initialCurveData.virtualSolReserves;
    this.virtualTokenReserves = initialCurveData.virtualTokenReserves;
    this.realTokenReserves = initialCurveData.realTokenReserves;
    this.lastUpdateTime = Date.now();
    this.logIdentifier = `curve-tracker-${tokenAddress.slice(0, 8)}`;

    logger.info(`[${this.logIdentifier}]: Initialized real-time curve tracker`, {
      virtualSol: this.virtualSolReserves.toString(),
      virtualTokens: this.virtualTokenReserves.toString(),
      realTokens: this.realTokenReserves.toString()
    });
  }

  /**
   * Get current curve state for quote calculation
   * Zero RPC calls - pure mathematical state
   */
  getCurrentState() {
    return {
      virtualSolReserves: this.virtualSolReserves,
      virtualTokenReserves: this.virtualTokenReserves,
      realTokenReserves: this.realTokenReserves
    };
  }

  /**
   * Calculate buy quote using current tracked curve state
   * No RPC calls - uses mathematical tracking
   */
  quoteCurrentBuy(solAmount: bigint) {
    const quote = quoteBuy(
      solAmount,
      this.virtualTokenReserves,
      this.virtualSolReserves,
      this.realTokenReserves
    );

    logger.info(`[${this.logIdentifier}]: Quote calculated with current state`, {
      solAmount: solAmount.toString(),
      tokenOut: quote.tokenOut.toString(),
      currentVirtualSol: this.virtualSolReserves.toString(),
      currentVirtualTokens: this.virtualTokenReserves.toString()
    });

    return quote;
  }

  /**
   * Update curve state after successful transaction
   * Uses the new state values returned by quoteBuy
   */
  updateAfterSuccessfulBuy(solAmount: bigint, tokensReceived: bigint) {
    // Calculate the new state using quoteBuy (same as what happened on-chain)
    const quote = quoteBuy(
      solAmount,
      this.virtualTokenReserves,
      this.virtualSolReserves,
      this.realTokenReserves
    );

    // Update to the new state
    this.virtualSolReserves = quote.newVirtualSOLReserve;
    this.virtualTokenReserves = quote.newVirtualTokenReserve;
    this.realTokenReserves = quote.newRealTokenReserve;
    this.lastUpdateTime = Date.now();

    logger.info(`[${this.logIdentifier}]: Curve state updated after successful buy`, {
      solSpent: solAmount.toString(),
      tokensReceived: tokensReceived.toString(),
      newVirtualSol: this.virtualSolReserves.toString(),
      newVirtualTokens: this.virtualTokenReserves.toString(),
      newRealTokens: this.realTokenReserves.toString()
    });
  }

  /**
   * Get the age of the current curve data
   */
  getDataAge(): number {
    return Date.now() - this.lastUpdateTime;
  }

  /**
   * Optional: Sync with blockchain if data becomes very stale
   * Rate-limited and only used as fallback
   */
  async syncIfVeryStale(bondingCurveAddress: PublicKey, maxAge: number = 60000): Promise<boolean> {
    const age = this.getDataAge();
    if (age < maxAge) {
      return false; // Data is fresh enough
    }

    try {
      logger.info(`[${this.logIdentifier}]: Data is stale (${Math.round(age / 1000)}s), attempting sync`);
      
      const freshData = await getBondingCurveData(bondingCurveAddress);
      if (freshData) {
        const oldVirtualSol = this.virtualSolReserves;
        const oldVirtualTokens = this.virtualTokenReserves;

        this.virtualSolReserves = freshData.virtualSolReserves;
        this.virtualTokenReserves = freshData.virtualTokenReserves;
        this.realTokenReserves = freshData.realTokenReserves;
        this.lastUpdateTime = Date.now();

        logger.info(`[${this.logIdentifier}]: Successfully synced with blockchain`, {
          oldVirtualSol: oldVirtualSol.toString(),
          newVirtualSol: this.virtualSolReserves.toString(),
          oldVirtualTokens: oldVirtualTokens.toString(),
          newVirtualTokens: this.virtualTokenReserves.toString()
        });

        return true;
      }
    } catch (error: any) {
      logger.warn(`[${this.logIdentifier}]: Failed to sync with blockchain: ${error.message}`);
    }

    return false;
  }

  /**
   * Calculate the difference between tracked state and actual blockchain state
   */
  calculateStateDifference(actualData: BondingCurveData): number {
    const solDiff = Math.abs(Number(actualData.virtualSolReserves - this.virtualSolReserves));
    const tokenDiff = Math.abs(Number(actualData.virtualTokenReserves - this.virtualTokenReserves));
    
    const solDiffPercent = solDiff / Number(this.virtualSolReserves);
    const tokenDiffPercent = tokenDiff / Number(this.virtualTokenReserves);
    
    return Math.max(solDiffPercent, tokenDiffPercent);
  }
}

/**
 * Rate-limit safe launch manager that handles multiple concurrent launches
 */
export class RateLimitSafeLaunchManager {
  private activeLaunches: Map<string, BondingCurveTracker> = new Map();
  private rpcCallCount: number = 0;
  private rpcResetTime: number = Date.now();
  private readonly MAX_RPC_PER_MINUTE = 100; // Conservative limit
  private readonly MAX_CONCURRENT_LAUNCHES = 25; // Buffer above 20

  /**
   * Check if we can make an RPC call without hitting rate limits
   */
  private canMakeRpcCall(): boolean {
    const now = Date.now();
    if (now - this.rpcResetTime > 60000) {
      // Reset counter every minute
      this.rpcCallCount = 0;
      this.rpcResetTime = now;
    }
    return this.rpcCallCount < this.MAX_RPC_PER_MINUTE;
  }

  /**
   * Get current RPC usage stats
   */
  getRpcUsageStats() {
    const now = Date.now();
    const timeUntilReset = Math.max(0, 60000 - (now - this.rpcResetTime));
    
    return {
      callsUsed: this.rpcCallCount,
      callsRemaining: this.MAX_RPC_PER_MINUTE - this.rpcCallCount,
      timeUntilReset: Math.round(timeUntilReset / 1000),
      activeLaunches: this.activeLaunches.size
    };
  }

  /**
   * Initialize a new launch with real-time curve tracking
   * Uses single RPC call - same as existing system
   */
  async initializeLaunch(tokenAddress: string, bondingCurveAddress: PublicKey): Promise<BondingCurveTracker> {
    if (this.activeLaunches.size >= this.MAX_CONCURRENT_LAUNCHES) {
      throw new Error(`Too many concurrent launches. Max: ${this.MAX_CONCURRENT_LAUNCHES}`);
    }

    if (!this.canMakeRpcCall()) {
      const stats = this.getRpcUsageStats();
      throw new Error(`RPC rate limit reached. Used: ${stats.callsUsed}/${this.MAX_RPC_PER_MINUTE}. Reset in ${stats.timeUntilReset}s`);
    }

    const logId = `launch-init-${tokenAddress.slice(0, 8)}`;
    logger.info(`[${logId}]: Initializing launch with real-time curve tracking`);

    try {
      // Single RPC call - same as existing system
      const initialCurveData = await getBondingCurveData(bondingCurveAddress);
      this.rpcCallCount++;

      if (!initialCurveData) {
        throw new Error("Could not fetch initial bonding curve data");
      }

      const tracker = new BondingCurveTracker(tokenAddress, initialCurveData);
      this.activeLaunches.set(tokenAddress, tracker);

      logger.info(`[${logId}]: Launch initialized successfully`, {
        rpcCallsUsed: this.rpcCallCount,
        activeLaunches: this.activeLaunches.size
      });

      return tracker;
    } catch (error: any) {
      logger.error(`[${logId}]: Failed to initialize launch: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get tracker for an active launch
   */
  getLaunchTracker(tokenAddress: string): BondingCurveTracker | undefined {
    return this.activeLaunches.get(tokenAddress);
  }

  /**
   * Check if a launch is active
   */
  isLaunchActive(tokenAddress: string): boolean {
    return this.activeLaunches.has(tokenAddress);
  }

  /**
   * Complete a launch and clean up resources
   */
  completeLaunch(tokenAddress: string): void {
    const tracker = this.activeLaunches.get(tokenAddress);
    if (tracker) {
      this.activeLaunches.delete(tokenAddress);
      logger.info(`Launch completed and cleaned up: ${tokenAddress.slice(0, 8)}`);
    }
  }

  /**
   * Clean up completed launches automatically
   * Called periodically to prevent memory leaks
   */
  cleanupCompletedLaunches(maxAge: number = 300000): number {
    const cutoffTime = Date.now() - maxAge; // Default 5 minutes
    let cleanedCount = 0;

    for (const [tokenAddress, tracker] of this.activeLaunches) {
      if (tracker.getDataAge() > maxAge) {
        this.activeLaunches.delete(tokenAddress);
        cleanedCount++;
        logger.info(`Cleaned up stale launch: ${tokenAddress.slice(0, 8)}`);
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleanup completed: ${cleanedCount} stale launches removed`);
    }

    return cleanedCount;
  }

  /**
   * Get system status for monitoring
   */
  getSystemStatus() {
    const rpcStats = this.getRpcUsageStats();
    return {
      ...rpcStats,
      maxConcurrentLaunches: this.MAX_CONCURRENT_LAUNCHES,
      launchesRemaining: this.MAX_CONCURRENT_LAUNCHES - this.activeLaunches.size
    };
  }
}

// Global instance for the application
export const globalLaunchManager = new RateLimitSafeLaunchManager();

// Automatic cleanup every 5 minutes
setInterval(() => {
  globalLaunchManager.cleanupCompletedLaunches();
}, 300000); 