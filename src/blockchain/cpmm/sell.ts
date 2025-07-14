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
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { connection } from "../common/connection";
import { getCpmmPoolState } from "./pool";
import { CpmmPool, CpmmSellConfig, CpmmSellResult, CreateSwapBaseInputIX } from "./types";
import {
  CPMM_ID,
  RAYDIUM_AUTHORITY,
  PLATFORM_FEE_WALLET,
  SWAP_BASE_INPUT_DISCRIMINATOR,
  DEFAULT_CONFIG,
} from "./constants";

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
  pool: CpmmPool,
  amountIn: bigint,
  slippage: number
): bigint => {
  // TODO: Implement CPMM-specific price calculation
  // This will use the actual CPMM formula when pools are available
  // For now, return a placeholder calculation
  
  // Placeholder: assume 1:1 ratio with slippage
  const solOut = amountIn;
  const solOutWithSlippage = (solOut * BigInt(100 - slippage)) / BigInt(100);
  
  return solOutWithSlippage;
};

// Adaptive slippage calculation for sell
const calculateAdaptiveSlippage = (
  pool: CpmmPool,
  amountIn: bigint
): number => {
  // TODO: Implement CPMM-specific slippage calculation
  // This will use actual pool reserves when available
  
  let slippage = DEFAULT_CONFIG.baseSlippage;
  
  // Placeholder logic - will be replaced with actual CPMM calculations
  if (amountIn > BigInt(1e9)) { // More than 1 SOL worth
    slippage = Math.max(slippage, 50);
  } else if (amountIn > BigInt(5e8)) { // More than 0.5 SOL worth
    slippage = Math.max(slippage, 45);
  }
  
  return Math.min(slippage, DEFAULT_CONFIG.maxSlippage);
};

// Create CPMM sell instruction
const createCpmmSellInstruction = async ({
  pool,
  payer,
  userInputTokenAccount,
  userOutputTokenAccount,
  amount_in,
  minimum_amount_out,
}: CreateSwapBaseInputIX): Promise<TransactionInstruction> => {
  const keys: AccountMeta[] = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: RAYDIUM_AUTHORITY, isSigner: false, isWritable: true },
    { pubkey: pool.amm_config, isSigner: false, isWritable: true },
    { pubkey: pool.poolId, isSigner: false, isWritable: true },
    { pubkey: userInputTokenAccount, isSigner: false, isWritable: true },
    { pubkey: userOutputTokenAccount, isSigner: false, isWritable: true },
    { pubkey: pool.token_1_vault, isSigner: false, isWritable: true },
    { pubkey: pool.token_0_vault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: pool.token_1_mint, isSigner: false, isWritable: true },
    { pubkey: pool.token_0_mint, isSigner: false, isWritable: true },
    { pubkey: pool.observation_key, isSigner: false, isWritable: true },
  ];

  const data = Buffer.alloc(8 + 8 + 8); // discriminator + two u64s
  SWAP_BASE_INPUT_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(amount_in, 8);
  data.writeBigUInt64LE(minimum_amount_out, 16);

  return new TransactionInstruction({
    keys,
    programId: CPMM_ID,
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
        const priorityFeeIx = createSmartPriorityFeeInstruction(retryCount);
        instructions[0] = priorityFeeIx; // Replace the first instruction (priority fee)
      }

      const signature = await connection.sendTransaction(tx, {
        skipPreflight: false,
        preflightCommitment: "processed",
        maxRetries: 3,
      });

      console.log(`[${logId}]: Transaction sent with signature: ${signature}`);

      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      return { success: true, signature };
    } catch (error: any) {
      retryCount++;
      console.error(`[${logId}]: Attempt ${retryCount} failed:`, error.message);
      
      if (retryCount < maxRetries) {
        console.log(`[${logId}]: Waiting ${retryInterval}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      } else {
        return { success: false, error: error.message };
      }
    }
  }
  
  return { success: false, error: "Max retries exceeded" };
};

/**
 * Execute a CPMM sell transaction with platform fees, Maestro fees, and adaptive slippage
 * This function will be used when BONK tokens graduate to CPMM pools
 */
export const executeCpmmSell = async (
  tokenMint: string,
  sellerKeypair: Keypair,
  tokenAmount?: bigint, // Optional: if not provided, sells all tokens
  userSlippage?: number, // User-configurable slippage
  config: CpmmSellConfig = {}
): Promise<CpmmSellResult> => {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const logId = `cpmm-sell-${tokenMint.substring(0, 8)}`;
  const start = Date.now();
  
  console.log(`[${logId}]: 🚀 Starting CPMM sell`);
  console.log(`[${logId}]: 🪙 Token mint: ${tokenMint}`);
  console.log(`[${logId}]: ⚙️  User slippage: ${userSlippage || 'default'}%`);

  try {
    // Get pool state
    const poolState = await getCpmmPoolState(tokenMint);
    if (!poolState) {
      return {
        success: false,
        error: `No CPMM pool found for token ${tokenMint}. Token may not have graduated to CPMM yet.`
      };
    }

    console.log(`[${logId}]: ✅ CPMM pool found: ${poolState.pool.poolId.toString()}`);

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
    const adaptiveSlippage = calculateAdaptiveSlippage(poolState.pool, amountToSell);
    const finalSlippage = userSlippage !== undefined ? userSlippage : adaptiveSlippage;
    
    console.log(`[${logId}]: 📊 Slippage calculation:`);
    console.log(`[${logId}]:   Adaptive slippage: ${adaptiveSlippage}%`);
    console.log(`[${logId}]:   User slippage: ${userSlippage || 'default'}%`);
    console.log(`[${logId}]:   Final slippage: ${finalSlippage}%`);

    // Calculate expected SOL out
    const expectedSolOut = estimateSellOutput(poolState.pool, amountToSell, finalSlippage);
    
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
        
        const currentSolOut = estimateSellOutput(poolState.pool, amountToSell, currentSlippage);
        
        console.log(`[${logId}]: 📊 Retry ${attempt + 1} - Slippage: ${currentSlippage}%, Expected SOL: ${currentSolOut.toString()}`);

        // Create instructions
        const instructions: TransactionInstruction[] = [];

        // Priority fee instruction
        const priorityFeeIx = createSmartPriorityFeeInstruction(attempt);
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

        // CPMM sell instruction
        const sellIx = await createCpmmSellInstruction({
          pool: poolState.pool,
          payer: sellerKeypair.publicKey,
          userInputTokenAccount: tokenAta,
          userOutputTokenAccount: wsolAta,
          amount_in: amountToSell,
          minimum_amount_out: currentSolOut,
        });
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
          console.log(`[${logId}]: ✅ CPMM sell completed successfully in ${end - start}ms`);
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
    console.error(`[${logId}]: ❌ CPMM sell error in ${end - start}ms:`, error);
    
    return {
      success: false,
      error: error.message || "Unknown error occurred"
    };
  }
}; 