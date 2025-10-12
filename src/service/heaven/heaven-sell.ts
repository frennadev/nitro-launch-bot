// Heaven DEX Sell Implementation
// Heaven tokens use Token-2022 Program - ensure all operations are Token-2022 compatible

import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createInitializeAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createSyncNativeInstruction,
  getAccount,
} from "@solana/spl-token";
import { createMaestroFeeInstruction } from "../../utils/maestro-fee";
import {
  discoverHeavenPool,
  HeavenPoolInfo as DiscoveredPoolInfo,
} from "./heaven-pool-discovery";
import { logger } from "../../utils/logger";
import { connection } from "../config";

// Constants (same as heaven-buy.ts)
const HEAVEN_PROGRAM_ID = new PublicKey(
  "HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o"
);
const HEAVEN_EVENT_AUTHORITY = new PublicKey(
  "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny"
);

// Fee constants (same as other DEX services)
const MAESTRO_FEE_ACCOUNT = new PublicKey(
  "5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB"
);
const MAESTRO_FEE_AMOUNT = BigInt(1000000); // 0.001 SOL

// Pool info interface for sell transaction (extended from discovery)
interface HeavenSellPoolInfo {
  programToken2022: PublicKey;
  programToken: PublicKey;
  programATA: PublicKey;
  programSystem: PublicKey;
  poolConfig: PublicKey;
  user: PublicKey;
  tokenMint: PublicKey;
  nativeMint: PublicKey;
  tokenVault: PublicKey;
  userWsolAta: PublicKey;
  tokenRecipient: PublicKey;
  wsolVault: PublicKey;
  extraConfig: PublicKey;
  sysvarInstructions: PublicKey;
  eventAuthority: PublicKey;
  programDerived: PublicKey;
  chainlinkFeed?: PublicKey;
}

/**
 * Build Heaven DEX sell instruction (reverse of buy)
 * Sells tokens for SOL by reversing the buy flow
 */
function buildHeavenSellInstruction(
  accounts: HeavenSellPoolInfo,
  tokenAmountInLamports: bigint,
  minSolOut: bigint
) {
  // ✅ SAME ACCOUNT ORDER AS BUY - the discriminator determines buy vs sell direction
  // Account order matches successful sell transaction structure
  const keys = [
    { pubkey: accounts.programToken2022, isSigner: false, isWritable: false },
    { pubkey: accounts.programToken, isSigner: false, isWritable: false },
    { pubkey: accounts.programATA, isSigner: false, isWritable: false },
    { pubkey: accounts.programSystem, isSigner: false, isWritable: false },
    { pubkey: accounts.poolConfig, isSigner: false, isWritable: true },
    { pubkey: accounts.user, isSigner: true, isWritable: true },
    { pubkey: accounts.tokenMint, isSigner: false, isWritable: false },
    { pubkey: accounts.nativeMint, isSigner: false, isWritable: false },
    { pubkey: accounts.tokenRecipient, isSigner: false, isWritable: true }, // User's token account (source for sell)
    { pubkey: accounts.userWsolAta, isSigner: false, isWritable: true }, // User's WSOL account (destination for sell)
    { pubkey: accounts.tokenVault, isSigner: false, isWritable: true },
    { pubkey: accounts.wsolVault, isSigner: false, isWritable: true },
    { pubkey: accounts.extraConfig, isSigner: false, isWritable: true },
    { pubkey: accounts.sysvarInstructions, isSigner: false, isWritable: false },
    { pubkey: accounts.eventAuthority, isSigner: false, isWritable: false },
    {
      pubkey: new PublicKey("CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt"),
      isSigner: false,
      isWritable: false,
    },
  ];

  // ✅ CONFIRMED: Heaven DEX sell instruction - REAL WORKING DATA!
  // From successful transaction: 33e685a4017f83ad30c91f4c6fc82f00c33d8c160000000000000000
  // Instruction #6 - 13,449,704.249477424 tokens → 0.52703617 WSOL
  // CRITICAL: Sell instruction is 28 bytes total (8+8+8+4)!
  const data = Buffer.alloc(28); // 28 bytes for sell
  // CORRECT Heaven DEX sell discriminator (from working transaction)
  Buffer.from("33e685a4017f83ad", "hex").copy(data, 0); // Heaven sell discriminator
  data.writeBigUInt64LE(tokenAmountInLamports, 8);
  data.writeBigUInt64LE(minSolOut, 16);
  // 4-byte extra field (from successful transaction: 00000000)
  data.writeUInt32LE(0, 24); // Last 4 bytes

  return new TransactionInstruction({
    programId: HEAVEN_PROGRAM_ID,
    keys,
    data,
  });
}

/**
 * Create Maestro fee instruction (same as other DEX services)
 */
// Maestro fee function moved to centralized utility: src/utils/maestro-fee.ts

/**
 * Get user's token balance for the specified token
 */
async function getUserTokenBalance(
  tokenMint: PublicKey,
  userPubkey: PublicKey,
  connection: Connection
): Promise<bigint> {
  try {
    const userTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      userPubkey,
      false,
      TOKEN_2022_PROGRAM_ID // Heaven tokens use Token-2022
    );

    const tokenAccountInfo = await getAccount(
      connection,
      userTokenAccount,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    return tokenAccountInfo.amount;
  } catch (error: any) {
    logger.debug(`Token account not found or error: ${error.message}`);
    return BigInt(0);
  }
}

/**
 * Main Heaven DEX sell function
 * Follows the same patterns as buy but in reverse
 */
export async function sellHeavenUngraduated(
  tokenMintStr: string,
  sellerPrivateKey: string,
  tokenAmount?: number // If not provided, sell all tokens
): Promise<string> {
  const logId = `heaven-sell-${tokenMintStr.substring(0, 8)}`;
  logger.info(`[${logId}] Starting Heaven DEX sell transaction`);

  const seller = Keypair.fromSecretKey(bs58.decode(sellerPrivateKey));
  const tokenMint = new PublicKey(tokenMintStr);

  try {
    // Step 1: Discover Heaven pool (same as buy)
    logger.info(`[${logId}] Discovering Heaven pool for token...`);
    const poolInfo = await discoverHeavenPool(tokenMintStr);
    if (!poolInfo) {
      throw new Error(`No Heaven pool found for token ${tokenMintStr}`);
    }
    logger.info(`[${logId}] Heaven pool discovered successfully`);

    // Step 2: Check user's token balance
    const userTokenBalance = await getUserTokenBalance(
      tokenMint,
      seller.publicKey,
      connection
    );
    if (userTokenBalance === BigInt(0)) {
      throw new Error("No tokens to sell");
    }

    // Determine amount to sell
    let tokensToSell: bigint;
    if (tokenAmount && tokenAmount > 0) {
      tokensToSell = BigInt(Math.floor(tokenAmount * Math.pow(10, 9))); // Assuming 9 decimals
      if (tokensToSell > userTokenBalance) {
        throw new Error(
          `Insufficient token balance. Have: ${userTokenBalance}, trying to sell: ${tokensToSell}`
        );
      }
    } else {
      tokensToSell = userTokenBalance; // Sell all
    }

    logger.info(
      `[${logId}] Selling ${tokensToSell} tokens (balance: ${userTokenBalance})`
    );

    // Step 3: Setup accounts (similar to buy but for sell)
    const userTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      seller.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const userWsolAta = getAssociatedTokenAddressSync(
      NATIVE_MINT,
      seller.publicKey
    );

    // Step 4: Prepare pool info for sell (reverse of buy accounts)
    const poolAccounts: HeavenSellPoolInfo = {
      programToken2022: TOKEN_2022_PROGRAM_ID,
      programToken: TOKEN_PROGRAM_ID,
      programATA: ASSOCIATED_TOKEN_PROGRAM_ID,
      programSystem: SystemProgram.programId,
      poolConfig: poolInfo.poolConfig,
      user: seller.publicKey,
      tokenMint: tokenMint,
      nativeMint: NATIVE_MINT,
      tokenVault: poolInfo.tokenVault,
      userWsolAta: userWsolAta,
      tokenRecipient: userTokenAccount, // User's token account for sell
      wsolVault: poolInfo.wsolVault,
      extraConfig: poolInfo.extraConfig,
      sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      eventAuthority: HEAVEN_EVENT_AUTHORITY, // Use constant since poolInfo doesn't have this
      programDerived: poolInfo.programDerived,
    };

    // Step 5: Calculate minimum SOL output (conservative estimate)
    const minSolOut = BigInt(1); // Very conservative minimum - in production would calculate based on current price

    // Step 6: Build transaction instructions
    const allIxs: TransactionInstruction[] = [];

    // Add compute budget instructions
    allIxs.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 })
    );

    // Create WSOL ATA if needed (for receiving SOL)
    allIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        seller.publicKey,
        userWsolAta,
        seller.publicKey,
        NATIVE_MINT
      )
    );

    // Build Heaven sell instruction
    const heavenSellIx = buildHeavenSellInstruction(
      poolAccounts,
      tokensToSell,
      minSolOut
    );
    allIxs.push(heavenSellIx);

    // Add Maestro fee (same as other DEXes)
    const maestroFeeIx = createMaestroFeeInstruction(seller.publicKey);
    allIxs.push(maestroFeeIx);

    // Close WSOL account to get SOL back
    allIxs.push(
      createCloseAccountInstruction(
        userWsolAta,
        seller.publicKey,
        seller.publicKey
      )
    );

    // Step 7: Build and send transaction (same as buy pattern)
    const latestBlockhash = await connection.getLatestBlockhash();

    // Use Address Lookup Table (same as buy)
    const lookupTableAddress = new PublicKey(
      "7RKtfATWCe98ChuwecNq8XCzAzfoK3DtZTprFsPMGtio"
    );
    const lookupTableAccount =
      await connection.getAddressLookupTable(lookupTableAddress);

    const messageV0 = new TransactionMessage({
      payerKey: seller.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: allIxs,
    }).compileToV0Message(
      lookupTableAccount.value ? [lookupTableAccount.value] : []
    );

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([seller]);

    // Send transaction with retry logic (same as buy)
    let attempt = 1;
    const maxAttempts = 3;
    let currentTokenAmount = tokensToSell;

    while (attempt <= maxAttempts) {
      try {
        logger.info(
          `[${logId}] Sending sell transaction (attempt ${attempt}/${maxAttempts})`
        );

        const signature = await connection.sendTransaction(transaction, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });

        const confirmation = await connection.confirmTransaction(
          signature,
          "confirmed"
        );

        if (!confirmation.value.err) {
          logger.info(`[${logId}] ✅ Heaven DEX sell successful: ${signature}`);
          
          // Collect platform fee after successful Heaven DEX sell
          // Estimate SOL received based on token amount and current price
          try {
            const { collectTransactionFee } = await import("../../backend/functions-main");
            
            // For now, use a conservative estimate of 0.01 SOL for fee calculation
            // In a real implementation, you'd want to parse the transaction to get actual SOL received
            const estimatedSolReceived = 0.01; // This should be calculated from actual transaction
            
            const feeResult = await collectTransactionFee(
              sellerPrivateKey,
              estimatedSolReceived,
              "sell"
            );
            
            if (feeResult.success) {
              logger.info(`[${logId}] Platform fee collected: ${feeResult.feeAmount} SOL`);
            } else {
              logger.warn(`[${logId}] Failed to collect platform fee: ${feeResult.error}`);
            }
          } catch (feeError: any) {
            logger.warn(`[${logId}] Error collecting platform fee: ${feeError.message}`);
          }
          
          return signature;
        } else {
          throw new Error(
            `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
          );
        }
      } catch (error: any) {
        logger.error(`[${logId}] Attempt ${attempt} failed: ${error.message}`);

        if (attempt === maxAttempts) {
          throw error;
        }

        // Reduce amount by 5% for retry (similar to buy logic)
        currentTokenAmount = BigInt(
          Math.floor(Number(currentTokenAmount) * 0.95)
        );
        attempt++;

        // Rebuild transaction with reduced amount
        const retryHeavenIx = buildHeavenSellInstruction(
          poolAccounts,
          currentTokenAmount,
          minSolOut
        );
        allIxs[allIxs.length - 3] = retryHeavenIx; // Replace the Heaven instruction

        const retryMessageV0 = new TransactionMessage({
          payerKey: seller.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: allIxs,
        }).compileToV0Message(
          lookupTableAccount.value ? [lookupTableAccount.value] : []
        );

        const retryTransaction = new VersionedTransaction(retryMessageV0);
        retryTransaction.sign([seller]);
        // Update transaction for retry
        Object.assign(transaction, retryTransaction);
      }
    }

    throw new Error("All sell attempts failed");
  } catch (error: any) {
    logger.error(`[${logId}] Heaven DEX sell failed: ${error.message}`);
    throw error;
  }
}

/**
 * Legacy function name for compatibility (wraps sellHeavenUngraduated)
 */
export async function sellHeavenToken(
  tokenAddress: string,
  seller: Keypair,
  tokenAmount: bigint
): Promise<string | null> {
  try {
    const signature = await sellHeavenUngraduated(
      tokenAddress,
      bs58.encode(seller.secretKey),
      Number(tokenAmount) / Math.pow(10, 9) // Convert lamports to token amount
    );
    return signature;
  } catch (error: any) {
    logger.error(`sellHeavenToken wrapper failed: ${error.message}`);
    return null;
  }
}
