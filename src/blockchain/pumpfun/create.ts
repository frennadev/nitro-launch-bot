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
import { tokenCreateInstruction } from "./instructions";
import { getBondingCurve, getCreatorVault, getMetadataPDA } from "./utils";
import {
  PUMPFUN_PROGRAM,
  PUMPFUN_GLOBAL_SETTINGS,
  PUMPFUN_MINT_AUTHORITY,
  PUMPFUN_EVENT_AUTHORITY,
  TOKEN_METADATA_PROGRAM,
  MAESTRO_FEE_ACCOUNT,
  MAESTRO_FEE_AMOUNT,
  PLATFORM_FEE_WALLET,
  DEFAULT_PLATFORM_FEE_PERCENTAGE,
} from "./constants";
import { CreateCodec } from "./codecs";
import { createUnifiedConfig, toPriorityFeeConfig } from "../common/unified-config";
import { createUnifiedPriorityFeeInstruction } from "../common/unified-priority-fees";

// IPFS and metadata upload utilities
import axios from "axios";
import * as fs from "fs";
import * as path from "path";

// Pinata IPFS configuration
const PINATA_API_KEY = process.env.PINATA_API_KEY || "";
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY || "";
const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs";

export interface CreateTokenResult {
  success: boolean;
  tokenAddress?: string;
  signature?: string;
  metadataUri?: string;
  error?: string;
}

export interface TokenMetadata {
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
  metadata: TokenMetadata,
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
  console.log("Creating token metadata...");

  // Upload image to IPFS
  const imageFileName = `token-logo-${Date.now()}.png`;
  const imageHash = await uploadFileToPinata(imageBuffer, imageFileName);
  const imageUri = `${PINATA_GATEWAY}/ipfs/${imageHash}`;
  console.log(`Image uploaded: ${imageUri}`);

  // Create metadata object
  const metadata: TokenMetadata = {
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
  const metadataHash = await uploadJsonToPinata(metadata, `${name} Metadata`);
  const metadataUri = `${PINATA_GATEWAY}/ipfs/${metadataHash}`;
  console.log(`Metadata uploaded: ${metadataUri}`);

  return metadataUri;
}

/**
 * Create a new token on PumpFun
 */
export const createPumpFunToken = async (
  creatorKeypair: Keypair,
  name: string,
  symbol: string,
  description: string,
  imageBuffer: Buffer | ArrayBuffer,
  config?: any
): Promise<CreateTokenResult> => {
  const logId = `pumpfun-create-${name.substring(0, 8)}`;
  console.log(`[${logId}]: Starting PumpFun token creation`);
  console.log(`[${logId}]: Token Name: ${name}`);
  console.log(`[${logId}]: Token Symbol: ${symbol}`);
  console.log(`[${logId}]: Creator: ${creatorKeypair.publicKey.toBase58()}`);

  try {
    // Use unified configuration
    const unifiedConfig = config || createUnifiedConfig();
    const priorityFeeConfig = toPriorityFeeConfig(unifiedConfig);

    // Step 1: Create token mint
    console.log(`[${logId}]: Creating token mint...`);
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey;
    console.log(`[${logId}]: Token mint: ${mint.toBase58()}`);

    // Step 2: Upload metadata to IPFS
    console.log(`[${logId}]: Uploading metadata to IPFS...`);
    const metadataUri = await createTokenMetadata(name, symbol, description, imageBuffer);
    console.log(`[${logId}]: Metadata URI: ${metadataUri}`);

    // Step 3: Check creator balance
    const creatorBalance = await connection.getBalance(creatorKeypair.publicKey, "confirmed");
    const estimatedFee = 0.01 * LAMPORTS_PER_SOL; // Estimated transaction fee
    
    if (creatorBalance < estimatedFee) {
      return {
        success: false,
        error: `Insufficient balance: ${creatorBalance / LAMPORTS_PER_SOL} SOL available, need at least 0.01 SOL for fees`
      };
    }

    console.log(`[${logId}]: Creator balance: ${creatorBalance / LAMPORTS_PER_SOL} SOL`);

    // Step 4: Create transaction instructions
    console.log(`[${logId}]: Creating transaction instructions...`);

    // Priority fee instruction
    const priorityFeeIx = createUnifiedPriorityFeeInstruction(0, priorityFeeConfig);
    console.log(`[${logId}]: Priority fee instruction created`);

    // Compute budget instruction
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 200000, // Higher compute units for token creation
    });
    console.log(`[${logId}]: Compute budget instruction created`);

    // Create mint instruction
    const createMintIx = createMint(
      creatorKeypair.publicKey,
      MINT_SIZE,
      6, // Decimals (PumpFun tokens typically use 6 decimals)
      creatorKeypair.publicKey,
      creatorKeypair.publicKey,
      [creatorKeypair, mintKeypair]
    );
    console.log(`[${logId}]: Create mint instruction created`);

    // Create ATA for creator
    const creatorAta = getAssociatedTokenAddressSync(mint, creatorKeypair.publicKey);
    const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      creatorKeypair.publicKey,
      creatorAta,
      creatorKeypair.publicKey,
      mint
    );
    console.log(`[${logId}]: Create ATA instruction created`);

    // PumpFun token creation instruction
    const tokenCreateIx = tokenCreateInstruction(
      mint,
      creatorKeypair.publicKey,
      metadataUri,
      name,
      symbol
    );
    console.log(`[${logId}]: Token creation instruction created`);

    // Maestro fee transfer
    const maestroFeeIx = SystemProgram.transfer({
      fromPubkey: creatorKeypair.publicKey,
      toPubkey: MAESTRO_FEE_ACCOUNT,
      lamports: Number(MAESTRO_FEE_AMOUNT),
    });
    console.log(`[${logId}]: Maestro fee instruction created`);

    // Platform fee transfer
    const platformFeeAmount = Math.ceil(0.01 * LAMPORTS_PER_SOL * unifiedConfig.fees.platformPercentage / 100);
    const platformFeeIx = SystemProgram.transfer({
      fromPubkey: creatorKeypair.publicKey,
      toPubkey: PLATFORM_FEE_WALLET,
      lamports: platformFeeAmount,
    });
    console.log(`[${logId}]: Platform fee instruction created`);

    // Combine all instructions
    const instructions = [
      priorityFeeIx,
      computeBudgetIx,
      createMintIx,
      createAtaIx,
      tokenCreateIx,
      maestroFeeIx,
      platformFeeIx,
    ];

    // Step 5: Create and send transaction
    console.log(`[${logId}]: Creating transaction...`);
    const blockhash = await connection.getLatestBlockhash("processed");
    console.log(`[${logId}]: Latest blockhash: ${blockhash.blockhash}`);

    const tx = new VersionedTransaction(
      new TransactionMessage({
        instructions,
        payerKey: creatorKeypair.publicKey,
        recentBlockhash: blockhash.blockhash,
      }).compileToV0Message()
    );

    // Sign with both creator and mint keypairs
    tx.sign([creatorKeypair, mintKeypair]);
    console.log(`[${logId}]: Transaction signed`);

    // Send transaction
    console.log(`[${logId}]: Sending transaction...`);
    const signature = await connection.sendTransaction(tx, {
      skipPreflight: false,
      preflightCommitment: "processed",
    });
    console.log(`[${logId}]: Transaction sent with signature: ${signature}`);

    // Wait for confirmation
    console.log(`[${logId}]: Waiting for confirmation...`);
    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash: blockhash.blockhash,
        lastValidBlockHeight: blockhash.lastValidBlockHeight,
      },
      "confirmed"
    );

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    console.log(`[${logId}]: Token creation successful!`);
    console.log(`[${logId}]: Token Address: ${mint.toBase58()}`);
    console.log(`[${logId}]: Metadata URI: ${metadataUri}`);

    return {
      success: true,
      tokenAddress: mint.toBase58(),
      signature,
      metadataUri,
    };

  } catch (error: any) {
    console.error(`[${logId}]: Token creation failed:`, error);
    return {
      success: false,
      error: error.message || "Unknown error occurred during token creation",
    };
  }
};

/**
 * Create token with retry logic
 */
export const createPumpFunTokenWithRetry = async (
  creatorKeypair: Keypair,
  name: string,
  symbol: string,
  description: string,
  imageBuffer: Buffer | ArrayBuffer,
  maxRetries: number = 3,
  config?: any
): Promise<CreateTokenResult> => {
  const logId = `pumpfun-create-retry-${name.substring(0, 8)}`;
  console.log(`[${logId}]: Starting token creation with retry logic (max ${maxRetries} attempts)`);

  let lastError: string = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[${logId}]: Attempt ${attempt}/${maxRetries}`);

    const result = await createPumpFunToken(
      creatorKeypair,
      name,
      symbol,
      description,
      imageBuffer,
      config
    );

    if (result.success) {
      console.log(`[${logId}]: Token creation successful on attempt ${attempt}`);
      return result;
    }

    lastError = result.error || "Unknown error";
    console.error(`[${logId}]: Attempt ${attempt} failed: ${lastError}`);

    if (attempt < maxRetries) {
      const delay = attempt * 2000; // 2s, 4s, 6s delays
      console.log(`[${logId}]: Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.error(`[${logId}]: All ${maxRetries} attempts failed`);
  return {
    success: false,
    error: `Token creation failed after ${maxRetries} attempts. Last error: ${lastError}`,
  };
};

/**
 * Validate token creation parameters
 */
export const validateTokenCreationParams = (
  name: string,
  symbol: string,
  description: string,
  imageBuffer: Buffer | ArrayBuffer
): string[] => {
  const errors: string[] = [];

  // Validate name
  if (!name || name.trim().length === 0) {
    errors.push("Token name is required");
  } else if (name.length > 32) {
    errors.push("Token name must be 32 characters or less");
  }

  // Validate symbol
  if (!symbol || symbol.trim().length === 0) {
    errors.push("Token symbol is required");
  } else if (symbol.length > 10) {
    errors.push("Token symbol must be 10 characters or less");
  }

  // Validate description
  if (!description || description.trim().length === 0) {
    errors.push("Token description is required");
  } else if (description.length > 200) {
    errors.push("Token description must be 200 characters or less");
  }

  // Validate image
  if (!imageBuffer || imageBuffer.byteLength === 0) {
    errors.push("Token image is required");
  } else if (imageBuffer.byteLength > 5 * 1024 * 1024) { // 5MB limit
    errors.push("Token image must be 5MB or less");
  }

  return errors;
}; 