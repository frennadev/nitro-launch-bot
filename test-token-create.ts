#!/usr/bin/env tsx

/**
 * PumpFun Token Creation Test Script
 * 
 * This script tests the PumpFun token creation instruction with just a name and symbol.
 * It creates a test token on PumpFun's bonding curve system.
 * 
 * Usage: npm run test-token-create <name> <symbol>
 * Example: npm run test-token-create "Test Token" "TEST"
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";

// Import the required PumpFun modules
import {
  CREATE_DISCRIMINATOR,
  PUMPFUN_EVENT_AUTHORITY,
  PUMPFUN_GLOBAL_SETTINGS,
  PUMPFUN_MINT_AUTHORITY,
  PUMPFUN_PROGRAM,
  TOKEN_METADATA_PROGRAM,
} from "./src/blockchain/pumpfun/constants";
import { CreateCodec } from "./src/blockchain/pumpfun/codecs";
import { getBondingCurve, getMetadataPDA } from "./src/blockchain/pumpfun/utils";

// Configuration
const RPC_ENDPOINT = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_ENDPOINT, "confirmed");

// Default metadata URI for testing (simple JSON with basic token info)
const DEFAULT_METADATA_URI = "https://pump.fun/token-metadata.json";

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
 * Create the PumpFun token creation instruction
 */
function createTokenInstruction(
  mint: Keypair,
  creator: Keypair,
  name: string,
  symbol: string,
  uri: string
): TransactionInstruction {
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint.publicKey);
  const metadata = getMetadataPDA(mint.publicKey);

  const keys = [
    { pubkey: mint.publicKey, isWritable: true, isSigner: true },
    { pubkey: PUMPFUN_MINT_AUTHORITY, isWritable: false, isSigner: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
    { pubkey: PUMPFUN_GLOBAL_SETTINGS, isSigner: false, isWritable: false },
    { pubkey: TOKEN_METADATA_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: metadata, isSigner: false, isWritable: true },
    { pubkey: creator.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_PROGRAM, isSigner: false, isWritable: false },
  ];

  const data = CreateCodec.encode({
    name,
    symbol,
    uri,
    creator: creator.publicKey.toBase58(),
    instruction: Buffer.from(CREATE_DISCRIMINATOR).readBigUInt64LE(),
  });

  return new TransactionInstruction({
    data: Buffer.from(data),
    keys,
    programId: PUMPFUN_PROGRAM,
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
async function testTokenCreate(name: string, symbol: string, creatorPrivateKey?: string) {
  console.log("🚀 PumpFun Token Creation Test");
  console.log("=" + "=".repeat(50));
  
  // Generate keypairs
  const mintKeypair = Keypair.generate();
  const creatorKeypair = generateOrLoadKeypair(creatorPrivateKey);
  
  console.log(`📋 Token Details:`);
  console.log(`   Name: ${name}`);
  console.log(`   Symbol: ${symbol}`);
  console.log(`   Mint Address: ${mintKeypair.publicKey.toBase58()}`);
  console.log(`   Creator: ${creatorKeypair.publicKey.toBase58()}`);
  console.log();

  // Check creator balance
  const balance = await checkBalance(creatorKeypair.publicKey);
  console.log(`💰 Creator Balance: ${balance.toFixed(4)} SOL`);
  
  if (balance < 0.01) {
    console.error("❌ Insufficient balance! Need at least 0.01 SOL for transaction fees.");
    process.exit(1);
  }

  // Generate bonding curve and metadata addresses
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(mintKeypair.publicKey);
  const metadata = getMetadataPDA(mintKeypair.publicKey);

  console.log(`🔗 Generated Addresses:`);
  console.log(`   Bonding Curve: ${bondingCurve.toBase58()}`);
  console.log(`   Associated Bonding Curve: ${associatedBondingCurve.toBase58()}`);
  console.log(`   Metadata PDA: ${metadata.toBase58()}`);
  console.log();

  // Create the token creation instruction
  console.log("🔨 Creating token instruction...");
  const createInstruction = createTokenInstruction(
    mintKeypair,
    creatorKeypair,
    name,
    symbol,
    DEFAULT_METADATA_URI
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
  transaction.sign([creatorKeypair, mintKeypair]);
  console.log("✍️ Transaction signed");

  // Send transaction
  const result = await sendAndConfirmTransaction(transaction);

  if (result.success) {
    console.log();
    console.log("🎉 TOKEN CREATION SUCCESSFUL!");
    console.log("=" + "=".repeat(50));
    console.log(`✅ Transaction Signature: ${result.signature}`);
    console.log(`🪙 Token Address: ${mintKeypair.publicKey.toBase58()}`);
    console.log(`🔗 Bonding Curve: ${bondingCurve.toBase58()}`);
    console.log(`📄 Metadata: ${metadata.toBase58()}`);
    console.log();
    console.log(`🌐 View on Solscan: https://solscan.io/tx/${result.signature}`);
    console.log(`🌐 View Token: https://solscan.io/token/${mintKeypair.publicKey.toBase58()}`);
    
    // Save keypairs for reference
    console.log();
    console.log("🔑 Keypairs (save these!):");
    console.log(`   Mint Private Key: ${bs58.encode(mintKeypair.secretKey)}`);
    console.log(`   Creator Private Key: ${bs58.encode(creatorKeypair.secretKey)}`);
  } else {
    console.log();
    console.log("❌ TOKEN CREATION FAILED!");
    console.log("=" + "=".repeat(50));
    console.log(`Error: ${result.error}`);
    console.log();
    console.log("💡 Troubleshooting:");
    console.log("   - Check your SOL balance");
    console.log("   - Verify RPC endpoint is working");
    console.log("   - Try again with higher priority fees");
    console.log("   - Check Solana network status");
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log("Usage: npm run test-token-create <name> <symbol> [creator-private-key]");
    console.log("Example: npm run test-token-create \"My Test Token\" \"MTT\"");
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
    await testTokenCreate(name, symbol, creatorPrivateKey);
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

// Run the script - always run when executed directly
main().catch(console.error);

export { testTokenCreate, createTokenInstruction };