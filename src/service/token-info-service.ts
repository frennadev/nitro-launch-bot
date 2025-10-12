import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import {
  getMint as getToken2022Mint,
  TOKEN_2022_PROGRAM_ID,
  getTokenMetadata,
} from "@solana/spl-token";
import axios from "axios";
import {
  // BirdeyesResponse,
  SolanaTrackerResponse,
  TokenInfo,
} from "./interface";
import PumpFunMarketCapService from "./pumpfun-marketcap-service";
import { connection } from "./config";
import { logger } from "../utils/logger";
import { env } from "../config";
import UnifiedMarketCapService from "./unified-marketcap-service";

export class TokenInfoService {
  private static instance: TokenInfoService;
  private cache = new Map<string, { data: TokenInfo; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  // 🔥 FIX: Add request deduplication to prevent multiple concurrent requests for same token
  private pendingRequests = new Map<string, Promise<TokenInfo | null>>();

  static getInstance(): TokenInfoService {
    if (!TokenInfoService.instance) {
      TokenInfoService.instance = new TokenInfoService();
    }
    return TokenInfoService.instance;
  }

  async getTokenInfo(tokenAddress: string): Promise<TokenInfo | null> {
    // 🔥 FIX: Check cache first (this was missing implementation)
    const cached = this.cache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    // 🔥 FIX: Check if request is already pending to avoid duplicate API calls
    const pendingRequest = this.pendingRequests.get(tokenAddress);
    if (pendingRequest) {
      return pendingRequest;
    }

    // 🔥 FIX: Create and store the request promise
    const requestPromise = this.fetchTokenInfoInternal(tokenAddress);
    this.pendingRequests.set(tokenAddress, requestPromise);

    try {
      const result = await requestPromise;

      // 🔥 FIX: Cache successful results
      if (result) {
        this.cache.set(tokenAddress, {
          data: result,
          timestamp: Date.now(),
        });
      }

      return result;
    } finally {
      // 🔥 FIX: Always clean up pending request
      this.pendingRequests.delete(tokenAddress);
    }
  }

  private async fetchTokenInfoInternal(
    tokenAddress: string
  ): Promise<TokenInfo | null> {
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

  /**
   * Get name and symbol for Solana Token2022 (Token Extensions Program) tokens
   * @param tokenAddress - The token mint address
   * @returns Object containing name and symbol, or null if not found
   */
  async getToken2022Info(
    tokenAddress: string
  ): Promise<{ name: string; symbol: string; decimals?: number } | null> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);

      // First, try to get the mint info to check if it's a Token2022 token
      let mintInfo;
      try {
        // Try Token2022 program first
        mintInfo = await getToken2022Mint(
          connection,
          mintPubkey,
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );
      } catch (token2022Error) {
        // If Token2022 fails, try regular SPL token
        try {
          mintInfo = await getMint(connection, mintPubkey);
        } catch (splError) {
          logger.error(
            `Failed to get mint info for ${tokenAddress}:`,
            splError
          );
          return null;
        }
      }

      // Try to get token metadata (works for both Token2022 and SPL tokens with metadata)
      try {
        const metadata = await getTokenMetadata(connection, mintPubkey);

        if (metadata) {
          return {
            name: metadata.name || "Unknown Token",
            symbol: metadata.symbol || "UNKNOWN",
            decimals: mintInfo.decimals,
          };
        }
      } catch (metadataError) {
        logger.warn(
          `No metadata found for token ${tokenAddress}:`,
          metadataError
        );
      }

      // 🚀 FAST FALLBACK: Try Metaplex metadata (common for Token2022 tokens)
      try {
        const metaplexResult = await this.getMetaplexMetadata(tokenAddress);
        if (metaplexResult?.name && metaplexResult?.symbol) {
          logger.info(
            `Token ${tokenAddress} metadata found via Metaplex fallback`
          );
          return {
            name: metaplexResult.name,
            symbol: metaplexResult.symbol,
            decimals: mintInfo.decimals,
          };
        }
      } catch (metaplexError) {
        logger.debug(
          `Metaplex metadata fallback failed for ${tokenAddress}:`,
          metaplexError
        );
      }

      // If no metadata extension, try to fetch from account data directly
      try {
        const accountInfo = await connection.getAccountInfo(mintPubkey);

        if (accountInfo && accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
          // This is a Token2022 token but may not have metadata extension
          logger.info(
            `Token ${tokenAddress} is a Token2022 token but has no metadata extension`
          );

          return {
            name: "Token2022 Token",
            symbol: "T2022",
            decimals: mintInfo.decimals,
          };
        }
      } catch (accountError) {
        logger.error(
          `Error fetching account info for ${tokenAddress}:`,
          accountError
        );
      }

      // Return basic info if available
      return {
        name: "Unknown Token",
        symbol: "UNKNOWN",
        decimals: mintInfo.decimals,
      };
    } catch (error) {
      logger.error(`Error fetching Token2022 info for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * 🚀 FAST Metaplex metadata fallback for Token2022 tokens
   * Uses pattern-based extraction for speed and reliability
   */
  private async getMetaplexMetadata(tokenAddress: string): Promise<{
    name: string;
    symbol: string;
    uri?: string;
    image?: string;
    twitter?: string;
    website?: string;
    telegram?: string;
    description?: string;
  } | null> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);

      // Derive Metaplex metadata PDA
      const METAPLEX_PROGRAM_ID = new PublicKey(
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
      );

      const [metadataPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("metadata"),
          METAPLEX_PROGRAM_ID.toBuffer(),
          mintPubkey.toBuffer(),
        ],
        METAPLEX_PROGRAM_ID
      );

      // Fast account fetch with timeout
      const metadataAccount = await Promise.race([
        connection.getAccountInfo(metadataPDA),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("Metaplex fetch timeout")), 2000)
        ),
      ]);

      logger.info("HERE");
      if (!metadataAccount) {
        logger.info("Metaplex metadata not found");
        return null;
      }
      logger.info("HERE2");
      // Fast pattern-based extraction (proven to work from testing)
      const data = metadataAccount.data;
      const dataStr = data.toString("utf8");

      // Extract URI first (most reliable indicator)
      const uriMatch = dataStr.match(/https?:\/\/[^\s\x00]{10,}/);
      if (!uriMatch) {
        return null; // No URI = no valid metadata
      }

      const uri = uriMatch[0];

      // Fast URI fetch with timeout and fallback
      try {
        logger.info(`[DEBUG] URI: ${uri}`);
        const response = await Promise.race([
          axios
            .get(uri, {
              timeout: 3000,
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                Connection: "keep-alive",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site",
                "Cache-Control": "no-cache",
                Pragma: "no-cache",
              },
              validateStatus: () => true, // Accept any status code
              maxRedirects: 5,
            })
            .catch(() => ({ data: null, status: 500 })), // Return null data on any error
          new Promise<{ data: null; status: 500 }>((resolve) =>
            setTimeout(() => resolve({ data: null, status: 500 }), 3000)
          ),
        ]);

        if (response.data?.name && response.data?.symbol) {
          // Helper function to extract social media links from various metadata structures
          const extractSocialLinks = (data: any) => {
            const result = {
              twitter: null as string | null,
              website: null as string | null,
              telegram: null as string | null,
              description: null as string | null,
            };

            try {
              // Direct fields at root level
              if (data.twitter) result.twitter = data.twitter;
              if (data.website) result.website = data.website;
              if (data.telegram) result.telegram = data.telegram;
              if (data.description) result.description = data.description;

              // Alternative field names for website
              if (!result.website && data.external_url)
                result.website = data.external_url;
              if (!result.website && data.homepage)
                result.website = data.homepage;
              if (!result.website && data.web) result.website = data.web;

              // Alternative field names for social media
              if (!result.twitter && data.twitter_url)
                result.twitter = data.twitter_url;
              if (!result.twitter && data.x) result.twitter = data.x;
              if (!result.twitter && data.x_url) result.twitter = data.x_url;
              if (!result.telegram && data.telegram_url)
                result.telegram = data.telegram_url;

              // Check in extensions object
              if (data.extensions) {
                if (!result.twitter && data.extensions.twitter)
                  result.twitter = data.extensions.twitter;
                if (!result.website && data.extensions.website)
                  result.website = data.extensions.website;
                if (!result.telegram && data.extensions.telegram)
                  result.telegram = data.extensions.telegram;
                if (!result.description && data.extensions.description)
                  result.description = data.extensions.description;
              }

              // Check in social object
              if (data.social) {
                if (!result.twitter && data.social.twitter)
                  result.twitter = data.social.twitter;
                if (!result.website && data.social.website)
                  result.website = data.social.website;
                if (!result.telegram && data.social.telegram)
                  result.telegram = data.social.telegram;
              }

              // Check in attributes array (common in NFT metadata)
              if (data.attributes && Array.isArray(data.attributes)) {
                for (const attr of data.attributes) {
                  if (attr.trait_type && attr.value) {
                    const traitType = attr.trait_type.toLowerCase();
                    if (
                      !result.twitter &&
                      (traitType === "twitter" || traitType === "x")
                    ) {
                      result.twitter = attr.value;
                    }
                    if (
                      !result.website &&
                      (traitType === "website" || traitType === "homepage")
                    ) {
                      result.website = attr.value;
                    }
                    if (!result.telegram && traitType === "telegram") {
                      result.telegram = attr.value;
                    }
                  }
                }
              }

              // Clean up URLs - ensure they start with https:// if they're not empty
              const cleanUrl = (url: string | null): string | null => {
                if (!url || url.trim() === "") return null;
                const cleaned = url.trim();
                if (
                  cleaned.startsWith("http://") ||
                  cleaned.startsWith("https://")
                ) {
                  return cleaned;
                }
                if (cleaned.includes(".") && !cleaned.includes(" ")) {
                  return `https://${cleaned}`;
                }
                return cleaned;
              };

              // Apply cleaning and trimming
              result.twitter = result.twitter ? cleanUrl(result.twitter) : null;
              result.website = result.website ? cleanUrl(result.website) : null;
              result.telegram = result.telegram
                ? cleanUrl(result.telegram)
                : null;
              result.description = result.description
                ? result.description.trim()
                : null;
            } catch (error) {
              console.error(`[ERROR] Failed to extract social links:`, error);
            }

            return result;
          };

          const socialLinks = extractSocialLinks(response.data);

          logger.info(
            `[DEBUG] Extracted social links for token:`,
            JSON.stringify(
              {
                twitter: socialLinks.twitter,
                website: socialLinks.website,
                telegram: socialLinks.telegram,
                description: socialLinks.description,
              },
              null,
              2
            )
          );

          return {
            name: response.data.name.trim(),
            symbol: response.data.symbol.trim(),
            uri,
            image: response.data.image ? response.data.image.trim() : undefined,
            twitter: socialLinks.twitter || undefined,
            website: socialLinks.website || undefined,
            telegram: socialLinks.telegram || undefined,
            description: socialLinks.description || undefined,
          };
        }
      } catch (uriFetchError) {
        // Fallback: Extract from raw metadata if URI fetch fails
        const namePatterns =
          dataStr.match(/[A-Za-z][A-Za-z0-9\s]{2,19}/g) || [];
        const symbolPatterns = dataStr.match(/[A-Z][A-Z0-9]{1,7}/g) || [];

        const likelyName = namePatterns.find(
          (n) => n.length >= 3 && n.length <= 20 && !/[^\w\s]/.test(n)
        );
        const likelySymbol = symbolPatterns.find(
          (s) => s.length >= 2 && s.length <= 8 && /^[A-Z]+$/.test(s)
        );
        const likelyImage = dataStr.match(/https?:\/\/[^\s]+/);

        if (likelyName && likelySymbol) {
          return {
            name: likelyName.trim(),
            symbol: likelySymbol.trim(),
            uri,
            image: likelyImage ? likelyImage[0].trim() : undefined,
          };
        }
      }

      return null;
    } catch (error) {
      logger.error(
        `Error extracting token info from metadata for ${tokenAddress}:`,
        error
      );
      // Silent fail - this is a fallback method
      return null;
    }
  }

  /**
   * Universal function to get token name and symbol for both SPL and Token2022 tokens
   * @param tokenAddress - The token mint address
   * @returns Object containing name, symbol, and additional info, or null if not found
   */
  async getUniversalTokenInfo(tokenAddress: string): Promise<{
    name: string;
    symbol: string;
    decimals: number;
    isToken2022: boolean;
  } | null> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);

      // First check if it's a Token2022 token
      let isToken2022 = false;
      let mintInfo;

      try {
        // Try Token2022 program first
        mintInfo = await getToken2022Mint(
          connection,
          mintPubkey,
          "confirmed",
          TOKEN_2022_PROGRAM_ID
        );
        isToken2022 = true;
        logger.info(`Token ${tokenAddress} is a Token2022 token`);
      } catch (token2022Error) {
        // If Token2022 fails, try regular SPL token
        try {
          mintInfo = await getMint(connection, mintPubkey);
          isToken2022 = false;
          logger.info(`Token ${tokenAddress} is a regular SPL token`);
        } catch (splError) {
          logger.error(
            `Failed to get mint info for ${tokenAddress}:`,
            splError
          );
          return null;
        }
      }

      // Try to get metadata (works for both types)
      try {
        const metadata = await getTokenMetadata(connection, mintPubkey);

        if (metadata && metadata.name && metadata.symbol) {
          return {
            name: metadata.name,
            symbol: metadata.symbol,
            decimals: mintInfo.decimals,
            isToken2022,
          };
        }
      } catch (metadataError) {
        logger.warn(`No metadata extension found for ${tokenAddress}`);
      }

      // Fallback: return basic info based on token type
      return {
        name: isToken2022 ? "Token2022 Token" : "SPL Token",
        symbol: isToken2022 ? "T2022" : "SPL",
        decimals: mintInfo.decimals,
        isToken2022,
      };
    } catch (error) {
      logger.error(
        `Error fetching universal token info for ${tokenAddress}:`,
        error
      );
      return null;
    }
  }

  private async getDexScreenerTokenInfo(
    tokenAddress: string
  ): Promise<Partial<TokenInfo> | null> {
    try {
      const onChainInfo = await this.getMetaplexMetadata(tokenAddress);

      // First try Birdeye API
      // const response = await axios.get(
      //   "https://public-api.birdeye.so/defi/token_overview?address=" +
      //     tokenAddress,
      //   {
      //     headers: {
      //       accept: "application/json",
      //       "x-chain": "solana",
      //       "X-API-KEY": "e750e17792ae478983170f78486de13c",
      //     },
      //     timeout: 5000,
      //   }
      // );

      // const response = await axios.get(
      //   `${env.SOLANA_TRACKER_BASE_URL}/tokens/${tokenAddress}`,
      //   {
      //     headers: {
      //       accept: "application/json",
      //       "x-api-key": env.SOLANA_TRACKER_API_KEY,
      //     },
      //     timeout: 5000,
      //   }
      // );
      const service = new UnifiedMarketCapService(env.HELIUS_RPC_URL);
      let birdeyeResult: Partial<TokenInfo> | null = {};

      console.log("📊 Fetching market cap data...\n");
      const result = await service.calculateMarketCap(tokenAddress);
      if (!result) {
        const response = await axios.get(
          `${env.SOLANA_TRACKER_BASE_URL}/tokens/${tokenAddress}`,
          {
            headers: {
              accept: "application/json",
              "x-api-key": env.SOLANA_TRACKER_API_KEY,
            },
            timeout: 5000,
          }
        );
        const bestPair: SolanaTrackerResponse = response.data;
        birdeyeResult = {
          name: onChainInfo?.name || bestPair.token.name,
          symbol: onChainInfo?.symbol || bestPair.token.symbol,
          price: bestPair.pools[0]?.price?.usd || 0,
          priceChange24h: bestPair.events?.["24h"]?.priceChangePercentage || 0,
          marketCap: bestPair.pools[0]?.marketCap?.usd || 0,
          volume24h: bestPair.pools[0]?.txns?.volume24h || 0,
          liquidity: bestPair.pools[0]?.liquidity?.usd || 0,
          supply: `${bestPair.pools[0]?.tokenSupply}` || "0",
          decimals: bestPair.token.decimals,
          address: tokenAddress,
          image: onChainInfo?.image || bestPair.token.image,
          website: onChainInfo?.website || undefined,
          twitter:
            onChainInfo?.twitter ||
            bestPair.token.twitter ||
            bestPair.token.strictSocials?.twitter ||
            undefined,
          telegram:
            onChainInfo?.telegram ||
            bestPair.token.telegram ||
            bestPair.token.strictSocials?.telegram ||
            undefined,
          description:
            onChainInfo?.description || bestPair.token.description || undefined,
        };
      } else {
        const tokenData = result.data;

        const birdeyeResult = {
          name: tokenData?.name,
          symbol: tokenData?.symbol,
          price: tokenData?.price,
          priceChange24h: tokenData?.price,
          marketCap: tokenData?.marketCap,
          volume24h: -24,
          liquidity: tokenData?.tokenReserves,
          supply: `${tokenData?.totalSupply}`,
          decimals: 6,
          address: tokenAddress,
          image: onChainInfo?.image,
          website: onChainInfo?.website || "",
          twitter: onChainInfo?.twitter || "",
          telegram: onChainInfo?.telegram || "",
          description: onChainInfo?.description || "",
        };
      }

      // const bestPair: SolanaTrackerResponse = response.data;

      // Check if Birdeye returned unknown name and symbol, if so use DexScreener as fallback
      if (
        !birdeyeResult.name ||
        birdeyeResult.name.toLowerCase() === "unknown" ||
        !birdeyeResult.symbol ||
        birdeyeResult.symbol.toLowerCase() === "unknown"
      ) {
        logger.info(
          `Birdeye returned unknown token info for ${tokenAddress}, falling back to DexScreener`
        );

        try {
          const dexScreenerResponse = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
            {
              timeout: 5000,
            }
          );

          if (
            dexScreenerResponse.data?.pairs &&
            dexScreenerResponse.data.pairs.length > 0
          ) {
            // Get the pair with highest liquidity
            const bestDexPair = dexScreenerResponse.data.pairs.reduce(
              (best: any, current: any) => {
                const currentLiquidity = current.liquidity?.usd || 0;
                const bestLiquidity = best.liquidity?.usd || 0;
                return currentLiquidity > bestLiquidity ? current : best;
              }
            );

            // Use DexScreener data for name and symbol, keep Birdeye data for other fields
            if (bestDexPair.baseToken) {
              birdeyeResult.name =
                bestDexPair.baseToken.name || birdeyeResult.name;
              birdeyeResult.symbol =
                bestDexPair.baseToken.symbol || birdeyeResult.symbol;
              birdeyeResult.decimals =
                bestDexPair.baseToken.decimals || birdeyeResult.decimals;
              birdeyeResult.price =
                +bestDexPair.priceUsd || +birdeyeResult.price! || 0;
              birdeyeResult.priceChange24h =
                bestDexPair.priceChange?.h24 ||
                birdeyeResult.priceChange24h ||
                0;
              birdeyeResult.marketCap =
                bestDexPair.marketCap || birdeyeResult.marketCap || 0;
              birdeyeResult.volume24h =
                bestDexPair.volume?.h24 || birdeyeResult.volume24h || 0;
              birdeyeResult.liquidity =
                bestDexPair.liquidity?.usd || birdeyeResult.liquidity || 0;
              logger.info(
                `Updated token info from DexScreener: ${birdeyeResult.name} (${birdeyeResult.symbol})`
              );
            }
          }
        } catch (dexScreenerError) {
          logger.warn("DexScreener fallback failed:", dexScreenerError);
          // Continue with Birdeye data even if DexScreener fails
        }

        // If still unknown after DexScreener, try Token2022/SPL metadata as final fallback
        if (
          !birdeyeResult.name ||
          birdeyeResult.name.toLowerCase() === "spl token" ||
          !birdeyeResult.symbol ||
          birdeyeResult.symbol.toLowerCase() === "spl token"
        ) {
          logger.info(
            `Both Birdeye and DexScreener returned unknown for ${tokenAddress}, trying Token2022/SPL metadata`
          );

          try {
            const onChainInfo = await this.getUniversalTokenInfo(tokenAddress);
            if (onChainInfo && onChainInfo.name && onChainInfo.symbol) {
              birdeyeResult.name = onChainInfo.name;
              birdeyeResult.symbol = onChainInfo.symbol;
              logger.info(
                `Updated token info from on-chain metadata: ${
                  birdeyeResult.name
                } (${birdeyeResult.symbol}) - ${
                  onChainInfo.isToken2022 ? "Token2022" : "SPL"
                }`
              );
            }
          } catch (onChainError) {
            logger.warn("On-chain metadata fallback failed:", onChainError);
            // Continue with existing data
          }
        }
      }

      return birdeyeResult;
    } catch (error) {
      console.error("Error fetching token info:", error);
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
      image: dexScreener?.image,
      dex: dexScreener?.dexId || "Unknown Dex",
      website: dexScreener?.website,
      twitter: dexScreener?.twitter,
      telegram: dexScreener?.telegram,
      description: dexScreener?.description,
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
    const dexScreenerMatches = Array.from(text.matchAll(dexScreenerRegex));

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
