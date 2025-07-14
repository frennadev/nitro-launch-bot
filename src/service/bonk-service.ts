import {
  AccountMeta,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  BONK_PROGRAM_ID,
  getBonkPoolState,
  PoolState,
} from "./bonk-pool-service";
import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes";
import {
  AccountLayout,
  createAssociatedTokenAccount,
  createInitializeAccountInstruction,
  createWrappedNativeAccount,
  getOrCreateAssociatedTokenAccount,
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { connection } from "./config";
import { closeAccountInstruction } from "@raydium-io/raydium-sdk-v2";
import { TOKEN_PROGRAM_ID } from "@raydium-io/raydium-sdk";
import { logger } from "../jobs/logger";

export interface CreateBuyIX {
  pool: PoolState;
  payer: PublicKey;
  userBaseAta: PublicKey;
  userQuoteAta: PublicKey;
  amount_in: bigint;
  minimum_amount_out: bigint;
}

export interface CreateSellIX {
  pool: PoolState;
  payer: PublicKey;
  userBaseAta: PublicKey;
  userQuoteAta: PublicKey;
  amount_in: bigint;
  minimum_amount_out: bigint;
}

export interface BuyData {
  mint: PublicKey;
  amount: bigint;
  privateKey: string;
}

export interface SellData {
  mint: PublicKey;
  amount: bigint;
  privateKey: string;
  percentage?: number; // Optional: sell percentage of holdings (1-100)
}

// 🔥 NEW: Configuration interface for BONK service
export interface BonkServiceConfig {
  baseSlippage: number; // Base slippage percentage (default: 35%)
  maxSlippage: number; // Maximum slippage cap (default: 70%)
  maxRetries: number; // Maximum retry attempts (default: 3)
  lowLiquidityThreshold: number; // SOL threshold for low liquidity warning (default: 5)
  mediumLiquidityThreshold: number; // SOL threshold for medium liquidity (default: 20)
  feeRateBasisPoints: number; // Fee rate in basis points (default: 25 = 0.25%)
  retryDelayMs: number; // Base delay between retries in ms (default: 1000)
  retrySlippageBonus: number; // Extra slippage per retry attempt (default: 10%)
}

// Default configuration - can be overridden per transaction
const DEFAULT_CONFIG: BonkServiceConfig = {
  baseSlippage: 35,
  maxSlippage: 70,
  maxRetries: 3,
  lowLiquidityThreshold: 5,
  mediumLiquidityThreshold: 20,
  feeRateBasisPoints: 25,
  retryDelayMs: 1000,
  retrySlippageBonus: 10,
};

const raydim_authority = new PublicKey(
  "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh"
);
const global_config = new PublicKey(
  "6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX"
);
const platform_config = new PublicKey(
  "FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1"
);
const token_program = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const event_authority = new PublicKey(
  "2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr"
);

const BUY_DISCRIMINATOR = [250, 234, 13, 123, 213, 156, 19, 236];
const SELL_DISCRIMINATOR = [149, 39, 222, 155, 211, 124, 152, 26];

// Maestro Bot constants (same as PumpFun)
const MAESTRO_BOT_PROGRAM = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");
const MAESTRO_FEE_ACCOUNT = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");

export default class BonkService {
  private config: BonkServiceConfig;

  constructor(config: Partial<BonkServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info(`[bonk-service]: 🔧 BONK Service initialized with config:`, this.config);
  }

  // Update configuration at runtime
  updateConfig(config: Partial<BonkServiceConfig>) {
    this.config = { ...this.config, ...config };
    logger.info(`[bonk-service]: 🔧 BONK Service config updated:`, this.config);
  }

  createBuyIX = async ({
    pool,
    payer,
    userBaseAta,
    userQuoteAta,
    amount_in,
    minimum_amount_out,
  }: CreateBuyIX) => {
    const keys: AccountMeta[] = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: raydim_authority, isSigner: false, isWritable: false },
      { pubkey: global_config, isSigner: false, isWritable: false },
      { pubkey: platform_config, isSigner: false, isWritable: false },
      { pubkey: pool.poolId, isSigner: false, isWritable: true },
      { pubkey: userBaseAta, isSigner: false, isWritable: true },
      { pubkey: userQuoteAta, isSigner: false, isWritable: true },
      { pubkey: pool.baseVault, isSigner: false, isWritable: true },
      { pubkey: pool.quoteVault, isSigner: false, isWritable: true },
      { pubkey: pool.baseMint, isSigner: false, isWritable: true },
      { pubkey: pool.quoteMint, isSigner: false, isWritable: true },
      { pubkey: token_program, isSigner: false, isWritable: false },
      { pubkey: token_program, isSigner: false, isWritable: false },
      { pubkey: event_authority, isSigner: false, isWritable: false },
      { pubkey: BONK_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(32);
    const discriminator = Buffer.from(BUY_DISCRIMINATOR);
    discriminator.copy(data, 0);
    data.writeBigUInt64LE(amount_in, 8);
    data.writeBigUInt64LE(minimum_amount_out, 16);
    data.writeBigUInt64LE(BigInt(0), 24); // share fee rate

    const buyIx = new TransactionInstruction({
      keys,
      programId: BONK_PROGRAM_ID,
      data,
    });
    logger.debug(`[bonk-service]: raw buyIx data: ${buyIx.data.toString("hex")}`);
    return buyIx;
  };

  // Maestro-style buy instruction that includes fee transfer to look like Maestro Bot
  createMaestroBuyInstructions = async ({
    pool,
    payer,
    userBaseAta,
    userQuoteAta,
    amount_in,
    minimum_amount_out,
    maestroFeeAmount = BigInt(1000000), // Default 0.001 SOL fee
  }: CreateBuyIX & { maestroFeeAmount?: bigint }): Promise<TransactionInstruction[]> => {
    const instructions: TransactionInstruction[] = [];
    
    // 1. Create the main buy instruction (same as regular buy)
    const buyIx = await this.createBuyIX({
      pool,
      payer,
      userBaseAta,
      userQuoteAta,
      amount_in,
      minimum_amount_out,
    });
    instructions.push(buyIx);
    
    // 2. Add Maestro fee transfer to mimic their transaction structure
    const maestroFeeTransferIx = SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: MAESTRO_FEE_ACCOUNT,
      lamports: Number(maestroFeeAmount),
    });
    instructions.push(maestroFeeTransferIx);
    
    return instructions;
  };

  // 🔥 NEW: Create sell instruction
  createSellIX = async ({
    pool,
    payer,
    userBaseAta,
    userQuoteAta,
    amount_in,
    minimum_amount_out,
  }: CreateSellIX) => {
    const keys: AccountMeta[] = [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: raydim_authority, isSigner: false, isWritable: false },
      { pubkey: global_config, isSigner: false, isWritable: false },
      { pubkey: platform_config, isSigner: false, isWritable: false },
      { pubkey: pool.poolId, isSigner: false, isWritable: true },
      { pubkey: userBaseAta, isSigner: false, isWritable: true },
      { pubkey: userQuoteAta, isSigner: false, isWritable: true },
      { pubkey: pool.baseVault, isSigner: false, isWritable: true },
      { pubkey: pool.quoteVault, isSigner: false, isWritable: true },
      { pubkey: pool.baseMint, isSigner: false, isWritable: true },
      { pubkey: pool.quoteMint, isSigner: false, isWritable: true },
      { pubkey: token_program, isSigner: false, isWritable: false },
      { pubkey: token_program, isSigner: false, isWritable: false },
      { pubkey: event_authority, isSigner: false, isWritable: false },
      { pubkey: BONK_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const data = Buffer.alloc(32);
    const discriminator = Buffer.from(SELL_DISCRIMINATOR);
    discriminator.copy(data, 0);
    data.writeBigUInt64LE(amount_in, 8);
    data.writeBigUInt64LE(minimum_amount_out, 16);
    data.writeBigUInt64LE(BigInt(0), 24); // share fee rate

    const sellIx = new TransactionInstruction({
      keys,
      programId: BONK_PROGRAM_ID,
      data,
    });
    logger.debug(`[bonk-service]: raw sellIx data: ${sellIx.data.toString("hex")}`);
    return sellIx;
  };

  // Helper to estimate output for a buy (constant product formula, minus slippage)
  private estimateBuyOutput(
    pool: PoolState,
    amountIn: bigint,
    slippage?: number
  ): bigint {
    const finalSlippage = slippage ?? this.config.baseSlippage;
    
    // Use REAL reserves for calculation (not virtual) - this matches actual BONK program behavior
    const realBase = BigInt(pool.realBase);
    const realQuote = BigInt(pool.realQuote);
    
    logger.debug(`[bonk-service]: 🔍 Pool reserves used for calculation:`);
    logger.debug(`[bonk-service]:    realBase: ${realBase.toString()}`);
    logger.debug(`[bonk-service]:    realQuote: ${realQuote.toString()}`);
    logger.debug(`[bonk-service]:    amountIn: ${amountIn.toString()}`);
    
    // BONK program might deduct fees from the input amount before calculation
    // Let's try applying a fee (similar to how other DEXs work)
    const feeRate = BigInt(this.config.feeRateBasisPoints);
    const feeBasisPoints = BigInt(10000);
    const amountAfterFees = amountIn - (amountIn * feeRate) / feeBasisPoints;
    
    logger.debug(`[bonk-service]:    amountAfterFees: ${amountAfterFees.toString()}`);
    
    // Use constant product formula: x * y = k
    // After swap: (realBase - tokensOut) * (realQuote + amountAfterFees) = k
    // So: tokensOut = realBase - (k / (realQuote + amountAfterFees))
    const k = realBase * realQuote;
    const newRealQuote = realQuote + amountAfterFees;
    const newRealBase = k / newRealQuote;
    const tokensOut = realBase - newRealBase;
    
    logger.debug(`[bonk-service]:    Expected tokensOut (after fees, before slippage): ${tokensOut.toString()}`);
    
    // Apply higher slippage tolerance (35% instead of 25%) to account for:
    // 1. Pool state changes between calculation and execution
    // 2. Additional protocol fees not accounted for
    // 3. Price impact in volatile conditions
    const tokensOutWithSlippage = (tokensOut * BigInt(100 - finalSlippage)) / BigInt(100);
    
    logger.debug(`[bonk-service]:    tokensOut with slippage: ${tokensOutWithSlippage.toString()}`);
    
    return tokensOutWithSlippage;
  }

  // 🔥 NEW: Helper to estimate output for a sell (constant product formula, minus slippage)
  private estimateSellOutput(
    pool: PoolState,
    amountIn: bigint,
    slippage?: number
  ): bigint {
    const finalSlippage = slippage ?? this.config.baseSlippage;

    const realBase = BigInt(pool.realBase);
    const realQuote = BigInt(pool.realQuote);

    logger.debug(`[bonk-service]: 🔍 Pool reserves used for sell calculation:`);
    logger.debug(`[bonk-service]:    realBase: ${realBase.toString()}`);
    logger.debug(`[bonk-service]:    realQuote: ${realQuote.toString()}`);
    logger.debug(`[bonk-service]:    amountIn (tokens to sell): ${amountIn.toString()}`);

    // Apply fees to input amount
    const feeRate = BigInt(this.config.feeRateBasisPoints);
    const feeBasisPoints = BigInt(10000);
    const amountAfterFees = amountIn - (amountIn * feeRate) / feeBasisPoints;

    logger.debug(`[bonk-service]:    amountAfterFees: ${amountAfterFees.toString()}`);

    // Use constant product formula for sell: x * y = k
    // After swap: (realBase + amountAfterFees) * (realQuote - solOut) = k
    // So: solOut = realQuote - (k / (realBase + amountAfterFees))
    const k = realBase * realQuote;
    const newRealBase = realBase + amountAfterFees;
    const newRealQuote = k / newRealBase;
    const solOut = realQuote - newRealQuote;

    logger.debug(
      `[bonk-service]:    Expected solOut (after fees, before slippage): ${solOut.toString()}`
    );

    // Apply slippage tolerance
    const solOutWithSlippage =
      (solOut * BigInt(100 - finalSlippage)) / BigInt(100);

    logger.debug(`[bonk-service]:    solOut with slippage: ${solOutWithSlippage.toString()}`);

    return solOutWithSlippage;
  }

  // 🔥 UPDATED: Adaptive slippage calculation for both buy and sell
  private calculateAdaptiveSlippage(
    pool: PoolState,
    amountIn: bigint,
    isSell: boolean = false
  ): number {
    const realBase = BigInt(pool.realBase);
    const realQuote = BigInt(pool.realQuote);

    // Calculate price impact as percentage
    const priceImpact = isSell
      ? Number(amountIn * BigInt(100)) / Number(realBase)
      : Number(amountIn * BigInt(100)) / Number(realQuote);

    let slippage = this.config.baseSlippage;

    if (priceImpact > 5) {
      slippage = Math.max(slippage, 50);
      logger.warn(`[bonk-service]: 🚨 High price impact detected, using 50% slippage`);
    } else if (priceImpact > 2) {
      slippage = Math.max(slippage, 45);
      logger.warn(`[bonk-service]: ⚠️ Medium price impact detected, using 45% slippage`);
    } else if (priceImpact > 1) {
      slippage = Math.max(slippage, 40);
      logger.warn(`[bonk-service]: ⚠️ Medium price impact detected, using 40% slippage`);
    }

    // Check pool depth
    const relevantReserves = isSell ? Number(realBase) : Number(realQuote);
    const reservesThreshold = isSell
      ? this.config.lowLiquidityThreshold * 1e6 // Assume 6 decimals for tokens
      : this.config.lowLiquidityThreshold * 1e9; // 9 decimals for SOL

    if (relevantReserves < reservesThreshold) {
      slippage = Math.max(slippage, 50);
      logger.warn(`[bonk-service]: 🚨 Low liquidity pool detected, using minimum 50% slippage`);
    } else if (relevantReserves < reservesThreshold * 4) {
      slippage = Math.max(slippage, 45);
      logger.warn(
        `[bonk-service]: ⚠️ Medium liquidity pool detected, using minimum 45% slippage`
      );
    }

    const operation = isSell ? "SELL" : "BUY";
    logger.info(
      `[bonk-service]: 📊 Adaptive slippage calculated for ${operation}: ${slippage}% (Price impact: ${priceImpact.toFixed(2)}%)`
    );
    return Math.min(slippage, this.config.maxSlippage);
  }

  // 🔥 NEW: Retry logic for sell operations
  private async retrySellWithAdaptiveSlippage(
    pool: PoolState,
    sellData: SellData,
    maxRetries?: number
  ): Promise<VersionedTransaction> {
    const finalMaxRetries = maxRetries ?? this.config.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= finalMaxRetries; attempt++) {
      try {
        logger.info(`[bonk-service]: 🔄 Sell attempt ${attempt}/${finalMaxRetries}`);

        const adaptiveSlippage = this.calculateAdaptiveSlippage(
          pool,
          sellData.amount,
          true
        );

        const retrySlippageBonus =
          attempt > 1 ? (attempt - 1) * this.config.retrySlippageBonus : 0;
        const finalSlippage = Math.min(
          adaptiveSlippage + retrySlippageBonus,
          this.config.maxSlippage
        );

        if (attempt > 1) {
          logger.info(
            `[bonk-service]: 🔄 Retry attempt with increased slippage: ${finalSlippage}% (base: ${adaptiveSlippage}% + retry bonus: ${retrySlippageBonus}%)`
          );

          await new Promise((resolve) =>
            setTimeout(resolve, this.config.retryDelayMs * attempt)
          );

          const freshPool = await getBonkPoolState(sellData.mint.toBase58());
          if (freshPool) {
            Object.assign(pool, freshPool);
            logger.info(`[bonk-service]: 🔄 Pool state refreshed for retry`);
          }
        }

        const minAmountOut = this.estimateSellOutput(
          pool,
          sellData.amount,
          finalSlippage
        );
        return await this.createSellTransaction(pool, sellData, minAmountOut);
      } catch (error: any) {
        lastError = error;
        logger.warn(`[bonk-service]: ❌ Sell attempt ${attempt} failed: ${error.message}`);

        if (
          error.message?.includes("Insufficient funds") ||
          error.message?.includes("Pool not found") ||
          error.message?.includes("Invalid mint")
        ) {
          logger.warn(`[bonk-service]: 🚫 Non-retryable error detected, stopping retries`);
          throw error;
        }

        if (attempt === finalMaxRetries) {
          logger.error(`[bonk-service]: 🚫 All ${finalMaxRetries} attempts failed`);
          throw lastError;
        }
      }
    }

    throw lastError || new Error("Unexpected retry loop exit");
  }

  // 🔥 UPDATED: Retry logic with exponential backoff for pool state changes
  private async retryBuyWithAdaptiveSlippage(
    pool: PoolState,
    buyData: BuyData,
    maxRetries?: number
  ): Promise<VersionedTransaction> {
    const finalMaxRetries = maxRetries ?? this.config.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= finalMaxRetries; attempt++) {
      try {
        logger.info(`[bonk-service]: 🔄 Buy attempt ${attempt}/${finalMaxRetries}`);

        const adaptiveSlippage = this.calculateAdaptiveSlippage(
          pool,
          buyData.amount,
          false
        );

        const retrySlippageBonus =
          attempt > 1 ? (attempt - 1) * this.config.retrySlippageBonus : 0;
        const finalSlippage = Math.min(
          adaptiveSlippage + retrySlippageBonus,
          this.config.maxSlippage
        );

        if (attempt > 1) {
          logger.info(
            `[bonk-service]: 🔄 Retry attempt with increased slippage: ${finalSlippage}% (base: ${adaptiveSlippage}% + retry bonus: ${retrySlippageBonus}%)`
          );

          await new Promise((resolve) =>
            setTimeout(resolve, this.config.retryDelayMs * attempt)
          );

          const freshPool = await getBonkPoolState(buyData.mint.toBase58());
          if (freshPool) {
            Object.assign(pool, freshPool);
            logger.info(`[bonk-service]: 🔄 Pool state refreshed for retry`);
          }
        }

        const minAmountOut = this.estimateBuyOutput(
          pool,
          buyData.amount,
          finalSlippage
        );
        return await this.createBuyTransaction(pool, buyData, minAmountOut);
      } catch (error: any) {
        lastError = error;
        logger.warn(`[bonk-service]: ❌ Buy attempt ${attempt} failed: ${error.message}`);

        if (
          error.message?.includes("Insufficient funds") ||
          error.message?.includes("Pool not found") ||
          error.message?.includes("Invalid mint")
        ) {
          logger.warn(`[bonk-service]: 🚫 Non-retryable error detected, stopping retries`);
          throw error;
        }

        if (attempt === finalMaxRetries) {
          logger.error(`[bonk-service]: 🚫 All ${finalMaxRetries} attempts failed`);
          throw lastError;
        }
      }
    }

    throw lastError || new Error("Unexpected retry loop exit");
  }

  // 🔥 UPDATED: Separate transaction creation logic for better error handling
  private async createBuyTransaction(
    pool: PoolState,
    buyData: BuyData,
    minAmountOut: bigint
  ): Promise<VersionedTransaction> {
    const { mint, privateKey, amount } = buyData;
    const owner = Keypair.fromSecretKey(bs58.decode(privateKey));

    const [wsolAta, tokenAta] = this.getPrecomputedATAAddresses(
      owner,
      [NATIVE_MINT, mint],
      owner.publicKey
    );

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1_100_100,
    });

    const { instructions: ataInstructions } =
      this.createOptimizedATAInstructions(
        owner,
        [NATIVE_MINT, mint],
        owner.publicKey
      );

    const transferSolIx = SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: wsolAta,
      lamports: Number(amount),
    });
    const syncNativeIx = createSyncNativeInstruction(wsolAta);

    // Build buy instruction
    const ixData: CreateBuyIX = {
      pool: pool,
      payer: owner.publicKey,
      userBaseAta: tokenAta,
      userQuoteAta: wsolAta,
      amount_in: amount,
      minimum_amount_out: minAmountOut,
    };
    const buyInstruction = await this.createBuyIX(ixData);

    // 🔥 OPTIMIZED: Build final instruction list
    const instructions = [
      modifyComputeUnits,
      addPriorityFee,
      ...ataInstructions,
      transferSolIx,
      syncNativeIx,
      buyInstruction,
    ];

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([owner]);

    return tx;
  }

  // 🔥 NEW: Create sell transaction
  private async createSellTransaction(
    pool: PoolState,
    sellData: SellData,
    minAmountOut: bigint
  ): Promise<VersionedTransaction> {
    const { mint, privateKey, amount } = sellData;
    const owner = Keypair.fromSecretKey(bs58.decode(privateKey));

    const [wsolAta, tokenAta] = this.getPrecomputedATAAddresses(
      owner,
      [NATIVE_MINT, mint],
      owner.publicKey
    );

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1_100_100,
    });

    const { instructions: ataInstructions } =
      this.createOptimizedATAInstructions(
        owner,
        [NATIVE_MINT, mint],
        owner.publicKey
      );

    const ixData: CreateSellIX = {
      pool: pool,
      payer: owner.publicKey,
      userBaseAta: tokenAta,
      userQuoteAta: wsolAta,
      amount_in: amount,
      minimum_amount_out: minAmountOut,
    };
    const sellInstruction = await this.createSellIX(ixData);

    // Add instruction to close WSOL account after sell to recover rent
    const closeWsolIx = createCloseAccountInstruction(
      wsolAta,
      owner.publicKey,
      owner.publicKey
    );

    const instructions = [
      modifyComputeUnits,
      addPriorityFee,
      ...ataInstructions,
      sellInstruction,
      closeWsolIx,
    ];

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([owner]);

    return tx;
  }

  // 🔥 NEW: Get token balance for percentage-based sells
  private async getTokenBalance(
    owner: PublicKey,
    mint: PublicKey
  ): Promise<bigint> {
    try {
      const tokenAta = getAssociatedTokenAddressSync(mint, owner);
      const balance = await connection.getTokenAccountBalance(tokenAta);
      return BigInt(balance.value.amount);
    } catch (error) {
      logger.warn(`[bonk-service]: Token account not found or has zero balance`);
      return BigInt(0);
    }
  }

  /**
   * 🔥 OPTIMIZED: Create optimized ATA instructions that pre-computes addresses and uses idempotent instructions
   * This eliminates network calls for ATA existence checks and uses faster idempotent instructions
   */
  public createOptimizedATAInstructions(
    payer: Keypair,
    mints: PublicKey[],
    owner: PublicKey = payer.publicKey
  ): { instructions: TransactionInstruction[]; addresses: PublicKey[] } {
    const instructions: TransactionInstruction[] = [];
    const addresses: PublicKey[] = [];

    for (const mint of mints) {
      const ataAddress = getAssociatedTokenAddressSync(mint, owner);
      addresses.push(ataAddress);

      const ataInstruction = createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        ataAddress,
        owner,
        mint
      );
      instructions.push(ataInstruction);
    }

    return { instructions, addresses };
  }

  /**
   * 🔥 OPTIMIZED: Get pre-computed ATA addresses without network calls
   */
  public getPrecomputedATAAddresses(
    payer: Keypair,
    mints: PublicKey[],
    owner: PublicKey = payer.publicKey
  ): PublicKey[] {
    return mints.map((mint) => getAssociatedTokenAddressSync(mint, owner));
  }

  buyTx = async (buyData: BuyData) => {
    const { mint } = buyData;
    logger.info(`[bonk-service]: 🚀 BONK Buy started with adaptive slippage & retry logic`);
    const start = Date.now();

    const poolDiscoveryStart = Date.now();
    const poolState = await getBonkPoolState(mint.toBase58());
    const poolDiscoveryTime = Date.now() - poolDiscoveryStart;

    if (!poolState) {
      throw new Error("Pool not found");
    }

    logger.info(
      `[bonk-service]: [BuyTx] Pool discovery took ${poolDiscoveryTime}ms for ${mint.toBase58()}`
    );
    if (poolDiscoveryTime < 1000) {
      logger.info(`[bonk-service]: [BuyTx] ✅ Using pre-cached pool for ${mint.toBase58()}`);
    } else {
      logger.warn(`[bonk-service]: [BuyTx] ⚠️ Pool discovery was slow (${poolDiscoveryTime}ms) for ${mint.toBase58()}`);
    }

    logger.info(`[bonk-service]: Pool Info`, poolState);

    try {
      const tx = await this.retryBuyWithAdaptiveSlippage(poolState, buyData);
      logger.info(`[bonk-service]: createSwapIx total time: ${Date.now() - start}ms`);
      return tx;
    } catch (error: any) {
      logger.error(`[bonk-service]: 🚫 All buy attempts failed: ${error.message}`);
      throw error;
    }
  };

  // 🔥 NEW: Sell transaction method
  sellTx = async (sellData: SellData) => {
    const { mint, percentage } = sellData;
    logger.info(`[bonk-service]: 🚀 BONK Sell started with adaptive slippage & retry logic`);
    const start = Date.now();

    const poolDiscoveryStart = Date.now();
    const poolState = await getBonkPoolState(mint.toBase58());
    const poolDiscoveryTime = Date.now() - poolDiscoveryStart;

    if (!poolState) {
      throw new Error("Pool not found");
    }

    logger.info(
      `[bonk-service]: [SellTx] Pool discovery took ${poolDiscoveryTime}ms for ${mint.toBase58()}`
    );

    // Handle percentage-based selling
    let finalSellData = sellData;
    if (percentage && percentage > 0 && percentage <= 100) {
      const owner = Keypair.fromSecretKey(bs58.decode(sellData.privateKey));
      const balance = await this.getTokenBalance(owner.publicKey, mint);

      if (balance === BigInt(0)) {
        throw new Error("No token balance found for percentage-based sell");
      }

      const amountToSell = (balance * BigInt(percentage)) / BigInt(100);
      finalSellData = {
        ...sellData,
        amount: amountToSell,
      };

      logger.info(
        `[bonk-service]: 📊 Percentage sell: ${percentage}% of ${balance.toString()} = ${amountToSell.toString()} tokens`
      );
    }

    logger.info(`[bonk-service]: Pool Info`, poolState);

    try {
      const tx = await this.retrySellWithAdaptiveSlippage(
        poolState,
        finalSellData
      );
      logger.info(`[bonk-service]: createSellIx total time: ${Date.now() - start}ms`);
      return tx;
    } catch (error: any) {
      logger.error(`[bonk-service]: 🚫 All sell attempts failed: ${error.message}`);
      throw error;
    }
  };
} 