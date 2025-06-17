import { PublicKey } from "@solana/web3.js";
import { getMarketAssociatedPoolKeys } from "../service/raydium-service";
import { LiquidityPoolKeysV4, Token, TOKEN_PROGRAM_ID } from "@raydium-io/raydium-sdk";

export class RaydiumPoolKeysFetcher {
  constructor(
    private mintToken: Token,
    private WSOL: Token,
    private marketId: string
  ) {}

  async getMarketSellPoolKeys(): Promise<LiquidityPoolKeysV4> {
    return (await getMarketAssociatedPoolKeys({
      baseToken: this.mintToken,
      quoteToken: this.WSOL,
      targetMarketId: new PublicKey(this.marketId),
    })) as LiquidityPoolKeysV4;
  }

  async getMarketBuyPoolKeys(): Promise<LiquidityPoolKeysV4> {
    return (await getMarketAssociatedPoolKeys({
      baseToken: this.WSOL,
      quoteToken: this.mintToken,
      targetMarketId: new PublicKey(this.marketId),
    })) as LiquidityPoolKeysV4;
  }
}
