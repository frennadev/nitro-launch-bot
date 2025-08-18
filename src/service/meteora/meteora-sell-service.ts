// Meteora Sell Service - Minimal integration for universal auto-sell
// Integrates with existing external sell system like PumpFun and Bonk

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

// Constants (same as buy service)
const METEORA_DBC_PROGRAM_ID = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
);
const DAMM_V2_PROGRAM_ID = new PublicKey(
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"
);
const METEORA_SWAP_DISCRIMINATOR = Buffer.from("f8c69e91e17587c8", "hex");

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

// Fee constants (same as buy service)
const MAESTRO_FEE_ACCOUNT = new PublicKey(
  "5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB"
);
const MAESTRO_FEE_AMOUNT = BigInt(1000000); // 0.001 SOL

interface MeteoraSellResult {
  success: boolean;
  signature?: string;
  error?: string;
  platform: "meteora";
  tokenType?: "ungraduated" | "graduated";
}

// Import detection and discovery functions from buy service
async function detectMeteorTokenType(
  tokenMint: string,
  logId: string
): Promise<"ungraduated" | "graduated" | null> {
  try {
    const mint = new PublicKey(tokenMint);

    // Check ungraduated first
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
      return "ungraduated";
    }

    // Check graduated
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
      return "graduated";
    }

    return null;
  } catch (error: any) {
    logger.error(`[${logId}] Detection failed: ${error.message}`);
    return null;
  }
}

// Discover ungraduated pool (same as buy service)
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

// Discover graduated pool (same as buy service)
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

// Simplified sell instruction (reverse of buy - swap token for SOL)
function createMeteorSellInstruction(
  user: PublicKey,
  userTokenAccount: PublicKey,
  userWsolAccount: PublicKey,
  poolInfo: any,
  tokenAmountIn: bigint,
  minimumSolOut: bigint
): TransactionInstruction {
  const instructionData = Buffer.alloc(24);
  METEORA_SWAP_DISCRIMINATOR.copy(instructionData, 0);
  instructionData.writeBigUInt64LE(tokenAmountIn, 8);
  instructionData.writeBigUInt64LE(minimumSolOut, 16);

  let accounts;
  let programId;

  if (poolInfo.type === "ungraduated") {
    // 15-account layout for ungraduated (token -> SOL)
    programId = METEORA_DBC_PROGRAM_ID;
    accounts = [
      { pubkey: poolInfo.authority, isSigner: false, isWritable: false },
      { pubkey: poolInfo.configAccount, isSigner: false, isWritable: false },
      { pubkey: poolInfo.poolAccount, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true }, // Input: Token
      { pubkey: userWsolAccount, isSigner: false, isWritable: true }, // Output: SOL
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
    // 14-account layout for graduated (token -> SOL)
    programId = DAMM_V2_PROGRAM_ID;
    accounts = [
      { pubkey: poolInfo.authority, isSigner: false, isWritable: false },
      { pubkey: poolInfo.poolAccount, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true }, // Input: Token
      { pubkey: userWsolAccount, isSigner: false, isWritable: true }, // Output: SOL
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

// Main Meteora sell function - integrates with external sell system
export async function executeMeteoraSell(
  tokenAddress: string,
  sellerPrivateKey: string,
  tokenAmount: number
): Promise<MeteoraSellResult> {
  const logId = `meteora-sell-${tokenAddress.substring(0, 8)}`;
  logger.info(`[${logId}] Starting Meteora sell for ${tokenAmount} tokens`);

  try {
    const user = Keypair.fromSecretKey(bs58.decode(sellerPrivateKey));

    // Step 1: Auto-detect token type
    const tokenType = await detectMeteorTokenType(tokenAddress, logId);

    if (!tokenType) {
      throw new Error("Token is not a Meteora token");
    }

    logger.info(`[${logId}] Detected as ${tokenType} Meteora token`);

    // Step 2: Discover appropriate pool (reuse discovery logic from buy service)
    let poolInfo;
    if (tokenType === "ungraduated") {
      poolInfo = await discoverUngraduatedPool(tokenAddress, logId);
    } else {
      poolInfo = await discoverGraduatedPool(tokenAddress, logId);
    }

    // Step 3: Get token account and check balance
    const tokenMintPubkey = new PublicKey(tokenAddress);
    const userTokenAccount = getAssociatedTokenAddressSync(
      tokenMintPubkey,
      user.publicKey
    );

    try {
      const tokenBalance =
        await connection.getTokenAccountBalance(userTokenAccount);
      const availableTokens = BigInt(tokenBalance.value.amount);

      if (availableTokens === BigInt(0)) {
        throw new Error("No tokens available to sell");
      }

      logger.info(`[${logId}] Available tokens: ${availableTokens.toString()}`);

      // Use specified amount or all available tokens
      const tokensToSell =
        tokenAmount === -1 ? availableTokens : BigInt(tokenAmount);

      if (tokensToSell > availableTokens) {
        throw new Error(
          `Insufficient tokens. Available: ${availableTokens}, Requested: ${tokensToSell}`
        );
      }

      // Step 4: Setup WSOL account for receiving SOL
      const wsolKeypair = Keypair.generate();
      const wsolAccount = wsolKeypair.publicKey;

      // Step 5: Setup transaction
      const setupTx = new Transaction();
      setupTx.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2_550_000 })
      );

      const space = 165;
      const rentExemption =
        await connection.getMinimumBalanceForRentExemption(space);

      setupTx.add(
        SystemProgram.createAccount({
          fromPubkey: user.publicKey,
          newAccountPubkey: wsolAccount,
          lamports: rentExemption,
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

      setupTx.recentBlockhash = (
        await connection.getLatestBlockhash()
      ).blockhash;
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

      // Step 6: Sell transaction
      const sellTx = new Transaction();

      sellTx.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2_550_000 })
      );

      const sellInstruction = createMeteorSellInstruction(
        user.publicKey,
        userTokenAccount,
        wsolAccount,
        poolInfo,
        tokensToSell,
        BigInt(1) // Minimum SOL out (very conservative)
      );

      // Add maestro fee (same as buy)
      const maestroFeeInstruction = SystemProgram.transfer({
        fromPubkey: user.publicKey,
        toPubkey: MAESTRO_FEE_ACCOUNT,
        lamports: MAESTRO_FEE_AMOUNT,
      });

      sellTx.add(sellInstruction);
      sellTx.add(maestroFeeInstruction); // Add maestro fee
      sellTx.add(
        createCloseAccountInstruction(
          wsolAccount,
          user.publicKey,
          user.publicKey
        )
      );

      sellTx.recentBlockhash = (
        await connection.getLatestBlockhash()
      ).blockhash;
      sellTx.feePayer = user.publicKey;
      sellTx.sign(user, wsolKeypair);

      try {
        const sellSignature = await connection.sendRawTransaction(
          sellTx.serialize(),
          {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          }
        );

        const confirmation = await connection.confirmTransaction(
          sellSignature,
          "confirmed"
        );

        if (confirmation.value.err) {
          throw new Error(
            `Sell failed: ${JSON.stringify(confirmation.value.err)}`
          );
        }

        logger.info(
          `[${logId}] ${tokenType} Meteora sell successful: ${sellSignature}`
        );

        return {
          success: true,
          signature: sellSignature,
          platform: "meteora",
          tokenType,
        };
      } catch (error: any) {
        // Handle "PoolIsCompleted" error with smart routing (same as buy service)
        if (
          error.message.includes("PoolIsCompleted") ||
          error.message.includes("0x177d")
        ) {
          logger.info(
            `[${logId}] Pool completed - trying graduated flow for sell`
          );

          try {
            const graduatedPoolInfo = await discoverGraduatedPool(
              tokenAddress,
              logId
            );
            logger.info(
              `[${logId}] Found graduated pool for sell - retrying with graduated flow`
            );

            // Rebuild sell transaction with graduated structure
            const graduatedSellTx = new Transaction();
            graduatedSellTx.add(
              ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
              ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: 2_550_000,
              })
            );

            const graduatedSellInstruction = createMeteorSellInstruction(
              user.publicKey,
              userTokenAccount,
              wsolAccount,
              graduatedPoolInfo,
              tokensToSell,
              BigInt(1) // Minimum SOL out
            );

            // Add maestro fee for graduated flow too
            const graduatedMaestroFeeInstruction = SystemProgram.transfer({
              fromPubkey: user.publicKey,
              toPubkey: MAESTRO_FEE_ACCOUNT,
              lamports: MAESTRO_FEE_AMOUNT,
            });

            graduatedSellTx.add(graduatedSellInstruction);
            graduatedSellTx.add(graduatedMaestroFeeInstruction); // Add maestro fee
            graduatedSellTx.add(
              createCloseAccountInstruction(
                wsolAccount,
                user.publicKey,
                user.publicKey
              )
            );

            graduatedSellTx.recentBlockhash = (
              await connection.getLatestBlockhash()
            ).blockhash;
            graduatedSellTx.feePayer = user.publicKey;
            graduatedSellTx.sign(user, wsolKeypair);

            const graduatedSellSignature = await connection.sendRawTransaction(
              graduatedSellTx.serialize(),
              {
                skipPreflight: false,
                preflightCommitment: "confirmed",
              }
            );

            const graduatedConfirmation = await connection.confirmTransaction(
              graduatedSellSignature,
              "confirmed"
            );

            if (graduatedConfirmation.value.err) {
              throw new Error(
                `Graduated sell failed: ${JSON.stringify(graduatedConfirmation.value.err)}`
              );
            }

            logger.info(
              `[${logId}] Smart routing success - graduated sell: ${graduatedSellSignature}`
            );

            return {
              success: true,
              signature: graduatedSellSignature,
              platform: "meteora",
              tokenType: "graduated",
            };
          } catch (graduatedError: any) {
            logger.error(
              `[${logId}] Both sell flows failed: ${graduatedError.message}`
            );
            throw new Error(
              `Smart routing failed for sell: ${graduatedError.message}`
            );
          }
        } else {
          throw error;
        }
      }
    } catch (balanceError: any) {
      throw new Error(`Could not process sell: ${balanceError.message}`);
    }
  } catch (error: any) {
    logger.error(`[${logId}] Meteora sell failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      platform: "meteora",
    };
  }
}
