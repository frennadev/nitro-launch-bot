import { PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import axios from "axios";
import { connection } from "./config";
import { logger } from "../jobs/logger";
// Removed BirdeyesResponse - no longer using Birdeye API

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
  isToken2022?: boolean;
}

export interface Token2022Info {
  name: string;
  symbol: string;
  decimals: number;
  supply?: string;
  image?: string;
  description?: string;
}

export interface TokenValue {
  priceUsd: number;
  marketCap?: number;
  volume24h?: number;
  priceChange24h?: number;
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
    const logId = `token-info-${tokenAddress.substring(0, 8)}`;
    
    try {
      // Validate address
      if (!this.isValidSolanaAddress(tokenAddress)) {
        return null;
      }

      // Check if it's a Token-2022 token (Heaven DEX)
      const isToken2022 = await this.checkIfToken2022(tokenAddress);
      
      if (isToken2022) {
        logger.info(`[${logId}] Detected Token-2022 (Heaven DEX token)`);
        return await this.getToken2022Info(tokenAddress);
      }

      // Fetch from multiple sources for regular tokens
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
      // Use actual DexScreener API instead of Birdeye
      const response = await axios.get(
        `https://api.dexscreener.com/tokens/v1/solana/${tokenAddress}`,
        {
          timeout: 5000,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; NitroBot/1.0)",
          },
        }
      );

      const data = response.data || [];
      if (!data.length || !data[0]) {
        return null;
      }

      const tokenData = data[0];
      return {
        name: tokenData.baseToken?.name || "Unknown",
        symbol: tokenData.baseToken?.symbol || "UNKNOWN",
        price: parseFloat(tokenData.priceUsd || "0"),
        priceChange24h: parseFloat(tokenData.priceChange?.h24 || "0"),
        marketCap: tokenData.marketCap || 0,
        volume24h: tokenData.volume?.h24 || 0,
        liquidity: tokenData.liquidity?.usd || 0,
        supply: "0", // DexScreener doesn't provide supply
        decimals: tokenData.baseToken?.decimals || 9,
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

  /**
   * Check if token is Token-2022 (Heaven DEX)
   */
  private async checkIfToken2022(tokenAddress: string): Promise<boolean> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      const mintInfo = await connection.getAccountInfo(mintPubkey);
      
      if (!mintInfo) return false;
      
      // Check if the owner is TOKEN_2022_PROGRAM_ID
      return mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get Token-2022 metadata with Metaplex fallback
   * Essential for Heaven DEX tokens
   */
  private async getToken2022Info(tokenAddress: string): Promise<TokenInfo | null> {
    const logId = `token2022-info-${tokenAddress.substring(0, 8)}`;
    
    try {
      const mintPk = new PublicKey(tokenAddress);
      
      // 1. Try to get basic mint info first
      const mintInfo = await connection.getParsedAccountInfo(mintPk);
      if (!mintInfo.value) {
        logger.warn(`[${logId}] Token mint not found`);
        return null;
      }
      
      const decimals = (mintInfo.value.data as any).parsed?.info?.decimals || 9;
      const supply = (mintInfo.value.data as any).parsed?.info?.supply || "0";
      
      // 2. Try Metaplex metadata (most reliable for Token-2022)
      const metaplexInfo = await this.getMetaplexMetadata(tokenAddress);
      if (metaplexInfo) {
        logger.info(`[${logId}] ✅ Found Metaplex metadata: ${metaplexInfo.name} (${metaplexInfo.symbol})`);
        
        // Get price data
        const priceData = await this.getTokenPrice(tokenAddress);
        
        return {
          address: tokenAddress,
          name: metaplexInfo.name,
          symbol: metaplexInfo.symbol,
          decimals: metaplexInfo.decimals || decimals,
          supply: supply,
          price: priceData?.priceUsd,
          priceChange24h: priceData?.priceChange24h,
          marketCap: priceData?.marketCap,
          volume24h: priceData?.volume24h,
          image: metaplexInfo.image,
          description: metaplexInfo.description,
          dex: "Heaven DEX",
          dexId: "heaven",
          isToken2022: true
        };
      }
      
      // 3. Fallback to external APIs
      const externalInfo = await this.getExternalTokenInfo(tokenAddress);
      if (externalInfo) {
        logger.info(`[${logId}] ✅ Found external metadata: ${externalInfo.name} (${externalInfo.symbol})`);
        return {
          address: tokenAddress,
          name: externalInfo.name,
          symbol: externalInfo.symbol,
          decimals: externalInfo.decimals || decimals,
          supply: supply,
          price: externalInfo.price,
          dex: "Heaven DEX",
          dexId: "heaven",
          isToken2022: true
        };
      }
      
      logger.warn(`[${logId}] No metadata found for Token-2022`);
      return {
        address: tokenAddress,
        name: "Unknown Heaven Token",
        symbol: "UNKNOWN",
        decimals: decimals,
        supply: supply,
        dex: "Heaven DEX",
        dexId: "heaven",
        isToken2022: true
      };
      
    } catch (error: any) {
      logger.error(`[${logId}] Error getting Token-2022 info: ${error.message}`);
      return null;
    }
  }

  /**
   * Get Metaplex metadata for Token-2022
   * This is the primary source for Heaven DEX tokens
   */
  private async getMetaplexMetadata(tokenAddress: string): Promise<Token2022Info | null> {
    try {
      const mintPk = new PublicKey(tokenAddress);
      
      // Find Metaplex metadata PDA
      const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
      
      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          METADATA_PROGRAM_ID.toBuffer(),
          mintPk.toBuffer(),
        ],
        METADATA_PROGRAM_ID
      );
      
      // Get metadata account
      const metadataAccount = await connection.getAccountInfo(metadataPDA);
      if (!metadataAccount) {
        return null;
      }
      
      // Parse metadata (simplified parser)
      const metadata = this.parseMetaplexMetadata(metadataAccount.data);
      if (!metadata) {
        return null;
      }
      
      // If metadata has URI, fetch additional data
      if (metadata.uri) {
        const additionalData = await this.fetchMetadataFromUri(metadata.uri);
        return {
          name: additionalData?.name || metadata.name || "Unknown",
          symbol: additionalData?.symbol || metadata.symbol || "Unknown",
          decimals: 9,
          image: additionalData?.image,
          description: additionalData?.description
        };
      }
      
      return {
        name: metadata.name || "Unknown",
        symbol: metadata.symbol || "Unknown", 
        decimals: 9
      };
      
    } catch (error: any) {
      logger.debug(`Metaplex metadata fetch failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Simple Metaplex metadata parser
   */
  private parseMetaplexMetadata(data: Buffer): { name?: string; symbol?: string; uri?: string } | null {
    try {
      // Skip header and read strings
      let offset = 1 + 32 + 32; // Skip key + update authority + mint
      
      // Read name (32 bytes, null-terminated)
      const nameBytes = data.slice(offset, offset + 32);
      const name = nameBytes.toString('utf8').replace(/\0/g, '').trim();
      offset += 32;
      
      // Read symbol (10 bytes, null-terminated)  
      const symbolBytes = data.slice(offset, offset + 10);
      const symbol = symbolBytes.toString('utf8').replace(/\0/g, '').trim();
      offset += 10;
      
      // Read URI length (4 bytes)
      const uriLength = data.readUInt32LE(offset);
      offset += 4;
      
      // Read URI
      const uri = data.slice(offset, offset + uriLength).toString('utf8');
      
      return { name, symbol, uri };
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch metadata from URI (IPFS or HTTP)
   */
  private async fetchMetadataFromUri(uri: string): Promise<any> {
    try {
      // Handle IPFS URIs
      if (uri.startsWith('ipfs://')) {
        uri = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
      }
      
      const response = await Promise.race([
        axios.get(uri, { timeout: 3000 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      ]);
      
      return (response as any).data;
    } catch (error) {
      return null;
    }
  }

  /**
   * External API fallback for token info
   */
  private async getExternalTokenInfo(tokenAddress: string): Promise<{ name: string; symbol: string; decimals: number; price?: number } | null> {
    try {
      // Try DexScreener first
      const dexResponse = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        { timeout: 3000 }
      );
      
      if (dexResponse.data?.pairs?.[0]) {
        const pair = dexResponse.data.pairs[0];
        return {
          name: pair.baseToken.name,
          symbol: pair.baseToken.symbol,
          decimals: 9,
          price: parseFloat(pair.priceUsd) || undefined
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get token price from multiple sources
   */
  private async getTokenPrice(tokenAddress: string): Promise<TokenValue | null> {
    const sources = [
      () => this.getPriceFromDexScreener(tokenAddress),
      () => this.getPriceFromSolanaTracker(tokenAddress),
      () => this.getPriceFromJupiter(tokenAddress)
    ];
    
    for (const getPrice of sources) {
      try {
        const price = await getPrice();
        if (price && price.priceUsd > 0) {
          return price;
        }
      } catch (error) {
        continue; // Try next source
      }
    }
    
    return null;
  }

  /**
   * DexScreener price API
   */
  private async getPriceFromDexScreener(tokenAddress: string): Promise<TokenValue | null> {
    try {
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        { timeout: 5000 }
      );
      
      const pair = response.data?.pairs?.[0];
      if (!pair) return null;
      
      return {
        priceUsd: parseFloat(pair.priceUsd) || 0,
        marketCap: parseFloat(pair.marketCap) || undefined,
        volume24h: parseFloat(pair.volume?.h24) || undefined,
        priceChange24h: parseFloat(pair.priceChange?.h24) || undefined
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * SolanaTracker price API
   */
  private async getPriceFromSolanaTracker(tokenAddress: string): Promise<TokenValue | null> {
    try {
      const { SolanaTrackerService } = await import('../services/token/solana-tracker-service');
      const solanaTracker = new SolanaTrackerService();
      const tokenInfo = await solanaTracker.getTokenInfo(tokenAddress);
      
      if (tokenInfo && tokenInfo.price) {
        return {
          priceUsd: tokenInfo.price
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Jupiter price API
   */
  private async getPriceFromJupiter(tokenAddress: string): Promise<TokenValue | null> {
    try {
      const response = await axios.get(
        `https://price.jup.ag/v4/price?ids=${tokenAddress}`,
        { timeout: 5000 }
      );
      
      const priceData = response.data?.data?.[tokenAddress];
      if (priceData?.price) {
        return {
          priceUsd: priceData.price
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
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
