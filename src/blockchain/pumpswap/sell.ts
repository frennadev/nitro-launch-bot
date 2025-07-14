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
  SELL_DISCRIMINATOR,
  PLATFORM_FEE_WALLET,
} from "./constants";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createTransferInstruction,
} from "@solana/spl-token";
import { getTokenPoolInfo, getSellAmountOut } from "./pool";

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

// Close account instruction data
const closeAccountInstructionData = struct<{ instruction: TokenInstruction.CloseAccount }>([u8("instruction")]);

const createCloseAccountInstruction = (
  account: PublicKey,
  destination: PublicKey,
  authority: PublicKey
): TransactionInstruction => {
  const keys = [
    { pubkey: account, isSigner: false, isWritable: true },
    { pubkey: destination, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true, isWritable: false },
  ];

  const data = Buffer.alloc(closeAccountInstructionData.span);
  closeAccountInstructionData.encode({ instruction: TokenInstruction.CloseAccount }, data);

  return new TransactionInstruction({ keys, programId: TOKEN_PROGRAM_ID, data });
};

export interface SellResult {
  success: boolean;
  signature?: string;
  error?: string;
  solReceived?: string;
  tokensSold?: string;
}

// Smart priority fee configuration for sell transactions
interface SmartPriorityFeeConfig {
  baseFee: number;
  retryMultiplier: number;
  maxFee: number;
  minFee: number;
}

const SELL_PRIORITY_CONFIG: SmartPriorityFeeConfig = {
  baseFee: 1_500_000, // 1.5M microLamports (0.0015 SOL)
  retryMultiplier: 1.5, // 50% increase per retry
  maxFee: 12_000_000, // 12M microLamports (0.012 SOL)
  minFee: 300_000, // 300K microLamports (0.0003 SOL)
};

// Calculate smart priority fee based on retry attempt
const calculateSmartPriorityFee = (retryAttempt: number): number => {
  const calculatedFee = Math.floor(SELL_PRIORITY_CONFIG.baseFee * Math.pow(SELL_PRIORITY_CONFIG.retryMultiplier, retryAttempt));
  return Math.max(SELL_PRIORITY_CONFIG.minFee, Math.min(calculatedFee, SELL_PRIORITY_CONFIG.maxFee));
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
  sellerKeypair: Keypair,
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

// Create PumpSwap sell instruction with correct account structure (matching reference)
const createPumpSwapSellInstruction = (
  poolInfo: any,
  user: PublicKey,
  baseMint: PublicKey,
  quoteMint: PublicKey,
  baseTokenAta: PublicKey,
  quoteTokenAta: PublicKey,
  baseAmountIn: bigint,
  minQuoteAmountOut: bigint,
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
  const discriminator = Buffer.from(SELL_DISCRIMINATOR);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(baseAmountIn, 8);
  data.writeBigUInt64LE(minQuoteAmountOut, 16);

  return new TransactionInstruction({
    keys,
    programId: PUMPSWAP_AMM_PROGRAM_ID,
    data,
  });
};

export const executePumpSwapSell = async (
  tokenAddress: string,
  sellerKeypair: Keypair,
  tokenAmount?: bigint, // Optional: if not provided, sells all tokens
  platformFeePercentage: number = DEFAULT_PLATFORM_FEE_PERCENTAGE,
  slippagePercentage: number = 1.0, // Default 1% slippage
  maxRetries: number = 3
): Promise<SellResult> => {
  const logId = `pumpswap-sell-${tokenAddress.substring(0, 8)}`;
  const start = performance.now();
  console.log(`[${logId}]: Starting PumpSwap sell with ${platformFeePercentage}% platform fee`);

  try {
    const tokenMint = new PublicKey(tokenAddress);
    console.log(`[${logId}]: Token address = ${tokenMint.toBase58()}`);

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
    const wsolAta = getAssociatedTokenAddressSync(WSOL_MINT, sellerKeypair.publicKey);
    const tokenAta = getAssociatedTokenAddressSync(tokenMint, sellerKeypair.publicKey);
    
    // Get coin creator vault ATA (this is where the creator receives fees in WSOL)
    const coinCreatorVaultAuthority = getCreatorVaultAuthority(poolInfo.coinCreator);
    const coinCreatorVaultAta = getAssociatedTokenAddressSync(WSOL_MINT, coinCreatorVaultAuthority, true);

    console.log(`[${logId}]: Token accounts prepared:`);
    console.log(`[${logId}]:   WSOL ATA: ${wsolAta.toBase58()}`);
    console.log(`[${logId}]:   Token ATA: ${tokenAta.toBase58()}`);
    console.log(`[${logId}]:   Creator Vault ATA: ${coinCreatorVaultAta.toBase58()}`);

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

    // Calculate expected SOL out
    const minQuoteAmountOut = await getSellAmountOut(poolInfo, amountToSell, slippagePercentage);
    
    console.log(`[${logId}]: Amount calculations:`);
    console.log(`[${logId}]:   Tokens in: ${amountToSell.toString()}`);
    console.log(`[${logId}]:   Min SOL out: ${minQuoteAmountOut.toString()}`);
    console.log(`[${logId}]:   Expected SOL out: ${(Number(minQuoteAmountOut) / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    // Platform fee calculation
    const platformFeeLamports = BigInt(Math.floor(Number(minQuoteAmountOut) * platformFeePercentage / 100));

    // Retry logic with dynamic WSOL ATA check and instruction rebuild
    let result;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Rebuild instructions array each attempt
      const instructions = [];
      // Add priority fee instruction
      const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 1_100_100,
      });
      instructions.push(addPriorityFee);
      // Modify compute units for sell transaction
      const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
        units: 151591,
      });
      instructions.push(modifyComputeUnits);
      // Check if WSOL ATA exists before creating it (on every retry)
      const wsolAtaInfo = await connection.getAccountInfo(wsolAta);
      if (!wsolAtaInfo) {
        const tokenAccountInstruction = createAssociatedTokenAccountIdempotentInstruction(
          sellerKeypair.publicKey,
          wsolAta,
          sellerKeypair.publicKey,
          WSOL_MINT
        );
        instructions.push(tokenAccountInstruction);
      }
      // Create sell instruction with REAL pool data
      const sellInstruction = createPumpSwapSellInstruction(
        poolInfo,
        sellerKeypair.publicKey,
        tokenMint, // baseMint (the token we're selling)
        WSOL_MINT, // quoteMint (SOL)
        tokenAta, // baseTokenAta (our token account)
        wsolAta, // quoteTokenAta (our WSOL account)
        amountToSell, // baseAmountIn (tokens we're selling)
        minQuoteAmountOut, // minQuoteAmountOut (min SOL we expect to receive)
        coinCreatorVaultAta, // coinCreatorVaultAta
        coinCreatorVaultAuthority // coinCreatorVaultAuthority
      );
      instructions.push(sellInstruction);
      // Platform fee transfer (from WSOL ATA to platform wallet)
      if (platformFeeLamports > 0) {
        // Get platform wallet's WSOL ATA
        const platformWsolAta = getAssociatedTokenAddressSync(WSOL_MINT, PLATFORM_FEE_WALLET);
        
        // Create platform wallet's WSOL ATA if it doesn't exist
        const createPlatformWsolAtaIx = createAssociatedTokenAccountIdempotentInstruction(
          sellerKeypair.publicKey,
          platformWsolAta,
          PLATFORM_FEE_WALLET,
          WSOL_MINT
        );
        instructions.push(createPlatformWsolAtaIx);
        
        // Transfer WSOL tokens from user's WSOL ATA to platform wallet's WSOL ATA
        const transferPlatformFeeIx = createTransferInstruction(
          wsolAta, // source
          platformWsolAta, // destination
          sellerKeypair.publicKey, // authority
          Number(platformFeeLamports) // amount
        );
        instructions.push(transferPlatformFeeIx);
      }
      // Close WSOL account to get SOL back
      const closeAccount = createCloseAccountInstruction(
        wsolAta,
        sellerKeypair.publicKey,
        sellerKeypair.publicKey
      );
      instructions.push(closeAccount);
      // Build and sign transaction
      const blockhash = await connection.getLatestBlockhash("processed");
      const message = new TransactionMessage({
        instructions,
        payerKey: sellerKeypair.publicKey,
        recentBlockhash: blockhash.blockhash,
      }).compileToV0Message();
      const transaction = new VersionedTransaction(message);
      transaction.sign([sellerKeypair]);
      console.log(`[${logId}]: Transaction created with ${instructions.length} instructions (attempt ${attempt + 1})`);
      // Send and confirm transaction
      result = await sendAndConfirmTransactionWithRetry(
        transaction,
        sellerKeypair,
        instructions,
        1, // Only 1 retry per outer attempt
        1000,
        logId
      );
      if (result.success) break;
      // Wait before next retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // If all attempts failed, set a default error result
    if (!result) {
      result = { success: false, error: 'Transaction failed after all retries' };
    }

    if (result.success && result.signature) {
      const end = performance.now();
      console.log(`[${logId}]: ✅ PumpSwap sell completed successfully in ${(end - start).toFixed(2)}ms`);
      console.log(`[${logId}]: Transaction signature: ${result.signature}`);
      
      // Record transaction for analytics
      await recordTransaction(
        tokenAddress,
        sellerKeypair.publicKey.toBase58(),
        "pumpswap_sell",
        result.signature,
        true,
        Number(minQuoteAmountOut) / LAMPORTS_PER_SOL,
        amountToSell.toString(),
        undefined
      );

      return {
        success: true,
        signature: result.signature,
        solReceived: (Number(minQuoteAmountOut) / LAMPORTS_PER_SOL).toFixed(6),
        tokensSold: amountToSell.toString(),
      };
    } else {
      console.error(`[${logId}]: ❌ PumpSwap sell failed: ${result.error}`);
      
      // Record failed transaction
      await recordTransaction(
        tokenAddress,
        sellerKeypair.publicKey.toBase58(),
        "pumpswap_sell",
        "failed",
        false,
        0,
        amountToSell.toString(),
        result.error
      );

      return {
        success: false,
        error: result.error || "Transaction failed",
      };
    }

  } catch (error: any) {
    const end = performance.now();
    console.error(`[${logId}]: ❌ PumpSwap sell error in ${(end - start).toFixed(2)}ms:`, error);
    
    // Record failed transaction
    await recordTransaction(
      tokenAddress,
      sellerKeypair.publicKey.toBase58(),
      "pumpswap_sell",
      "error",
      false,
      0,
      tokenAmount?.toString() || "0",
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
  sellerPublicKey: string,
  transactionType: "pumpswap_sell",
  signature: string,
  success: boolean,
  amountSol: number,
  amountTokens: string,
  errorMessage?: string
): Promise<void> => {
  try {
    console.log(`[transaction-record]: Recording ${transactionType} transaction`, {
      tokenAddress,
      sellerPublicKey,
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