import axios from "axios";
import { logger } from "../../blockchain/common/logger";
import { env } from "../../config";

export interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  price: number;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  priceChangePercentage: number;
  logoURI?: string;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  createdAt?: Date;
  holders?: number;
  supply?: number;
}

export class SolanaTrackerService {
  private cache = new Map<string, { data: TokenInfo | null; timestamp: number }>();
  private readonly CACHE_TTL_DEFAULT = 30 * 60 * 1000; // 30 minutes
  private readonly CACHE_TTL_POPULAR = 60 * 60 * 1000; // 60 minutes
  private readonly CACHE_TTL_NEW = 15 * 60 * 1000; // 15 minutes for new tokens
  private readonly BASE_URL = env.SOLANA_TRACKER_BASE_URL || "https://data.solanatracker.io";
  private readonly API_KEY = env.SOLANA_TRACKER_API_KEY;
  
  // Cache hit tracking
  private cacheHits = 0;
  private cacheMisses = 0;

  async getTokenInfo(tokenAddress: string): Promise<TokenInfo | null> {
    const logId = `token-info-${tokenAddress.substring(0, 8)}`;
    
    // 🎯 SMART CACHE: Check cache with dynamic TTL
    const cached = this.cache.get(tokenAddress);
    if (cached) {
      const smartTTL = this.getSmartCacheTTL(tokenAddress, cached.data);
      if (Date.now() - cached.timestamp < smartTTL) {
        this.cacheHits++;
        logger.info(`[${logId}] Cache hit (TTL: ${Math.round(smartTTL / 60000)}min)`);
        return cached.data;
      }
    }

    this.cacheMisses++;
    logger.info(`[${logId}] Fetching from SolanaTracker API`);

    try {
      // 🚀 SOLANATRACKER API CALL
      const response = await axios.get(
        `${this.BASE_URL}/tokens/${tokenAddress}`,
        {
          headers: {
            accept: "application/json",
            ...(this.API_KEY && { "x-api-key": this.API_KEY }),
          },
          timeout: 10000,
        }
      );

      const tokenData = this.transformSolanaTrackerResponse(response.data);
      
      // 🎯 SMART CACHE: Cache with appropriate TTL
      const smartTTL = this.getSmartCacheTTL(tokenAddress, tokenData);
      this.cache.set(tokenAddress, {
        data: tokenData,
        timestamp: Date.now(),
      });
      
      logger.info(`[${logId}] Cached for ${Math.round(smartTTL / 60000)}min`);
      return tokenData;

    } catch (error: any) {
      logger.error(`[${logId}] SolanaTracker API error:`, error.message);
      
      // Cache null result to avoid repeated failed requests
      this.cache.set(tokenAddress, {
        data: null,
        timestamp: Date.now(),
      });
      
      return null;
    }
  }

  async getMultipleTokens(tokenAddresses: string[]): Promise<Map<string, TokenInfo | null>> {
    const results = new Map<string, TokenInfo | null>();
    
    // Process in batches to avoid overwhelming the API
    const batchSize = 10;
    for (let i = 0; i < tokenAddresses.length; i += batchSize) {
      const batch = tokenAddresses.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (address) => {
        const info = await this.getTokenInfo(address);
        return { address, info };
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.set(result.value.address, result.value.info);
        }
      }

      // Small delay between batches to be respectful to the API
      if (i + batchSize < tokenAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  async getTokenPrice(tokenAddress: string): Promise<number | null> {
    const tokenInfo = await this.getTokenInfo(tokenAddress);
    return tokenInfo?.price || null;
  }

  async getTokenMarketCap(tokenAddress: string): Promise<number | null> {
    const tokenInfo = await this.getTokenInfo(tokenAddress);
    return tokenInfo?.marketCap || null;
  }

  async searchTokens(query: string, limit: number = 20): Promise<TokenInfo[]> {
    try {
      const response = await axios.get(
        `${this.BASE_URL}/search`,
        {
          params: { q: query, limit },
          headers: {
            accept: "application/json",
            ...(this.API_KEY && { "x-api-key": this.API_KEY }),
          },
          timeout: 10000,
        }
      );

      return response.data.tokens?.map((token: any) => 
        this.transformSolanaTrackerResponse({ token, pools: token.pools || [] })
      ) || [];

    } catch (error: any) {
      logger.error(`Token search error for "${query}":`, error.message);
      return [];
    }
  }

  private transformSolanaTrackerResponse(data: any): TokenInfo {
    const token = data.token || data;
    const pools = data.pools || [];
    const mainPool = pools[0] || {};
    const events = data.events || {};

    return {
      name: token.name || "Unknown",
      symbol: token.symbol || "UNKNOWN",
      decimals: token.decimals || 6,
      price: mainPool.price || 0,
      marketCap: mainPool.marketCap || 0,
      liquidity: mainPool.liquidity || 0,
      volume24h: mainPool.volume24h || 0,
      priceChangePercentage: events["24h"]?.priceChangePercentage || 0,
      logoURI: token.image || token.logoURI,
      description: token.description,
      website: token.website,
      twitter: token.twitter,
      telegram: token.telegram,
      createdAt: token.createdAt ? new Date(token.createdAt) : undefined,
      holders: token.holders,
      supply: token.supply,
    };
  }

  private getSmartCacheTTL(tokenAddress: string, tokenInfo: TokenInfo | null): number {
    if (!tokenInfo) {
      return 5 * 60 * 1000; // 5 minutes for failed requests
    }

    // Popular tokens (high volume) get longer cache
    if (tokenInfo.volume24h > 100000) {
      return this.CACHE_TTL_POPULAR; // 60 minutes
    }
    
    // New/small tokens get shorter cache for freshness
    if (tokenInfo.marketCap < 100000) {
      return this.CACHE_TTL_NEW; // 15 minutes
    }
    
    return this.CACHE_TTL_DEFAULT; // 30 minutes
  }

  // Cache management and stats
  getCacheStats(): { 
    size: number; 
    hitRate: number; 
    totalRequests: number;
    estimatedSavings: number;
  } {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 ? (this.cacheHits / totalRequests) * 100 : 0;
    const estimatedSavings = this.cacheHits * 0.01; // Assume $0.01 per API call saved

    return {
      size: this.cache.size,
      hitRate: Math.round(hitRate * 100) / 100,
      totalRequests,
      estimatedSavings: Math.round(estimatedSavings * 100) / 100,
    };
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    logger.info("SolanaTracker cache cleared");
  }

  // Cleanup old cache entries
  cleanupCache(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, value] of this.cache.entries()) {
      const maxAge = this.getSmartCacheTTL(key, value.data);
      if (now - value.timestamp > maxAge) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info(`Cleaned up ${removed} expired cache entries`);
    }
  }

  // Periodic cleanup
  startPeriodicCleanup(intervalMinutes: number = 30): void {
    setInterval(() => {
      this.cleanupCache();
    }, intervalMinutes * 60 * 1000);
  }
}

// Export singleton instance
export const solanaTrackerService = new SolanaTrackerService();

// Start periodic cleanup
solanaTrackerService.startPeriodicCleanup();