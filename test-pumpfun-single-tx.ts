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
  quoteBuy
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
    console.error("Usage: bun run test-pumpfun-single-tx.ts <private_key> <name> <symbol> <dev_buy_amount>");
    console.error("Example: bun run test-pumpfun-single-tx.ts 'your_private_key' 'MyToken' 'MTK' 0.1");
    process.exit(1);
  }

  const [privateKey, tokenName, symbol, devBuyAmountStr] = args;
  const devBuyAmount = parseFloat(devBuyAmountStr);

  console.log("🚀 PumpFun Token Creation + Dev Buy Test (Single Transaction)");
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
    const estimatedTxFee = 0.03; // SOL (higher for single complex tx)
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

    // Build single transaction with all instructions
    console.log("");
    console.log("🔨 Building single transaction with all instructions...");
    const instructions: TransactionInstruction[] = [];

    // 1. Token creation instruction
    const createIx = tokenCreateInstruction(
      mintKeypair,
      devKeypair,
      tokenName,
      symbol,
      metadataUri
    );
    instructions.push(createIx);
    console.log("✅ Instruction #1: Token creation added");
    
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
    console.log("✅ Instruction #2: ExtendAccount added");

    // 3. Dev buy instructions (if dev buy > 0)
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
      console.log("✅ Instruction #3: Dev ATA creation added (idempotent)");
      
      // Calculate buy amounts
      const devBuyLamports = BigInt(Math.ceil(devBuyAmount * LAMPORTS_PER_SOL));
      // Add 10% buffer to max SOL cost to account for fees and slippage
      const maxSolCostWithBuffer = BigInt(Math.ceil(Number(devBuyLamports) * 1.10));
      
      const { tokenOut } = quoteBuy(
        devBuyLamports,
        globalSetting.initialVirtualTokenReserves,
        globalSetting.initialVirtualSolReserves,
        globalSetting.initialRealTokenReserves
      );
      const tokenOutWithSlippage = applySlippage(tokenOut, 2); // 2% slippage for safety
      
      console.log(`🧮 Calculated token output: ${tokenOut.toString()}`);
      console.log(`🧮 Token output with slippage: ${tokenOutWithSlippage.toString()}`);
      console.log(`🧮 Max SOL cost with buffer: ${maxSolCostWithBuffer.toString()}`);
      
      // Create buy instruction
      const devBuyIx = buyInstruction(
        mintKeypair.publicKey,
        devKeypair.publicKey, // tokenCreator
        devKeypair.publicKey, // buyer
        tokenOutWithSlippage, // amount (tokens to receive)
        maxSolCostWithBuffer // maxSolCost (max SOL to spend with buffer)
      );
      instructions.push(devBuyIx);
      console.log("✅ Instruction #4: Dev buy added");
    }

    // Build and sign transaction
    console.log("📝 Building transaction...");
    const blockHash = await connection.getLatestBlockhash("confirmed");
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: devKeypair.publicKey,
        recentBlockhash: blockHash.blockhash,
        instructions: instructions,
      }).compileToV0Message()
    );

    transaction.sign([devKeypair, mintKeypair]);
    console.log("✅ Transaction signed");

    console.log("🚀 Sending transaction...");
    const maxRetries = 3;
    let txSignature: string | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`📤 Sending transaction (attempt ${attempt}/${maxRetries})...`);
        txSignature = await connection.sendTransaction(transaction, {
          maxRetries: 0,
          preflightCommitment: "confirmed",
        });
        console.log(`📤 Transaction sent: ${txSignature}`);
        break;
      } catch (error: any) {
        console.log(`❌ Attempt ${attempt} failed: ${error.message}`);
        if (attempt === maxRetries) {
          throw error;
        }
        console.log(`⏳ Retrying in 1000ms...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (!txSignature) {
      throw new Error("Failed to send transaction after all retries");
    }

    // Wait for confirmation
    console.log("⏳ Waiting for confirmation...");
    const confirmation = await connection.confirmTransaction({
      signature: txSignature,
      blockhash: blockHash.blockhash,
      lastValidBlockHeight: blockHash.lastValidBlockHeight,
    }, "confirmed");

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    console.log("✅ Transaction confirmed!");
    console.log("");
    console.log("🎉 SUCCESS!");
    console.log("==================================================");
    console.log(`🪙 Token Mint: ${mintKeypair.publicKey.toString()}`);
    console.log(`📛 Name: ${tokenName}`);
    console.log(`🏷️  Symbol: ${symbol}`);
    console.log(`📋 Metadata URI: ${metadataUri}`);
    console.log(`📋 Transaction: ${txSignature}`);
    console.log(`🔗 Explorer: https://solscan.io/tx/${txSignature}`);
    console.log(`🔗 Token: https://solscan.io/token/${mintKeypair.publicKey.toString()}`);
    console.log(`🔗 PumpFun: https://pump.fun/${mintKeypair.publicKey.toString()}`);
    if (devBuyAmount > 0) {
      console.log(`💰 Dev Buy: ${devBuyAmount} SOL completed successfully!`);
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