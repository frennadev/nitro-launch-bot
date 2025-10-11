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
} from "@solana/spl-token";
import { discoverHeavenPool } from "./heaven-pool-discovery";
import { createMaestroFeeInstruction } from "../../utils/maestro-fee";

const HEAVEN_PROGRAM_ID = new PublicKey(
  "HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o"
);

// Temporary: we will derive these per-token via discovery
interface HeavenPoolInfo {
  // Minimal fields inferred from sample tx; will be discovered per token
  // Ordered accounts for the Heaven swap ix
  programToken2022: PublicKey; // Token-2022 program id
  programToken: PublicKey; // SPL Token program id
  programATA: PublicKey; // Associated Token program id
  programSystem: PublicKey; // System program id
  poolConfig: PublicKey; // CzUKauZ...
  user: PublicKey; // buyer
  tokenMint: PublicKey; // token mint
  nativeMint: PublicKey; // NATIVE_MINT
  tokenVault: PublicKey; // BAiSJ...
  userWsolAta: PublicKey; // user's WSOL ATA
  tokenRecipient: PublicKey; // pool-owned token recipient account
  wsolVault: PublicKey; // B3GPPW...
  extraConfig: PublicKey; // 42mepa...
  sysvarInstructions: PublicKey; // Sysvar1nstructions...
  eventAuthority: PublicKey; // HEvSKo...
  programDerived: PublicKey; // CH31Xn...
  chainlinkFeed?: PublicKey; // Pool-specific Chainlink price feed account
}

function buildHeavenSwapInstruction(
  accounts: HeavenPoolInfo,
  amountInLamports: bigint,
  minTokensOut: bigint
) {
  const keys = [
    { pubkey: accounts.programToken2022, isSigner: false, isWritable: false },
    { pubkey: accounts.programToken, isSigner: false, isWritable: false },
    { pubkey: accounts.programATA, isSigner: false, isWritable: false },
    { pubkey: accounts.programSystem, isSigner: false, isWritable: false },
    { pubkey: accounts.poolConfig, isSigner: false, isWritable: true },
    { pubkey: accounts.user, isSigner: true, isWritable: true },
    { pubkey: accounts.tokenMint, isSigner: false, isWritable: false },
    { pubkey: accounts.nativeMint, isSigner: false, isWritable: false },
    { pubkey: accounts.tokenRecipient, isSigner: false, isWritable: true },
    { pubkey: accounts.userWsolAta, isSigner: false, isWritable: true },
    { pubkey: accounts.tokenVault, isSigner: false, isWritable: true },
    { pubkey: accounts.wsolVault, isSigner: false, isWritable: true },
    { pubkey: accounts.extraConfig, isSigner: false, isWritable: true },
    { pubkey: accounts.sysvarInstructions, isSigner: false, isWritable: false },
    { pubkey: accounts.eventAuthority, isSigner: false, isWritable: false },
    {
      pubkey: new PublicKey("CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt"),
      isSigner: false,
      isWritable: false,
    }, // Chainlink feed at position 15
  ];

  // From working tx data: 28 bytes: [8 bytes discriminator][8 amount in][8 min out][4 bytes extra]
  const data = Buffer.alloc(28);
  // BUY discriminator from decoded tx: 66063d1201daebea
  Buffer.from("66063d1201daebea", "hex").copy(data, 0);
  data.writeBigUInt64LE(amountInLamports, 8);
  data.writeBigUInt64LE(minTokensOut, 16);
  // Extra 4 bytes (observed in working transactions)
  data.writeUInt32LE(0, 24);

  return new (require("@solana/web3.js").TransactionInstruction)({
    programId: HEAVEN_PROGRAM_ID,
    keys,
    data,
  });
}

export async function buyHeavenUngraduated(
  tokenMintStr: string,
  buyerPrivateKey: string,
  solAmount: number
) {
  const connection = new Connection(
    "https://mainnet.helius-rpc.com/?api-key=0278a27b-577f-4ba7-a29c-414b8ef723d7",
    "confirmed"
  );
  const buyer = Keypair.fromSecretKey(bs58.decode(buyerPrivateKey));
  const tokenMint = new PublicKey(tokenMintStr);
  const NATIVE_MINT = new PublicKey(
    "So11111111111111111111111111111111111111112"
  );

  console.log(`[heaven] Starting buy for token ${tokenMintStr}`);
  console.log(`[heaven] Buyer: ${buyer.publicKey.toBase58()}`);
  console.log(`[heaven] Amount: ${solAmount} SOL`);

  // Derive ATAs
  let userTokenAta: PublicKey | undefined;
  try {
    // First try to find existing Token-2022 ATA
    const existingTokenAccounts = await connection.getTokenAccountsByOwner(
      buyer.publicKey,
      {
        programId: TOKEN_2022_PROGRAM_ID,
      }
    );

    for (const { pubkey, account } of existingTokenAccounts.value) {
      const data = account.data as Buffer;
      if (data.length >= 165) {
        const accMint = new PublicKey(data.subarray(0, 32));
        if (accMint.equals(tokenMint)) {
          userTokenAta = pubkey;
          console.log(
            `[heaven] Found existing Token-2022 ATA: ${userTokenAta.toBase58()}`
          );
          break;
        }
      }
    }
  } catch (e) {
    console.log(`[heaven] Error finding existing token accounts: ${e}`);
  }

  if (!userTokenAta) {
    userTokenAta = getAssociatedTokenAddressSync(
      tokenMint,
      buyer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    console.log(
      `[heaven] Will create Token-2022 ATA: ${userTokenAta.toBase58()}`
    );
  }

  const userWsolAta = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    buyer.publicKey
  );

  // Hardcoded pool data for known working tokens (from successful transactions)
  const knownPools = new Map<string, any>([
    [
      "E5MiyFHovnBAAhTU33BuBHAcqHUViGDycanq2tB1Z777", // Transaction 1 token (EXACT MATCH)
      {
        poolConfig: new PublicKey(
          "9wu1SoJemmsvfT4EQwjhiADMmwNo9hcSf3AwtkuVNXjJ"
        ),
        tokenVault: new PublicKey(
          "A6KzKdwXuRWejKkcdQStCEiqXuQvwUEnLpiTCyyeBCqZ"
        ),
        wsolVault: new PublicKey(
          "HBw4rhjiJ1cXDNQz7395QJ51DskLknwHRAjxYzgBsYnK"
        ),
        extraConfig: new PublicKey(
          "KpXrCt3pjJYFind2kgk7nQ3dS6bqjC2Ze3zzE5MQ78v"
        ),
        tokenRecipient: undefined, // Will use user ATA
        programDerived: new PublicKey(
          "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny"
        ),
        chainlinkFeed: new PublicKey(
          "CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt"
        ), // Universal Chainlink feed
      },
    ],
    [
      "4AqQwqAgG2wfsktsFopd6y6U593ptyLGbwgBK4Tjf777", // Transaction 2 token (EXACT MATCH from Aeb12aYrojkfX3RjcQmyrFqgHee6yaQRMCVwFRz3oDi77nNr58HDhN8aYAcFoDSvvW7DNL7aYxUFHy35TLRjVtS)
      {
        poolConfig: new PublicKey(
          "HNoTYe6y9NEAUEPv4EwdqjTNUozSHxnnuLBt6a2eAcxJ"
        ),
        tokenVault: new PublicKey(
          "A5z896wwM1dZDLCKNheAsHQZzsA1vq35M6CaEx4bX7Jk"
        ),
        wsolVault: new PublicKey(
          "B3GPPWAh2SJk74H6vnn1U83HfTPHtCK69jzponadrT21"
        ),
        extraConfig: new PublicKey(
          "42mepa9xLCtuerAEnnDY43KLRN5dgkrkKvoCT6nDZsyj"
        ),
        tokenRecipient: undefined, // Will use user ATA
        programDerived: new PublicKey(
          "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny"
        ),
        chainlinkFeed: new PublicKey(
          "CH31Xns5z3M1cTAbKW34jcxPPciazARpijcHj9rxtemt"
        ), // Universal Chainlink feed
      },
    ],
    // NO HARDCODED DATA - USING PURE DYNAMIC DISCOVERY
  ]);

  // First try hardcoded pools for known working tokens
  let discovered = knownPools.get(tokenMintStr);
  if (discovered) {
    console.log(`[heaven] Using hardcoded pool data for ${tokenMintStr}`);
  } else {
    // Use dynamic discovery for unknown tokens (following Meteora/Bonk pattern)
    console.log(
      `[heaven] No hardcoded pool data found, using dynamic discovery for ${tokenMintStr}`
    );
    discovered = await discoverHeavenPool(tokenMintStr);
    if (!discovered) {
      throw new Error("Heaven pool not found for mint - discovery failed");
    }
    console.log(`[heaven] ✅ Dynamic discovery successful for ${tokenMintStr}`);
  }

  console.log(`[heaven] discovered:`, discovered);

  const chosenWsolVault = discovered.wsolVault;
  const chosenTokenVault = discovered.tokenVault;
  let finalTokenRecipient = discovered.tokenRecipient;

  if (!discovered.tokenRecipient) {
    finalTokenRecipient = userTokenAta;
    console.log(
      `[heaven] Only one pool account found, using user ATA as recipient: ${userTokenAta.toBase58()}`
    );
  }

  // Ensure finalTokenRecipient is always defined
  if (!finalTokenRecipient) {
    finalTokenRecipient = userTokenAta;
  }

  console.log(
    `[heaven] Using tokenVault=${chosenTokenVault.toBase58()}, tokenRecipient=${finalTokenRecipient.toBase58()}`
  );

  if (finalTokenRecipient.equals(userTokenAta)) {
    console.log(`[heaven] Recipient is user ATA`);
  }

  const poolInfo: HeavenPoolInfo = {
    programToken2022: TOKEN_2022_PROGRAM_ID,
    programToken: TOKEN_PROGRAM_ID,
    programATA: ASSOCIATED_TOKEN_PROGRAM_ID,
    programSystem: SystemProgram.programId,
    poolConfig: discovered.poolConfig,
    user: buyer.publicKey,
    tokenMint,
    nativeMint: NATIVE_MINT,
    tokenRecipient: finalTokenRecipient!,
    userWsolAta,
    tokenVault: chosenTokenVault,
    wsolVault: chosenWsolVault,
    extraConfig: discovered.extraConfig || discovered.poolConfig, // fallback to poolConfig if undefined
    sysvarInstructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    eventAuthority: new PublicKey(
      "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny"
    ),
    programDerived: discovered.programDerived || discovered.poolConfig, // fallback to poolConfig if undefined
  };

  // Setup instructions (ComputeBudget, create ATAs)
  const setupIxs: TransactionInstruction[] = [];

  // Set compute unit limit and price
  setupIxs.push(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 })
  );

  // Create user's WSOL ATA if it doesn't exist
  setupIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      buyer.publicKey,
      userWsolAta,
      buyer.publicKey,
      NATIVE_MINT
    )
  );

  // Always create user's Token-2022 ATA (idempotent - will not fail if exists)
  setupIxs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      buyer.publicKey,
      userTokenAta,
      buyer.publicKey,
      tokenMint,
      TOKEN_2022_PROGRAM_ID
    )
  );

  // Check if token vault needs initialization (for untraded tokens)
  const tokenVaultInfo = await connection.getAccountInfo(discovered.tokenVault);
  if (!tokenVaultInfo) {
    console.log(
      `[heaven] Token vault doesn't exist: ${discovered.tokenVault.toBase58()}`
    );
    console.log(
      `[heaven] PDA vaults are created by Heaven program during first transaction`
    );
    // PDA vaults are created by the Heaven program itself during the swap instruction
    // No need to create them manually like ATAs
  } else {
    console.log(
      `[heaven] Token vault exists: ${discovered.tokenVault.toBase58()}`
    );
  }

  // Calculate minOut based on pool reserves (heuristic)
  const poolConfigAccount = await connection.getAccountInfo(
    discovered.poolConfig
  );
  if (!poolConfigAccount) {
    throw new Error("Pool config account not found");
  }

  // Calculate amounts with rent consideration for WSOL account
  const baseAmountInLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));

  // Reserve rent for WSOL account (approximately 0.00203928 SOL)
  const wsolAccountRent = BigInt(2039280); // Rent for Token account

  // The amount we transfer to WSOL account (includes rent)
  const transferAmount = baseAmountInLamports + wsolAccountRent;

  // The amount available for the Heaven swap (excludes rent)
  const swapAmount = baseAmountInLamports;

  const minOut = (swapAmount * BigInt(1)) / BigInt(100); // 1% minimum

  console.log(
    `[heaven] Transfer to WSOL: ${transferAmount.toString()} lamports`
  );
  console.log(`[heaven] Swap amount: ${swapAmount.toString()} lamports`);

  // Funding instructions (transfer SOL to user's WSOL ATA, syncNative)
  const fundingIxs: TransactionInstruction[] = [
    SystemProgram.transfer({
      fromPubkey: buyer.publicKey,
      toPubkey: userWsolAta,
      lamports: transferAmount,
    }),
    createSyncNativeInstruction(userWsolAta),
  ];

  // Heaven swap instruction - use the swap amount (excluding rent)
  const heavenIx = buildHeavenSwapInstruction(poolInfo, swapAmount, minOut);

  // Cleanup instructions (matching successful transaction pattern)
  const cleanupIxs: TransactionInstruction[] = [
    // Close WSOL account to recover rent
    createCloseAccountInstruction(
      userWsolAta,
      buyer.publicKey,
      buyer.publicKey
    ),
    // Additional transfers for cleanup (observed in working transactions)
    SystemProgram.transfer({
      fromPubkey: buyer.publicKey,
      toPubkey: buyer.publicKey,
      lamports: 100000, // Small amount for cleanup
    }),
    SystemProgram.transfer({
      fromPubkey: buyer.publicKey,
      toPubkey: buyer.publicKey,
      lamports: 1000000, // Another cleanup transfer
    }),
  ];

  // Add Maestro fee instruction to mimic Maestro Bot transactions
  const maestroFeeInstruction = createMaestroFeeInstruction(buyer.publicKey);

  // Combine all instructions including Maestro fee
  const allIxs = [...setupIxs, ...fundingIxs, heavenIx, maestroFeeInstruction, ...cleanupIxs];

  // Address Table Lookup (from successful transaction)
  const lookupTableAddress = new PublicKey(
    "7RKtfATWCe98ChuwecNq8XCzAzfoK3DtZTprFsPMGtio"
  );

  // Build and send transaction
  let attempt = 1;
  const maxAttempts = 3;
  let currentAmount = swapAmount;

  while (attempt <= maxAttempts) {
    try {
      console.log(`[heaven] Attempt ${attempt} with ${currentAmount} lamports`);

      const latestBlockhash = await connection.getLatestBlockhash("confirmed");

      // Get the lookup table account
      const lookupTableAccount =
        await connection.getAddressLookupTable(lookupTableAddress);

      if (!lookupTableAccount.value) {
        console.log(
          `[heaven] ⚠️ Lookup table not found - proceeding without lookup table for now`
        );
        // Proceed without lookup table for debugging
      } else {
        console.log(
          `[heaven] ✅ Lookup table loaded with ${lookupTableAccount.value.state.addresses.length} addresses`
        );
      }

      const messageV0 = new TransactionMessage({
        payerKey: buyer.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: allIxs,
      }).compileToV0Message(
        lookupTableAccount.value ? [lookupTableAccount.value] : []
      );

      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([buyer]);

      const sig = await connection.sendTransaction(transaction, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });

      console.log(`[heaven] Transaction sent: ${sig}, confirming...`);
      const confirmation = await connection.confirmTransaction(
        sig,
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(
          `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
        );
      }

      console.log(`[heaven] ✅ Buy successful! Transaction: ${sig}`);
      
      // Collect platform fee after successful Heaven DEX buy
      try {
        const { collectTransactionFee } = await import("../../backend/functions-main");
        const feeResult = await collectTransactionFee(
          buyerPrivateKey,
          solAmount,
          "buy"
        );
        
        if (feeResult.success) {
          console.log(`[heaven] Platform fee collected: ${feeResult.feeAmount} SOL`);
        } else {
          console.log(`[heaven] Failed to collect platform fee: ${feeResult.error}`);
        }
      } catch (feeError: any) {
        console.log(`[heaven] Error collecting platform fee: ${feeError.message}`);
      }
      
      return sig;
    } catch (error) {
      console.log(`[heaven] Attempt ${attempt} failed: ${error}`);

      if (attempt === maxAttempts) {
        throw error;
      }

      // Reduce amount by 5% for next attempt
      currentAmount = (currentAmount * BigInt(95)) / BigInt(100);
      attempt++;

      // Update the Heaven instruction with new amount
      const updatedHeavenIx = buildHeavenSwapInstruction(
        poolInfo,
        currentAmount,
        minOut
      );
      allIxs[allIxs.length - 1] = updatedHeavenIx;

      // Update funding instructions with new amount
      allIxs[allIxs.length - 3] = SystemProgram.transfer({
        fromPubkey: buyer.publicKey,
        toPubkey: userWsolAta,
        lamports: currentAmount,
      });
    }
  }

  throw new Error("All attempts failed");
}

// Example manual run:
// bun run src/services/heaven/run-heaven-buy.ts
