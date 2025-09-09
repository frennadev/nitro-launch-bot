import { Connection, PublicKey } from "@solana/web3.js";
import {
  PumpFunMarketCapService,
  PumpFunTokenInfo,
  MarketCapResult,
} from "./pumpfun-marketcap-service";
import {
  BonkMarketCapService,
  BonkMarketCapResult,
} from "./bonk-marketcap-service";

/**
 * 🚀 UNIFIED MARKET CAP SERVICE
 *
 * Combines PumpFun and BONK market cap services into a single unified interface
 * Automatically detects token type and routes to appropriate service
 */

export type UnifiedTokenInfo = PumpFunTokenInfo;

export interface UnifiedMarketCapResult {
  success: boolean;
  data?: UnifiedTokenInfo & {
    tokenType: "PUMPFUN" | "BONK" | "UNKNOWN";
    detectedBy: string;
  };
  error?: string;
}

export class UnifiedMarketCapService {
  private pumpFunService: PumpFunMarketCapService;
  private bonkService: BonkMarketCapService;
  private connection: Connection;

  constructor(heliusRpcUrl: string) {
    this.connection = new Connection(heliusRpcUrl, "confirmed");
    this.pumpFunService = new PumpFunMarketCapService(heliusRpcUrl);
    this.bonkService = new BonkMarketCapService(heliusRpcUrl);
  }

  /**
   * 🎯 Calculate market cap for any token (PumpFun or BONK)
   */
  async calculateMarketCap(
    mintAddress: string
  ): Promise<UnifiedMarketCapResult> {
    try {
      const mint = new PublicKey(mintAddress);

      // Detect token type
      const tokenType = await this.detectTokenType(mint);

      switch (tokenType) {
        case "PUMPFUN":
          return this.handlePumpFunToken(mintAddress);

        case "BONK":
          return this.handleBonkToken(mintAddress);

        default:
          // Try both services and return the first successful result
          return this.tryBothServices(mintAddress);
      }
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to calculate market cap: ${error.message}`,
      };
    }
  }

  /**
   * 🔍 Detect token type based on program associations
   */
  private async detectTokenType(
    mint: PublicKey
  ): Promise<"PUMPFUN" | "BONK" | "UNKNOWN"> {
    try {
      // Check if it's a known BONK token
      if (mint.toBase58() === "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263") {
        return "BONK";
      }

      // Check for PumpFun bonding curve account
      const PUMPFUN_PROGRAM = new PublicKey(
        "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
      );
      const [pumpfunBondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), mint.toBuffer()],
        PUMPFUN_PROGRAM
      );

      const pumpfunAccount = await this.connection.getAccountInfo(
        pumpfunBondingCurve
      );
      if (pumpfunAccount) {
        return "PUMPFUN";
      }

      // Check for BONK bonding curve account
      const BONK_PROGRAM = new PublicKey(
        "BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXqoQTa"
      );
      const [bonkBondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), mint.toBuffer()],
        BONK_PROGRAM
      );

      const bonkAccount = await this.connection.getAccountInfo(
        bonkBondingCurve
      );
      if (bonkAccount) {
        return "BONK";
      }

      return "UNKNOWN";
    } catch (error) {
      console.warn("Failed to detect token type:", error);
      return "UNKNOWN";
    }
  }

  /**
   * 🚀 Handle PumpFun token
   */
  private async handlePumpFunToken(
    mintAddress: string
  ): Promise<UnifiedMarketCapResult> {
    const result = await this.pumpFunService.calculateMarketCap(mintAddress);

    if (result.success && result.data) {
      return {
        success: true,
        data: {
          ...result.data,
          tokenType: "PUMPFUN",
          detectedBy: "PumpFun bonding curve detection",
        },
      };
    }

    return {
      success: false,
      error: result.error || "Failed to process PumpFun token",
    };
  }

  /**
   * 🐕 Handle BONK token
   */
  private async handleBonkToken(
    mintAddress: string
  ): Promise<UnifiedMarketCapResult> {
    const result = await this.bonkService.calculateMarketCap(mintAddress);

    if (result.success && result.data) {
      return {
        success: true,
        data: {
          ...result.data,
          tokenType: "BONK",
          detectedBy: "BONK bonding curve detection",
        },
      };
    }

    return {
      success: false,
      error: result.error || "Failed to process BONK token",
    };
  }

  /**
   * 🔄 Try both services when token type is unknown
   */
  private async tryBothServices(
    mintAddress: string
  ): Promise<UnifiedMarketCapResult> {
    // Try PumpFun first (more common)
    try {
      const pumpfunResult = await this.pumpFunService.calculateMarketCap(
        mintAddress
      );
      if (pumpfunResult.success && pumpfunResult.data) {
        return {
          success: true,
          data: {
            ...pumpfunResult.data,
            tokenType: "PUMPFUN",
            detectedBy: "PumpFun service fallback",
          },
        };
      }
    } catch (error) {
      console.warn("PumpFun service failed:", error);
    }

    // Try BONK service
    try {
      const bonkResult = await this.bonkService.calculateMarketCap(mintAddress);
      if (bonkResult.success && bonkResult.data) {
        return {
          success: true,
          data: {
            ...bonkResult.data,
            tokenType: "BONK",
            detectedBy: "BONK service fallback",
          },
        };
      }
    } catch (error) {
      console.warn("BONK service failed:", error);
    }

    return {
      success: false,
      error: "Token not recognized by either PumpFun or BONK services",
    };
  }

  /**
   * 📊 Get service statistics
   */
  getServiceInfo(): any {
    return {
      services: ["PumpFun", "BONK"],
      capabilities: {
        pumpfun: {
          bondedTokens: true,
          graduatedTokens: true,
          ammType: "PumpFun AMM",
        },
        bonk: {
          bondedTokens: true,
          graduatedTokens: true,
          ammType: "Raydium/DEX",
        },
      },
      detection: {
        automatic: true,
        fallback: true,
        programBased: true,
      },
    };
  }
}

export default UnifiedMarketCapService;
