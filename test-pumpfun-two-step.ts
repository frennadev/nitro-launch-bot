#!/usr/bin/env bun
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
  PUMPFUN_FEE_ACCOUNT
} from "./src/blockchain/pumpfun/constants";
import { 
  tokenCreateInstruction,
  buyInstruction
} from "./src/blockchain/pumpfun/instructions";
import { 
  getBondingCurve,
  getGlobalSetting,
  quoteBuy,
  getFeeConfig
} from "./src/blockchain/pumpfun/utils";
import bs58 from "bs58";

// Helper function to convert private key string to Keypair
async function secretKeyToKeypair(secretKey: string): Promise<Keypair> {
  try {
    const secretKeyBytes = bs58.decode(secretKey);
    return Keypair.fromSecretKey(secretKeyBytes);
  } catch (error) {
    throw new Error(`Invalid private key format: ${error}`);
  }
}

// Apply slippage to token amount (reduce expected tokens by slippage %)
function applySlippage(amount: bigint, slippagePercent: number): bigint {
  const slippageBasisPoints = BigInt(Math.floor(slippagePercent * 100));
  return (amount * (BigInt(10000) - slippageBasisPoints)) / BigInt(10000);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4) {
    console.error("Usage: bun run test-pumpfun-two-step.ts <private_key> <name> <symbol> <dev_buy_amount>");
    console.error("Example: bun run test-pumpfun-two-step.ts 'your_private_key' 'MyToken' 'MTK' 0.1");
    process.exit(1);
  }

  const [privateKey, tokenName, symbol, devBuyAmountStr] = args;
  const devBuyAmount = parseFloat(devBuyAmountStr);

  console.log("🚀 PumpFun Token Creation + Dev Buy Test (Two-Step)");
  console.log("==================================================");
  console.log(`📛 Token Name: ${tokenName}`);
  console.log(`🏷️  Symbol: ${symbol}`);
  console.log(`💰 Dev Buy Amount: ${devBuyAmount} SOL`);
  console.log("");

  // Initialize connection
  const connection = new Connection(env.HELIUS_RPC_URL, "confirmed");

  try {
    // Parse private key
    console.log("🔑 Parsing private key...");
    const devKeypair = await secretKeyToKeypair(privateKey);
    console.log(`👤 Dev Wallet: ${devKeypair.publicKey.toString()}`);

    // Check wallet balance
    console.log("💳 Checking wallet balance...");
    const balance = await connection.getBalance(devKeypair.publicKey);
    const balanceSOL = balance / LAMPORTS_PER_SOL;
    console.log(`💰 Balance: ${balanceSOL.toFixed(6)} SOL`);

    // Estimate costs
    const estimatedTxFee = 0.005; // SOL
    const buyFeePercent = 0.01; // 1%
    const estimatedBuyFee = devBuyAmount * buyFeePercent;
    const totalEstimatedCost = devBuyAmount + estimatedTxFee + estimatedBuyFee;
    
    console.log(`💸 Estimated total cost: ${totalEstimatedCost.toFixed(6)} SOL`);
    console.log(`   - Dev buy: ${devBuyAmount} SOL`);
    console.log(`   - Transaction fees: ${estimatedTxFee} SOL`);
    console.log(`   - Buy fee (1%): ${estimatedBuyFee.toFixed(6)} SOL`);

    if (balanceSOL < totalEstimatedCost) {
      throw new Error(`Insufficient balance. Need ${totalEstimatedCost.toFixed(6)} SOL, have ${balanceSOL.toFixed(6)} SOL`);
    }

    // Generate mint keypair
    console.log("🎲 Generating mint keypair...");
    const mintKeypair = Keypair.generate();
    console.log(`🪙 Token Mint: ${mintKeypair.publicKey.toString()}`);

    // Use hardcoded metadata URI
    console.log("📋 Using hardcoded metadata URI...");
    const metadataUri = "https://arweave.net/placeholder-test-metadata";
    console.log(`📋 Metadata URI: ${metadataUri}`);

    // Get global settings
    console.log("⚙️ Fetching global settings...");
    const globalSetting = await getGlobalSetting(connection);
    console.log(`📊 Initial virtual token reserves: ${globalSetting.initialVirtualTokenReserves}`);
    console.log(`📊 Initial virtual SOL reserves: ${globalSetting.initialVirtualSolReserves}`);

    // ==========================================
    // STEP 1: CREATE TOKEN
    // ==========================================
    console.log("");
    console.log("🔨 STEP 1: Creating token...");
    const createInstructions: TransactionInstruction[] = [];

    // 1. Token creation instruction
    const createIx = tokenCreateInstruction(
      mintKeypair,
      devKeypair,
      tokenName,
      symbol,
      metadataUri
    );
    createInstructions.push(createIx);
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
    createInstructions.push(extendAccountIx);
    console.log("✅ ExtendAccount instruction added");

    // Build and send token creation transaction
    console.log("📝 Building token creation transaction...");
    const createBlockHash = await connection.getLatestBlockhash("confirmed");
    const createTransaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: devKeypair.publicKey,
        recentBlockhash: createBlockHash.blockhash,
        instructions: createInstructions,
      }).compileToV0Message()
    );

    createTransaction.sign([devKeypair, mintKeypair]);
    console.log("✅ Token creation transaction signed");

    console.log("🚀 Sending token creation transaction...");
    const createTxSignature = await connection.sendTransaction(createTransaction, {
      maxRetries: 3,
      preflightCommitment: "confirmed",
    });
    console.log(`📤 Token creation transaction sent: ${createTxSignature}`);

    // Wait for confirmation
    console.log("⏳ Waiting for token creation confirmation...");
    const createConfirmation = await connection.confirmTransaction({
      signature: createTxSignature,
      blockhash: createBlockHash.blockhash,
      lastValidBlockHeight: createBlockHash.lastValidBlockHeight,
    }, "confirmed");

    if (createConfirmation.value.err) {
      throw new Error(`Token creation failed: ${JSON.stringify(createConfirmation.value.err)}`);
    }

    console.log("✅ Token creation confirmed!");
    
    // Debug: Check mint account after creation
    console.log("🔍 Checking mint account after creation...");
    const mintAccountInfo = await connection.getAccountInfo(mintKeypair.publicKey);
    if (mintAccountInfo) {
      console.log(`🔍 Mint account owner: ${mintAccountInfo.owner.toString()}`);
      console.log(`🔍 Expected owner: ${TOKEN_PROGRAM_ID.toString()}`);
      console.log(`🔍 Owners match: ${mintAccountInfo.owner.equals(TOKEN_PROGRAM_ID)}`);
    } else {
      console.log("🔍 Mint account not found!");
    }
    
    // Add a small delay to ensure the transaction is fully processed
    console.log("⏳ Waiting 2 seconds for transaction to fully process...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log("");

    // ==========================================
    // STEP 2: DEV BUY (if amount > 0)
    // ==========================================
    if (devBuyAmount > 0) {
      console.log("🔨 STEP 2: Performing dev buy...");
      const buyInstructions: TransactionInstruction[] = [];

      // 1. Create ATA for dev using createAssociatedTokenAccountIdempotentInstruction
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
      buyInstructions.push(createDevAtaIx);
      console.log("✅ Dev ATA creation instruction added (idempotent)");
      
      // 2. Calculate buy amounts
      const devBuyLamports = BigInt(Math.ceil(devBuyAmount * LAMPORTS_PER_SOL));
      // Add 5% buffer to max SOL cost to account for fees and slippage
      const maxSolCostWithBuffer = BigInt(Math.ceil(devBuyLamports * 1.05));
      
      const { tokenOut } = quoteBuy(
        devBuyLamports,
        globalSetting.initialVirtualTokenReserves,
        globalSetting.initialVirtualSolReserves,
        globalSetting.initialRealTokenReserves
      );
      const tokenOutWithSlippage = applySlippage(tokenOut, 1); // 1% slippage
      
      console.log(`🧮 Calculated token output: ${tokenOut.toString()}`);
      console.log(`🧮 Token output with slippage: ${tokenOutWithSlippage.toString()}`);
      console.log(`🧮 Max SOL cost with buffer: ${maxSolCostWithBuffer.toString()}`);
      
      // 3. Create buy instruction
      console.log(`🔍 Using mint for buy: ${mintKeypair.publicKey.toString()}`);
      console.log(`🔍 Token creator: ${devKeypair.publicKey.toString()}`);
      console.log(`🔍 Buyer: ${devKeypair.publicKey.toString()}`);
      console.log(`🔍 Amount (tokens): ${tokenOutWithSlippage.toString()}`);
      console.log(`🔍 Max SOL cost: ${maxSolCostWithBuffer.toString()}`);
      
      const devBuyIx = buyInstruction(
        mintKeypair.publicKey,
        devKeypair.publicKey, // tokenCreator
        devKeypair.publicKey, // buyer
        tokenOutWithSlippage, // amount (tokens to receive)
        maxSolCostWithBuffer // maxSolCost (max SOL to spend with buffer)
      );
      buyInstructions.push(devBuyIx);
      console.log("✅ Dev buy instruction added");

      // Build and send buy transaction
      console.log("📝 Building dev buy transaction...");
      const buyBlockHash = await connection.getLatestBlockhash("confirmed");
      const buyTransaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: devKeypair.publicKey,
          recentBlockhash: buyBlockHash.blockhash,
          instructions: buyInstructions,
        }).compileToV0Message()
      );

      buyTransaction.sign([devKeypair]);
      console.log("✅ Dev buy transaction signed");

      console.log("🚀 Sending dev buy transaction...");
      const buyTxSignature = await connection.sendTransaction(buyTransaction, {
        maxRetries: 3,
        preflightCommitment: "confirmed",
      });
      console.log(`📤 Dev buy transaction sent: ${buyTxSignature}`);

      // Wait for confirmation
      console.log("⏳ Waiting for dev buy confirmation...");
      const buyConfirmation = await connection.confirmTransaction({
        signature: buyTxSignature,
        blockhash: buyBlockHash.blockhash,
        lastValidBlockHeight: buyBlockHash.lastValidBlockHeight,
      }, "confirmed");

      if (buyConfirmation.value.err) {
        throw new Error(`Dev buy failed: ${JSON.stringify(buyConfirmation.value.err)}`);
      }

      console.log("✅ Dev buy confirmed!");
      console.log(`🎯 Tokens received: ${tokenOut.toString()}`);
    }

    console.log("");
    console.log("🎉 SUCCESS!");
    console.log("==================================================");
    console.log(`🪙 Token Mint: ${mintKeypair.publicKey.toString()}`);
    console.log(`📛 Name: ${tokenName}`);
    console.log(`🏷️  Symbol: ${symbol}`);
    console.log(`📋 Metadata URI: ${metadataUri}`);
    if (devBuyAmount > 0) {
      console.log(`💰 Dev Buy: ${devBuyAmount} SOL`);
    }

  } catch (error) {
    console.log("");
    console.log("❌ FAILED!");
    console.log("==================================================");
    console.error(error);
    process.exit(1);
  }
}

main();