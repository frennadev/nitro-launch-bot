import {
  CurrencyAmount,
  Liquidity,
  LIQUIDITY_STATE_LAYOUT_V4,
  LiquidityPoolKeysV4,
  MAINNET_PROGRAM_ID,
  MARKET_STATE_LAYOUT_V3,
  Percent,
  SPL_ACCOUNT_LAYOUT,
  SwapSide,
  Token,
  TOKEN_PROGRAM_ID,
  TokenAmount,
} from "@raydium-io/raydium-sdk";
import { Connection, PublicKey, VersionedTransaction, TransactionMessage, AccountInfo } from "@solana/web3.js";
import { getMint, getOrCreateAssociatedTokenAccount, NATIVE_MINT, unpackAccount } from "@solana/spl-token";
import { connection, initializeOwner, txVersion } from "./config";
import { getMarketId } from "../get-marketId";
import { RaydiumPoolKeysFetcher } from "../backend/raydium-poolkeys";

export interface TokenAccount {
  programId: PublicKey;
  pubkey: PublicKey;
  accountInfo: any;
}

// Global cache for token decimals to persist across instances
const globalDecimalCache: Record<string, number> = {};

// Global cache for market data
const marketDataCache: Record<string, any> = {};
const poolKeysCache: Record<string, LiquidityPoolKeysV4> = {};

export class RaydiumSwapInstruction {
  private decimalCache: Record<string, number> = {};

  async createSwapIx(
    inputMint: string,
    outputMint: string,
    privateKey: string,
    amount: number | string,
    priorityFee: number = 10000
  ): Promise<VersionedTransaction> {
    console.log("createSwapIx started");
    const start = Date.now();

    const inputDecimals = await this.getTokenDecimals(inputMint);
    console.log("inputDecimals:", inputDecimals);
    const outputDecimals = await this.getTokenDecimals(outputMint);
    console.log("outputDecimals:", outputDecimals);

    const inputIsSol = inputMint === NATIVE_MINT.toBase58();
    const tokenMintPk = new PublicKey(inputIsSol ? outputMint : inputMint);
    const tokenDecimals = inputIsSol ? outputDecimals : inputDecimals;
    const owner = initializeOwner(privateKey);

    // const marketIdStr = await getMarketId(tokenMintPk.toBase58())
    const marketIdStr = await getMarketId(tokenMintPk.toBase58());
    console.log("marketId:", marketIdStr);
    if (!marketIdStr) throw new Error("Market ID not found");
    const marketId = new PublicKey(marketIdStr);

    const toSmallestUnit = (amt: number | string, dec: number): bigint => {
      const [w, f = ""] = amt.toString().split(".");
      const frac = f.padEnd(dec, "0").slice(0, dec);
      return BigInt(w) * BigInt(10) ** BigInt(dec) + BigInt(frac);
    };
    const scaledAmount = toSmallestUnit(amount, inputDecimals);
    console.log("scaledAmount:", scaledAmount.toString());

    const mintToken = new Token(TOKEN_PROGRAM_ID, tokenMintPk, tokenDecimals);
    const WSOL = new Token(TOKEN_PROGRAM_ID, NATIVE_MINT, 9);

    const amountIn = new TokenAmount(inputIsSol ? WSOL : mintToken, scaledAmount);

    const rayiumPool = new RaydiumPoolKeysFetcher(mintToken, WSOL, marketIdStr);

    console.log({ inputIsSol });
    const poolKeys = inputIsSol
      ? ((await rayiumPool.getMarketBuyPoolKeys()) as unknown as LiquidityPoolKeysV4)
      : ((await rayiumPool.getMarketSellPoolKeys()) as unknown as LiquidityPoolKeysV4);

    // console.log("poolKeys:", poolKeys)
    console.log("poolKeys fetched");
    const { tokenAccounts } = await this.getWalletTokenAccounts(owner.publicKey);
    const wsolAccount = tokenAccounts.find((ta) => ta.accountInfo.mint.equals(NATIVE_MINT));
    const tokenAccount = tokenAccounts.find((ta) => ta.accountInfo.mint.equals(tokenMintPk));

    console.log("Token account fetched");

    const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys });
    console.log("Pool Info fetched");

    const slippageTolerance = new Percent(5, 1000);
    const { amountOut, minAmountOut } = Liquidity.computeAmountOut({
      poolKeys,
      poolInfo,
      amountIn,
      currencyOut: inputIsSol ? mintToken : WSOL,
      slippage: slippageTolerance,
    });

    const computeBudgetConfig = {
      microLamports: priorityFee,
      units: 600000,
    };

    const swapIxResponse = await Liquidity.makeSwapInstructionSimple({
      connection,
      poolKeys,
      userKeys: {
        tokenAccounts: [wsolAccount!, tokenAccount!],
        owner: owner.publicKey,
        payer: owner.publicKey,
      },
      amountIn,
      amountOut: minAmountOut,
      fixedSide: "in",
      makeTxVersion: txVersion,
      computeBudgetConfig,
    });
    // console.log("swapIxResponse:", swapIxResponse)

    const instructions = [...swapIxResponse.innerTransactions[0].instructions];
    const { blockhash } = await connection.getLatestBlockhash("processed");
    const messageV0 = new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([owner]);

    // console.log("tx signed:", tx)
    console.log("createSwapIx total time:", `${Date.now() - start}ms`);

    return tx;
  }

  async getTokenDecimals(mintAddress: string): Promise<number> {
    // Check global cache first
    if (globalDecimalCache[mintAddress] !== undefined) {
      return globalDecimalCache[mintAddress];
    }

    // Fall back to instance cache
    if (this.decimalCache[mintAddress] !== undefined) {
      // Update global cache from instance cache
      globalDecimalCache[mintAddress] = this.decimalCache[mintAddress];
      return this.decimalCache[mintAddress];
    }

    // Native SOL always has 9 decimals
    if (mintAddress === NATIVE_MINT.toBase58()) {
      globalDecimalCache[mintAddress] = 9;
      this.decimalCache[mintAddress] = 9;
      return 9;
    }

    try {
      const mintInfo = await getMint(connection, new PublicKey(mintAddress));
      globalDecimalCache[mintAddress] = mintInfo.decimals;
      this.decimalCache[mintAddress] = mintInfo.decimals;
      return mintInfo.decimals;
    } catch (error) {
      console.error(`Error fetching decimals for ${mintAddress}:`, error);
      throw error;
    }
  }

  async getWalletTokenAccounts(ownerPk: PublicKey) {
    const response = await connection.getTokenAccountsByOwner(ownerPk, {
      programId: TOKEN_PROGRAM_ID,
    });
    const tokenAccounts = response.value.map((ta) => {
      const accountInfo = SPL_ACCOUNT_LAYOUT.decode(ta.account.data);

      return {
        pubkey: ta.pubkey,
        programId: TOKEN_PROGRAM_ID,
        accountInfo,
      };
    });
    return { tokenAccounts };
  }
}

export type LiquidityPairTargetInfo = {
  baseToken: Token;
  quoteToken: Token;
  targetMarketId: PublicKey;
};

export async function getMarketAssociatedPoolKeys(input: LiquidityPairTargetInfo) {
  const marketIdString = input.targetMarketId.toBase58();

  if (!marketDataCache[marketIdString]) {
    console.log("Fetching market data for", marketIdString);
    const marketAccount = await connection.getAccountInfo(input.targetMarketId);
    if (!marketAccount) throw new Error("get market info error");
    marketDataCache[marketIdString] = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);
  }

  const marketInfo = marketDataCache[marketIdString];
  const ensurePub = (k: string | PublicKey) => (typeof k === "string" ? new PublicKey(k) : k);

  const marketData = {
    marketBaseVault: ensurePub(marketInfo.baseVault),
    marketQuoteVault: ensurePub(marketInfo.quoteVault),
    marketBids: ensurePub(marketInfo.bids),
    marketAsks: ensurePub(marketInfo.asks),
    marketEventQueue: ensurePub(marketInfo.eventQueue),
  };

  const associated = Liquidity.getAssociatedPoolKeys({
    version: 4,
    marketVersion: 3,
    baseMint: input.baseToken.mint,
    quoteMint: input.quoteToken.mint,
    baseDecimals: input.baseToken.decimals,
    quoteDecimals: input.quoteToken.decimals,
    marketId: input.targetMarketId,
    programId: MAINNET_PROGRAM_ID.AmmV4,
    marketProgramId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
  });

  const result = { ...associated, ...marketData };
  return result;
}

export interface PoolKeys {
  id: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  version: number;
  programId: string;
  authority: string;
  nonce: number;
  baseVault: string;
  quoteVault: string;
  lpVault: string;
  openOrders: string;
  targetOrders: string;
  withdrawQueue: string;
  marketVersion: number;
  marketProgramId: string;
  marketId: string;
  marketAuthority: string;
  lookupTableAccount: string;
  configId: string;
  marketBaseVault: string;
  marketQuoteVault: string;
  marketBids: string;
  marketAsks: string;
  marketEventQueue: string;
}
