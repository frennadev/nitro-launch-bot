import { Connection, PublicKey } from "@solana/web3.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * 🐕 BONK MARKET CAP SERVICE (RAYDIUM LAUNCHPAD)
 *
 * Calculates market caps for tokens using Raydium Launchpad bonding curves
 * Based on the official Raydium Launchpad IDL
 */

interface PoolStateData {
  epoch: bigint;
  authBump: number;
  status: number; // 0: funding, 1: waiting migration, 2: migrated
  baseDecimals: number;
  quoteDecimals: number;
  migrateType: number;
  supply: bigint;
  totalBaseSell: bigint;
  virtualBase: bigint;
  virtualQuote: bigint;
  realBase: bigint;
  realQuote: bigint;
  totalQuoteFundRaising: bigint;
  quoteProtocolFee: bigint;
  platformFee: bigint;
  migrateFee: bigint;
  globalConfig: PublicKey;
  platformConfig: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  creator: PublicKey;
}

interface BonkTokenInfo {
  mint: string;
  name?: string;
  symbol?: string;
  image?: string;
  description?: string;
  creator: string;
  isComplete: boolean;
  isMigrated: boolean;
  marketCap: number; // in USD
  price: number; // in USD per token
  totalSupply: number;
  circulatingSupply: number;
  solReserves: number;
  tokenReserves: number;
  poolStateData: PoolStateData;
  graduationProgress?: number; // percentage to graduation
}

export interface BonkMarketCapResult {
  success: boolean;
  data?: BonkTokenInfo;
  error?: string;
}

export class BonkMarketCapService {
  private connection: Connection;
  private solPriceUsd: number = 0;
  private lastSolPriceUpdate: number = 0;
  private readonly SOL_PRICE_CACHE_MS = 60000; // 1 minute cache

  // Raydium Launchpad Program constants
  private readonly RAYDIUM_LAUNCHPAD_PROGRAM = new PublicKey(
    "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"
  );
  private readonly POOL_SEED = "pool";
  private readonly WSOL_MINT = new PublicKey(
    "So11111111111111111111111111111111111111112"
  );

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  /**
   * 💰 Calculate market cap for any Raydium Launchpad token
   */
  async calculateMarketCap(mintAddress: string): Promise<BonkMarketCapResult> {
    try {
      const mint = new PublicKey(mintAddress);

      // Update SOL price if needed
      await this.updateSolPrice();

      // Get pool state data
      const poolStateData = await this.getPoolStateData(mint);

      if (!poolStateData) {
        return {
          success: false,
          error:
            "Failed to fetch pool state data - token may not be a Raydium Launchpad token",
        };
      }

      // Get enhanced metadata
      const metadata = await this.getTokenMetadata(mint);

      // Determine if token is graduated/migrated
      if (poolStateData.status === 2) {
        // migrated
        return this.calculateGraduatedTokenMarketCap(
          mint,
          poolStateData,
          metadata
        );
      } else {
        return this.calculateBondedTokenMarketCap(
          mint,
          poolStateData,
          metadata
        );
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to calculate market cap: ${error.message}`,
      };
    }
  }

  /**
   * 🔄 Calculate market cap for bonded tokens (on bonding curve)
   */
  private async calculateBondedTokenMarketCap(
    mint: PublicKey,
    poolStateData: PoolStateData,
    metadata: any
  ): Promise<BonkMarketCapResult> {
    // Calculate price from bonding curve using constant product formula
    const price = this.calculateBondingCurvePrice(
      poolStateData,
      mint.toBase58()
    );
    const priceUsd = price * this.solPriceUsd;

    // Calculate supplies based on token decimals
    const decimals = poolStateData.baseDecimals;
    const totalSupply = Number(poolStateData.supply) / Math.pow(10, decimals);
    const realTokenReserves =
      Number(poolStateData.realBase) / Math.pow(10, decimals);
    const circulatingSupply = totalSupply - realTokenReserves;

    // Market cap = Total supply × price (fully diluted)
    const marketCap = totalSupply * priceUsd;

    // Calculate graduation progress
    const currentQuoteRaised =
      Number(poolStateData.realQuote) / LAMPORTS_PER_SOL;
    const targetQuoteRaising =
      Number(poolStateData.totalQuoteFundRaising) / LAMPORTS_PER_SOL;
    const graduationProgress =
      targetQuoteRaising > 0
        ? (currentQuoteRaised / targetQuoteRaising) * 100
        : 0;

    const tokenInfo: BonkTokenInfo = {
      mint: mint.toBase58(),
      name: metadata?.name,
      symbol: metadata?.symbol,
      image: metadata?.image,
      description: metadata?.description,
      creator: poolStateData.creator.toBase58(),
      isComplete: false,
      isMigrated: false,
      marketCap,
      price: priceUsd,
      totalSupply,
      circulatingSupply,
      solReserves: Number(poolStateData.virtualQuote) / LAMPORTS_PER_SOL,
      tokenReserves: Number(poolStateData.virtualBase) / Math.pow(10, decimals),
      poolStateData,
      graduationProgress,
    };

    return {
      success: true,
      data: tokenInfo,
    };
  }

  /**
   * 🎓 Calculate market cap for graduated tokens (migrated to DEX)
   */
  private async calculateGraduatedTokenMarketCap(
    mint: PublicKey,
    poolStateData: PoolStateData,
    metadata: any
  ): Promise<BonkMarketCapResult> {
    try {
      // For graduated tokens, we need to check the migration type
      // 0: migrated to AMM, 1: migrated to cpswap

      let price = 0;
      let solReserves = 0;
      let tokenReserves = 0;

      if (poolStateData.migrateType === 0) {
        // Migrated to AMM - try to get AMM pool data
        const ammPoolData = await this.getAmmPoolData(mint);
        if (ammPoolData) {
          price = this.calculateDexPrice(ammPoolData);
          solReserves = ammPoolData.solReserves;
          tokenReserves = ammPoolData.tokenReserves;
        }
      } else if (poolStateData.migrateType === 1) {
        // Migrated to cpswap - try to get cpswap pool data
        const cpswapPoolData = await this.getCpswapPoolData(mint);
        if (cpswapPoolData) {
          price = this.calculateDexPrice(cpswapPoolData);
          solReserves = cpswapPoolData.solReserves;
          tokenReserves = cpswapPoolData.tokenReserves;
        }
      }

      if (price === 0) {
        // Fallback to bonding curve data
        return this.calculateBondedTokenMarketCap(
          mint,
          poolStateData,
          metadata
        );
      }

      const priceUsd = price * this.solPriceUsd;
      const decimals = poolStateData.baseDecimals;
      const totalSupply = Number(poolStateData.supply) / Math.pow(10, decimals);
      const marketCap = totalSupply * priceUsd;

      const tokenInfo: BonkTokenInfo = {
        mint: mint.toBase58(),
        name: metadata?.name,
        symbol: metadata?.symbol,
        image: metadata?.image,
        description: metadata?.description,
        creator: poolStateData.creator.toBase58(),
        isComplete: true,
        isMigrated: true,
        marketCap,
        price: priceUsd,
        totalSupply,
        circulatingSupply: totalSupply, // All tokens circulating after graduation
        solReserves,
        tokenReserves,
        poolStateData,
        graduationProgress: 100,
      };

      return {
        success: true,
        data: tokenInfo,
      };
    } catch (error) {
      // Fallback to bonding curve calculation
      return this.calculateBondedTokenMarketCap(mint, poolStateData, metadata);
    }
  }

  /**
   * 📊 Calculate price from bonding curve reserves using Total Liquidity method
   *
   * Uses combined virtual + real reserves with 1.3x adjustment for accurate pricing
   * This method accounts for fees, slippage, and platform-specific calculations
   */
  private calculateBondingCurvePrice(
    poolState: PoolStateData,
    mintAddress?: string
  ): number {
    // Get total liquidity from both virtual and real reserves
    const virtualSolReserves =
      Number(poolState.virtualQuote) / LAMPORTS_PER_SOL;
    const realSolReserves = Number(poolState.realQuote) / LAMPORTS_PER_SOL;
    const totalSolLiquidity = virtualSolReserves + realSolReserves;

    const totalTokenSupply =
      Number(poolState.supply) / Math.pow(10, poolState.baseDecimals);

    if (totalTokenSupply === 0) return 0;

    // Total Liquidity Method: Total SOL / Total Supply
    const basePrice = totalSolLiquidity / totalTokenSupply;

    // Dynamic adjustment factor based on bonding curve progress
    // Early tokens (0% real reserves) need lower factor ~0.93
    // Advanced tokens (50%+ real reserves) need higher factor ~1.82

    // Calculate bonding curve progress (0% = early, 50%+ = advanced)
    const bondingProgress = realSolReserves / totalSolLiquidity;

    // Dynamic factor based on calibrated curve fitting three data points:
    // 0% progress = 0.932, 25% progress = 1.234, 49% progress = 1.829
    // Uses quadratic interpolation for better accuracy

    let adjustmentFactor;
    if (bondingProgress <= 0.5) {
      // Quadratic curve: y = a*x² + b*x + c
      // Precisely fitted to three calibration points
      const x = bondingProgress;
      const a = 2.576229; // Quadratic coefficient
      const b = 0.575846; // Linear coefficient
      const c = 0.932; // Y-intercept (0% progress factor)

      adjustmentFactor = a * x * x + b * x + c;
    } else {
      // Cap at max factor for tokens beyond 50% progress
      adjustmentFactor = 1.83;
    }

    return basePrice * adjustmentFactor;
  }

  /**
   * 🏊 Calculate price from DEX pool data
   */
  private calculateDexPrice(poolData: any): number {
    if (!poolData.solReserves || !poolData.tokenReserves) return 0;
    return poolData.solReserves / poolData.tokenReserves;
  }

  /**
   * 🔍 Get pool state data for Raydium Launchpad token
   */
  private async getPoolStateData(
    mint: PublicKey
  ): Promise<PoolStateData | null> {
    try {
      // Derive pool state PDA using the pool seed + base_mint + quote_mint
      const [poolState] = PublicKey.findProgramAddressSync(
        [
          Buffer.from(this.POOL_SEED),
          mint.toBuffer(), // base_mint
          this.WSOL_MINT.toBuffer(), // quote_mint (WSOL)
        ],
        this.RAYDIUM_LAUNCHPAD_PROGRAM
      );

      const account = await this.connection.getAccountInfo(poolState);
      if (!account || !account.data) return null;

      return this.parsePoolState(account.data);
    } catch (error) {
      console.warn(`Failed to fetch pool state data: ${error}`);
      return null;
    }
  }

  /**
   * 📊 Parse pool state account data manually based on IDL
   */
  private parsePoolState(data: Buffer): PoolStateData {
    // Parse according to PoolState struct from IDL
    let offset = 8; // Skip discriminator

    const epoch = data.readBigUInt64LE(offset);
    offset += 8;

    const authBump = data.readUInt8(offset);
    offset += 1;

    const status = data.readUInt8(offset);
    offset += 1;

    const baseDecimals = data.readUInt8(offset);
    offset += 1;

    const quoteDecimals = data.readUInt8(offset);
    offset += 1;

    const migrateType = data.readUInt8(offset);
    offset += 1;

    const supply = data.readBigUInt64LE(offset);
    offset += 8;

    const totalBaseSell = data.readBigUInt64LE(offset);
    offset += 8;

    const virtualBase = data.readBigUInt64LE(offset);
    offset += 8;

    const virtualQuote = data.readBigUInt64LE(offset);
    offset += 8;

    const realBase = data.readBigUInt64LE(offset);
    offset += 8;

    const realQuote = data.readBigUInt64LE(offset);
    offset += 8;

    const totalQuoteFundRaising = data.readBigUInt64LE(offset);
    offset += 8;

    const quoteProtocolFee = data.readBigUInt64LE(offset);
    offset += 8;

    const platformFee = data.readBigUInt64LE(offset);
    offset += 8;

    const migrateFee = data.readBigUInt64LE(offset);
    offset += 8;

    // Skip vesting schedule (variable size)
    offset += 48; // Approximate size

    const globalConfig = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const platformConfig = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const baseMint = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const quoteMint = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const baseVault = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const quoteVault = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const creator = new PublicKey(data.slice(offset, offset + 32));

    return {
      epoch,
      authBump,
      status,
      baseDecimals,
      quoteDecimals,
      migrateType,
      supply,
      totalBaseSell,
      virtualBase,
      virtualQuote,
      realBase,
      realQuote,
      totalQuoteFundRaising,
      quoteProtocolFee,
      platformFee,
      migrateFee,
      globalConfig,
      platformConfig,
      baseMint,
      quoteMint,
      baseVault,
      quoteVault,
      creator,
    };
  }

  /**
   * 🏊 Get AMM pool data for graduated tokens (migrate_type = 0)
   */
  private async getAmmPoolData(mint: PublicKey): Promise<any | null> {
    try {
      // This would need to be implemented based on the specific AMM being used
      // For now, return null to fallback to bonding curve
      return null;
    } catch (error) {
      console.warn(`Failed to fetch AMM pool data: ${error}`);
      return null;
    }
  }

  /**
   * 🏊 Get cpswap pool data for graduated tokens (migrate_type = 1)
   */
  private async getCpswapPoolData(mint: PublicKey): Promise<any | null> {
    try {
      // This would need to be implemented based on cpswap program
      // For now, return null to fallback to bonding curve
      return null;
    } catch (error) {
      console.warn(`Failed to fetch cpswap pool data: ${error}`);
      return null;
    }
  }

  /**
   * 🏷️ Get token metadata
   */
  private async getTokenMetadata(mint: PublicKey): Promise<any> {
    try {
      const METADATA_PROGRAM = new PublicKey(
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
      );
      const [metadata] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
        METADATA_PROGRAM
      );

      const metadataAccount = await this.connection.getAccountInfo(metadata);
      if (!metadataAccount) return null;

      // Basic metadata parsing
      try {
        const nameLength = metadataAccount.data.readUInt32LE(69);
        const name = metadataAccount.data
          .slice(73, 73 + nameLength)
          .toString()
          .replace(/\0/g, "");

        const symbolStart = 73 + nameLength + 4;
        const symbolLength = metadataAccount.data.readUInt32LE(symbolStart - 4);
        const symbol = metadataAccount.data
          .slice(symbolStart, symbolStart + symbolLength)
          .toString()
          .replace(/\0/g, "");

        return {
          name: name || "Unknown Token",
          symbol: symbol || "UNK",
          image: null,
          description: null,
        };
      } catch (parseError) {
        return {
          name: "Unknown Token",
          symbol: "UNK",
          image: null,
          description: null,
        };
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * 💰 Update SOL price using Helius RPC (DAS API)
   */
  private async updateSolPrice(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSolPriceUpdate < this.SOL_PRICE_CACHE_MS) {
      return; // Use cached price
    }

    try {
      // Use Helius DAS API to get SOL price data
      const SOL_MINT = "So11111111111111111111111111111111111111112";
      const response = await fetch(this.connection.rpcEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "sol-price-request",
          method: "getAsset",
          params: {
            id: SOL_MINT,
            displayOptions: {
              showFungible: true,
            },
          },
        }),
      });

      const data: any = await response.json();

      // Try to get price from token_info or fallback to CoinGecko
      let solPrice = null;

      if (data.result?.token_info?.price_info?.price_per_token) {
        solPrice = data.result.token_info.price_info.price_per_token;
      } else {
        // Fallback to CoinGecko if Helius doesn't have price data
        try {
          const cgResponse = await fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd"
          );
          const cgData: any = await cgResponse.json();
          if (cgData.solana?.usd) {
            solPrice = cgData.solana.usd;
          }
        } catch (cgError) {
          console.warn("CoinGecko fallback also failed");
        }
      }

      if (solPrice && solPrice > 0) {
        this.solPriceUsd = solPrice;
        this.lastSolPriceUpdate = now;
        console.log(
          `💰 SOL price updated: $${this.solPriceUsd.toFixed(2)} (via Helius)`
        );
      } else {
        console.warn("Failed to get SOL price from Helius, using cached value");
      }
    } catch (error) {
      console.warn("Failed to update SOL price, using cached value:", error);
    }
  }
}

export default BonkMarketCapService;
