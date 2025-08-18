// Meteora Buy Service - Minimal integration for universal auto-buy
// Integrates with existing external buy system like PumpFun and Bonk

import {
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeAccountInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
import { connection } from "../config";
import { logger } from "../../utils/logger";

// Fee constants (same as PumpFun)
const MAESTRO_FEE_ACCOUNT = new PublicKey(
  "5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB"
);
const MAESTRO_FEE_AMOUNT = BigInt(1000000); // 0.001 SOL

// Constants
const METEORA_DBC_PROGRAM_ID = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
); // Ungraduated
const DAMM_V2_PROGRAM_ID = new PublicKey(
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"
); // Graduated
const METEORA_SWAP_DISCRIMINATOR = Buffer.from("f8c69e91e17587c8", "hex");

// Universal constants
const POOL_AUTHORITY_UNGRAD = new PublicKey(
  "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM"
);
const POOL_AUTHORITY_GRAD = new PublicKey(
  "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC"
);
const REFERRAL_ACCOUNT = new PublicKey(
  "JNK45gwenyqjk85JN44XekEYytZFGRubTabSNSXgT9u"
);
const EVENT_AUTHORITY_GRAD = new PublicKey(
  "3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet"
);

interface MeteoraBuyResult {
  success: boolean;
  signature?: string;
  error?: string;
  platform: "meteora";
  tokenType?: "ungraduated" | "graduated";
}

// Auto-detect token type (ungraduated vs graduated)
async function detectMeteorTokenType(
  tokenMint: string,
  logId: string
): Promise<"ungraduated" | "graduated" | null> {
  logger.info(`[${logId}] Detecting Meteora token type for ${tokenMint}`);

  try {
    const mint = new PublicKey(tokenMint);

    // Check for ungraduated (DBC program, 424-byte pools, offset 136)
    const ungraduatedPools = await connection.getProgramAccounts(
      METEORA_DBC_PROGRAM_ID,
      {
        commitment: "confirmed",
        filters: [
          { dataSize: 424 },
          { memcmp: { offset: 136, bytes: mint.toBase58() } },
        ],
      }
    );

    if (ungraduatedPools.length > 0) {
      logger.info(
        `[${logId}] Found ${ungraduatedPools.length} ungraduated pool(s)`
      );
      return "ungraduated";
    }

    // Check for graduated (DAMM v2 program, 1112-byte pools, offset 168)
    const graduatedPools = await connection.getProgramAccounts(
      DAMM_V2_PROGRAM_ID,
      {
        commitment: "confirmed",
        filters: [
          { dataSize: 1112 },
          { memcmp: { offset: 168, bytes: mint.toBase58() } },
        ],
      }
    );

    if (graduatedPools.length > 0) {
      logger.info(
        `[${logId}] Found ${graduatedPools.length} graduated pool(s)`
      );
      return "graduated";
    }

    logger.info(`[${logId}] No Meteora pools found`);
    return null;
  } catch (error: any) {
    logger.error(`[${logId}] Detection failed: ${error.message}`);
    return null;
  }
}

// Discover ungraduated pool (optimized with batch RPC)
async function discoverUngraduatedPool(
  tokenMint: string,
  logId: string
): Promise<any> {
  try {
    const mint = new PublicKey(tokenMint);

    const pools = await connection.getProgramAccounts(METEORA_DBC_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { dataSize: 424 },
        { memcmp: { offset: 136, bytes: mint.toBase58() } },
      ],
    });

    if (pools.length === 0) throw new Error("No ungraduated pools found");

    const poolAccount = pools[0];
    const poolData = poolAccount.account.data;

    // Extract config
    const configAccount = new PublicKey(poolData.slice(72, 104));

    // Batch vault discovery
    const vaultOffsets = [104, 136, 168, 200, 232];
    const potentialVaults = [];

    for (const offset of vaultOffsets) {
      if (offset + 32 <= poolData.length) {
        try {
          const vault = new PublicKey(poolData.slice(offset, offset + 32));
          if (!vault.equals(PublicKey.default)) {
            potentialVaults.push(vault);
          }
        } catch {}
      }
    }

    const accountInfos =
      await connection.getMultipleAccountsInfo(potentialVaults);

    let tokenVault = null;
    let solVault = null;

    for (let i = 0; i < accountInfos.length; i++) {
      const accountInfo = accountInfos[i];
      const vault = potentialVaults[i];

      if (accountInfo && accountInfo.data.length === 165) {
        const mintBytes = accountInfo.data.slice(0, 32);
        const vaultMint = new PublicKey(mintBytes);

        if (vaultMint.equals(mint) && !tokenVault) {
          tokenVault = vault;
        } else if (vaultMint.equals(NATIVE_MINT) && !solVault) {
          solVault = vault;
        }
      }
    }

    if (!tokenVault || !solVault) {
      throw new Error("Could not find vaults");
    }

    // Derive event authority for ungraduated
    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("__event_authority")],
      METEORA_DBC_PROGRAM_ID
    );

    logger.info(
      `[${logId}] Ungraduated pool discovered: ${poolAccount.pubkey.toBase58()}`
    );

    return {
      type: "ungraduated",
      poolAccount: poolAccount.pubkey,
      configAccount,
      tokenVault,
      solVault,
      tokenMint: mint,
      authority: POOL_AUTHORITY_UNGRAD,
      eventAuthority,
    };
  } catch (error: any) {
    throw new Error(`Ungraduated discovery failed: ${error.message}`);
  }
}

// Discover graduated pool (optimized with batch RPC)
async function discoverGraduatedPool(
  tokenMint: string,
  logId: string
): Promise<any> {
  try {
    const mint = new PublicKey(tokenMint);

    const pools = await connection.getProgramAccounts(DAMM_V2_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { dataSize: 1112 },
        { memcmp: { offset: 168, bytes: mint.toBase58() } },
      ],
    });

    if (pools.length === 0) throw new Error("No graduated pools found");

    const poolAccount = pools[0];
    const poolData = poolAccount.account.data;

    // Batch vault discovery - scan all potential keys
    const potentialKeys = [];
    for (let i = 0; i <= poolData.length - 32; i++) {
      try {
        const keyBytes = poolData.slice(i, i + 32);
        const pubkey = new PublicKey(keyBytes);

        if (
          !pubkey.equals(PublicKey.default) &&
          !pubkey.equals(DAMM_V2_PROGRAM_ID) &&
          !pubkey.equals(TOKEN_PROGRAM_ID)
        ) {
          potentialKeys.push(pubkey);
        }
      } catch {}
    }

    const accountInfos =
      await connection.getMultipleAccountsInfo(potentialKeys);

    let tokenVault = null;
    let solVault = null;

    for (let i = 0; i < accountInfos.length; i++) {
      const accountInfo = accountInfos[i];
      const pubkey = potentialKeys[i];

      if (accountInfo && accountInfo.data.length === 165) {
        const mintBytes = accountInfo.data.slice(0, 32);
        const vaultMint = new PublicKey(mintBytes);

        if (vaultMint.equals(mint) && !tokenVault) {
          tokenVault = pubkey;
        } else if (vaultMint.equals(NATIVE_MINT) && !solVault) {
          solVault = pubkey;
        }
      }
    }

    if (!tokenVault || !solVault) {
      throw new Error("Could not find vaults");
    }

    logger.info(
      `[${logId}] Graduated pool discovered: ${poolAccount.pubkey.toBase58()}`
    );

    return {
      type: "graduated",
      poolAccount: poolAccount.pubkey,
      tokenVault,
      solVault,
      tokenMint: mint,
      authority: POOL_AUTHORITY_GRAD,
    };
  } catch (error: any) {
    throw new Error(`Graduated discovery failed: ${error.message}`);
  }
}

// Create universal swap instruction
function createMeteorSwapInstruction(
  user: PublicKey,
  userWsolAccount: PublicKey,
  userTokenAccount: PublicKey,
  poolInfo: any,
  amountIn: bigint,
  minimumAmountOut: bigint
): TransactionInstruction {
  const instructionData = Buffer.alloc(24);
  METEORA_SWAP_DISCRIMINATOR.copy(instructionData, 0);
  instructionData.writeBigUInt64LE(amountIn, 8);
  instructionData.writeBigUInt64LE(minimumAmountOut, 16);

  let accounts;
  let programId;

  if (poolInfo.type === "ungraduated") {
    // 15-account layout for ungraduated BAGS tokens
    programId = METEORA_DBC_PROGRAM_ID;
    accounts = [
      { pubkey: poolInfo.authority, isSigner: false, isWritable: false },
      { pubkey: poolInfo.configAccount, isSigner: false, isWritable: false },
      { pubkey: poolInfo.poolAccount, isSigner: false, isWritable: true },
      { pubkey: userWsolAccount, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: poolInfo.tokenVault, isSigner: false, isWritable: true },
      { pubkey: poolInfo.solVault, isSigner: false, isWritable: true },
      { pubkey: poolInfo.tokenMint, isSigner: false, isWritable: false },
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: REFERRAL_ACCOUNT, isSigner: false, isWritable: true },
      { pubkey: poolInfo.eventAuthority, isSigner: false, isWritable: false },
      { pubkey: METEORA_DBC_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
  } else {
    // 14-account layout for graduated DAMM v2 tokens
    programId = DAMM_V2_PROGRAM_ID;
    accounts = [
      { pubkey: poolInfo.authority, isSigner: false, isWritable: false },
      { pubkey: poolInfo.poolAccount, isSigner: false, isWritable: true },
      { pubkey: userWsolAccount, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: poolInfo.tokenVault, isSigner: false, isWritable: true },
      { pubkey: poolInfo.solVault, isSigner: false, isWritable: true },
      { pubkey: poolInfo.tokenMint, isSigner: false, isWritable: false },
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: REFERRAL_ACCOUNT, isSigner: false, isWritable: true },
      { pubkey: EVENT_AUTHORITY_GRAD, isSigner: false, isWritable: false },
      { pubkey: DAMM_V2_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
  }

  return new TransactionInstruction({
    programId,
    keys: accounts,
    data: instructionData,
  });
}

// Create maestro fee instruction (matches PumpFun pattern)
function createMaestroFeeInstruction(
  buyer: PublicKey,
  feeAmount: bigint = MAESTRO_FEE_AMOUNT
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: buyer,
    toPubkey: MAESTRO_FEE_ACCOUNT,
    lamports: feeAmount,
  });
}

// Main Meteora buy function - integrates with external buy system
export async function executeMeteoraBuy(
  tokenAddress: string,
  buyerPrivateKey: string,
  solAmount: number
): Promise<MeteoraBuyResult> {
  const logId = `meteora-buy-${tokenAddress.substring(0, 8)}`;
  logger.info(`[${logId}] Starting Meteora buy for ${solAmount} SOL`);

  try {
    const user = Keypair.fromSecretKey(bs58.decode(buyerPrivateKey));

    // Step 1: Auto-detect token type
    const tokenType = await detectMeteorTokenType(tokenAddress, logId);

    if (!tokenType) {
      throw new Error("Token is not a Meteora token");
    }

    logger.info(`[${logId}] Detected as ${tokenType} Meteora token`);

    // Step 2: Discover appropriate pool
    let poolInfo;
    if (tokenType === "ungraduated") {
      poolInfo = await discoverUngraduatedPool(tokenAddress, logId);
    } else {
      poolInfo = await discoverGraduatedPool(tokenAddress, logId);
    }

    // Step 3: Setup accounts
    const tokenMintPubkey = new PublicKey(tokenAddress);
    const wsolKeypair = Keypair.generate();
    const wsolAccount = wsolKeypair.publicKey;
    const userTokenAccount = getAssociatedTokenAddressSync(
      tokenMintPubkey,
      user.publicKey
    );

    // Step 4: Setup transaction
    const setupTx = new Transaction();
    setupTx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2_550_000 })
    );

    const lamports = Math.floor(solAmount * 1_000_000_000);
    const space = 165;

    setupTx.add(
      SystemProgram.createAccount({
        fromPubkey: user.publicKey,
        newAccountPubkey: wsolAccount,
        lamports:
          lamports +
          (await connection.getMinimumBalanceForRentExemption(space)),
        space,
        programId: TOKEN_PROGRAM_ID,
      })
    );

    setupTx.add(
      createInitializeAccountInstruction(
        wsolAccount,
        NATIVE_MINT,
        user.publicKey
      )
    );

    setupTx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        user.publicKey,
        userTokenAccount,
        user.publicKey,
        tokenMintPubkey
      )
    );

    setupTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    setupTx.feePayer = user.publicKey;
    setupTx.sign(user, wsolKeypair);

    const setupSignature = await connection.sendRawTransaction(
      setupTx.serialize(),
      {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      }
    );

    await connection.confirmTransaction(setupSignature, "confirmed");
    logger.info(`[${logId}] Setup transaction confirmed: ${setupSignature}`);

    // Step 5: Swap transaction with smart routing
    const swapTx = new Transaction();

    swapTx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2_550_000 })
    );

    const swapInstruction = createMeteorSwapInstruction(
      user.publicKey,
      wsolAccount,
      userTokenAccount,
      poolInfo,
      BigInt(lamports),
      BigInt(Math.floor(lamports * 100)) // Conservative slippage
    );

    // Add maestro fee instruction (like PumpFun)
    const maestroFeeInstruction = createMaestroFeeInstruction(user.publicKey);

    swapTx.add(swapInstruction);
    swapTx.add(maestroFeeInstruction); // Add maestro fee
    swapTx.add(
      createCloseAccountInstruction(wsolAccount, user.publicKey, user.publicKey)
    );

    swapTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    swapTx.feePayer = user.publicKey;
    swapTx.sign(user, wsolKeypair);

    try {
      const swapSignature = await connection.sendRawTransaction(
        swapTx.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        }
      );

      const confirmation = await connection.confirmTransaction(
        swapSignature,
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(
          `Swap failed: ${JSON.stringify(confirmation.value.err)}`
        );
      }

      logger.info(
        `[${logId}] ${tokenType} Meteora buy successful: ${swapSignature}`
      );

      return {
        success: true,
        signature: swapSignature,
        platform: "meteora",
        tokenType,
      };
    } catch (error: any) {
      // Handle "PoolIsCompleted" error with smart routing
      if (
        error.message.includes("PoolIsCompleted") ||
        error.message.includes("0x177d")
      ) {
        logger.info(`[${logId}] Pool completed - trying graduated flow`);

        try {
          const graduatedPoolInfo = await discoverGraduatedPool(
            tokenAddress,
            logId
          );

          // Rebuild with graduated structure
          const graduatedSwapTx = new Transaction();
          graduatedSwapTx.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: 2_550_000,
            })
          );

          const graduatedSwapInstruction = createMeteorSwapInstruction(
            user.publicKey,
            wsolAccount,
            userTokenAccount,
            graduatedPoolInfo,
            BigInt(lamports),
            BigInt(Math.floor(lamports * 100))
          );

          // Add maestro fee for graduated flow too
          const graduatedMaestroFeeInstruction = createMaestroFeeInstruction(
            user.publicKey
          );

          graduatedSwapTx.add(graduatedSwapInstruction);
          graduatedSwapTx.add(graduatedMaestroFeeInstruction); // Add maestro fee
          graduatedSwapTx.add(
            createCloseAccountInstruction(
              wsolAccount,
              user.publicKey,
              user.publicKey
            )
          );

          graduatedSwapTx.recentBlockhash = (
            await connection.getLatestBlockhash()
          ).blockhash;
          graduatedSwapTx.feePayer = user.publicKey;
          graduatedSwapTx.sign(user, wsolKeypair);

          const graduatedSwapSignature = await connection.sendRawTransaction(
            graduatedSwapTx.serialize(),
            {
              skipPreflight: false,
              preflightCommitment: "confirmed",
            }
          );

          const graduatedConfirmation = await connection.confirmTransaction(
            graduatedSwapSignature,
            "confirmed"
          );

          if (graduatedConfirmation.value.err) {
            throw new Error(
              `Graduated swap failed: ${JSON.stringify(graduatedConfirmation.value.err)}`
            );
          }

          logger.info(
            `[${logId}] Smart routing success - graduated flow: ${graduatedSwapSignature}`
          );

          return {
            success: true,
            signature: graduatedSwapSignature,
            platform: "meteora",
            tokenType: "graduated",
          };
        } catch (graduatedError: any) {
          logger.error(
            `[${logId}] Both flows failed: ${graduatedError.message}`
          );
          throw new Error(`Smart routing failed: ${graduatedError.message}`);
        }
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    logger.error(`[${logId}] Meteora buy failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      platform: "meteora",
    };
  }
}
