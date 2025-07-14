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
const SELL_DISCRIMINATOR = [149, 39, 222, 155, 211, 124, 152, 26];

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

export interface BonkSellConfig {
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

export interface BonkSellResult {
  success: boolean;
  signature?: string;
  solReceived?: string;
  tokensSold?: string;
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

// Helper function to estimate sell output (constant product formula, minus slippage)
const estimateSellOutput = (
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

  // Use constant product formula for sell: x * y = k
  // After swap: (realBase + amountAfterFees) * (realQuote - solOut) = k
  // So: solOut = realQuote - (k / (realBase + amountAfterFees))
  const k = realBase * realQuote;
  const newRealBase = realBase + amountAfterFees;
  const newRealQuote = k / newRealBase;
  const solOut = realQuote - newRealQuote;

  // Apply slippage tolerance
  const solOutWithSlippage = (solOut * BigInt(100 - slippage)) / BigInt(100);

  return solOutWithSlippage;
};

// Adaptive slippage calculation for sell
const calculateAdaptiveSlippage = (
  pool: PoolState,
  amountIn: bigint
): number => {
  const realBase = BigInt(pool.realBase);
  const realQuote = BigInt(pool.realQuote);

  // Calculate price impact as percentage
  const priceImpact = Number(amountIn * BigInt(100)) / Number(realBase);

  let slippage = DEFAULT_CONFIG.baseSlippage;

  if (priceImpact > 5) {
    slippage = Math.max(slippage, 50);
  } else if (priceImpact > 2) {
    slippage = Math.max(slippage, 45);
  } else if (priceImpact > 1) {
    slippage = Math.max(slippage, 40);
  }

  // Check pool depth
  const reservesThreshold = DEFAULT_CONFIG.lowLiquidityThreshold * 1e6; // 6 decimals for tokens

  if (Number(realBase) < reservesThreshold) {
    slippage = Math.max(slippage, 50);
  } else if (Number(realBase) < reservesThreshold * 4) {
    slippage = Math.max(slippage, 45);
  }

  return Math.min(slippage, DEFAULT_CONFIG.maxSlippage);
};

// Create BONK sell instruction
const createBonkSellInstruction = (
  pool: PoolState,
  seller: PublicKey,
  userBaseAta: PublicKey,
  userQuoteAta: PublicKey,
  amountIn: bigint,
  minimumAmountOut: bigint
): TransactionInstruction => {
  const keys: AccountMeta[] = [
    { pubkey: seller, isSigner: true, isWritable: true },
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
  sellerKeypair: Keypair,
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
          payerKey: sellerKeypair.publicKey,
          recentBlockhash: blockhash.blockhash,
        }).compileToV0Message();
        
        tx = new VersionedTransaction(message);
        tx.sign([sellerKeypair]);
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
 * Execute a BONK sell transaction with platform fees, Maestro fees, and adaptive slippage
 */
export const executeBonkSell = async (
  tokenMint: string,
  sellerKeypair: Keypair,
  tokenAmount?: bigint, // Optional: if not provided, sells all tokens
  userSlippage?: number, // User-configurable slippage
  config: BonkSellConfig = {}
): Promise<BonkSellResult> => {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const logId = `bonk-sell-${tokenMint.substring(0, 8)}`;
  const start = Date.now();
  
  console.log(`[${logId}]: 🚀 Starting BONK sell`);
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

    // Prepare token accounts
    const tokenMintPubkey = new PublicKey(tokenMint);
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, sellerKeypair.publicKey);
    const tokenAta = getAssociatedTokenAddressSync(tokenMintPubkey, sellerKeypair.publicKey);

    // Get user token balance
    console.log(`[${logId}]: Getting user token balance...`);
    const userTokenBalanceInfo = await connection.getTokenAccountBalance(tokenAta);
    const userTokenBalance = BigInt(userTokenBalanceInfo.value?.amount || 0);
    console.log(`[${logId}]: User token balance: ${userTokenBalance} tokens`);

    if (userTokenBalance === BigInt(0)) {
      return {
        success: false,
        error: "No tokens to sell"
      };
    }

    // Determine amount to sell
    const amountToSell = tokenAmount !== undefined ? tokenAmount : userTokenBalance;
    
    if (amountToSell > userTokenBalance) {
      return {
        success: false,
        error: `Cannot sell ${amountToSell} tokens - only ${userTokenBalance} available`
      };
    }

    if (amountToSell <= BigInt(0)) {
      return {
        success: false,
        error: "Amount to sell must be greater than 0"
      };
    }

    console.log(`[${logId}]: Selling ${amountToSell} tokens out of ${userTokenBalance} available`);

    // Calculate adaptive slippage
    const adaptiveSlippage = calculateAdaptiveSlippage(poolState, amountToSell);
    const finalSlippage = userSlippage !== undefined ? userSlippage : adaptiveSlippage;
    
    console.log(`[${logId}]: 📊 Slippage calculation:`);
    console.log(`[${logId}]:   Adaptive slippage: ${adaptiveSlippage}%`);
    console.log(`[${logId}]:   User slippage: ${userSlippage || 'default'}%`);
    console.log(`[${logId}]:   Final slippage: ${finalSlippage}%`);

    // Calculate expected SOL out
    const expectedSolOut = estimateSellOutput(poolState, amountToSell, finalSlippage);
    
    console.log(`[${logId}]: 📈 Expected SOL out: ${expectedSolOut.toString()} lamports (${Number(expectedSolOut) / 1e9} SOL)`);

    // Calculate fees
    const platformFeeLamports = BigInt(Math.floor(Number(expectedSolOut) * finalConfig.platformFeePercentage / 100));
    const maestroFeeLamports = BigInt(Math.floor(Number(expectedSolOut) * finalConfig.maestroFeePercentage / 100));
    const totalFees = platformFeeLamports + maestroFeeLamports;
    const netSolOut = expectedSolOut - totalFees;

    console.log(`[${logId}]: 💰 Fee breakdown:`);
    console.log(`[${logId}]:   Platform fee (${finalConfig.platformFeePercentage}%): ${(Number(platformFeeLamports) / 1e9).toFixed(6)} SOL`);
    console.log(`[${logId}]:   Maestro fee (${finalConfig.maestroFeePercentage}%): ${(Number(maestroFeeLamports) / 1e9).toFixed(6)} SOL`);
    console.log(`[${logId}]:   Total fees: ${(Number(totalFees) / 1e9).toFixed(6)} SOL`);
    console.log(`[${logId}]:   Net SOL out: ${(Number(netSolOut) / 1e9).toFixed(6)} SOL`);

    // Retry logic with adaptive slippage
    let lastError: string = "";
    
    for (let attempt = 0; attempt < finalConfig.maxRetries; attempt++) {
      try {
        console.log(`[${logId}]: 🔄 Attempt ${attempt + 1}/${finalConfig.maxRetries}`);
        
        // Adjust slippage for retries
        const currentSlippage = attempt === 0 ? finalSlippage : 
          Math.min(finalSlippage + (attempt * finalConfig.retrySlippageBonus), finalConfig.maxSlippage);
        
        const currentSolOut = estimateSellOutput(poolState, amountToSell, currentSlippage);
        
        console.log(`[${logId}]: 📊 Retry ${attempt + 1} - Slippage: ${currentSlippage}%, Expected SOL: ${currentSolOut.toString()}`);

        // Create instructions
        const instructions: TransactionInstruction[] = [];

        // Priority fee instruction
        const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 1_100_100,
        });
        instructions.push(priorityFeeIx);

        // Check if WSOL ATA exists before creating it
        const wsolAtaInfo = await connection.getAccountInfo(wsolAta);
        if (!wsolAtaInfo) {
          instructions.push(
            createAssociatedTokenAccountIdempotentInstruction(
              sellerKeypair.publicKey,
              wsolAta,
              sellerKeypair.publicKey,
              NATIVE_MINT
            )
          );
        }

        // BONK sell instruction
        const sellIx = createBonkSellInstruction(
          poolState,
          sellerKeypair.publicKey,
          tokenAta,
          wsolAta,
          amountToSell,
          currentSolOut
        );
        instructions.push(sellIx);

        // Platform fee transfer (from WSOL ATA to platform wallet)
        // Only transfer if fee is at least 1000 lamports (0.000001 SOL) to avoid dust amounts
        if (platformFeeLamports >= 1000) {
          // Get platform wallet's WSOL ATA
          const platformWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, PLATFORM_FEE_WALLET);
          
          // Create platform wallet's WSOL ATA if it doesn't exist
          instructions.push(
            createAssociatedTokenAccountIdempotentInstruction(
              sellerKeypair.publicKey,
              platformWsolAta,
              PLATFORM_FEE_WALLET,
              NATIVE_MINT
            )
          );
          
          // Transfer platform fee
          console.log(`[${logId}]: 💸 Transferring platform fee: ${Number(platformFeeLamports)} lamports to ${PLATFORM_FEE_WALLET.toString()}`);
          instructions.push(
            createTransferInstruction(
              wsolAta,
              platformWsolAta,
              sellerKeypair.publicKey,
              Number(platformFeeLamports)
            )
          );
        } else if (platformFeeLamports > 0) {
          console.log(`[${logId}]: ⚠️  Platform fee too small (${Number(platformFeeLamports)} lamports), skipping transfer`);
        }

        // Close WSOL account (only if we have no platform fee or after fee transfer)
        instructions.push(createCloseAccountInstruction(wsolAta, sellerKeypair.publicKey, sellerKeypair.publicKey));

        // Create and send transaction
        const blockhash = await connection.getLatestBlockhash("processed");
        const message = new TransactionMessage({
          instructions,
          payerKey: sellerKeypair.publicKey,
          recentBlockhash: blockhash.blockhash,
        }).compileToV0Message();

        const transaction = new VersionedTransaction(message);
        transaction.sign([sellerKeypair]);

        console.log(`[${logId}]: 📤 Sending transaction with ${instructions.length} instructions...`);

        const result = await sendAndConfirmTransactionWithRetry(
          transaction,
          sellerKeypair,
          instructions,
          1, // Single retry per attempt
          finalConfig.retryDelayMs,
          logId
        );

        if (result.success && result.signature) {
          const end = Date.now();
          console.log(`[${logId}]: ✅ BONK sell completed successfully in ${end - start}ms`);
          console.log(`[${logId}]: 📝 Signature: ${result.signature}`);
          
          return {
            success: true,
            signature: result.signature,
            solReceived: (Number(netSolOut) / 1e9).toFixed(6),
            tokensSold: amountToSell.toString(),
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

    console.error(`[${logId}]: 🚫 All sell attempts failed`);
    return {
      success: false,
      error: lastError || "All sell attempts failed"
    };

  } catch (error: any) {
    const end = Date.now();
    console.error(`[${logId}]: ❌ BONK sell error in ${end - start}ms:`, error);
    
    return {
      success: false,
      error: error.message || "Unknown error occurred"
    };
  }
}; 