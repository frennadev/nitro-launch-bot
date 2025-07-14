import {
  PublicKey,
  Keypair,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getMint,
  MINT_SIZE,
} from "@solana/spl-token";
import { connection } from "../common/connection";
import { struct, u8 } from "@solana/buffer-layout";
import { u64 } from "@solana/buffer-layout-utils";
import bs58 from "bs58";

// Bonk.fun constants
const RAYDIUM_LAUNCH_LAB_PROGRAM_ID = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
const GLOBAL_CONFIG = new PublicKey("6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX");
const PLATFORM_CONFIG = new PublicKey("FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1");
const RAY_LAUNCHPAD_AUTHORITY = new PublicKey("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const RENT_PROGRAM = new PublicKey("SysvarRent111111111111111111111111111111111");
const EVENT_AUTHORITY = new PublicKey("2DPAtwB8L12vrMRExbLuyGnC7n2J5LNoZQSejeQGpwkr");

// IPFS and metadata upload utilities
import axios from "axios";
import * as fs from "fs";
import * as path from "path";

// Pinata IPFS configuration
const PINATA_API_KEY = process.env.PINATA_API_KEY || "";
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY || "";
const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

export interface CreateBonkTokenResult {
  success: boolean;
  tokenAddress?: string;
  signature?: string;
  metadataUri?: string;
  error?: string;
}

export interface BonkTokenMetadata {
  name: string;
  symbol: string;
  description: string;
  image: string;
  attributes?: Array<{
    trait_type: string;
    value: string;
  }>;
  properties?: {
    files?: Array<{
      uri: string;
      type: string;
    }>;
    category?: string;
  };
}

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
const VESTING_PARAM_LAYOUT = struct<VestingParams>([
  u64("totalLockedAmount"), 
  u64("cliffPeriod"), 
  u64("unlockPeriod")
]);

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

/**
 * Upload file to IPFS via Pinata
 */
async function uploadFileToPinata(
  fileBuffer: Buffer | ArrayBuffer,
  fileName: string
): Promise<string> {
  if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
    throw new Error("Pinata API credentials not configured");
  }

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), fileName);

  const response = await axios.post("https://api.pinata.cloud/pinning/pinFileToIPFS", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
      "pinata_api_key": PINATA_API_KEY,
      "pinata_secret_api_key": PINATA_SECRET_KEY,
    },
  });

  if (response.data.IpfsHash) {
    return response.data.IpfsHash;
  } else {
    throw new Error("Failed to upload file to IPFS");
  }
}

/**
 * Upload JSON metadata to IPFS via Pinata
 */
async function uploadJsonToPinata(
  metadata: BonkTokenMetadata,
  name: string
): Promise<string> {
  if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
    throw new Error("Pinata API credentials not configured");
  }

  const response = await axios.post(
    "https://api.pinata.cloud/pinning/pinJSONToIPFS",
    {
      pinataMetadata: {
        name: name,
      },
      pinataContent: metadata,
    },
    {
      headers: {
        "Content-Type": "application/json",
        "pinata_api_key": PINATA_API_KEY,
        "pinata_secret_api_key": PINATA_SECRET_KEY,
      },
    }
  );

  if (response.data.IpfsHash) {
    return response.data.IpfsHash;
  } else {
    throw new Error("Failed to upload metadata to IPFS");
  }
}

/**
 * Create and upload token metadata
 */
async function createTokenMetadata(
  name: string,
  symbol: string,
  description: string,
  imageBuffer: Buffer | ArrayBuffer
): Promise<string> {
  console.log("Creating Bonk token metadata...");

  // Upload image to IPFS
  const imageFileName = `bonk-token-logo-${Date.now()}.png`;
  const imageHash = await uploadFileToPinata(imageBuffer, imageFileName);
  const imageUri = `${PINATA_GATEWAY}/ipfs/${imageHash}`;
  console.log(`Image uploaded: ${imageUri}`);

  // Create metadata object
  const metadata: BonkTokenMetadata = {
    name,
    symbol,
    description,
    image: imageUri,
    properties: {
      files: [
        {
          uri: imageUri,
          type: "image/png",
        },
      ],
      category: "image",
    },
  };

  // Upload metadata to IPFS
  const metadataHash = await uploadJsonToPinata(metadata, `${name} Bonk Token Metadata`);
  const metadataUri = `${PINATA_GATEWAY}/ipfs/${metadataHash}`;
  console.log(`Metadata uploaded: ${metadataUri}`);

  return metadataUri;
}

/**
 * Encode string for transaction
 */
function encodeString(str: string) {
  const cleanStr = str.trim();
  const buffer = Buffer.alloc(4 + Buffer.byteLength(cleanStr, "utf8"));
  buffer.writeUInt32LE(Buffer.byteLength(cleanStr, "utf8"), 0);
  buffer.write(cleanStr, 4, "utf8");
  return buffer;
}

/**
 * Create token instruction for Bonk.fun
 */
const createBonkTokenInstruction = (
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
  const totalLength = instructionBuffer.length + mintParamBuffer.length + curveParamsBuffer.length + vestingParamBuffer.length;
  const data = Buffer.concat([instructionBuffer, mintParamBuffer, curveParamsBuffer, vestingParamBuffer], totalLength);

  return {
    keys,
    programId: RAYDIUM_LAUNCH_LAB_PROGRAM_ID,
    data,
  };
};

/**
 * Get unused Bonk address from database
 */
async function getUnusedBonkAddressFromDB(): Promise<Keypair | null> {
  try {
    const { BonkAddressModel } = await import("../../backend/models");
    
    const unusedAddress = await BonkAddressModel.findOne({ used: false });
    
    if (!unusedAddress) {
      console.log("No unused Bonk addresses found in database");
      return null;
    }

    // Mark as used
    await BonkAddressModel.updateOne(
      { _id: unusedAddress._id },
      { used: true, usedAt: new Date() }
    );

    const keypair = Keypair.fromSecretKey(bs58.decode(unusedAddress.privateKey));
    console.log(`Using Bonk address: ${keypair.publicKey.toString()}`);
    
    return keypair;
  } catch (error) {
    console.error("Error getting unused Bonk address:", error);
    return null;
  }
}

/**
 * Create a new token on Bonk.fun
 */
export const createBonkToken = async (
  creatorKeypair: Keypair,
  name: string,
  symbol: string,
  description: string,
  imageBuffer: Buffer | ArrayBuffer,
  config?: any
): Promise<CreateBonkTokenResult> => {
  const logId = `bonk-create-${name.substring(0, 8)}`;
  console.log(`[${logId}]: Starting Bonk.fun token creation`);
  console.log(`[${logId}]: Token Name: ${name}`);
  console.log(`[${logId}]: Token Symbol: ${symbol}`);
  console.log(`[${logId}]: Creator: ${creatorKeypair.publicKey.toBase58()}`);

  try {
    // Use unified configuration
    const { createUnifiedConfig } = await import("../common/unified-config");
    const unifiedConfig = config || createUnifiedConfig();
    const { toPriorityFeeConfig } = await import("../common/unified-config");
    const priorityFeeConfig = toPriorityFeeConfig(unifiedConfig);

    console.log(`[${logId}]: Using unified configuration for token creation`);

    // Step 1: Create and upload metadata
    console.log(`[${logId}]: Step 1 - Creating and uploading metadata...`);
    const metadataUri = await createTokenMetadata(name, symbol, description, imageBuffer);
    console.log(`[${logId}]: Metadata uploaded: ${metadataUri}`);

    // Step 2: Get token keypair from database
    console.log(`[${logId}]: Step 2 - Getting token keypair...`);
    const tokenKeypair = await getUnusedBonkAddressFromDB();
    
    if (!tokenKeypair) {
      throw new Error("No unused Bonk addresses available in database");
    }

    console.log(`[${logId}]: Token keypair obtained: ${tokenKeypair.publicKey.toString()}`);

    // Step 3: Create token parameters
    console.log(`[${logId}]: Step 3 - Creating token parameters...`);
    
    const mintParams: MintParams = {
      decimals: 6,
      name: name,
      symbol: symbol,
      uri: metadataUri,
    };

    const curveParams: CurveParams = {
      type: 0, // constant curve
      supply: BigInt(1_000_000_000_000_000), // 1 trillion tokens
      totalBaseSell: BigInt(793_100_000_000_000), // 79.31% for sale
      totalQuoteFundRaising: BigInt(85_000_000_000), // 85 SOL fundraising
      migrateType: 1,
    };

    const vestingParams: VestingParams = {
      totalLockedAmount: BigInt(0),
      cliffPeriod: BigInt(0),
      unlockPeriod: BigInt(0),
    };

    // Step 4: Create transaction
    console.log(`[${logId}]: Step 4 - Creating transaction...`);
    
    const instruction = createBonkTokenInstruction(
      creatorKeypair,
      tokenKeypair,
      mintParams,
      curveParams,
      vestingParams
    );

    // Add priority fee instruction
    const { createUnifiedPriorityFeeInstruction } = await import("../common/unified-priority-fees");
    const priorityFeeInstruction = createUnifiedPriorityFeeInstruction(priorityFeeConfig);

    const message = new TransactionMessage({
      payerKey: creatorKeypair.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
      instructions: [priorityFeeInstruction, instruction],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);
    transaction.sign([creatorKeypair, tokenKeypair]);

    // Step 5: Send transaction
    console.log(`[${logId}]: Step 5 - Sending transaction...`);
    const signature = await connection.sendTransaction(transaction, {
      maxRetries: unifiedConfig.retry.maxAttempts,
    });

    console.log(`[${logId}]: Transaction sent: ${signature}`);

    // Step 6: Wait for confirmation
    console.log(`[${logId}]: Step 6 - Waiting for confirmation...`);
    const confirmation = await connection.confirmTransaction(signature, "confirmed");
    
    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${confirmation.value.err}`);
    }

    console.log(`[${logId}]: Token creation successful: ${tokenKeypair.publicKey.toString()}`);

    return {
      success: true,
      tokenAddress: tokenKeypair.publicKey.toString(),
      signature: signature,
      metadataUri: metadataUri,
    };

  } catch (error: any) {
    console.error(`[${logId}]: Token creation failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Create Bonk token with retry logic
 */
export const createBonkTokenWithRetry = async (
  creatorKeypair: Keypair,
  name: string,
  symbol: string,
  description: string,
  imageBuffer: Buffer | ArrayBuffer,
  maxRetries: number = 3,
  config?: any
): Promise<CreateBonkTokenResult> => {
  const logId = `bonk-create-retry-${name.substring(0, 8)}`;
  console.log(`[${logId}]: Starting Bonk token creation with retry logic`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[${logId}]: Attempt ${attempt}/${maxRetries}`);
    
    try {
      const result = await createBonkToken(creatorKeypair, name, symbol, description, imageBuffer, config);
      
      if (result.success) {
        console.log(`[${logId}]: Token creation successful on attempt ${attempt}`);
        return result;
      }
      
      console.log(`[${logId}]: Attempt ${attempt} failed: ${result.error}`);
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`[${logId}]: Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
    } catch (error: any) {
      console.error(`[${logId}]: Attempt ${attempt} failed with error: ${error.message}`);
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[${logId}]: Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  return {
    success: false,
    error: `Token creation failed after ${maxRetries} attempts`,
  };
};

/**
 * Validate token creation parameters
 */
export const validateBonkTokenCreationParams = (
  name: string,
  symbol: string,
  description: string,
  imageBuffer: Buffer | ArrayBuffer
): string[] => {
  const errors: string[] = [];

  if (!name || name.trim().length === 0) {
    errors.push("Token name is required");
  } else if (name.length > 32) {
    errors.push("Token name must be 32 characters or less");
  }

  if (!symbol || symbol.trim().length === 0) {
    errors.push("Token symbol is required");
  } else if (symbol.length > 10) {
    errors.push("Token symbol must be 10 characters or less");
  }

  if (!description || description.trim().length === 0) {
    errors.push("Token description is required");
  } else if (description.length > 500) {
    errors.push("Token description must be 500 characters or less");
  }

  if (!imageBuffer || imageBuffer.byteLength === 0) {
    errors.push("Token image is required");
  } else if (imageBuffer.byteLength > 20 * 1024 * 1024) {
    errors.push("Token image must be 20MB or less");
  }

  return errors;
}; 