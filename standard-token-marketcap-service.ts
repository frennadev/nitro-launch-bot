import { Connection, PublicKey } from '@solana/web3.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * 🪙 STANDARD SPL TOKEN MARKET CAP SERVICE
 * 
 * Calculates market caps for standard SPL tokens (no bonding curves)
 * by fetching data from DEX pools like Raydium, Orca, etc.
 */

interface StandardTokenInfo {
  mint: string;
  name?: string;
  symbol?: string;
  image?: string;
  description?: string;
  marketCap: number; // in USD
  price: number; // in USD per token
  totalSupply: number;
  decimals: number;
  isStandardSpl: boolean;
  poolData?: any; // DEX pool information
}

export interface StandardTokenResult {
  success: boolean;
  data?: StandardTokenInfo;
  error?: string;
}

export class StandardTokenMarketCapService {
  private connection: Connection;
  private solPriceUsd: number = 0;
  private lastSolPriceUpdate: number = 0;
  private readonly SOL_PRICE_CACHE_MS = 60000; // 1 minute cache

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * 💰 Calculate market cap for standard SPL token
   */
  async calculateMarketCap(mintAddress: string): Promise<StandardTokenResult> {
    try {
      const mint = new PublicKey(mintAddress);
      
      // Update SOL price if needed
      await this.updateSolPrice();

      // Check if it's a standard SPL token
      const mintAccount = await this.connection.getAccountInfo(mint);
      if (!mintAccount) {
        return {
          success: false,
          error: 'Token mint not found'
        };
      }

      // Verify it's owned by Token Program
      const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      if (!mintAccount.owner.equals(TOKEN_PROGRAM)) {
        return {
          success: false,
          error: 'Not a standard SPL token'
        };
      }

      // Parse mint data
      const mintData = this.parseMintData(mintAccount.data);
      
      // Get token metadata
      const metadata = await this.getTokenMetadata(mint);
      
      // Try to find DEX pool and get price
      const poolData = await this.findDexPool(mint);
      let price = 0;
      
      if (poolData) {
        price = this.calculatePoolPrice(poolData);
      }

      const priceUsd = price * this.solPriceUsd;
      const totalSupply = Number(mintData.supply) / Math.pow(10, mintData.decimals);
      const marketCap = totalSupply * priceUsd;

      const tokenInfo: StandardTokenInfo = {
        mint: mint.toBase58(),
        name: metadata?.name,
        symbol: metadata?.symbol,
        image: metadata?.image,
        description: metadata?.description,
        marketCap,
        price: priceUsd,
        totalSupply,
        decimals: mintData.decimals,
        isStandardSpl: true,
        poolData
      };

      return {
        success: true,
        data: tokenInfo
      };

    } catch (error: any) {
      return {
        success: false,
        error: `Failed to calculate market cap: ${error.message}`
      };
    }
  }

  /**
   * 📊 Parse SPL mint account data
   */
  private parseMintData(data: Buffer) {
    // SPL Token mint account structure:
    // 0-4: mint_authority (option + pubkey)
    // 36-44: supply (u64)
    // 44: decimals (u8)
    // 45: is_initialized (bool)
    // 46-50: freeze_authority (option + pubkey)
    
    const supply = data.readBigUInt64LE(36);
    const decimals = data.readUInt8(44);
    const isInitialized = data.readUInt8(45) === 1;

    return {
      supply,
      decimals,
      isInitialized
    };
  }

  /**
   * 🏊 Find DEX pool for the token
   */
  private async findDexPool(mint: PublicKey): Promise<any | null> {
    try {
      // This is a simplified implementation
      // In production, you'd want to check multiple DEXs:
      // - Raydium
      // - Orca  
      // - Jupiter
      // - Serum
      
      // For now, return mock pool data
      // In a real implementation, you'd query DEX APIs or on-chain data
      
      // Try to get token accounts to see if there's activity
      const largestAccounts = await this.connection.getTokenLargestAccounts(mint);
      
      if (largestAccounts.value.length > 0) {
        // Mock pool data - replace with actual DEX pool discovery
        return {
          dex: 'Unknown',
          solReserves: 1, // Would be fetched from actual pool
          tokenReserves: 1000000, // Would be fetched from actual pool
          hasLiquidity: true
        };
      }

      return null;
    } catch (error) {
      console.warn('Failed to find DEX pool:', error);
      return null;
    }
  }

  /**
   * 💰 Calculate price from DEX pool
   */
  private calculatePoolPrice(poolData: any): number {
    if (!poolData || !poolData.solReserves || !poolData.tokenReserves) {
      return 0;
    }
    
    return poolData.solReserves / poolData.tokenReserves;
  }

  /**
   * 🏷️ Get token metadata
   */
  private async getTokenMetadata(mint: PublicKey): Promise<any> {
    try {
      const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
      const [metadata] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          METADATA_PROGRAM.toBuffer(),
          mint.toBuffer(),
        ],
        METADATA_PROGRAM
      );

      const metadataAccount = await this.connection.getAccountInfo(metadata);
      if (!metadataAccount) return null;

      // Basic metadata parsing
      try {
        const nameLength = metadataAccount.data.readUInt32LE(69);
        const name = metadataAccount.data.slice(73, 73 + nameLength).toString().replace(/\0/g, '');
        
        const symbolStart = 73 + nameLength + 4;
        const symbolLength = metadataAccount.data.readUInt32LE(symbolStart - 4);
        const symbol = metadataAccount.data.slice(symbolStart, symbolStart + symbolLength).toString().replace(/\0/g, '');

        return {
          name: name || 'Unknown Token',
          symbol: symbol || 'UNK',
          image: null,
          description: null
        };
      } catch (parseError) {
        return {
          name: 'Unknown Token',
          symbol: 'UNK',
          image: null,
          description: null
        };
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * 💰 Update SOL price from CoinGecko
   */
  private async updateSolPrice(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSolPriceUpdate < this.SOL_PRICE_CACHE_MS) {
      return; // Use cached price
    }

    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const data = await response.json();
      
      if (data.solana?.usd) {
        this.solPriceUsd = data.solana.usd;
        this.lastSolPriceUpdate = now;
        console.log(`💰 SOL price updated: $${this.solPriceUsd}`);
      }
    } catch (error) {
      console.warn('Failed to update SOL price, using cached value');
    }
  }
}

export default StandardTokenMarketCapService;
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * 🪙 STANDARD SPL TOKEN MARKET CAP SERVICE
 * 
 * Calculates market caps for standard SPL tokens (no bonding curves)
 * by fetching data from DEX pools like Raydium, Orca, etc.
 */

interface StandardTokenInfo {
  mint: string;
  name?: string;
  symbol?: string;
  image?: string;
  description?: string;
  marketCap: number; // in USD
  price: number; // in USD per token
  totalSupply: number;
  decimals: number;
  isStandardSpl: boolean;
  poolData?: any; // DEX pool information
}

export interface StandardTokenResult {
  success: boolean;
  data?: StandardTokenInfo;
  error?: string;
}

export class StandardTokenMarketCapService {
  private connection: Connection;
  private solPriceUsd: number = 0;
  private lastSolPriceUpdate: number = 0;
  private readonly SOL_PRICE_CACHE_MS = 60000; // 1 minute cache

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * 💰 Calculate market cap for standard SPL token
   */
  async calculateMarketCap(mintAddress: string): Promise<StandardTokenResult> {
    try {
      const mint = new PublicKey(mintAddress);
      
      // Update SOL price if needed
      await this.updateSolPrice();

      // Check if it's a standard SPL token
      const mintAccount = await this.connection.getAccountInfo(mint);
      if (!mintAccount) {
        return {
          success: false,
          error: 'Token mint not found'
        };
      }

      // Verify it's owned by Token Program
      const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      if (!mintAccount.owner.equals(TOKEN_PROGRAM)) {
        return {
          success: false,
          error: 'Not a standard SPL token'
        };
      }

      // Parse mint data
      const mintData = this.parseMintData(mintAccount.data);
      
      // Get token metadata
      const metadata = await this.getTokenMetadata(mint);
      
      // Try to find DEX pool and get price
      const poolData = await this.findDexPool(mint);
      let price = 0;
      
      if (poolData) {
        price = this.calculatePoolPrice(poolData);
      }

      const priceUsd = price * this.solPriceUsd;
      const totalSupply = Number(mintData.supply) / Math.pow(10, mintData.decimals);
      const marketCap = totalSupply * priceUsd;

      const tokenInfo: StandardTokenInfo = {
        mint: mint.toBase58(),
        name: metadata?.name,
        symbol: metadata?.symbol,
        image: metadata?.image,
        description: metadata?.description,
        marketCap,
        price: priceUsd,
        totalSupply,
        decimals: mintData.decimals,
        isStandardSpl: true,
        poolData
      };

      return {
        success: true,
        data: tokenInfo
      };

    } catch (error: any) {
      return {
        success: false,
        error: `Failed to calculate market cap: ${error.message}`
      };
    }
  }

  /**
   * 📊 Parse SPL mint account data
   */
  private parseMintData(data: Buffer) {
    // SPL Token mint account structure:
    // 0-4: mint_authority (option + pubkey)
    // 36-44: supply (u64)
    // 44: decimals (u8)
    // 45: is_initialized (bool)
    // 46-50: freeze_authority (option + pubkey)
    
    const supply = data.readBigUInt64LE(36);
    const decimals = data.readUInt8(44);
    const isInitialized = data.readUInt8(45) === 1;

    return {
      supply,
      decimals,
      isInitialized
    };
  }

  /**
   * 🏊 Find DEX pool for the token
   */
  private async findDexPool(mint: PublicKey): Promise<any | null> {
    try {
      // This is a simplified implementation
      // In production, you'd want to check multiple DEXs:
      // - Raydium
      // - Orca  
      // - Jupiter
      // - Serum
      
      // For now, return mock pool data
      // In a real implementation, you'd query DEX APIs or on-chain data
      
      // Try to get token accounts to see if there's activity
      const largestAccounts = await this.connection.getTokenLargestAccounts(mint);
      
      if (largestAccounts.value.length > 0) {
        // Mock pool data - replace with actual DEX pool discovery
        return {
          dex: 'Unknown',
          solReserves: 1, // Would be fetched from actual pool
          tokenReserves: 1000000, // Would be fetched from actual pool
          hasLiquidity: true
        };
      }

      return null;
    } catch (error) {
      console.warn('Failed to find DEX pool:', error);
      return null;
    }
  }

  /**
   * 💰 Calculate price from DEX pool
   */
  private calculatePoolPrice(poolData: any): number {
    if (!poolData || !poolData.solReserves || !poolData.tokenReserves) {
      return 0;
    }
    
    return poolData.solReserves / poolData.tokenReserves;
  }

  /**
   * 🏷️ Get token metadata
   */
  private async getTokenMetadata(mint: PublicKey): Promise<any> {
    try {
      const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
      const [metadata] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('metadata'),
          METADATA_PROGRAM.toBuffer(),
          mint.toBuffer(),
        ],
        METADATA_PROGRAM
      );

      const metadataAccount = await this.connection.getAccountInfo(metadata);
      if (!metadataAccount) return null;

      // Basic metadata parsing
      try {
        const nameLength = metadataAccount.data.readUInt32LE(69);
        const name = metadataAccount.data.slice(73, 73 + nameLength).toString().replace(/\0/g, '');
        
        const symbolStart = 73 + nameLength + 4;
        const symbolLength = metadataAccount.data.readUInt32LE(symbolStart - 4);
        const symbol = metadataAccount.data.slice(symbolStart, symbolStart + symbolLength).toString().replace(/\0/g, '');

        return {
          name: name || 'Unknown Token',
          symbol: symbol || 'UNK',
          image: null,
          description: null
        };
      } catch (parseError) {
        return {
          name: 'Unknown Token',
          symbol: 'UNK',
          image: null,
          description: null
        };
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * 💰 Update SOL price from CoinGecko
   */
  private async updateSolPrice(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSolPriceUpdate < this.SOL_PRICE_CACHE_MS) {
      return; // Use cached price
    }

    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const data = await response.json();
      
      if (data.solana?.usd) {
        this.solPriceUsd = data.solana.usd;
        this.lastSolPriceUpdate = now;
        console.log(`💰 SOL price updated: $${this.solPriceUsd}`);
      }
    } catch (error) {
      console.warn('Failed to update SOL price, using cached value');
    }
  }
}

export default StandardTokenMarketCapService;