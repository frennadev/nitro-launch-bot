import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  AccountInfo,
} from "@solana/web3.js";
// type AccountInfo<T> = AccountInfo<T>;
// We'll use manual parsing instead of borsh for better compatibility

/**
 * 🚀 PUMPFUN MARKET CAP CALCULATION SERVICE
 *
 * Uses Helius RPC + Official PumpFun IDL to calculate accurate market caps
 * for both bonded tokens (on curve) and graduated tokens (on Raydium)
 */

// PumpFun Program Constants from IDL
export const PUMPFUN_PROGRAM = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
export const PUMP_AMM_PROGRAM = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
);

// Account discriminators from IDL
const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];
const GLOBAL_DISCRIMINATOR = [167, 232, 232, 177, 200, 108, 114, 127];

// Manual parsing functions for better compatibility
function readU64(buffer: Buffer, offset: number): bigint {
  return buffer.readBigUInt64LE(offset);
}

function readU8(buffer: Buffer, offset: number): number {
  return buffer.readUInt8(offset);
}

function readPublicKey(buffer: Buffer, offset: number): PublicKey {
  return new PublicKey(buffer.slice(offset, offset + 32));
}

// Type definitions matching IDL
export interface BondingCurveData {
  virtual_token_reserves: bigint;
  virtual_sol_reserves: bigint;
  real_token_reserves: bigint;
  real_sol_reserves: bigint;
  token_total_supply: bigint;
  complete: boolean;
  creator: PublicKey;
}

export interface GlobalData {
  initialized: boolean;
  authority: PublicKey;
  fee_recipient: PublicKey;
  initial_virtual_token_reserves: bigint;
  initial_virtual_sol_reserves: bigint;
  initial_real_token_reserves: bigint;
  token_total_supply: bigint;
  fee_basis_points: bigint;
  withdraw_authority: PublicKey;
  enable_migrate: boolean;
  pool_migration_fee: bigint;
  creator_fee_basis_points: bigint;
  fee_recipients: PublicKey[];
  set_creator_authority: PublicKey;
  admin_set_creator_authority: PublicKey;
}

export interface PumpFunTokenInfo {
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
  solReserves: number; // in SOL
  tokenReserves: number;
  bondingCurveData?: BondingCurveData;
  pumpAmmPoolData?: any; // For graduated tokens
}

export interface MarketCapResult {
  success: boolean;
  data?: PumpFunTokenInfo;
  error?: string;
}

export class PumpFunMarketCapService {
  private connection: Connection;
  private solPriceUsd: number = 0;
  private lastSolPriceUpdate: number = 0;
  private readonly SOL_PRICE_CACHE_MS = 60000; // 1 minute cache

  constructor(heliusRpcUrl: string) {
    this.connection = new Connection(heliusRpcUrl, "confirmed");
  }

  /**
   * 🎯 MAIN FUNCTION: Calculate PumpFun token market cap
   */
  async calculateMarketCap(mintAddress: string): Promise<MarketCapResult> {
    try {
      const mint = new PublicKey(mintAddress);

      // Get fresh SOL price
      await this.updateSolPrice();

      // 1. Check if token exists and get bonding curve
      const bondingCurveAddress = this.getBondingCurveAddress(mint);
      const bondingCurveAccount =
        await this.connection.getAccountInfo(bondingCurveAddress);

      if (!bondingCurveAccount) {
        return {
          success: false,
          error: "Token not found or not a PumpFun token",
        };
      }

      // 2. Parse bonding curve data
      const bondingCurveData = this.parseBondingCurve(bondingCurveAccount.data);

      // 3. Get token metadata
      const metadata = await this.getTokenMetadata(mint);

      // 4. Check if token is graduated (migrated to Raydium)
      if (bondingCurveData.complete) {
        return await this.calculateGraduatedTokenMarketCap(
          mint,
          bondingCurveData,
          metadata
        );
      } else {
        return await this.calculateBondedTokenMarketCap(
          mint,
          bondingCurveData,
          metadata
        );
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to calculate market cap: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  /**
   * 💎 Calculate market cap for bonded tokens (still on curve)
   */
  private async calculateBondedTokenMarketCap(
    mint: PublicKey,
    bondingCurveData: BondingCurveData,
    metadata: any
  ): Promise<MarketCapResult> {
    // Calculate current price based on bonding curve
    const currentPrice = this.calculateBondingCurvePrice(bondingCurveData);
    const priceUsd = currentPrice * this.solPriceUsd;

    const totalSupply = Number(bondingCurveData.token_total_supply) / 1e6;

    // Calculate circulating supply
    let circulatingSupply: number;
    if (bondingCurveData.complete) {
      // If completed, all tokens are circulating
      circulatingSupply = totalSupply;
    } else {
      // For active curves, circulating = total - what's still in the curve
      circulatingSupply =
        Number(
          bondingCurveData.token_total_supply -
            bondingCurveData.real_token_reserves
        ) / 1e6;
    }

    // Market cap = TOTAL supply × price (PumpFun uses fully diluted market cap)
    const marketCap = totalSupply * priceUsd;

    const tokenInfo: PumpFunTokenInfo = {
      mint: mint.toBase58(),
      name: metadata?.name,
      symbol: metadata?.symbol,
      image: metadata?.image,
      description: metadata?.description,
      creator: bondingCurveData.creator.toBase58(),
      isComplete: false,
      isMigrated: false,
      marketCap,
      price: priceUsd,
      totalSupply,
      circulatingSupply,
      solReserves:
        Number(bondingCurveData.virtual_sol_reserves) / LAMPORTS_PER_SOL,
      tokenReserves: Number(bondingCurveData.virtual_token_reserves) / 1e6,
      bondingCurveData,
    };

    return {
      success: true,
      data: tokenInfo,
    };
  }

  /**
   * 🚀 Calculate market cap for graduated tokens (migrated to PumpFun AMM)
   */
  private async calculateGraduatedTokenMarketCap(
    mint: PublicKey,
    bondingCurveData: BondingCurveData,
    metadata: any
  ): Promise<MarketCapResult> {
    try {
      // For graduated tokens, we need to check PumpFun AMM pool
      const poolAddress = this.getPumpAmmPoolAddress(mint);
      const poolData = await this.getPumpAmmPoolData(poolAddress);

      if (!poolData) {
        // Fallback: use last known bonding curve data
        return this.calculateBondedTokenMarketCap(
          mint,
          bondingCurveData,
          metadata
        );
      }

      // Calculate price from PumpFun AMM pool reserves
      const price = this.calculateAmmPrice(poolData);
      const priceUsd = price * this.solPriceUsd;

      const totalSupply = Number(bondingCurveData.token_total_supply) / 1e6;
      const marketCap = totalSupply * priceUsd;

      const tokenInfo: PumpFunTokenInfo = {
        mint: mint.toBase58(),
        name: metadata?.name,
        symbol: metadata?.symbol,
        image: metadata?.image,
        description: metadata?.description,
        creator: bondingCurveData.creator.toBase58(),
        isComplete: true,
        isMigrated: true,
        marketCap,
        price: priceUsd,
        totalSupply,
        circulatingSupply: totalSupply, // All tokens are circulating after graduation
        solReserves: poolData.solReserves,
        tokenReserves: poolData.tokenReserves,
        bondingCurveData,
        pumpAmmPoolData: poolData,
      };

      return {
        success: true,
        data: tokenInfo,
      };
    } catch (error) {
      // Fallback to bonding curve calculation
      return this.calculateBondedTokenMarketCap(
        mint,
        bondingCurveData,
        metadata
      );
    }
  }

  /**
   * 📊 Calculate current token price from bonding curve reserves
   */
  private calculateBondingCurvePrice(bondingCurve: BondingCurveData): number {
    // PumpFun bonding curve price calculation
    const virtualSolReserves =
      Number(bondingCurve.virtual_sol_reserves) / LAMPORTS_PER_SOL;
    const virtualTokenReserves =
      Number(bondingCurve.virtual_token_reserves) / 1e6;

    // Handle edge cases
    if (virtualTokenReserves === 0 || virtualSolReserves === 0) {
      return 0;
    }

    // If the curve is complete, use real reserves instead
    if (bondingCurve.complete) {
      const realSolReserves =
        Number(bondingCurve.real_sol_reserves) / LAMPORTS_PER_SOL;
      const realTokenReserves = Number(bondingCurve.real_token_reserves) / 1e6;

      if (realTokenReserves === 0 || realSolReserves === 0) {
        return 0;
      }

      return realSolReserves / realTokenReserves;
    }

    // For active bonding curves, use virtual reserves
    return virtualSolReserves / virtualTokenReserves;
  }

  /**
   * 🏊 Calculate price from PumpFun AMM pool data
   */
  private calculateAmmPrice(poolData: any): number {
    if (!poolData.solReserves || !poolData.tokenReserves) return 0;
    return poolData.solReserves / poolData.tokenReserves;
  }

  /**
   * 🔍 Get bonding curve PDA address
   */
  private getBondingCurveAddress(mint: PublicKey): PublicKey {
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      PUMPFUN_PROGRAM
    );
    return bondingCurve;
  }

  /**
   * 🏊 Get PumpFun AMM pool address for graduated token
   */
  private getPumpAmmPoolAddress(mint: PublicKey): PublicKey {
    // Based on IDL: pool PDA with seeds ["pool", [0,0], pool_authority, mint, wsol_mint]
    const PUMP_AMM_PROGRAM = new PublicKey(
      "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
    );
    const WSOL_MINT = new PublicKey(
      "So11111111111111111111111111111111111111112"
    );

    // First get pool authority
    const [poolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool-authority"), mint.toBuffer()],
      PUMPFUN_PROGRAM
    );

    // Then get the actual pool address
    const [poolAddress] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool"),
        Buffer.from([0, 0]), // version bytes
        poolAuthority.toBuffer(),
        mint.toBuffer(),
        WSOL_MINT.toBuffer(),
      ],
      PUMP_AMM_PROGRAM
    );

    return poolAddress;
  }

  /**
   * 📊 Parse bonding curve account data manually
   */
  private parseBondingCurve(data: Buffer): BondingCurveData {
    // Skip discriminator (first 8 bytes)
    let offset = 8;

    // Parse according to BondingCurve struct from IDL:
    // virtual_token_reserves: u64
    // virtual_sol_reserves: u64
    // real_token_reserves: u64
    // real_sol_reserves: u64
    // token_total_supply: u64
    // complete: bool
    // creator: pubkey

    const virtual_token_reserves = readU64(data, offset);
    offset += 8;

    const virtual_sol_reserves = readU64(data, offset);
    offset += 8;

    const real_token_reserves = readU64(data, offset);
    offset += 8;

    const real_sol_reserves = readU64(data, offset);
    offset += 8;

    const token_total_supply = readU64(data, offset);
    offset += 8;

    const complete = readU8(data, offset) === 1;
    offset += 1;

    const creator = readPublicKey(data, offset);

    return {
      virtual_token_reserves,
      virtual_sol_reserves,
      real_token_reserves,
      real_sol_reserves,
      token_total_supply,
      complete,
      creator,
    };
  }

  /**
   * 🏊 Get PumpFun AMM pool data for graduated tokens
   */
  private async getPumpAmmPoolData(
    poolAddress: PublicKey
  ): Promise<any | null> {
    try {
      const poolAccount = await this.connection.getAccountInfo(poolAddress);
      if (!poolAccount) return null;

      // For now, we'll try to get the token account balances directly
      // This is a simplified approach - in production you'd want to parse the actual pool structure
      const WSOL_MINT = new PublicKey(
        "So11111111111111111111111111111111111111112"
      );

      // Get the pool's token accounts
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(
        poolAddress,
        {
          programId: new PublicKey(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          ),
        }
      );

      let solReserves = 0;
      let tokenReserves = 0;

      for (const account of tokenAccounts.value) {
        const accountData = account.account.data;
        // Parse token account data to get mint and balance
        const mint = new PublicKey(accountData.slice(0, 32));
        const amount = Number(accountData.readBigUInt64LE(64));

        if (mint.equals(WSOL_MINT)) {
          solReserves = amount / 1e9; // Convert lamports to SOL
        } else {
          tokenReserves = amount / 1e6; // Convert to token units
        }
      }

      return {
        solReserves,
        tokenReserves,
        poolAddress: poolAddress.toBase58(),
      };
    } catch (error) {
      console.warn(`Failed to fetch PumpFun AMM pool data: ${error}`);
      return null;
    }
  }

  /**
   * 🏷️ Get token metadata from Metaplex
   */
  private async getTokenMetadata(mint: PublicKey): Promise<any> {
    try {
      // Derive metadata PDA
      const METADATA_PROGRAM = new PublicKey(
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
      );
      const [metadataAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
        METADATA_PROGRAM
      );

      const metadataAccount =
        await this.connection.getAccountInfo(metadataAddress);
      if (!metadataAccount) return null;

      // Parse metadata (simplified - you might want to use @metaplex-foundation/mpl-token-metadata)
      // For now, return basic structure
      return {
        name: "Unknown",
        symbol: "UNK",
        image: null,
        description: null,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 💰 Update SOL price from external API
   */
  private async updateSolPrice(): Promise<void> {
    const now = Date.now();
    if (
      now - this.lastSolPriceUpdate < this.SOL_PRICE_CACHE_MS &&
      this.solPriceUsd > 0
    ) {
      return; // Use cached price
    }

    try {
      // Using CoinGecko API - free tier, no key required
      const response = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        {
          headers: {
            Accept: "application/json",
            "User-Agent":
              "Mozilla/5.0 (compatible; PumpFun-MarketCap-Service/1.0)",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: any = await response.json();

      if (data.solana?.usd && typeof data.solana.usd === "number") {
        this.solPriceUsd = data.solana.usd;
        this.lastSolPriceUpdate = now;
        console.log(`💰 SOL price updated: $${this.solPriceUsd}`);
      } else {
        throw new Error("Invalid price data structure");
      }
    } catch (error) {
      console.warn(`Failed to fetch SOL price: ${error}`);
      // Fallback price if API fails
      if (this.solPriceUsd === 0) {
        this.solPriceUsd = 220; // Current reasonable fallback for SOL
        console.log(`💰 Using fallback SOL price: $${this.solPriceUsd}`);
      }
    }
  }

  /**
   * 🔄 Batch calculate market caps for multiple tokens
   */
  async batchCalculateMarketCaps(
    mintAddresses: string[]
  ): Promise<MarketCapResult[]> {
    const promises = mintAddresses.map((mint) => this.calculateMarketCap(mint));
    return await Promise.all(promises);
  }

  /**
   * 📈 Get current SOL price
   */
  getSolPrice(): number {
    return this.solPriceUsd;
  }
}

/**
 * 🚀 UTILITY FUNCTIONS
 */

/**
 * Check if a token is a PumpFun token
 */
export async function isPumpFunToken(
  connection: Connection,
  mintAddress: string
): Promise<boolean> {
  try {
    const mint = new PublicKey(mintAddress);
    const service = new PumpFunMarketCapService(connection.rpcEndpoint);
    const bondingCurveAddress = service["getBondingCurveAddress"](mint);
    const account = await connection.getAccountInfo(bondingCurveAddress);
    return account !== null;
  } catch {
    return false;
  }
}

/**
 * Format market cap for display
 */
export function formatMarketCap(marketCap: number): string {
  if (marketCap >= 1_000_000_000) {
    return `$${(marketCap / 1_000_000_000).toFixed(2)}B`;
  } else if (marketCap >= 1_000_000) {
    return `$${(marketCap / 1_000_000).toFixed(2)}M`;
  } else if (marketCap >= 1_000) {
    return `$${(marketCap / 1_000).toFixed(2)}K`;
  } else {
    return `$${marketCap.toFixed(2)}`;
  }
}

/**
 * Format price for display
 */
export function formatPrice(price: number): string {
  if (price >= 1) {
    return `$${price.toFixed(4)}`;
  } else if (price >= 0.0001) {
    return `$${price.toFixed(6)}`;
  } else {
    return `$${price.toExponential(2)}`;
  }
}

export default PumpFunMarketCapService;
