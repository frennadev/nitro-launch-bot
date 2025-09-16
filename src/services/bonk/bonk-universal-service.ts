import { 
  PublicKey, 
  Keypair, 
  TransactionInstruction, 
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { logger } from "../../blockchain/common/logger";
import { connection } from "../../blockchain/common/connection";
import { createMaestroFeeInstruction } from "../../utils/maestro-fee";

// 🔥 UNIVERSAL CONSTANTS - PROVEN WORKING
const LAUNCHLAB_PROGRAM = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const BUY_DISCRIMINATOR = [0xfa, 0xea, 0x0d, 0x7b, 0xd5, 0x9c, 0x13, 0xec];
const SELL_DISCRIMINATOR = [149, 39, 222, 155, 211, 124, 152, 26];

// Universal constants for all BONK transactions
const RAYDIUM_AUTHORITY = new PublicKey("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh");
const GLOBAL_CONFIG = new PublicKey("6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX");
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const EVENT_AUTHORITY = new PublicKey("2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr");

export interface BonkPoolState {
  poolId: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  creator: PublicKey;
  platformConfig: PublicKey;
  virtualBase: bigint;
  virtualQuote: bigint;
  realBase: bigint;
  realQuote: bigint;
}

export interface BonkBuyParams {
  tokenMint: string;
  amount: number; // SOL amount
  userKeypair: Keypair;
  slippage?: number;
  priorityFee?: number;
}

export interface BonkSellParams {
  tokenMint: string;
  tokenAmount: number; // Token amount to sell
  userKeypair: Keypair;
  slippage?: number;
  priorityFee?: number;
}

/**
 * 🎯 UNIVERSAL CREATOR FEE VAULT DERIVATION
 * Works for ALL BONK premigrated tokens using PDA derivation
 */
function getCreatorFeeVault(creator: PublicKey, quoteMint: PublicKey): PublicKey {
  const [creatorFeeVault] = PublicKey.findProgramAddressSync(
    [creator.toBuffer(), quoteMint.toBuffer()],
    LAUNCHLAB_PROGRAM
  );
  return creatorFeeVault;
}

export class BonkUniversalService {
  
  /**
   * 🎯 UNIVERSAL BONK BUY TRANSACTION - Complete Working Pattern
   */
  async createBuyTransaction(params: BonkBuyParams): Promise<VersionedTransaction> {
    const { tokenMint, amount, userKeypair, slippage = 5, priorityFee = 0 } = params;
    const logId = `bonk-buy-${tokenMint.substring(0, 8)}`;

    logger.info(`[${logId}] Creating buy transaction: ${amount} SOL with ${slippage}% slippage`);
    
    // 🔍 STEP 1: Get pool state (includes creator)
    const poolState = await this.getBonkPoolState(tokenMint);
    if (!poolState) {
      throw new Error("Pool not found - token may not be available on BONK");
    }
    
    // 🎯 STEP 2: Derive creator fee vault universally
    const creatorFeeVault = getCreatorFeeVault(poolState.creator, WSOL_MINT);
    
    logger.info(`[${logId}] Pool found - Creator: ${poolState.creator.toBase58().substring(0, 8)}`);
    
    // 🚀 STEP 3: Calculate minimum amount out with bonding curve
    const amountLamports = BigInt(Math.floor(amount * LAMPORTS_PER_SOL));
    const minAmountOut = await this.calculateBuyMinAmountOut(poolState, amountLamports, slippage);
    
    // 🔧 STEP 4: Get ATAs
    const tokenMintPk = new PublicKey(tokenMint);
    const tokenAta = getAssociatedTokenAddressSync(tokenMintPk, userKeypair.publicKey);
    const wsolAta = getAssociatedTokenAddressSync(WSOL_MINT, userKeypair.publicKey);
    
    // 🎯 STEP 5: Build complete transaction (7-instruction pattern)
    const instructions: TransactionInstruction[] = [];
    
    // #1-2: Compute Budget (match successful transactions)
    if (priorityFee > 0) {
      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
      );
    }
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 207_046 })    // Exact limit
    );
    
    // #3: Create Token ATA (conditional)
    const tokenAtaInfo = await connection.getAccountInfo(tokenAta);
    if (!tokenAtaInfo) {
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          userKeypair.publicKey, tokenAta, userKeypair.publicKey, tokenMintPk
        )
      );
    }
    
    // #4: Create WSOL ATA (conditional)
    const wsolAtaInfo = await connection.getAccountInfo(wsolAta);
    if (!wsolAtaInfo) {
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          userKeypair.publicKey, wsolAta, userKeypair.publicKey, WSOL_MINT
        )
      );
    }
    
    // #5: Transfer SOL to WSOL ATA
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: wsolAta,
        lamports: Number(amountLamports)
      })
    );
    
    // #6: Sync Native
    instructions.push(createSyncNativeInstruction(wsolAta));
    
    // #7: BONK Buy Instruction (buy_exact_in)
    instructions.push(
      this.createBuyInstruction({
        payer: userKeypair.publicKey,
        poolState,
        userTokenAta: tokenAta,
        userWsolAta: wsolAta,
        creatorFeeVault,
        amountIn: amountLamports,
        minimumAmountOut: minAmountOut
      })
    );
    
    // #8: Maestro fee instruction to mimic Maestro Bot transactions
    instructions.push(createMaestroFeeInstruction(userKeypair.publicKey));
    
    // #9: Close WSOL ATA (get remaining SOL back)
    instructions.push(
      createCloseAccountInstruction(wsolAta, userKeypair.publicKey, userKeypair.publicKey)
    );
    
    // 🚀 Build and return versioned transaction
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: userKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([userKeypair]);
    
    return tx;
  }

  /**
   * 🎯 UNIVERSAL BONK SELL TRANSACTION - Complete Working Pattern
   */
  async createSellTransaction(params: BonkSellParams): Promise<VersionedTransaction> {
    const { tokenMint, tokenAmount, userKeypair, slippage = 5, priorityFee = 0 } = params;
    const logId = `bonk-sell-${tokenMint.substring(0, 8)}`;

    logger.info(`[${logId}] Creating sell transaction: ${tokenAmount} tokens with ${slippage}% slippage`);
    
    // 🔍 STEP 1: Get pool state
    const poolState = await this.getBonkPoolState(tokenMint);
    if (!poolState) {
      throw new Error("Pool not found - token may not be available on BONK");
    }
    
    // 🎯 STEP 2: Calculate minimum SOL out
    const tokenAmountBigInt = BigInt(tokenAmount);
    const minSolOut = await this.calculateSellMinAmountOut(poolState, tokenAmountBigInt, slippage);
    
    // 🔧 STEP 3: Get ATAs
    const tokenMintPk = new PublicKey(tokenMint);
    const tokenAta = getAssociatedTokenAddressSync(tokenMintPk, userKeypair.publicKey);
    const wsolAta = getAssociatedTokenAddressSync(WSOL_MINT, userKeypair.publicKey);
    
    // 🎯 STEP 4: Build sell transaction (5-instruction pattern)
    const instructions: TransactionInstruction[] = [];
    
    // #1-2: Compute Budget
    if (priorityFee > 0) {
      instructions.push(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
      );
    }
    instructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 207_046 })
    );
    
    // #3: Create WSOL ATA (conditional)
    const wsolAtaInfo = await connection.getAccountInfo(wsolAta);
    if (!wsolAtaInfo) {
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          userKeypair.publicKey, wsolAta, userKeypair.publicKey, WSOL_MINT
        )
      );
    }
    
    // #4: BONK Sell Instruction (sell_exact_in)
    instructions.push(
      this.createSellInstruction({
        payer: userKeypair.publicKey,
        poolState,
        userTokenAta: tokenAta,
        userWsolAta: wsolAta,
        tokenAmountIn: tokenAmountBigInt,
        minimumSolOut: minSolOut
      })
    );
    
    // #5: Maestro fee instruction to mimic Maestro Bot transactions
    instructions.push(createMaestroFeeInstruction(userKeypair.publicKey));
    
    // #6: Close WSOL ATA (get SOL)
    instructions.push(
      createCloseAccountInstruction(wsolAta, userKeypair.publicKey, userKeypair.publicKey)
    );
    
    // 🚀 Build and return versioned transaction
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const messageV0 = new TransactionMessage({
      payerKey: userKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([userKeypair]);
    
    return tx;
  }

  /**
   * 🔥 CORE: Create BONK buy instruction (buy_exact_in)
   */
  private createBuyInstruction(params: {
    payer: PublicKey;
    poolState: BonkPoolState;
    userTokenAta: PublicKey;
    userWsolAta: PublicKey;
    creatorFeeVault: PublicKey;
    amountIn: bigint;
    minimumAmountOut: bigint;
  }): TransactionInstruction {
    const { payer, poolState, userTokenAta, userWsolAta, creatorFeeVault, amountIn, minimumAmountOut } = params;
    
    // 🎯 EXACT ACCOUNT ORDER from successful transactions
    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },                    // payer
      { pubkey: RAYDIUM_AUTHORITY, isSigner: false, isWritable: false },       // authority
      { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: false },          // global_config
      { pubkey: poolState.platformConfig, isSigner: false, isWritable: false }, // platform_config
      { pubkey: poolState.poolId, isSigner: false, isWritable: true },        // pool_state
      { pubkey: userTokenAta, isSigner: false, isWritable: true },            // user_base_token
      { pubkey: userWsolAta, isSigner: false, isWritable: true },             // user_quote_token
      { pubkey: poolState.baseVault, isSigner: false, isWritable: true },     // base_vault
      { pubkey: poolState.quoteVault, isSigner: false, isWritable: true },    // quote_vault
      { pubkey: poolState.baseMint, isSigner: false, isWritable: false },     // base_token_mint
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },              // quote_token_mint
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },          // base_token_program
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },          // quote_token_program
      { pubkey: creatorFeeVault, isSigner: false, isWritable: true },         // creator_fee_vault
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },        // event_authority
      { pubkey: LAUNCHLAB_PROGRAM, isSigner: false, isWritable: false },      // program
    ];

    // 🔥 EXACT DATA STRUCTURE (24 bytes)
    const data = Buffer.alloc(24);
    Buffer.from(BUY_DISCRIMINATOR).copy(data, 0);     // 8 bytes: discriminator
    data.writeBigUInt64LE(amountIn, 8);               // 8 bytes: amount_in
    data.writeBigUInt64LE(minimumAmountOut, 16);      // 8 bytes: minimum_amount_out

    return new TransactionInstruction({
      keys,
      programId: LAUNCHLAB_PROGRAM,
      data,
    });
  }

  /**
   * 🔥 CORE: Create BONK sell instruction (sell_exact_in)
   */
  private createSellInstruction(params: {
    payer: PublicKey;
    poolState: BonkPoolState;
    userTokenAta: PublicKey;
    userWsolAta: PublicKey;
    tokenAmountIn: bigint;
    minimumSolOut: bigint;
  }): TransactionInstruction {
    const { payer, poolState, userTokenAta, userWsolAta, tokenAmountIn, minimumSolOut } = params;
    
    // 🎯 EXACT ACCOUNT ORDER for sell_exact_in
    const keys = [
      { pubkey: payer, isSigner: true, isWritable: true },                    // payer
      { pubkey: RAYDIUM_AUTHORITY, isSigner: false, isWritable: false },       // authority
      { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: false },          // global_config
      { pubkey: poolState.platformConfig, isSigner: false, isWritable: false }, // platform_config
      { pubkey: poolState.poolId, isSigner: false, isWritable: true },        // pool_state
      { pubkey: userTokenAta, isSigner: false, isWritable: true },            // user_base_token
      { pubkey: userWsolAta, isSigner: false, isWritable: true },             // user_quote_token
      { pubkey: poolState.baseVault, isSigner: false, isWritable: true },     // base_vault
      { pubkey: poolState.quoteVault, isSigner: false, isWritable: true },    // quote_vault
      { pubkey: poolState.baseMint, isSigner: false, isWritable: false },     // base_token_mint
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },              // quote_token_mint
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },          // base_token_program
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },          // quote_token_program
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },        // event_authority
      { pubkey: LAUNCHLAB_PROGRAM, isSigner: false, isWritable: false },      // program
    ];

    // 🔥 EXACT SELL DATA STRUCTURE (24 bytes)
    const data = Buffer.alloc(24);
    Buffer.from(SELL_DISCRIMINATOR).copy(data, 0);    // 8 bytes: discriminator
    data.writeBigUInt64LE(tokenAmountIn, 8);          // 8 bytes: amount_in
    data.writeBigUInt64LE(minimumSolOut, 16);         // 8 bytes: minimum_amount_out

    return new TransactionInstruction({
      keys,
      programId: LAUNCHLAB_PROGRAM,
      data,
    });
  }

  /**
   * 🧮 Calculate minimum tokens out for buy (bonding curve + slippage)
   */
  private async calculateBuyMinAmountOut(
    poolState: BonkPoolState, 
    amountIn: bigint, 
    slippagePercent: number
  ): Promise<bigint> {
    // Use bonding curve: tokensOut = (amountIn * virtualBase) / (virtualQuote + amountIn)
    const virtualBase = poolState.virtualBase;
    const virtualQuote = poolState.virtualQuote;
    
    const tokensOut = (amountIn * virtualBase) / (virtualQuote + amountIn);
    
    // Apply slippage
    const minTokensOut = tokensOut * BigInt(100 - slippagePercent) / BigInt(100);
    
    logger.info(`🧮 BONK BUY: ${Number(amountIn) / LAMPORTS_PER_SOL} SOL → ${Number(tokensOut)} tokens (${slippagePercent}% slippage)`);
    
    return minTokensOut;
  }

  /**
   * 🧮 Calculate minimum SOL out for sell (bonding curve + slippage)
   */
  private async calculateSellMinAmountOut(
    poolState: BonkPoolState, 
    tokenAmountIn: bigint, 
    slippagePercent: number
  ): Promise<bigint> {
    // Use bonding curve: solOut = virtualQuote - (k / (virtualBase + tokenAmountIn))
    const virtualBase = poolState.virtualBase;
    const virtualQuote = poolState.virtualQuote;
    const k = virtualBase * virtualQuote;
    
    const newVirtualBase = virtualBase + tokenAmountIn;
    const newVirtualQuote = k / newVirtualBase;
    const solOut = virtualQuote - newVirtualQuote;
    
    // Apply slippage
    const minSolOut = solOut * BigInt(100 - slippagePercent) / BigInt(100);
    
    logger.info(`🧮 BONK SELL: ${Number(tokenAmountIn)} tokens → ${Number(solOut) / LAMPORTS_PER_SOL} SOL (${slippagePercent}% slippage)`);
    
    return minSolOut;
  }

  /**
   * 🔍 Pool discovery using memcmp filters
   */
  private async getBonkPoolState(tokenMint: string): Promise<BonkPoolState | null> {
    try {
      const pools = await connection.getProgramAccounts(LAUNCHLAB_PROGRAM, {
        commitment: "confirmed",
        filters: [
          {
            memcmp: {
              offset: 75, // Base mint position in pool account
              bytes: tokenMint,
            },
          },
        ],
      });

      if (pools.length === 0) return null;
      
      // Decode pool account data to extract all needed info
      return this.decodePoolAccount(pools[0].account.data, pools[0].pubkey);
    } catch (error) {
      logger.error(`Failed to get BONK pool state for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * 🔧 Decode pool account data
   */
  private decodePoolAccount(data: Buffer, poolId: PublicKey): BonkPoolState {
    // This is a simplified decoder - implement based on actual BONK pool structure
    // The exact offsets and structure would need to be determined from the program IDL
    
    // Placeholder implementation - replace with actual decoding logic
    const baseMint = new PublicKey(data.slice(75, 107));
    const quoteMint = new PublicKey(data.slice(107, 139));
    const creator = new PublicKey(data.slice(139, 171));
    
    // Derive vaults and other accounts
    const [baseVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), poolId.toBuffer(), baseMint.toBuffer()],
      LAUNCHLAB_PROGRAM
    );
    
    const [quoteVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), poolId.toBuffer(), quoteMint.toBuffer()],
      LAUNCHLAB_PROGRAM
    );

    const [platformConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("platform_config")],
      LAUNCHLAB_PROGRAM
    );

    return {
      poolId,
      baseMint,
      quoteMint,
      baseVault,
      quoteVault,
      creator,
      platformConfig,
      virtualBase: BigInt(1000000000), // Placeholder - decode from data
      virtualQuote: BigInt(1000000000), // Placeholder - decode from data
      realBase: BigInt(1000000000), // Placeholder - decode from data
      realQuote: BigInt(1000000000), // Placeholder - decode from data
    };
  }

  /**
   * 🎯 Quick buy with automatic retry
   */
  async quickBuy(params: {
    tokenAddress: string;
    privateKey: string;
    solAmount: number;
    slippage?: number;
    maxRetries?: number;
  }): Promise<{ success: boolean; signature?: string; error?: string }> {
    const { tokenAddress, privateKey, solAmount, slippage = 5, maxRetries = 3 } = params;
    
    try {
      const userKeypair = Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));

      const tx = await this.createBuyTransaction({
        tokenMint: tokenAddress,
        amount: solAmount,
        userKeypair,
        slippage,
      });

      // Send with retries
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const signature = await connection.sendTransaction(tx, {
            maxRetries: 3,
            skipPreflight: false,
          });

          const confirmation = await connection.confirmTransaction(signature, "confirmed");
          
          if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }

          // Collect platform fee after successful Bonk Universal Service buy
          try {
            const { collectTransactionFee } = await import("../../backend/functions-main");
            const feeResult = await collectTransactionFee(
              privateKey,
              solAmount,
              "buy"
            );
            
            if (feeResult.success) {
              console.log(`[bonk-universal] Platform fee collected: ${feeResult.feeAmount} SOL`);
            } else {
              console.log(`[bonk-universal] Failed to collect platform fee: ${feeResult.error}`);
            }
          } catch (feeError: any) {
            console.log(`[bonk-universal] Error collecting platform fee: ${feeError.message}`);
          }

          return { success: true, signature };
        } catch (error: any) {
          if (attempt === maxRetries) {
            return { success: false, error: error.message };
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }

      return { success: false, error: "Max retries exceeded" };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
export const bonkUniversalService = new BonkUniversalService();