import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import readline from "readline";

import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { struct, u8 } from "@solana/buffer-layout";
import bs58 from "bs58";
// @ts-ignore
import { u64 } from "@solana/buffer-layout-utils";

import { promisify } from "util";
import { exec } from "child_process";
// import { formatTokenLink } from "../utils/helpers";
// import { archiveAddress } from "./address-archive-manager";
// import { isBooleanObject } from "util/types";
// import secret from "../config/secret-config";
import { BonkAddressModel } from "../../backend/models";
import { env } from "../../config";
import { archiveAddress, formatTokenLink, uploadFileToPinata, uploadJsonToPinata } from "../../backend/utils";
import { getDevWallet } from "../../backend/functions";
import { LaunchDestination } from "../../backend/types";

const execAsync = promisify(exec);

// Constants for Solana integration
const RAYDIUM_LAUNCH_LAB_PROGRAM_ID = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
const GLOBAL_CONFIG = new PublicKey("6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX");
const PLATFORM_CONFIG = new PublicKey("FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1");
const RAY_LAUNCHPAD_AUTHORITY = new PublicKey("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const RENT_PROGRAM = new PublicKey("SysvarRent111111111111111111111111111111111");
const EVENT_AUTHORITY = new PublicKey("2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr");

// Pinata configuration
const PINATA_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiIzZTk3Njg2Yy02NTgwLTRjMDctYjRhOS1hNTkzMDU0MWQ5ODkiLCJlbWFpbCI6Im9sdWJvZHVudG9iaTFAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBpbl9wb2xpY3kiOnsicmVnaW9ucyI6W3siZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiRlJBMSJ9LHsiZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiTllDMSJ9XSwidmVyc2lvbiI6MX0sIm1mYV9lbmFibGVkIjpmYWxzZSwic3RhdHVzIjoiQUNUSVZFIn0sImF1dGhlbnRpY2F0aW9uVHlwZSI6InNjb3BlZEtleSIsInNjb3BlZEtleUtleSI6IjQ4NGFmMjg3ODRkZDE5OWFlMjkzIiwic2NvcGVkS2V5U2VjcmV0IjoiNzFhMmUyODQ5MzJlOTA3N2QyNWRlN2IwNTVjYjZiNjE5ZGUwN2U5OTI3MmIwMmMzNDUwZmRlMTE5YjM5MDVjYSIsImV4cCI6MTc3ODk1NjMxMX0.0HhCVh-QLrKUnFVKMweS55IEGpxXCVb-R0aOEwV8XnU";
const PINATA_API_URL = "https://api.pinata.cloud/pinning";
const PINATA_GATEWAY = "https://letsbonk-bob.mypinata.cloud";

// Fixed wallet for funding transactions
const WALLET_PRIVATE_KEY = "36j9cP13yCP9ZBNqPoWT9R8BKAc5RANBdc1BDnrrGnZKk87WXFdy2Y2TL5T8k9GTdrvAfeRbJwfNac5o9ETqxE9X";

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

// Layouts for token parameters
const VESTING_PARAM_LAYOUT = struct<VestingParams>([u64("totalLockedAmount"), u64("cliffPeriod"), u64("unlockPeriod")]);

const CURVE_PARAM_LAYOUT = struct<CurveParams>([
  u8("type"),
  u64("supply"),
  u64("totalBaseSell"),
  u64("totalQuoteFundRaising"),
  u8("migrateType"),
]);

interface InitializeInstructionData {
  instruction: bigint;
}

const INITIALIZE_INSTRUCTION_LAYOUT = struct<InitializeInstructionData>([u64("instruction")]);

// Get wallet from private key
function getWallet() {
  return Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY));
}

// Prompt user for input
const askQuestion = async (question: string): Promise<string> => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

// Encode string for transaction
function encodeString(str: string) {
  const cleanStr = str.trim();
  const buffer = Buffer.alloc(4 + Buffer.byteLength(cleanStr, "utf8"));
  buffer.writeUInt32LE(Buffer.byteLength(cleanStr, "utf8"), 0);
  buffer.write(cleanStr, 4, "utf8");
  return buffer;
}

// Create token instruction
const createTokenInstruction = (
  payer: Keypair,
  token: Keypair,
  mintParams: MintParams,
  curveParams: CurveParams,
  vestingParams: VestingParams
) => {
  const [metadataPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), token.publicKey.toBuffer()],
    METADATA_PROGRAM
  );
  const [poolPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from([112, 111, 111, 108]), token.publicKey.toBuffer(), WSOL_MINT.toBuffer()],
    RAYDIUM_LAUNCH_LAB_PROGRAM_ID
  );
  const [baseVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from([112, 111, 111, 108, 95, 118, 97, 117, 108, 116]), poolPDA.toBuffer(), token.publicKey.toBuffer()],
    RAYDIUM_LAUNCH_LAB_PROGRAM_ID
  );
  const [quoteVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from([112, 111, 111, 108, 95, 118, 97, 117, 108, 116]), poolPDA.toBuffer(), WSOL_MINT.toBuffer()],
    RAYDIUM_LAUNCH_LAB_PROGRAM_ID
  );

  console.log("Using name in instruction:", mintParams.name);

  const keys = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: false },
    { pubkey: PLATFORM_CONFIG, isSigner: false, isWritable: false },
    { pubkey: RAY_LAUNCHPAD_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: poolPDA, isSigner: false, isWritable: true },
    { pubkey: token.publicKey, isSigner: true, isWritable: true },
    { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
    { pubkey: baseVaultPDA, isSigner: false, isWritable: true },
    { pubkey: quoteVaultPDA, isSigner: false, isWritable: true },
    { pubkey: metadataPDA, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: METADATA_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: RENT_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
    {
      pubkey: RAYDIUM_LAUNCH_LAB_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    },
  ];
  const instructionBuffer = Buffer.alloc(INITIALIZE_INSTRUCTION_LAYOUT.span);
  INITIALIZE_INSTRUCTION_LAYOUT.encode(
    {
      instruction: Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]).readBigUInt64LE(),
    },
    instructionBuffer
  );

  // Mint Params
  const decimalBuffer = Buffer.from([mintParams.decimals]);
  const nameBuffer = encodeString(mintParams.name);
  const symbolBuffer = encodeString(mintParams.symbol);
  const uriBuffer = encodeString(mintParams.uri);
  const mintParamLength = decimalBuffer.length + nameBuffer.length + symbolBuffer.length + uriBuffer.length;
  const mintParamBuffer = Buffer.concat([decimalBuffer, nameBuffer, symbolBuffer, uriBuffer], mintParamLength);

  // Curve Params
  const curveParamsBuffer = Buffer.alloc(CURVE_PARAM_LAYOUT.span);
  CURVE_PARAM_LAYOUT.encode({ ...curveParams }, curveParamsBuffer);

  // Vesting Params
  const vestingParamBuffer = Buffer.alloc(VESTING_PARAM_LAYOUT.span);
  VESTING_PARAM_LAYOUT.encode({ ...vestingParams }, vestingParamBuffer);

  // Final Data
  const totalLength =
    instructionBuffer.length + mintParamBuffer.length + curveParamsBuffer.length + vestingParamBuffer.length;
  const data = Buffer.concat([instructionBuffer, mintParamBuffer, curveParamsBuffer, vestingParamBuffer], totalLength);
  return new TransactionInstruction({
    keys,
    programId: RAYDIUM_LAUNCH_LAB_PROGRAM_ID,
    data,
  });
};

async function getTokenKeypair(): Promise<Keypair> {
  const configFile = "./bonk-config.json";

  try {
    const wallet = await BonkAddressModel.findOne({});
    return Keypair.fromSecretKey(bs58.decode(wallet!.secretKey));
  } catch (error) {
    console.error("Error loading bonk address config:", error);
  }

  // No bonk address configured, generate a random one
  const randomKeypair = Keypair.generate();
  console.log(`Generated random token address: ${randomKeypair.publicKey.toString()}`);
  return randomKeypair;
}

async function getUnusedBonkAddressFromDB() {
  try {
    const unusedAddresses = await BonkAddressModel.find({
      isBonk: true,
      isUsed: false,
    })
      .sort({ createdAt: -1 })
      .limit(1);

    if (unusedAddresses.length === 0) {
      console.log("No unused bonk addresses found in the database.");
      console.log("Generating a new bonk address...");

      // Try to generate a new bonk address
      try {
        await execAsync("npx bun src/bonk-address-finder.ts");
        const newAddresses = await BonkAddressModel.find({
          isBonk: true,
          isUsed: false,
        })
          .sort({ createdAt: -1 })
          .limit(1);

        if (newAddresses.length === 0) {
          throw new Error("Failed to generate a new bonk address");
        }
        await BonkAddressModel.updateOne({ _id: newAddresses[0]._id }, { selected: true, isUsed: true });

        return Keypair.fromSecretKey(bs58.decode(newAddresses[0]!.secretKey));
      } catch (error) {
        console.error("Error generating new bonk address:", error);
        return null;
      }
    }

    await BonkAddressModel.updateOne({ _id: unusedAddresses[0]._id }, { selected: true, isUsed: true });
    return Keypair.fromSecretKey(bs58.decode(unusedAddresses[0]!.secretKey));
  } catch (error) {
    console.error("Error accessing database:", error);
    return null;
  }
}

// Main token creation function - Modified to separate metadata upload from launch
export async function createBonkToken(
  tokenName: string,
  ticker: string,
  image: string,
  hasMedia: boolean,
  userId: string
) {
  try {
    console.log("=== Bonk Token Creation (Metadata Only) ===");
    console.log("===========================================");

    console.log("\nStep 1: Collecting token information...");
    const name = tokenName;
    const symbol = ticker;
    const imagePath = image;

    let imageUri = "";
    if (hasMedia) {
      if (/^https?:\/\//i.test(imagePath)) {
        console.log("\nStep 2: Downloading and uploading logo to IPFS...");
        
        // Download image as ArrayBuffer (same approach as PumpFun)
        const response = await axios.get(imagePath, { responseType: "arraybuffer" });
        
        // Get file extension from URL or default to .png
        const ext = path.extname(imagePath) || ".png";
        const fileName = `token-logo-${Date.now()}${ext}`;
        
        // Upload directly to IPFS without saving to local file
        const imageHash = await uploadFileToPinata(response.data, fileName);
        imageUri = `${PINATA_GATEWAY}/ipfs/${imageHash}`;
        
        console.log(`Logo uploaded successfully: ${imageUri}`);
      } else {
        // If it's already a local path (shouldn't happen in this context)
        throw new Error("Local image paths are not supported in this implementation");
      }
    }

    // Step 3: Create and upload metadata
    console.log("\nStep 3: Creating and uploading metadata...");
    const metadata = {
      name,
      symbol,
      description: `${name} Token`,
      image: imageUri,
      properties: {
        files: [
          {
            uri: imageUri,
            type: `image/${path.extname(imagePath).substring(1)}`,
          },
        ],
        category: "image",
      },
    };

    const metadataHash = await uploadJsonToPinata(metadata, `${name} Metadata`);
    const metadataUri = `${PINATA_GATEWAY}/ipfs/${metadataHash}`;

    console.log(`Metadata uploaded successfully: ${metadataUri}`);

    // Step 4: Get token keypair (either configured bonk address or random)
    console.log("\nStep 4: Getting token keypair...");
    const tokenKeypair = await getUnusedBonkAddressFromDB();

    if (!tokenKeypair) {
      throw new Error("keypair not found");
    }

    // Token keypair is already saved to database, no need for local file
    console.log(`Token keypair obtained: ${tokenKeypair.publicKey.toString()}`);

    // Step 5: Create token record in database (without launching)
    console.log("\nStep 5: Creating token record in database...");
    
    // Import required modules
    const { TokenModel } = await import("../../backend/models");
    const { encryptPrivateKey } = await import("../../backend/utils");
    const { getDefaultDevWallet } = await import("../../backend/functions");
    
    // Get default dev wallet for the user
    const devWalletAddress = await getDefaultDevWallet(userId);
    const { WalletModel } = await import("../../backend/models");
    const devWallet = await WalletModel.findOne({ 
      user: userId, 
      publicKey: devWalletAddress,
      isDev: true 
    });

    if (!devWallet) {
      throw new Error("Default dev wallet not found");
    }

    // Create token record in database (similar to PumpFun createToken function)
    const token = await TokenModel.create({
      user: userId,
      name,
      symbol,
      description: `${name} Token`,
      launchData: {
        devWallet: devWallet.id,
        destination: LaunchDestination.LETSBONK, // Set destination to letsbonk
      },
      tokenAddress: tokenKeypair.publicKey.toString(),
      tokenPrivateKey: encryptPrivateKey(bs58.encode(tokenKeypair.secretKey)),
      tokenMetadataUrl: metadataUri,
      // State will default to LISTED (not launched yet)
    });

    console.log("\n=== TOKEN CREATION COMPLETE (Metadata Only) ===");
    console.log(`Token address: ${tokenKeypair.publicKey.toString()}`);
    console.log(`Token name: ${name}`);
    console.log(`Token symbol: ${symbol}`);
    console.log(`Metadata URI: ${metadataUri}`);
    console.log(`Token record created in database with ID: ${token._id}`);

    const formattedLink = formatTokenLink(tokenKeypair.publicKey.toString());
    console.log(`Future trading link: ${formattedLink}`);

    // Archive the address for tracking
    await archiveAddress(tokenKeypair.publicKey.toString(), name, symbol, "PENDING_LAUNCH");

    return {
      tokenAddress: tokenKeypair.publicKey.toString(),
      tokenName: name,
      tokenSymbol: symbol,
      description: `${name} Token`,
      metadataUri,
      link: formattedLink,
      // Note: No transaction signature since we're not launching yet
    };

  } catch (error) {
    console.error("Error creating Bonk token (metadata only):", error);
    throw error;
  }
}

// Launch function for Bonk tokens (separate from creation)
export async function launchBonkToken(
  tokenAddress: string,
  userId: string,
  devBuy: number = 0 // Add devBuy parameter
) {
  try {
    console.log("=== Bonk Token Launch ===");
    console.log("========================");

    // Import required modules
    const { TokenModel } = await import("../../backend/models");
    const { decryptPrivateKey } = await import("../../backend/utils");
    const { getDevWallet } = await import("../../backend/functions");

    // Get token from database
    const token = await TokenModel.findOne({ 
      tokenAddress, 
      user: userId 
    });

    if (!token) {
      throw new Error("Token not found in database");
    }

    console.log(`Launching token: ${token.name} (${token.symbol})`);
    console.log(`Token address: ${tokenAddress}`);
    console.log(`Dev buy amount: ${devBuy} SOL`);

    // Get dev wallet for funding
    console.log("\nLoading wallet for funding...");
    const devWalletPrivateKey = await getDevWallet(userId);
    const wallet = Keypair.fromSecretKey(bs58.decode(devWalletPrivateKey.wallet));

    console.log(`Using wallet address for funding: ${wallet.publicKey.toString()}`);

    // Decrypt token private key
    const tokenPrivateKey = decryptPrivateKey(token.tokenPrivateKey);
    const tokenKeypair = Keypair.fromSecretKey(bs58.decode(tokenPrivateKey));

    console.log("\nStep 1: Creating Solana token...");

    // Create mint params
    const mintParams: MintParams = {
      decimals: 6,
      name: token.name,
      symbol: token.symbol,
      uri: token.tokenMetadataUrl,
    };

    const curveParams: CurveParams = {
      type: 0, // constant curve
      supply: BigInt(1_000_000_000_000_000),
      totalBaseSell: BigInt(793_100_000_000_000),
      totalQuoteFundRaising: BigInt(85_000_000_000),
      migrateType: 1,
    };

    const vestingParams: VestingParams = {
      totalLockedAmount: BigInt(0),
      cliffPeriod: BigInt(0),
      unlockPeriod: BigInt(0),
    };

    // Create transaction
    console.log("Creating token transaction...");
    const instruction = createTokenInstruction(wallet, tokenKeypair, mintParams, curveParams, vestingParams);

    // Get fresh blockhash
    const connection = new Connection(env.UTILS_HELIUS_RPC, "confirmed");
    const blockHash = await connection.getLatestBlockhash("finalized");
    console.log("Got fresh blockhash, creating transaction...");

    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockHash.blockhash,
        instructions: [instruction],
      }).compileToV0Message()
    );

    // Sign transaction with both wallets
    tx.sign([wallet, tokenKeypair]);

    console.log("Sending transaction to network...");

    try {
      // Send the transaction
      const signature = await connection.sendTransaction(tx, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 5,
      });

      console.log("\n=== BONK TOKEN LAUNCH COMPLETE ===");
      console.log(`Transaction signature: ${signature}`);
      console.log(`Token address: ${tokenAddress}`);
      console.log(`Token name: ${token.name}`);
      console.log(`Token symbol: ${token.symbol}`);
      console.log(`Metadata URI: ${token.tokenMetadataUrl}`);

      // Step 2: Execute dev buy if specified
      let devBuySignature: string | undefined;
      if (devBuy > 0) {
        console.log(`\nStep 2: Executing dev buy of ${devBuy} SOL...`);
        
        try {
          // Wait a moment for the token creation to propagate
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Import required modules for dev buy
          const { VersionedTransaction, TransactionMessage, ComputeBudgetProgram, PublicKey, SystemProgram } = await import("@solana/web3.js");
          const { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, NATIVE_MINT, createSyncNativeInstruction, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
          const { getBonkPoolState } = await import("../../service/bonk-pool-service");
          
          // Get Bonk pool state for this token
          const poolState = await getBonkPoolState(tokenAddress);
          if (!poolState) {
            throw new Error(`No Bonk pool found for token ${tokenAddress}`);
          }
          
          console.log(`Found Bonk pool: ${poolState.poolId.toString()}`);
          
          // Create WSOL and token ATAs for dev wallet
          const devWsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey);
          const devTokenAta = getAssociatedTokenAddressSync(new PublicKey(tokenAddress), wallet.publicKey);
          
          // Create ATA instructions
          const devWsolAtaIx = createAssociatedTokenAccountIdempotentInstruction(
            wallet.publicKey,
            devWsolAta,
            wallet.publicKey,
            NATIVE_MINT
          );
          const devTokenAtaIx = createAssociatedTokenAccountIdempotentInstruction(
            wallet.publicKey,
            devTokenAta,
            wallet.publicKey,
            new PublicKey(tokenAddress)
          );
          
          // Convert dev buy amount to lamports
          const devBuyLamports = BigInt(Math.ceil(devBuy * 1_000_000_000));
          
          // Transfer SOL to WSOL account
          const transferSolIx = SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: devWsolAta,
            lamports: Number(devBuyLamports),
          });
          
          // Sync native instruction to convert SOL to WSOL
          const syncNativeIx = createSyncNativeInstruction(devWsolAta);
          
          // Create Bonk buy instruction for dev wallet
          const devBuyIx = await createBonkBuyInstruction({
            pool: poolState,
            payer: wallet.publicKey,
            userBaseAta: devTokenAta,
            userQuoteAta: devWsolAta,
            amount_in: devBuyLamports,
            minimum_amount_out: BigInt(1), // Minimum 1 token
          });
          
          // Add priority fee instruction
          const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: 2_000_000, // High priority for dev buy
          });
          
          // Get fresh blockhash for dev buy
          const devBuyBlockHash = await connection.getLatestBlockhash("processed");
          
          // Create dev buy transaction
          const devBuyTx = new VersionedTransaction(
            new TransactionMessage({
              instructions: [
                addPriorityFee,
                devWsolAtaIx,
                devTokenAtaIx,
                transferSolIx,
                syncNativeIx,
                devBuyIx
              ],
              payerKey: wallet.publicKey,
              recentBlockhash: devBuyBlockHash.blockhash,
            }).compileToV0Message(),
          );
          devBuyTx.sign([wallet]);
          
          // Send dev buy transaction
          devBuySignature = await connection.sendTransaction(devBuyTx, {
            skipPreflight: false,
            preflightCommitment: "processed",
            maxRetries: 3
          });
          
          // Wait for confirmation
          const confirmation = await connection.confirmTransaction({
            signature: devBuySignature,
            blockhash: devBuyBlockHash.blockhash,
            lastValidBlockHeight: devBuyBlockHash.lastValidBlockHeight
          }, "processed");
          
          if (confirmation.value.err) {
            throw new Error(`Dev buy transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }
          
          console.log(`✅ Dev buy successful! Signature: ${devBuySignature}`);
          console.log(`Dev wallet bought tokens with ${devBuy} SOL`);
          
          // Record the dev buy transaction
          const { recordTransaction } = await import("../../backend/functions");
          await recordTransaction(
            tokenAddress,
            wallet.publicKey.toString(),
            "dev_buy",
            devBuySignature,
            true,
            token.launchData?.launchAttempt || 1,
            {
              amountSol: devBuy,
              errorMessage: undefined,
            }
          );
          
        } catch (devBuyError: any) {
          console.error(`❌ Dev buy failed: ${devBuyError.message}`);
          console.log("Continuing with launch process...");
          
          // Record the failed dev buy transaction
          const { recordTransaction } = await import("../../backend/functions");
          await recordTransaction(
            tokenAddress,
            wallet.publicKey.toString(),
            "dev_buy",
            "FAILED",
            false,
            token.launchData?.launchAttempt || 1,
            {
              amountSol: devBuy,
              errorMessage: devBuyError.message,
            }
          );
        }
      }

      const formattedLink = formatTokenLink(tokenAddress);
      console.log(formattedLink);

      // Update token state in database
      await TokenModel.updateOne(
        { _id: token._id },
        { 
          state: "launched",
          "launchData.launchAttempt": (token.launchData?.launchAttempt || 0) + 1,
          "launchData.devBuySignature": devBuySignature // Store dev buy signature if successful
        }
      );

      // Archive the address with the actual transaction signature
      await archiveAddress(tokenAddress, token.name, token.symbol, signature);

      return {
        transaction: signature,
        devBuySignature: devBuySignature,
        tokenAddress,
        tokenName: token.name,
        tokenSymbol: token.symbol,
        link: formattedLink,
        metadataUri: token.tokenMetadataUrl,
      };
    } catch (error) {
      console.error("\nTransaction failed.");
      console.error("Error details:", error);

      // Update token state to reflect failure
      await TokenModel.updateOne(
        { _id: token._id },
        { state: "listed" } // Keep as listed for retry
      );

      throw error;
    }
  } catch (error) {
    console.error("Error launching Bonk token:", error);
    throw error;
  }
}

// Helper function to create Bonk buy instruction (same as in functions.ts)
async function createBonkBuyInstruction({
  pool,
  payer,
  userBaseAta,
  userQuoteAta,
  amount_in,
  minimum_amount_out,
}: {
  pool: any;
  payer: PublicKey;
  userBaseAta: PublicKey;
  userQuoteAta: PublicKey;
  amount_in: bigint;
  minimum_amount_out: bigint;
}) {
  const { TransactionInstruction, PublicKey } = await import("@solana/web3.js");
  const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
  
  // Bonk program constants
  const BONK_PROGRAM_ID = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
  const raydim_authority = new PublicKey("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh");
  const global_config = new PublicKey("6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX");
  const platform_config = new PublicKey("FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1");
  const event_authority = new PublicKey("2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr");
  
  // Buy instruction discriminator (Bonk program, not PumpFun)
  const BUY_DISCRIMINATOR = Buffer.from([250, 234, 13, 123, 213, 156, 19, 236]);
  
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: raydim_authority, isSigner: false, isWritable: false },
    { pubkey: global_config, isSigner: false, isWritable: false },
    { pubkey: platform_config, isSigner: false, isWritable: false },
    { pubkey: pool.poolId, isSigner: false, isWritable: true },
    { pubkey: userBaseAta, isSigner: false, isWritable: true },
    { pubkey: userQuoteAta, isSigner: false, isWritable: true },
    { pubkey: pool.baseVault, isSigner: false, isWritable: true },
    { pubkey: pool.quoteVault, isSigner: false, isWritable: true },
    { pubkey: pool.baseMint, isSigner: false, isWritable: true },
    { pubkey: pool.quoteMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: event_authority, isSigner: false, isWritable: false },
    { pubkey: BONK_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = Buffer.alloc(32);
  const discriminator = Buffer.from(BUY_DISCRIMINATOR);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(amount_in, 8);
  data.writeBigUInt64LE(minimum_amount_out, 16);
  data.writeBigUInt64LE(BigInt(0), 24); // share fee rate

  return new TransactionInstruction({
    keys,
    programId: BONK_PROGRAM_ID,
    data,
  });
}

// // Execute the token creation process
// createToken()
//   .then(() => {
//     console.log("\nProcess completed!");
//   })
//   .catch((err) => {
//     console.error("\nFailed to complete token creation:", err);
//   });
