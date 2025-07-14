import {
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { struct, u8 } from "@solana/buffer-layout";
import { TokenInstruction } from "@solana/spl-token";
import { connection } from "../common/connection";
import { 
  PUMPSWAP_AMM_PROGRAM_ID,
  WSOL_MINT,
  GLOBAL_CONFIG,
  PUMPFUN_AMM_PROTOCOL_FEE,
  PROTOCOL_FEE_ATA,
  EVENT_AUTHORITY,
  DEFAULT_PLATFORM_FEE_PERCENTAGE,
  BUY_DISCRIMINATOR
} from "./constants";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getTokenPoolInfo, getBuyAmountOut } from "./pool";

// Derive creator vault authority from coin creator
const getCreatorVaultAuthority = (creator: PublicKey) => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from([99, 114, 101, 97, 116, 111, 114, 95, 118, 97, 117, 108, 116]),
     creator.toBuffer()],
    PUMPSWAP_AMM_PROGRAM_ID
  )[0];
};

// Helper functions for WSOL handling
const syncNativeInstructionData = struct<{ instruction: TokenInstruction.SyncNative }>([u8("instruction")]);

const createSyncNativeInstruction = (account: PublicKey): TransactionInstruction => {
  const keys = [{ pubkey: account, isSigner: false, isWritable: true }];
  const data = Buffer.alloc(syncNativeInstructionData.span);
  syncNativeInstructionData.encode({ instruction: TokenInstruction.SyncNative }, data);
  return new TransactionInstruction({ keys, programId: TOKEN_PROGRAM_ID, data });
};

const buildAssociatedTokenAccountInstruction = (
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  instructionData: Buffer
): TransactionInstruction => {
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedToken, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: instructionData,
  });
};

export interface BuyResult {
  success: boolean;
  signature?: string;
  error?: string;
  tokensReceived?: string;
  solSpent?: string;
}

// Smart priority fee configuration for buy transactions
interface SmartPriorityFeeConfig {
  baseFee: number;
  retryMultiplier: number;
  maxFee: number;
  minFee: number;
}

const BUY_PRIORITY_CONFIG: SmartPriorityFeeConfig = {
  baseFee: 1_500_000, // 1.5M microLamports (0.0015 SOL)
  retryMultiplier: 1.5, // 50% increase per retry
  maxFee: 12_000_000, // 12M microLamports (0.012 SOL)
  minFee: 300_000, // 300K microLamports (0.0003 SOL)
};

// Calculate smart priority fee based on retry attempt
const calculateSmartPriorityFee = (retryAttempt: number): number => {
  const calculatedFee = Math.floor(BUY_PRIORITY_CONFIG.baseFee * Math.pow(BUY_PRIORITY_CONFIG.retryMultiplier, retryAttempt));
  return Math.max(BUY_PRIORITY_CONFIG.minFee, Math.min(calculatedFee, BUY_PRIORITY_CONFIG.maxFee));
};

// Create smart priority fee instruction
const createSmartPriorityFeeInstruction = (retryAttempt: number) => {
  const priorityFee = calculateSmartPriorityFee(retryAttempt);
  return ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: priorityFee,
  });
};

// Send and confirm transaction with retry logic
const sendAndConfirmTransactionWithRetry = async (
  tx: VersionedTransaction,
  buyerKeypair: Keypair,
  instructions: any[],
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
        console.log(`[${logId}]: Retry ${retryCount} - Applying priority fee: ${priorityFee} microLamports (${(priorityFee / 1_000_000_000).toFixed(6)} SOL)`);
        
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

      console.log(`[${logId}]: Transaction confirmed successfully`);
      return { success: true, signature };

    } catch (error: any) {
      console.error(`[${logId}]: Attempt ${retryCount + 1} failed:`, error.message);
      
      if (retryCount === maxRetries - 1) {
        return { 
          success: false, 
          error: error.message || "Transaction failed after all retries" 
        };
      }
      
      retryCount++;
      console.log(`[${logId}]: Retrying in ${retryInterval}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }
  }
  
  return { success: false, error: "Transaction failed after all retries" };
};

// Create PumpSwap buy instruction with correct account structure (matching reference)
const createPumpSwapBuyInstruction = (
  poolInfo: any,
  user: PublicKey,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  baseTokenAta: PublicKey,
  quoteTokenAta: PublicKey,
  baseAmountOut: bigint,
  maxQuoteAmountIn: bigint,
  coinCreatorVaultAta: PublicKey,
  coinCreatorVaultAuthority: PublicKey
): TransactionInstruction => {
  const keys = [
    { pubkey: poolInfo.poolId, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: false },
    { pubkey: baseMint, isSigner: false, isWritable: false },
    { pubkey: quoteMint, isSigner: false, isWritable: false },
    { pubkey: baseTokenAta, isSigner: false, isWritable: true },
    { pubkey: quoteTokenAta, isSigner: false, isWritable: true },
    { pubkey: poolInfo.poolBaseTokenAccount, isSigner: false, isWritable: true },
    { pubkey: poolInfo.poolQuoteTokenAccount, isSigner: false, isWritable: true },
    { pubkey: PUMPFUN_AMM_PROTOCOL_FEE, isSigner: false, isWritable: false },
    { pubkey: PROTOCOL_FEE_ATA, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMPSWAP_AMM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: coinCreatorVaultAta, isSigner: false, isWritable: true },
    { pubkey: coinCreatorVaultAuthority, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(24);
  const discriminator = Buffer.from(BUY_DISCRIMINATOR);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(baseAmountOut, 8);
  data.writeBigUInt64LE(maxQuoteAmountIn, 16);

  return new TransactionInstruction({
    keys,
    programId: PUMPSWAP_AMM_PROGRAM_ID,
    data,
  });
};

/**
 * Execute a buy transaction on PumpSwap with real pool data
 */
export const executePumpSwapBuy = async (
  tokenAddress: string,
  buyerKeypair: Keypair,
  solAmount: number,
  platformFeePercentage: number = DEFAULT_PLATFORM_FEE_PERCENTAGE,
  slippagePercentage: number = 1.0, // Default 1% slippage
  maxRetries: number = 3
): Promise<BuyResult> => {
  const logId = `pumpswap-buy-${tokenAddress.substring(0, 8)}`;
  const start = performance.now();
  console.log(`[${logId}]: Starting PumpSwap buy for ${solAmount} SOL with ${platformFeePercentage}% platform fee`);

  try {
    const tokenMint = new PublicKey(tokenAddress);
    console.log(`[${logId}]: Token address = ${tokenMint.toBase58()}`);

    // Calculate fees (simplified for now - using platform fee only)
    const platformFee = (solAmount * platformFeePercentage) / 100; // Platform fee percentage
    const totalFees = platformFee; // Simplified fee structure
    const totalSpend = solAmount + totalFees;
    
    console.log(`[${logId}]: Fee breakdown:`);
    console.log(`[${logId}]:   - Platform fee (${platformFeePercentage}%): ${platformFee.toFixed(6)} SOL`);
    console.log(`[${logId}]:   - Total fees: ${totalFees.toFixed(6)} SOL`);
    console.log(`[${logId}]:   - Trade amount (SOL sent to buy): ${solAmount.toFixed(6)} SOL`);
    console.log(`[${logId}]:   - Total spend (trade + fees): ${totalSpend.toFixed(6)} SOL`);

    // Enhanced wallet balance checking with fee reservations
    const walletBalance = await connection.getBalance(buyerKeypair.publicKey, "confirmed");
    const walletBalanceSOL = walletBalance / LAMPORTS_PER_SOL;
    
    // Reserve fees for transaction and future operations
    const transactionFeeReserve = 0.002; // Priority fees + base fees (reduced)
    const sellFeeReserve = 0.002; // Reserve for future sell transaction fees (reduced)
    const totalFeeReserve = transactionFeeReserve + sellFeeReserve + totalFees;
    const availableForTrade = walletBalanceSOL - totalFeeReserve;
    
    console.log(`[${logId}]: Wallet balance: ${walletBalanceSOL.toFixed(6)} SOL`);
    console.log(`[${logId}]: Transaction fee reserve: ${transactionFeeReserve.toFixed(6)} SOL`);
    console.log(`[${logId}]: Sell fee reserve: ${sellFeeReserve.toFixed(6)} SOL (for future sells)`);
    console.log(`[${logId}]: Total fee reserve: ${totalFeeReserve.toFixed(6)} SOL`);
    console.log(`[${logId}]: Available for trade: ${availableForTrade.toFixed(6)} SOL`);
    
    if (availableForTrade <= 0) {
      return {
        success: false,
        error: `Insufficient balance: ${walletBalanceSOL.toFixed(6)} SOL available, need at least ${totalFeeReserve.toFixed(6)} SOL for fees`
      };
    }
    
    // Use the minimum of requested amount or available balance
    const actualTradeAmount = Math.min(solAmount, availableForTrade);
    
    if (actualTradeAmount < solAmount) {
      console.warn(`[${logId}]: Adjusted trade amount from ${solAmount} SOL to ${actualTradeAmount.toFixed(6)} SOL due to fee reservations`);
    }

    // 🔥 REAL POOL DATA FETCHING
    console.log(`[${logId}]: Fetching real pool data for token ${tokenAddress}...`);
    const poolInfo = await getTokenPoolInfo(tokenAddress);
    
    if (!poolInfo) {
      return {
        success: false,
        error: `No PumpSwap pool found for token ${tokenAddress}. This token may not be listed on PumpSwap.`
      };
    }

    console.log(`[${logId}]: ✅ Real pool data fetched successfully!`);
    console.log(`[${logId}]:   Pool ID: ${poolInfo.poolId.toBase58()}`);
    console.log(`[${logId}]:   Base Mint: ${poolInfo.baseMint.toBase58()}`);
    console.log(`[${logId}]:   Quote Mint: ${poolInfo.quoteMint.toBase58()}`);
    console.log(`[${logId}]:   Pool Base Token Account: ${poolInfo.poolBaseTokenAccount.toBase58()}`);
    console.log(`[${logId}]:   Pool Quote Token Account: ${poolInfo.poolQuoteTokenAccount.toBase58()}`);
    console.log(`[${logId}]:   Coin Creator: ${poolInfo.coinCreator.toBase58()}`);

    // Prepare token accounts
    const wsolAta = getAssociatedTokenAddressSync(WSOL_MINT, buyerKeypair.publicKey);
    const tokenAta = getAssociatedTokenAddressSync(tokenMint, buyerKeypair.publicKey);
    
    // Get coin creator vault ATA (this is where the creator receives fees in WSOL)
    const coinCreatorVaultAuthority = getCreatorVaultAuthority(poolInfo.coinCreator);
    const coinCreatorVaultAta = getAssociatedTokenAddressSync(WSOL_MINT, coinCreatorVaultAuthority, true);

    console.log(`[${logId}]: Token accounts prepared:`);
    console.log(`[${logId}]:   WSOL ATA: ${wsolAta.toBase58()}`);
    console.log(`[${logId}]:   Token ATA: ${tokenAta.toBase58()}`);
    console.log(`[${logId}]:   Creator Vault ATA: ${coinCreatorVaultAta.toBase58()}`);

    // Calculate amounts
    const solAmountLamports = BigInt(Math.floor(actualTradeAmount * LAMPORTS_PER_SOL));
    const maxQuoteAmountIn = solAmountLamports; // Maximum SOL we're willing to spend
    
    // Calculate expected tokens out (simplified - in real implementation, use bonding curve)
    const baseAmountOut = await getBuyAmountOut(poolInfo, solAmountLamports, slippagePercentage);
    
    console.log(`[${logId}]: Amount calculations:`);
    console.log(`[${logId}]:   SOL in (lamports): ${solAmountLamports.toString()}`);
    console.log(`[${logId}]:   Max SOL in: ${maxQuoteAmountIn.toString()}`);
    console.log(`[${logId}]:   Expected tokens out: ${baseAmountOut.toString()}`);

    // Create instructions
    const instructions = [];

    // Add priority fee instruction
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1_100_100,
    });
    instructions.push(addPriorityFee);

    // Create token ATA if it doesn't exist
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        buyerKeypair.publicKey,
        tokenAta,
        buyerKeypair.publicKey,
        tokenMint
      )
    );

    // Create WSOL ATA with custom instruction (matching reference)
    const createTokenAccountWsol = buildAssociatedTokenAccountInstruction(
      buyerKeypair.publicKey,
      wsolAta,
      buyerKeypair.publicKey,
      WSOL_MINT,
      Buffer.from([1])
    );
    instructions.push(createTokenAccountWsol);

    // Transfer SOL to WSOL account
    const transferForWsol = SystemProgram.transfer({
      fromPubkey: buyerKeypair.publicKey,
      toPubkey: wsolAta,
      lamports: Number(solAmountLamports),
    });
    instructions.push(transferForWsol);

    // Sync native instruction to convert SOL to WSOL
    const syncNativeInstruction = createSyncNativeInstruction(wsolAta);
    instructions.push(syncNativeInstruction);

    // Create buy instruction with REAL pool data
    const buyInstruction = createPumpSwapBuyInstruction(
      poolInfo,
      buyerKeypair.publicKey,
      tokenMint, // baseMint (the token we're buying)
      WSOL_MINT, // quoteMint (SOL)
      tokenAta, // baseTokenAta (our token account)
      wsolAta, // quoteTokenAta (our WSOL account)
      baseAmountOut, // baseAmountOut (tokens we expect to receive)
      maxQuoteAmountIn, // maxQuoteAmountIn (max SOL we're willing to spend)
      coinCreatorVaultAta, // coinCreatorVaultAta
      coinCreatorVaultAuthority // coinCreatorVaultAuthority
    );

    instructions.push(buyInstruction);

    // Create and send transaction
    const blockhash = await connection.getLatestBlockhash("processed");
    const message = new TransactionMessage({
      instructions,
      payerKey: buyerKeypair.publicKey,
      recentBlockhash: blockhash.blockhash,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);
    transaction.sign([buyerKeypair]);

    console.log(`[${logId}]: Transaction created with ${instructions.length} instructions`);
    console.log(`[${logId}]: Sending transaction...`);

    // Send and confirm transaction
    const result = await sendAndConfirmTransactionWithRetry(
      transaction,
      buyerKeypair,
      instructions,
      maxRetries,
      1000,
      logId
    );

    if (result.success && result.signature) {
      const end = performance.now();
      console.log(`[${logId}]: ✅ PumpSwap buy completed successfully in ${(end - start).toFixed(2)}ms`);
      console.log(`[${logId}]: Transaction signature: ${result.signature}`);
      
      // Record transaction for analytics
      await recordTransaction(
        tokenAddress,
        buyerKeypair.publicKey.toBase58(),
        "pumpswap_buy",
        result.signature,
        true,
        actualTradeAmount,
        baseAmountOut.toString(),
        undefined
      );

      return {
        success: true,
        signature: result.signature,
        tokensReceived: baseAmountOut.toString(),
        solSpent: actualTradeAmount.toFixed(6),
      };
    } else {
      console.error(`[${logId}]: ❌ PumpSwap buy failed: ${result.error}`);
      
      // Record failed transaction
      await recordTransaction(
        tokenAddress,
        buyerKeypair.publicKey.toBase58(),
        "pumpswap_buy",
        "failed",
        false,
        actualTradeAmount,
        "0",
        result.error
      );

      return {
        success: false,
        error: result.error || "Transaction failed",
      };
    }

  } catch (error: any) {
    const end = performance.now();
    console.error(`[${logId}]: ❌ PumpSwap buy error in ${(end - start).toFixed(2)}ms:`, error);
    
    // Record failed transaction
    await recordTransaction(
      tokenAddress,
      buyerKeypair.publicKey.toBase58(),
      "pumpswap_buy",
      "error",
      false,
      solAmount,
      "0",
      error.message
    );

    return {
      success: false,
      error: error.message || "Unknown error occurred",
    };
  }
};

/**
 * Optional transaction recording function for analytics
 */
export const recordTransaction = async (
  tokenAddress: string,
  buyerPublicKey: string,
  transactionType: "pumpswap_buy",
  signature: string,
  success: boolean,
  amountSol: number,
  amountTokens: string,
  errorMessage?: string
): Promise<void> => {
  try {
    console.log(`[transaction-record]: Recording ${transactionType} transaction`, {
      tokenAddress,
      buyerPublicKey,
      signature,
      success,
      amountSol,
      amountTokens,
      errorMessage,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[transaction-record]: Error recording transaction:`, error);
  }
};