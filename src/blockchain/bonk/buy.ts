import {
  AccountMeta,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { struct, u8 } from "@solana/buffer-layout";
import { TokenInstruction } from "@solana/spl-token";
import { connection } from "../common/connection";
import { getBonkPoolState, PoolState } from "./pool";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  createTransferInstruction,
  NATIVE_MINT,
} from "@solana/spl-token";

// BONK Program constants
const BONK_PROGRAM_ID = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
const raydim_authority = new PublicKey("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh");
const global_config = new PublicKey("6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX");
const platform_config = new PublicKey("FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1");
const token_program = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const event_authority = new PublicKey("2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr");

// Maestro Bot constants
const MAESTRO_BOT_PROGRAM = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");
const MAESTRO_FEE_ACCOUNT = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");

// Platform fee wallet
const PLATFORM_FEE_WALLET = new PublicKey("C1QL4i1Dbt69eNfMRoxc1VZLsu4MgtmVKucrBDPg4Pop");

// Instruction discriminators
const BUY_DISCRIMINATOR = [250, 234, 13, 123, 213, 156, 19, 236];

// Default configuration
const DEFAULT_CONFIG = {
  baseSlippage: 35,
  maxSlippage: 70,
  maxRetries: 3,
  lowLiquidityThreshold: 5,
  mediumLiquidityThreshold: 20,
  feeRateBasisPoints: 25,
  retryDelayMs: 1000,
  retrySlippageBonus: 10,
  platformFeePercentage: 1.0, // 1% platform fee
  maestroFeePercentage: 0.25, // 0.25% Maestro fee
};

export interface BonkBuyConfig {
  baseSlippage?: number;
  maxSlippage?: number;
  maxRetries?: number;
  lowLiquidityThreshold?: number;
  mediumLiquidityThreshold?: number;
  feeRateBasisPoints?: number;
  retryDelayMs?: number;
  retrySlippageBonus?: number;
  platformFeePercentage?: number;
  maestroFeePercentage?: number;
}

export interface BonkBuyResult {
  success: boolean;
  signature?: string;
  tokensReceived?: string;
  solSpent?: string;
  error?: string;
}

// Helper function to create smart priority fee instruction
const createSmartPriorityFeeInstruction = (retryCount: number): TransactionInstruction => {
  const baseFee = 1_100_100;
  const retryMultiplier = Math.pow(1.5, retryCount);
  const finalFee = Math.floor(baseFee * retryMultiplier);
  
  return ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: finalFee,
  });
};

// Helper function to estimate buy output (constant product formula, minus slippage)
const estimateBuyOutput = (
  pool: PoolState,
  amountIn: bigint,
  slippage: number
): bigint => {
  const realBase = BigInt(pool.realBase);
  const realQuote = BigInt(pool.realQuote);

  // Apply fees to input amount
  const feeRate = BigInt(DEFAULT_CONFIG.feeRateBasisPoints);
  const feeBasisPoints = BigInt(10000);
  const amountAfterFees = amountIn - (amountIn * feeRate) / feeBasisPoints;

  // Use constant product formula for buy: x * y = k
  // After swap: (realQuote + amountAfterFees) * (realBase - tokensOut) = k
  // So: tokensOut = realBase - (k / (realQuote + amountAfterFees))
  const k = realBase * realQuote;
  const newRealQuote = realQuote + amountAfterFees;
  const newRealBase = k / newRealQuote;
  const tokensOut = realBase - newRealBase;

  // Apply slippage tolerance
  const tokensOutWithSlippage = (tokensOut * BigInt(100 - slippage)) / BigInt(100);

  return tokensOutWithSlippage;
};

// Adaptive slippage calculation
const calculateAdaptiveSlippage = (
  pool: PoolState,
  amountIn: bigint
): number => {
  const realBase = BigInt(pool.realBase);
  const realQuote = BigInt(pool.realQuote);

  // Calculate price impact as percentage
  const priceImpact = Number(amountIn * BigInt(100)) / Number(realQuote);

  let slippage = DEFAULT_CONFIG.baseSlippage;

  if (priceImpact > 5) {
    slippage = Math.max(slippage, 50);
  } else if (priceImpact > 2) {
    slippage = Math.max(slippage, 45);
  } else if (priceImpact > 1) {
    slippage = Math.max(slippage, 40);
  }

  // Check pool depth
  const reservesThreshold = DEFAULT_CONFIG.lowLiquidityThreshold * 1e9; // 9 decimals for SOL

  if (Number(realQuote) < reservesThreshold) {
    slippage = Math.max(slippage, 50);
  } else if (Number(realQuote) < reservesThreshold * 4) {
    slippage = Math.max(slippage, 45);
  }

  return Math.min(slippage, DEFAULT_CONFIG.maxSlippage);
};

// Create BONK buy instruction
const createBonkBuyInstruction = (
  pool: PoolState,
  payer: PublicKey,
  userBaseAta: PublicKey,
  userQuoteAta: PublicKey,
  amountIn: bigint,
  minimumAmountOut: bigint
): TransactionInstruction => {
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
  data.writeBigUInt64LE(amountIn, 8);
  data.writeBigUInt64LE(minimumAmountOut, 16);
  data.writeBigUInt64LE(BigInt(0), 24); // share fee rate

  return new TransactionInstruction({
    keys,
    programId: BONK_PROGRAM_ID,
    data,
  });
};

// Send and confirm transaction with retry logic
const sendAndConfirmTransactionWithRetry = async (
  tx: VersionedTransaction,
  buyerKeypair: Keypair,
  instructions: TransactionInstruction[],
  maxRetries: number = 3,
  retryInterval: number = 1000,
  logId: string
): Promise<{ success: boolean; signature?: string; error?: string }> => {
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      // Apply smart priority fees on retries
      if (retryCount > 0) {
        const smartFeeIx = createSmartPriorityFeeInstruction(retryCount);
        const priorityFee = smartFeeIx.data.readUInt32LE(4);
        console.log(`[${logId}]: Retry ${retryCount} - Applying priority fee: ${priorityFee} microLamports`);
        
        // Rebuild transaction with new priority fee
        const blockhash = await connection.getLatestBlockhash("processed");
        const newInstructions = [smartFeeIx, ...instructions];
        const message = new TransactionMessage({
          instructions: newInstructions,
          payerKey: buyerKeypair.publicKey,
          recentBlockhash: blockhash.blockhash,
        }).compileToV0Message();
        
        tx = new VersionedTransaction(message);
        tx.sign([buyerKeypair]);
      }

      // Send transaction
      const signature = await connection.sendTransaction(tx, {
        skipPreflight: false,
        preflightCommitment: "processed",
      });

      console.log(`[${logId}]: Transaction sent with signature: ${signature}`);

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: (await connection.getLatestBlockhash("processed")).blockhash,
          lastValidBlockHeight: (await connection.getLatestBlockhash("processed")).lastValidBlockHeight,
        },
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`);
      }

      return { success: true, signature };
    } catch (error: any) {
      retryCount++;
      console.error(`[${logId}]: Attempt ${retryCount} failed: ${error.message}`);
      
      if (retryCount >= maxRetries) {
        return { success: false, error: error.message };
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }
  }
  
  return { success: false, error: "Max retries exceeded" };
};

/**
 * Execute a BONK buy transaction with platform fees, Maestro fees, and adaptive slippage
 */
export const executeBonkBuy = async (
  tokenMint: string,
  buyerKeypair: Keypair,
  solAmount: number,
  userSlippage?: number, // User-configurable slippage
  config: BonkBuyConfig = {}
): Promise<BonkBuyResult> => {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const logId = `bonk-buy-${tokenMint.substring(0, 8)}`;
  const start = Date.now();
  
  console.log(`[${logId}]: 🚀 Starting BONK buy for ${solAmount} SOL`);
  console.log(`[${logId}]: 🪙 Token mint: ${tokenMint}`);
  console.log(`[${logId}]: ⚙️  User slippage: ${userSlippage || 'default'}%`);

  try {
    // Get pool state
    const poolState = await getBonkPoolState(tokenMint);
    if (!poolState) {
      return {
        success: false,
        error: `No BONK pool found for token ${tokenMint}`
      };
    }

    console.log(`[${logId}]: ✅ Pool found: ${poolState.poolId.toString()}`);

    // Calculate amounts
    const solAmountLamports = BigInt(Math.floor(solAmount * 1e9));
    
    // Calculate fees
    const platformFee = (solAmount * finalConfig.platformFeePercentage) / 100;
    const maestroFee = (solAmount * finalConfig.maestroFeePercentage) / 100;
    const totalFees = platformFee + maestroFee;
    const tradeAmount = solAmount - totalFees;
    const tradeAmountLamports = BigInt(Math.floor(tradeAmount * 1e9));

    console.log(`[${logId}]: 💰 Fee breakdown:`);
    console.log(`[${logId}]:   Platform fee (${finalConfig.platformFeePercentage}%): ${platformFee.toFixed(6)} SOL`);
    console.log(`[${logId}]:   Maestro fee (${finalConfig.maestroFeePercentage}%): ${maestroFee.toFixed(6)} SOL`);
    console.log(`[${logId}]:   Total fees: ${totalFees.toFixed(6)} SOL`);
    console.log(`[${logId}]:   Trade amount: ${tradeAmount.toFixed(6)} SOL`);

    // Calculate adaptive slippage
    const adaptiveSlippage = calculateAdaptiveSlippage(poolState, tradeAmountLamports);
    const finalSlippage = userSlippage !== undefined ? userSlippage : adaptiveSlippage;
    
    console.log(`[${logId}]: 📊 Slippage calculation:`);
    console.log(`[${logId}]:   Adaptive slippage: ${adaptiveSlippage}%`);
    console.log(`[${logId}]:   User slippage: ${userSlippage || 'default'}%`);
    console.log(`[${logId}]:   Final slippage: ${finalSlippage}%`);

    // Calculate expected tokens out
    const expectedTokensOut = estimateBuyOutput(poolState, tradeAmountLamports, finalSlippage);
    
    console.log(`[${logId}]: 📈 Expected tokens out: ${expectedTokensOut.toString()}`);

    // Prepare token accounts
    const tokenMintPubkey = new PublicKey(tokenMint);
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, buyerKeypair.publicKey);
    const tokenAta = getAssociatedTokenAddressSync(tokenMintPubkey, buyerKeypair.publicKey);

    // Retry logic with adaptive slippage
    let lastError: string = "";
    
    for (let attempt = 0; attempt < finalConfig.maxRetries; attempt++) {
      try {
        console.log(`[${logId}]: 🔄 Attempt ${attempt + 1}/${finalConfig.maxRetries}`);
        
        // Adjust slippage for retries
        const currentSlippage = attempt === 0 ? finalSlippage : 
          Math.min(finalSlippage + (attempt * finalConfig.retrySlippageBonus), finalConfig.maxSlippage);
        
        const currentTokensOut = estimateBuyOutput(poolState, tradeAmountLamports, currentSlippage);
        
        console.log(`[${logId}]: 📊 Retry ${attempt + 1} - Slippage: ${currentSlippage}%, Expected tokens: ${currentTokensOut.toString()}`);

        // Create instructions
        const instructions: TransactionInstruction[] = [];

        // Priority fee instruction
        const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 1_100_100,
        });
        instructions.push(priorityFeeIx);

        // Create token ATA if needed
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            buyerKeypair.publicKey,
            tokenAta,
            buyerKeypair.publicKey,
            tokenMintPubkey
          )
        );

        // Create WSOL ATA if needed
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            buyerKeypair.publicKey,
            wsolAta,
            buyerKeypair.publicKey,
            NATIVE_MINT
          )
        );

        // Transfer SOL to WSOL account
        instructions.push(
          SystemProgram.transfer({
            fromPubkey: buyerKeypair.publicKey,
            toPubkey: wsolAta,
            lamports: Number(tradeAmountLamports),
          })
        );

        // Sync native instruction
        instructions.push(createSyncNativeInstruction(wsolAta));

        // BONK buy instruction
        const buyIx = createBonkBuyInstruction(
          poolState,
          buyerKeypair.publicKey,
          tokenAta,
          wsolAta,
          tradeAmountLamports,
          currentTokensOut
        );
        instructions.push(buyIx);

        // Platform fee transfer (from buyer's SOL to platform wallet)
        if (platformFee > 0) {
          const platformFeeLamports = BigInt(Math.floor(platformFee * 1e9));
          
          // Transfer platform fee directly from buyer's SOL balance
          instructions.push(
            SystemProgram.transfer({
              fromPubkey: buyerKeypair.publicKey,
              toPubkey: PLATFORM_FEE_WALLET,
              lamports: Number(platformFeeLamports),
            })
          );
        }

        // Close WSOL account
        instructions.push(createCloseAccountInstruction(wsolAta, buyerKeypair.publicKey, buyerKeypair.publicKey));

        // Create and send transaction
        const blockhash = await connection.getLatestBlockhash("processed");
        const message = new TransactionMessage({
          instructions,
          payerKey: buyerKeypair.publicKey,
          recentBlockhash: blockhash.blockhash,
        }).compileToV0Message();

        const transaction = new VersionedTransaction(message);
        transaction.sign([buyerKeypair]);

        console.log(`[${logId}]: 📤 Sending transaction with ${instructions.length} instructions...`);

        const result = await sendAndConfirmTransactionWithRetry(
          transaction,
          buyerKeypair,
          instructions,
          1, // Single retry per attempt
          finalConfig.retryDelayMs,
          logId
        );

        if (result.success && result.signature) {
          const end = Date.now();
          console.log(`[${logId}]: ✅ BONK buy completed successfully in ${end - start}ms`);
          console.log(`[${logId}]: 📝 Signature: ${result.signature}`);
          
          return {
            success: true,
            signature: result.signature,
            tokensReceived: currentTokensOut.toString(),
            solSpent: solAmount.toFixed(6),
          };
        } else {
          lastError = result.error || "Transaction failed";
          throw new Error(lastError);
        }
      } catch (error: any) {
        lastError = error.message;
        console.error(`[${logId}]: ❌ Attempt ${attempt + 1} failed: ${error.message}`);
        
        if (attempt < finalConfig.maxRetries - 1) {
          console.log(`[${logId}]: ⏳ Waiting ${finalConfig.retryDelayMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, finalConfig.retryDelayMs));
        }
      }
    }

    console.error(`[${logId}]: 🚫 All buy attempts failed`);
    return {
      success: false,
      error: lastError || "All buy attempts failed"
    };

  } catch (error: any) {
    const end = Date.now();
    console.error(`[${logId}]: ❌ BONK buy error in ${end - start}ms:`, error);
    
    return {
      success: false,
      error: error.message || "Unknown error occurred"
    };
  }
}; 