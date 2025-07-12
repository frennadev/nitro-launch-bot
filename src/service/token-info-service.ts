import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import axios from "axios";
import { connection } from "./config";
import { logger } from "../jobs/logger";
import { BirdeyesResponse } from "./responseTypes";

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
  price?: number;
  dex: string;
  dexId?: string;
  priceChange24h?: number;
  marketCap?: number;
  volume24h?: number;
  liquidity?: number;
  holders?: number;
  description?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  image?: string;
  verified?: boolean;
}

export interface DexScreenerToken {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
}

export class TokenInfoService {
  private static instance: TokenInfoService;
  private cache = new Map<string, { data: TokenInfo; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  static getInstance(): TokenInfoService {
    if (!TokenInfoService.instance) {
      TokenInfoService.instance = new TokenInfoService();
    }
    return TokenInfoService.instance;
  }

  async getTokenInfo(tokenAddress: string): Promise<TokenInfo | null> {
    // Check cache first

    try {
      // Validate address
      if (!this.isValidSolanaAddress(tokenAddress)) {
        return null;
      }

      // Fetch from multiple sources
      const [dexScreenerData] = await Promise.allSettled([
        this.getDexScreenerTokenInfo(tokenAddress),
      ]);

      // Combine data from all sources
      const tokenInfo = this.combineTokenData(
        tokenAddress,
        dexScreenerData.status === "fulfilled" ? dexScreenerData.value : null
      );

      return tokenInfo;
    } catch (error) {
      console.error(`Error fetching token info for ${tokenAddress}:`, error);
      return null;
    }
  }

  async getOnChainTokenInfo(
    tokenAddress: string
  ): Promise<Partial<TokenInfo> | null> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      const mintInfo = await getMint(connection, mintPubkey);

      const supply = (
        Number(mintInfo.supply) / Math.pow(10, mintInfo.decimals)
      ).toString();

      return {
        address: tokenAddress,
        decimals: mintInfo.decimals,
        supply,
      };
    } catch (error) {
      console.error("Error fetching on-chain token info:", error);
      return null;
    }
  }

  private async getDexScreenerTokenInfo(
    tokenAddress: string
  ): Promise<Partial<TokenInfo> | null> {
    try {
      const response = await axios.get(
        "https://public-api.birdeye.so/defi/token_overview?address=" +
          tokenAddress,
        {
          headers: {
            accept: "application/json",
            "x-chain": "solana",
            "X-API-KEY": "e750e17792ae478983170f78486de13c",
          },
          timeout: 5000,
        }
      );

      // Get the pair with highest liquidity
      const bestPair: BirdeyesResponse = response.data;

      return {
        name: bestPair.data.name,
        symbol: bestPair.data.symbol,
        price: bestPair.data.price,
        priceChange24h: bestPair.data.priceChange24hPercent || 0,
        marketCap: bestPair.data.marketCap || 0,
        volume24h: bestPair.data.v24hUSD || 0,
        liquidity: bestPair.data.liquidity || 0,
        supply: `${bestPair.data.totalSupply}` || "0",
        decimals: bestPair.data.decimals,
        address: tokenAddress,
      };
    } catch (error) {
      console.error("Error fetching DexScreener token info:", error);
      return null;
    }
  }

  private async getJupiterTokenInfo(
    tokenAddress: string
  ): Promise<Partial<TokenInfo> | null> {
    try {
      const response = await axios.get(`https://token.jup.ag/strict`, {
        timeout: 5000,
      });

      const token = response.data.find((t: any) => t.address === tokenAddress);
      if (!token) return null;

      return {
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
        image: token.logoURI,
        verified: token.tags?.includes("verified") || false,
      };
    } catch (error) {
      console.error("Error fetching Jupiter token info:", error);
      return null;
    }
  }

  private combineTokenData(
    address: string,
    dexScreener: Partial<TokenInfo> | null
  ): TokenInfo | null {
    if (!dexScreener) {
      return null;
    }

    return {
      address,
      name: dexScreener?.name || "Unknown Token",
      symbol: dexScreener?.symbol || "UNKNOWN",
      decimals: dexScreener?.decimals || 9,
      supply: dexScreener?.supply || "0",
      price: dexScreener?.price,
      priceChange24h: dexScreener?.priceChange24h,
      marketCap: dexScreener?.marketCap,
      volume24h: dexScreener?.volume24h,
      liquidity: dexScreener?.liquidity,
      dex: dexScreener?.dexId || "Unknown Dex",
    };
  }

  private isValidSolanaAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return address.length >= 32 && address.length <= 44;
    } catch {
      return false;
    }
  }

  // Clear cache for a specific token
  clearTokenCache(tokenAddress: string): void {
    this.cache.delete(tokenAddress);
  }

  // Helper method to detect token addresses in text
  static detectTokenAddresses(text: string): string[] {
    const addresses: string[] = [];

    // Detect DexScreener URLs and extract token addresses
    const dexScreenerRegex =
      /(?:https?:\/\/)?(?:www\.)?dexscreener\.com\/solana\/([1-9A-HJ-NP-Za-km-z]{32,44})/gi;
    const dexScreenerMatches = text.matchAll(dexScreenerRegex);

    for (const match of dexScreenerMatches) {
      const tokenAddress = match[1];
      logger.info(`Detected DexScreener token address: ${tokenAddress}`);
      if (this.isValidTokenAddress(tokenAddress)) {
        logger.debug("Valid DexScreener address:", tokenAddress);
        if (!addresses.includes(tokenAddress)) {
          addresses.push(tokenAddress);
        }
      }
    }

    // Detect raw Solana addresses (case insensitive)
    const solanaAddressRegex = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/gi;
    const rawMatches = text.match(solanaAddressRegex) || [];
    logger.info(`Found ${rawMatches.length} raw Solana address matches`);
    logger.debug("Raw matches:", rawMatches);

    for (const match of rawMatches) {
      if (this.isValidTokenAddress(match) && !addresses.includes(match)) {
        addresses.push(match);
      }
    }

    logger.info(`Detected ${addresses.length} unique token addresses in text`);
    logger.debug("Detected addresses:", addresses);

    return addresses;
  }

  private static isValidTokenAddress(address: string): boolean {
    try {
      logger.info(`Validating token address: ${address}`);
      // Check length and valid characters
      logger.info(`Address length: ${address.length}`);
      new PublicKey(address);

      if (address.length < 32 || address.length > 44) {
        logger.warn(`Invalid address length: ${address.length}`);
        return false;
      }
      return address.length >= 32;
    } catch (error) {
      logger.error(`Error validating token address: ${address}`);
      logger.debug(`Error details: ${error}`);
      return false;
    }
  }
}
