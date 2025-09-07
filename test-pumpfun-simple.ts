#!/usr/bin/env bun

/**
 * Simple PumpFun Token Creation + Dev Buy Test Script
 * 
 * Usage: bun run test-pumpfun-simple.ts <private_key> <name> <symbol> <dev_buy_amount>
 * 
 * Example: bun run test-pumpfun-simple.ts "your_private_key_here" "TestToken" "TEST" 0.001
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
  SYSVAR_RENT_PUBKEY
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createAssociatedTokenAccountIdempotentInstruction
} from "@solana/spl-token";
import { env } from "./src/config";
import { 
  PUMPFUN_PROGRAM,
  PUMPFUN_MINT_AUTHORITY,
  PUMPFUN_GLOBAL_SETTINGS,
  PUMPFUN_EVENT_AUTHORITY,
  PUMPFUN_FEE_ACCOUNT,
  TOKEN_METADATA_PROGRAM,
  CREATE_DISCRIMINATOR,
  BUY_DISCRIMINATOR
} from "./src/blockchain/pumpfun/constants";
import { 
  getBondingCurve, 
  getMetadataPDA, 
  getCreatorVault,
  getGlobalSetting,
  quoteBuy,
  applySlippage,
  getFeeConfig
} from "./src/blockchain/pumpfun/utils";
import { CreateCodec, BuyCodec } from "./src/blockchain/pumpfun/codecs";
import { globalVolumeAccumulator, userVolumeAccumulator } from "./src/blockchain/pumpfun/instructions";

// Initialize connection
const connection = new Connection(env.HELIUS_RPC_URL, "confirmed");

// Helper function to convert private key string to Keypair
async function secretKeyToKeypair(privateKeyString: string): Promise<Keypair> {
  try {
    // Handle different private key formats
    let secretKey: Uint8Array;
    
    if (privateKeyString.startsWith('[') && privateKeyString.endsWith(']')) {
      // Array format: [1,2,3,...]
      const keyArray = JSON.parse(privateKeyString);
      secretKey = new Uint8Array(keyArray);
    } else if (privateKeyString.includes(',')) {
      // Comma-separated format: 1,2,3,...
      const keyArray = privateKeyString.split(',').map(num => parseInt(num.trim()));
      secretKey = new Uint8Array(keyArray);
    } else {
      // Base58 format (most common)
      const bs58 = await import('bs58');
      secretKey = bs58.default.decode(privateKeyString);
    }
    
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    throw new Error(`Invalid private key format: ${error.message}`);
  }
}

// Create token instruction
function tokenCreateInstruction(
  mint: Keypair,
  dev: Keypair,
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
    { pubkey: dev.publicKey, isSigner: true, isWritable: true },
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
    creator: dev.publicKey.toBase58(),
    instruction: Buffer.from(CREATE_DISCRIMINATOR).readBigUInt64LE(),
  });
  
  return new TransactionInstruction({
    data: Buffer.from(data),
    keys,
    programId: PUMPFUN_PROGRAM,
  });
}

// Create buy instruction (with FeeConfig account)
function buyInstruction(
  mint: PublicKey,
  tokenCreator: PublicKey,
  buyer: PublicKey,
  amount: bigint,
  maxSolCost: bigint
): TransactionInstruction {
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint);
  const buyerAta = getAssociatedTokenAddressSync(mint, buyer);
  const creatorVault = getCreatorVault(tokenCreator);
  const feeConfig = getFeeConfig();
  const global_volume_accumulator = globalVolumeAccumulator();
  const user_volume_accumulator = userVolumeAccumulator(buyer);

  const keys = [
    { pubkey: PUMPFUN_GLOBAL_SETTINGS, isSigner: false, isWritable: false },
    { pubkey: feeConfig, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_FEE_ACCOUNT, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
    { pubkey: buyerAta, isSigner: false, isWritable: true },
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: creatorVault, isSigner: false, isWritable: true },
    { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: global_volume_accumulator, isWritable: true, isSigner: false },
    { pubkey: user_volume_accumulator, isWritable: true, isSigner: false },
  ];
  
  const data = BuyCodec.encode({
    instruction: Buffer.from(BUY_DISCRIMINATOR).readBigUint64LE(),
    amount,
    maxSolCost,
  });
  
  return new TransactionInstruction({
    data: Buffer.from(data),
    keys,
    programId: PUMPFUN_PROGRAM,
  });
}

// Send transaction with retry
async function sendAndConfirmTransactionWithRetry(
  transaction: VersionedTransaction,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<{ success: boolean; signature?: string; error?: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📤 Sending transaction (attempt ${attempt}/${maxRetries})...`);
      
      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: false,
        preflightCommitment: "processed",
        maxRetries: 0
      });
      
      console.log(`📋 Transaction signature: ${signature}`);
      console.log(`🔗 Explorer: https://solscan.io/tx/${signature}`);
      
      // Wait for confirmation
      console.log(`⏳ Waiting for confirmation...`);
      const confirmation = await connection.confirmTransaction(signature, "confirmed");
      
      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      console.log(`✅ Transaction confirmed!`);
      return { success: true, signature };
      
    } catch (error) {
      console.log(`❌ Attempt ${attempt} failed:`, error.message);
      
      if (attempt < maxRetries) {
        console.log(`⏳ Retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } else {
        return { success: false, error: error.message };
      }
    }
  }
  
  return { success: false, error: "Max retries exceeded" };
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length !== 4) {
    console.log("❌ Usage: bun run test-pumpfun-simple.ts <private_key> <name> <symbol> <dev_buy_amount>");
    console.log("📝 Example: bun run test-pumpfun-simple.ts \"your_private_key_here\" \"TestToken\" \"TEST\" 0.001");
    process.exit(1);
  }
  
  const [privateKeyString, tokenName, symbol, devBuyAmountStr] = args;
  const devBuyAmount = parseFloat(devBuyAmountStr);
  
  if (isNaN(devBuyAmount) || devBuyAmount <= 0) {
    console.log("❌ Dev buy amount must be a positive number");
    process.exit(1);
  }
  
  console.log("🚀 PumpFun Token Creation + Dev Buy Test (Simple)");
  console.log("=" .repeat(50));
  console.log(`📛 Token Name: ${tokenName}`);
  console.log(`🏷️  Symbol: ${symbol}`);
  console.log(`💰 Dev Buy Amount: ${devBuyAmount} SOL`);
  console.log("");
  
  try {
    // Parse private key
    console.log("🔑 Parsing private key...");
    const devKeypair = await secretKeyToKeypair(privateKeyString);
    console.log(`👤 Dev Wallet: ${devKeypair.publicKey.toBase58()}`);
    
    // Check wallet balance
    console.log("💳 Checking wallet balance...");
    const balance = await connection.getBalance(devKeypair.publicKey);
    const balanceSOL = balance / LAMPORTS_PER_SOL;
    console.log(`💰 Balance: ${balanceSOL.toFixed(6)} SOL`);
    
    // Estimate total cost
    const estimatedFees = 0.02; // Transaction fees + account creation
    const estimatedBuyFee = devBuyAmount * 0.01; // 1% buy fee
    const totalCost = devBuyAmount + estimatedFees + estimatedBuyFee;
    
    console.log(`💸 Estimated total cost: ${totalCost.toFixed(6)} SOL`);
    console.log(`   - Dev buy: ${devBuyAmount} SOL`);
    console.log(`   - Transaction fees: ${estimatedFees} SOL`);
    console.log(`   - Buy fee (1%): ${estimatedBuyFee.toFixed(6)} SOL`);
    
    if (balanceSOL < totalCost) {
      console.log(`❌ Insufficient balance! Need at least ${totalCost.toFixed(6)} SOL`);
      process.exit(1);
    }
    
    // Generate mint keypair
    console.log("🎲 Generating mint keypair...");
    const mintKeypair = Keypair.generate();
    console.log(`🪙 Token Mint: ${mintKeypair.publicKey.toBase58()}`);
    
    // Use a simple hardcoded metadata URI (no IPFS upload needed)
    console.log("📋 Using hardcoded metadata URI...");
    const metadataUri = `https://arweave.net/placeholder-${symbol.toLowerCase()}-metadata`;
    console.log(`📋 Metadata URI: ${metadataUri}`);
    
    // Get global settings
    console.log("⚙️ Fetching global settings...");
    const globalSetting = await getGlobalSetting();
    console.log(`📊 Initial virtual token reserves: ${globalSetting.initialVirtualTokenReserves.toString()}`);
    console.log(`📊 Initial virtual SOL reserves: ${globalSetting.initialVirtualSolReserves.toString()}`);
    
    // Build transaction instructions
    console.log("🔨 Building transaction...");
    const instructions: TransactionInstruction[] = [];
    
    // 1. Create token instruction
    const createIx = tokenCreateInstruction(
      mintKeypair,
      devKeypair,
      tokenName,
      symbol,
      metadataUri
    );
    instructions.push(createIx);
    console.log("✅ Token creation instruction added");
    
    // 2. ExtendAccount instruction (required after token creation)
    const extendAccountIx = new TransactionInstruction({
      keys: [
        { pubkey: getBondingCurve(mintKeypair.publicKey).bondingCurve, isSigner: false, isWritable: true }, // account
        { pubkey: devKeypair.publicKey, isSigner: true, isWritable: true }, // user
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
        { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false }, // event_authority
        { pubkey: PUMPFUN_PROGRAM, isSigner: false, isWritable: false }, // program
      ],
      programId: PUMPFUN_PROGRAM,
      data: Buffer.from([234, 102, 194, 203, 150, 72, 62, 229]) // ExtendAccount discriminator
    });
    instructions.push(extendAccountIx);
    console.log("✅ ExtendAccount instruction added");
    
    // 3. Dev buy instructions (if dev buy > 0)
    let devBuyTokenAmount: string | undefined;
    if (devBuyAmount > 0) {
      // Create ATA for dev using createAssociatedTokenAccountIdempotentInstruction
      const devAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        devKeypair.publicKey
      );
      const createDevAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        devKeypair.publicKey,
        devAta,
        devKeypair.publicKey,
        mintKeypair.publicKey
      );
      instructions.push(createDevAtaIx);
      console.log("✅ Dev ATA creation instruction added (idempotent)");
      
      // Calculate buy amounts
      const devBuyLamports = BigInt(Math.ceil(devBuyAmount * LAMPORTS_PER_SOL));
      const { tokenOut } = quoteBuy(
        devBuyLamports,
        globalSetting.initialVirtualTokenReserves,
        globalSetting.initialVirtualSolReserves,
        globalSetting.initialRealTokenReserves
      );
      const tokenOutWithSlippage = applySlippage(tokenOut, 1); // 1% slippage
      
      console.log(`🧮 Calculated token output: ${tokenOut.toString()}`);
      console.log(`🧮 Token output with slippage: ${tokenOutWithSlippage.toString()}`);
      
      // Create buy instruction with correct parameters
      // Based on successful tx: amount = tokens to receive, maxSolCost = max SOL to spend
      const devBuyIx = buyInstruction(
        mintKeypair.publicKey,
        devKeypair.publicKey, // tokenCreator
        devKeypair.publicKey, // buyer
        tokenOutWithSlippage, // amount (tokens to receive)
        devBuyLamports // maxSolCost (max SOL to spend)
      );
      instructions.push(devBuyIx);
      console.log("✅ Dev buy instruction added");
      
      devBuyTokenAmount = tokenOut.toString();
    }
    
    // Build and sign transaction
    console.log("📝 Building transaction...");
    const blockHash = await connection.getLatestBlockhash("confirmed");
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        instructions,
        payerKey: devKeypair.publicKey,
        recentBlockhash: blockHash.blockhash,
      }).compileToV0Message()
    );
    
    transaction.sign([devKeypair, mintKeypair]);
    console.log("✅ Transaction signed");
    
    // Send transaction
    console.log("🚀 Sending transaction...");
    const result = await sendAndConfirmTransactionWithRetry(transaction);
    
    if (result.success) {
      console.log("");
      console.log("🎉 SUCCESS!");
      console.log("=" .repeat(50));
      console.log(`🪙 Token Mint: ${mintKeypair.publicKey.toBase58()}`);
      console.log(`📋 Transaction: ${result.signature}`);
      console.log(`🔗 Explorer: https://solscan.io/tx/${result.signature}`);
      console.log(`🔗 Token: https://solscan.io/token/${mintKeypair.publicKey.toBase58()}`);
      console.log(`🔗 PumpFun: https://pump.fun/${mintKeypair.publicKey.toBase58()}`);
      
      if (devBuyTokenAmount) {
        console.log(`💰 Dev bought: ${devBuyTokenAmount} tokens`);
      }
      
      console.log("");
      console.log("✅ Token created successfully with dev buy!");
      
    } else {
      console.log("");
      console.log("❌ FAILED!");
      console.log("=" .repeat(50));
      console.log(`Error: ${result.error}`);
      process.exit(1);
    }
    
  } catch (error) {
    console.log("");
    console.log("❌ ERROR!");
    console.log("=" .repeat(50));
    console.log(`Error: ${error.message}`);
    console.log(`Stack: ${error.stack}`);
    process.exit(1);
  }
}

// Run the script
if (import.meta.main) {
  main().catch(console.error);
}