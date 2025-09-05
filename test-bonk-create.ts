#!/usr/bin/env tsx

/**
 * Bonk (LetsBonk) Token Creation Test Script
 * 
 * This script tests the Bonk/LetsBonk token creation instruction with just a name and symbol.
 * It creates a test token on the Bonk/Raydium Launch Lab platform.
 * 
 * Usage: npm run test-bonk-create <name> <symbol>
 * Example: npm run test-bonk-create "Test Bonk Token" "TBT"
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { struct, u8 } from "@solana/buffer-layout";
import { u64 } from "@solana/buffer-layout-utils";
import bs58 from "bs58";

// Bonk/Raydium Launch Lab Constants
const RAYDIUM_LAUNCH_LAB_PROGRAM_ID = new PublicKey(
  "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"
);
const GLOBAL_CONFIG = new PublicKey(
  "6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX"
);
const PLATFORM_CONFIG = new PublicKey(
  "FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1"
);
const RAY_LAUNCHPAD_AUTHORITY = new PublicKey(
  "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh"
);
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const METADATA_PROGRAM = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);
const RENT_PROGRAM = new PublicKey(
  "SysvarRent111111111111111111111111111111111"
);
const EVENT_AUTHORITY = new PublicKey(
  "2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr"
);

// Configuration
const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_ENDPOINT, "confirmed");

// Default metadata URI for testing
const DEFAULT_METADATA_URI = "https://letsbonk-bob.mypinata.cloud/ipfs/QmTestMetadata";

// Types for token creation
type MintParams = {
  decimals: number;
  name: string;
  symbol: string;
  uri: string;
};

type CurveParams = {
  type: number;
  supply: bigint;
  totalBaseSell: bigint;
  totalQuoteFundRaising: bigint;
  migrateType: number;
};

type VestingParams = {
  totalLockedAmount: bigint;
  cliffPeriod: bigint;
  unlockPeriod: bigint;
};

type AmmCreatorFeeOn = {
  creatorFeeOn: boolean;
};

// Layouts for token parameters
const VESTING_PARAM_LAYOUT = struct<VestingParams>([
  u64("totalLockedAmount"),
  u64("cliffPeriod"),
  u64("unlockPeriod"),
]);

const CURVE_PARAM_LAYOUT = struct<CurveParams>([
  u8("type"),
  u64("supply"),
  u64("totalBaseSell"),
  u64("totalQuoteFundRaising"),
  u8("migrateType"),
]);

const AMM_CREATOR_FEE_ON_LAYOUT = struct<AmmCreatorFeeOn>([
  u8("creatorFeeOn"), // boolean as u8
]);

interface InitializeInstructionData {
  instruction: bigint;
}

const INITIALIZE_INSTRUCTION_LAYOUT = struct<InitializeInstructionData>([
  u64("instruction"),
]);

/**
 * Encode string for transaction data
 */
function encodeString(str: string) {
  const cleanStr = str.trim();
  const buffer = Buffer.alloc(4 + Buffer.byteLength(cleanStr, "utf8"));
  buffer.writeUInt32LE(Buffer.byteLength(cleanStr, "utf8"), 0);
  buffer.write(cleanStr, 4, "utf8");
  return buffer;
}

/**
 * Generate a test keypair or use provided private key
 */
function generateOrLoadKeypair(privateKey?: string): Keypair {
  if (privateKey) {
    try {
      return Keypair.fromSecretKey(bs58.decode(privateKey));
    } catch (error) {
      console.error("❌ Invalid private key format:", error);
      process.exit(1);
    }
  }
  return Keypair.generate();
}

/**
 * Create the Bonk token creation instruction
 */
function createBonkTokenInstruction(
  payer: Keypair,
  token: Keypair,
  mintParams: MintParams,
  curveParams: CurveParams,
  vestingParams: VestingParams
): TransactionInstruction {
  // Generate required PDAs
  const [metadataPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM.toBuffer(),
      token.publicKey.toBuffer(),
    ],
    METADATA_PROGRAM
  );
  
  const [poolPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([112, 111, 111, 108]), // "pool"
      token.publicKey.toBuffer(),
      WSOL_MINT.toBuffer(),
    ],
    RAYDIUM_LAUNCH_LAB_PROGRAM_ID
  );
  
  const [baseVaultPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([112, 111, 111, 108, 95, 118, 97, 117, 108, 116]), // "pool_vault"
      poolPDA.toBuffer(),
      token.publicKey.toBuffer(),
    ],
    RAYDIUM_LAUNCH_LAB_PROGRAM_ID
  );
  
  const [quoteVaultPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([112, 111, 111, 108, 95, 118, 97, 117, 108, 116]), // "pool_vault"
      poolPDA.toBuffer(),
      WSOL_MINT.toBuffer(),
    ],
    RAYDIUM_LAUNCH_LAB_PROGRAM_ID
  );

  const keys = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },        // 0: payer
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },       // 1: creator (same as payer)
    { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: false },        // 2: global_config
    { pubkey: PLATFORM_CONFIG, isSigner: false, isWritable: false },      // 3: platform_config
    { pubkey: RAY_LAUNCHPAD_AUTHORITY, isSigner: false, isWritable: false }, // 4: authority
    { pubkey: poolPDA, isSigner: false, isWritable: true },               // 5: pool_state
    { pubkey: token.publicKey, isSigner: true, isWritable: true },        // 6: base_mint
    { pubkey: WSOL_MINT, isSigner: false, isWritable: false },            // 7: quote_mint
    { pubkey: baseVaultPDA, isSigner: false, isWritable: true },          // 8: base_vault
    { pubkey: quoteVaultPDA, isSigner: false, isWritable: true },         // 9: quote_vault
    { pubkey: metadataPDA, isSigner: false, isWritable: true },           // 10: metadata_account
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },     // 11: base_token_program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },     // 12: quote_token_program
    { pubkey: METADATA_PROGRAM, isSigner: false, isWritable: false },     // 13: metadata_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 14: system_program
    { pubkey: RENT_PROGRAM, isSigner: false, isWritable: false },         // 15: rent_program
    { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },      // 16: event_authority
    { pubkey: RAYDIUM_LAUNCH_LAB_PROGRAM_ID, isSigner: false, isWritable: false }, // 17: program
  ];

  // Create instruction data (following the original implementation)
  const instructionBuffer = Buffer.alloc(INITIALIZE_INSTRUCTION_LAYOUT.span);
  INITIALIZE_INSTRUCTION_LAYOUT.encode(
    {
      instruction: Buffer.from([
        67, 153, 175, 39, 218, 16, 38, 32,
      ]).readBigUInt64LE(),
    },
    instructionBuffer
  );

  // Mint Params
  const decimalBuffer = Buffer.from([mintParams.decimals]);
  const nameBuffer = encodeString(mintParams.name);
  const symbolBuffer = encodeString(mintParams.symbol);
  const uriBuffer = encodeString(mintParams.uri);
  const mintParamLength =
    decimalBuffer.length +
    nameBuffer.length +
    symbolBuffer.length +
    uriBuffer.length;
  const mintParamBuffer = Buffer.concat(
    [decimalBuffer, nameBuffer, symbolBuffer, uriBuffer],
    mintParamLength
  );

  // Curve Params
  const curveParamsBuffer = Buffer.alloc(CURVE_PARAM_LAYOUT.span);
  CURVE_PARAM_LAYOUT.encode({ ...curveParams }, curveParamsBuffer);

  // Vesting Params
  const vestingParamBuffer = Buffer.alloc(VESTING_PARAM_LAYOUT.span);
  VESTING_PARAM_LAYOUT.encode({ ...vestingParams }, vestingParamBuffer);

  // AMM Creator Fee On Params
  const ammCreatorFeeOnParams: AmmCreatorFeeOn = { creatorFeeOn: false };
  const ammCreatorFeeOnBuffer = Buffer.alloc(AMM_CREATOR_FEE_ON_LAYOUT.span);
  AMM_CREATOR_FEE_ON_LAYOUT.encode(ammCreatorFeeOnParams, ammCreatorFeeOnBuffer);

  // Final Data
  const totalLength =
    instructionBuffer.length +
    mintParamBuffer.length +
    curveParamsBuffer.length +
    vestingParamBuffer.length +
    ammCreatorFeeOnBuffer.length;
  const instructionData = Buffer.concat(
    [instructionBuffer, mintParamBuffer, curveParamsBuffer, vestingParamBuffer, ammCreatorFeeOnBuffer],
    totalLength
  );

  return new TransactionInstruction({
    data: instructionData,
    keys,
    programId: RAYDIUM_LAUNCH_LAB_PROGRAM_ID,
  });
}

/**
 * Check wallet balance
 */
async function checkBalance(publicKey: PublicKey): Promise<number> {
  const balance = await connection.getBalance(publicKey);
  return balance / LAMPORTS_PER_SOL;
}

/**
 * Send and confirm transaction with retries
 */
async function sendAndConfirmTransaction(
  transaction: VersionedTransaction,
  maxRetries: number = 3
): Promise<{ success: boolean; signature?: string; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📤 Sending transaction (attempt ${attempt}/${maxRetries})...`);
      
      const signature = await connection.sendTransaction(transaction, {
        maxRetries: 3,
        skipPreflight: false,
      });

      console.log(`🔍 Confirming transaction: ${signature}`);
      
      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      return { success: true, signature };
    } catch (error: any) {
      console.error(`❌ Attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        return { success: false, error: error.message };
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  
  return { success: false, error: "Max retries exceeded" };
}

/**
 * Main test function
 */
async function testBonkTokenCreate(name: string, symbol: string, creatorPrivateKey?: string) {
  console.log("🚀 Bonk (LetsBonk) Token Creation Test");
  console.log("=" + "=".repeat(50));
  
  // Generate keypairs
  const tokenKeypair = Keypair.generate();
  const creatorKeypair = generateOrLoadKeypair(creatorPrivateKey);
  
  console.log(`📋 Token Details:`);
  console.log(`   Name: ${name}`);
  console.log(`   Symbol: ${symbol}`);
  console.log(`   Token Address: ${tokenKeypair.publicKey.toBase58()}`);
  console.log(`   Creator: ${creatorKeypair.publicKey.toBase58()}`);
  console.log();

  // Check creator balance
  const balance = await checkBalance(creatorKeypair.publicKey);
  console.log(`💰 Creator Balance: ${balance.toFixed(4)} SOL`);
  
  if (balance < 0.05) {
    console.error("❌ Insufficient balance! Need at least 0.05 SOL for Bonk token creation fees.");
    process.exit(1);
  }

  // Generate PDAs for logging
  const [metadataPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM.toBuffer(),
      tokenKeypair.publicKey.toBuffer(),
    ],
    METADATA_PROGRAM
  );
  
  const [poolPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([112, 111, 111, 108]),
      tokenKeypair.publicKey.toBuffer(),
      WSOL_MINT.toBuffer(),
    ],
    RAYDIUM_LAUNCH_LAB_PROGRAM_ID
  );

  console.log(`🔗 Generated Addresses:`);
  console.log(`   Pool PDA: ${poolPDA.toBase58()}`);
  console.log(`   Metadata PDA: ${metadataPDA.toBase58()}`);
  console.log();

  // Set up token parameters
  const mintParams: MintParams = {
    decimals: 6,
    name,
    symbol,
    uri: DEFAULT_METADATA_URI,
  };

  const curveParams: CurveParams = {
    type: 0, // constant curve
    supply: BigInt(1_000_000_000_000_000), // 1B tokens with 6 decimals
    totalBaseSell: BigInt(793_100_000_000_000), // ~79% for sale
    totalQuoteFundRaising: BigInt(85_000_000_000), // 85 SOL fundraising goal
    migrateType: 1,
  };

  const vestingParams: VestingParams = {
    totalLockedAmount: BigInt(0),
    cliffPeriod: BigInt(0),
    unlockPeriod: BigInt(0),
  };

  // Create the token creation instruction
  console.log("🔨 Creating Bonk token instruction...");
  const createInstruction = createBonkTokenInstruction(
    creatorKeypair,
    tokenKeypair,
    mintParams,
    curveParams,
    vestingParams
  );

  // Build transaction
  console.log("📦 Building transaction...");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      instructions: [createInstruction],
      payerKey: creatorKeypair.publicKey,
      recentBlockhash: blockhash,
    }).compileToV0Message()
  );

  // Sign transaction
  transaction.sign([creatorKeypair, tokenKeypair]);
  console.log("✍️ Transaction signed");

  // Send transaction
  const result = await sendAndConfirmTransaction(transaction);

  if (result.success) {
    console.log();
    console.log("🎉 BONK TOKEN CREATION SUCCESSFUL!");
    console.log("=" + "=".repeat(50));
    console.log(`✅ Transaction Signature: ${result.signature}`);
    console.log(`🪙 Token Address: ${tokenKeypair.publicKey.toBase58()}`);
    console.log(`🏊 Pool Address: ${poolPDA.toBase58()}`);
    console.log(`📄 Metadata: ${metadataPDA.toBase58()}`);
    console.log();
    console.log(`🌐 View on Solscan: https://solscan.io/tx/${result.signature}`);
    console.log(`🌐 View Token: https://solscan.io/token/${tokenKeypair.publicKey.toBase58()}`);
    console.log(`🎯 Bonk Trading: https://letsbonk.com/token/${tokenKeypair.publicKey.toBase58()}`);
    
    // Save keypairs for reference
    console.log();
    console.log("🔑 Keypairs (save these!):");
    console.log(`   Token Private Key: ${bs58.encode(tokenKeypair.secretKey)}`);
    console.log(`   Creator Private Key: ${bs58.encode(creatorKeypair.secretKey)}`);
  } else {
    console.log();
    console.log("❌ BONK TOKEN CREATION FAILED!");
    console.log("=" + "=".repeat(50));
    console.log(`Error: ${result.error}`);
    console.log();
    console.log("💡 Troubleshooting:");
    console.log("   - Check your SOL balance (need ~0.05 SOL)");
    console.log("   - Verify RPC endpoint is working");
    console.log("   - Try again with higher priority fees");
    console.log("   - Check Solana network status");
    console.log("   - Ensure Raydium Launch Lab program is accessible");
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log("Usage: npm run test-bonk-create <name> <symbol> [creator-private-key]");
    console.log("Example: npm run test-bonk-create \"My Bonk Token\" \"MBT\"");
    console.log();
    console.log("Optional: Provide creator private key as third argument");
    console.log("If not provided, a new keypair will be generated");
    process.exit(1);
  }

  const [name, symbol, creatorPrivateKey] = args;

  // Validate inputs
  if (name.length > 32) {
    console.error("❌ Token name too long (max 32 characters)");
    process.exit(1);
  }
  
  if (symbol.length > 10) {
    console.error("❌ Token symbol too long (max 10 characters)");
    process.exit(1);
  }

  try {
    await testBonkTokenCreate(name, symbol, creatorPrivateKey);
  } catch (error: any) {
    console.error("❌ Unexpected error:", error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Exiting...');
  process.exit(0);
});

// Run the script
main().catch(console.error);

export { testBonkTokenCreate, createBonkTokenInstruction };