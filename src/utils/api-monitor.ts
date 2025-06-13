import { logger } from "../blockchain/common/logger";
import { connectionPool } from "../blockchain/common/connection-pool";

interface ApiUsageStats {
  timestamp: number;
  requestsPerSecond: number;
  transactionsPerSecond: number;
  cacheHitRate: number;
  queueLengths: {
    requests: number;
    transactions: number;
  };
}

class ApiMonitor {
  private stats: ApiUsageStats[] = [];
  private maxStatsHistory = 300; // Keep 5 minutes of stats (at 1 second intervals)
  private monitoringInterval: NodeJS.Timeout | null = null;

  start() {
    if (this.monitoringInterval) return;
    
    this.monitoringInterval = setInterval(() => {
      this.collectStats();
    }, 1000);
    
    logger.info("API monitoring started");
  }

  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    logger.info("API monitoring stopped");
  }

  private collectStats() {
    const poolStats = connectionPool.getPoolStats();
    
    const currentStats: ApiUsageStats = {
      timestamp: Date.now(),
      requestsPerSecond: poolStats.requestCount,
      transactionsPerSecond: poolStats.transactionCount,
      cacheHitRate: this.calculateCacheHitRate(),
      queueLengths: {
        requests: poolStats.requestQueueLength,
        transactions: poolStats.transactionQueueLength,
      },
    };

    this.stats.push(currentStats);
    
    // Keep only recent stats
    if (this.stats.length > this.maxStatsHistory) {
      this.stats.shift();
    }

    // Log warnings if approaching limits
    if (currentStats.requestsPerSecond > 160) { // 80% of 200 limit
      logger.warn(`High API usage: ${currentStats.requestsPerSecond}/200 requests per second`);
    }
    
    if (currentStats.transactionsPerSecond > 40) { // 80% of 50 limit
      logger.warn(`High transaction rate: ${currentStats.transactionsPerSecond}/50 transactions per second`);
    }
  }

  private calculateCacheHitRate(): number {
    // This is a simplified calculation - in a real implementation,
    // you'd track cache hits vs misses
    return 0.75; // Placeholder
  }

  getCurrentStats(): ApiUsageStats | null {
    return this.stats.length > 0 ? this.stats[this.stats.length - 1] : null;
  }

  getAverageStats(minutes: number = 1): Partial<ApiUsageStats> | null {
    const cutoffTime = Date.now() - (minutes * 60 * 1000);
    const recentStats = this.stats.filter(stat => stat.timestamp > cutoffTime);
    
    if (recentStats.length === 0) return null;

    const avgRequests = recentStats.reduce((sum, stat) => sum + stat.requestsPerSecond, 0) / recentStats.length;
    const avgTransactions = recentStats.reduce((sum, stat) => sum + stat.transactionsPerSecond, 0) / recentStats.length;
    const avgCacheHitRate = recentStats.reduce((sum, stat) => sum + stat.cacheHitRate, 0) / recentStats.length;

    return {
      requestsPerSecond: Math.round(avgRequests * 100) / 100,
      transactionsPerSecond: Math.round(avgTransactions * 100) / 100,
      cacheHitRate: Math.round(avgCacheHitRate * 100) / 100,
    };
  }

  getHealthStatus(): 'healthy' | 'warning' | 'critical' {
    const current = this.getCurrentStats();
    if (!current) return 'healthy';

    if (current.requestsPerSecond > 180 || current.transactionsPerSecond > 45) {
      return 'critical';
    }
    
    if (current.requestsPerSecond > 160 || current.transactionsPerSecond > 40) {
      return 'warning';
    }

    return 'healthy';
  }

  logSummary() {
    const current = this.getCurrentStats();
    const avg5min = this.getAverageStats(5);
    const health = this.getHealthStatus();

    logger.info("=== API Usage Summary ===");
    logger.info(`Health Status: ${health.toUpperCase()}`);
    
    if (current) {
      logger.info(`Current: ${current.requestsPerSecond}/200 requests/sec, ${current.transactionsPerSecond}/50 tx/sec`);
      logger.info(`Queue lengths: ${current.queueLengths.requests} requests, ${current.queueLengths.transactions} transactions`);
    }
    
    if (avg5min) {
      logger.info(`5min avg: ${avg5min.requestsPerSecond}/200 requests/sec, ${avg5min.transactionsPerSecond}/50 tx/sec`);
    }
    
    logger.info("========================");
  }
}

export const apiMonitor = new ApiMonitor(); 