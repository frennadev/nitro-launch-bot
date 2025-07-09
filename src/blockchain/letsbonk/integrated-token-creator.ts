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
import { archiveAddress, formatTokenLink } from "../../backend/utils";

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

// Upload file to IPFS via Pinata
async function uploadFileToPinata(filePath: string, fileName: string) {
  try {
    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath));

    const metadata = JSON.stringify({
      name: fileName,
    });
    formData.append("pinataMetadata", metadata);

    const options = JSON.stringify({
      cidVersion: 0,
    });
    formData.append("pinataOptions", options);

    const res = await axios.post(`${PINATA_API_URL}/pinFileToIPFS`, formData, {
      maxBodyLength: Infinity,
      headers: {
        "Content-Type": `multipart/form-data; boundary=${formData.getBoundary()}`,
        Authorization: `Bearer ${PINATA_JWT}`,
      },
    });

    return res.data.IpfsHash;
  } catch (error) {
    console.error("Error uploading file to Pinata:", error);
    throw error;
  }
}

// Upload JSON to IPFS via Pinata
async function uploadJsonToPinata(jsonData: any, name: string) {
  try {
    const data = JSON.stringify({
      pinataOptions: {
        cidVersion: 0,
      },
      pinataMetadata: {
        name,
      },
      pinataContent: jsonData,
    });

    const res = await axios.post(`${PINATA_API_URL}/pinJSONToIPFS`, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PINATA_JWT}`,
      },
    });

    return res.data.IpfsHash;
  } catch (error) {
    console.error("Error uploading JSON to Pinata:", error);
    throw error;
  }
}

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
        await execAsync("npx bun bonk-address-finder.ts");
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

// Main token creation function
export async function createBonkToken(tokenName: string, ticker: string, image: string, hasMedia: boolean) {
  try {
    console.log("=== Solana Token Creation ===");
    console.log("============================");

    console.log("\nLoading wallet for funding...");
    const wallet = getWallet();
    console.log(`Using wallet address for funding: ${wallet.publicKey.toString()}`);

    console.log("\nStep 1: Collecting token information...");
    const name = tokenName;
    const symbol = ticker;
    const imagePath = image;

    async function fetchAndSaveImage(url: string, outputPath: string): Promise<void> {
      const response = await axios.get(url, { responseType: "stream" });
      const writer = fs.createWriteStream(outputPath);

      return new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
      });
    }

    let imageUri = "";
    if (hasMedia) {
      let localImagePath = imagePath;
      if (/^https?:\/\//i.test(imagePath)) {
        const ext = path.extname(imagePath) || ".png";
        const fileName = `downloaded-token-logo${Math.floor(Math.random() * 1000)}${ext}`;
        localImagePath = path.join(__dirname, fileName);
        console.log(`Downloading remote image to: ${localImagePath}`);
        await fetchAndSaveImage(imagePath, localImagePath);
      }

      if (!fs.existsSync(localImagePath)) {
        throw new Error(`Image file not found at ${localImagePath}`);
      }
      console.log("\nStep 2: Uploading logo to IPFS...");
      const imageFileName = path.basename(localImagePath);
      const imageHash = await uploadFileToPinata(localImagePath, imageFileName);
      imageUri = `${PINATA_GATEWAY}/ipfs/${imageHash}`;

      console.log(`Logo uploaded successfully: ${imageUri}`);
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

    // Step 4: Create token
    console.log("\nStep 4: Creating Solana token...");

    // Get token keypair (either configured bonk address or random)
    const tokenKeypair = await getUnusedBonkAddressFromDB();

    if (!tokenKeypair) {
      throw new Error("keypair not found");
    }

    // Save the token keypair to a file for future reference (unless it's a bonk address already saved)
    const keypairData = {
      publicKey: tokenKeypair.publicKey.toString(),
      secretKey: bs58.encode(tokenKeypair.secretKey),
    };
    fs.writeFileSync(`token-keypair-${name.replace(/\s+/g, "-")}.json`, JSON.stringify(keypairData, null, 2));
    console.log(`Saved token keypair to token-keypair-${name.replace(/\s+/g, "-")}.json`);

    // Create mint params
    const mintParams: MintParams = {
      decimals: 6,
      name,
      symbol,
      uri: metadataUri,
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

      console.log("\n=== TOKEN CREATION COMPLETE ===");
      console.log(`Transaction signature: ${signature}`);
      console.log(`Token address: ${tokenKeypair.publicKey.toString()}`);
      console.log(`Token name: ${name}`);
      console.log(`Token symbol: ${symbol}`);
      console.log(`Metadata URI: ${metadataUri}`);

      const formattedLink = formatTokenLink(tokenKeypair.publicKey.toString());
      console.log(formattedLink);
      await archiveAddress(tokenKeypair.publicKey.toString(), name, symbol, signature);

      return {
        transaction: signature,
        tokenAddress: tokenKeypair.publicKey.toString(),
        tokenName: name,
        tokenSymbol: symbol,
        link: formattedLink,
        metadataUri,
      };
    } catch (error) {
      console.error("\nTransaction failed, but token keypair is saved.");
      console.error("You can retry later using the saved token keypair file.");
      console.error("Error details:", error);

      return {
        tokenAddress: tokenKeypair.publicKey.toString(),
        tokenName: name,
        tokenSymbol: symbol,
        metadataUri,
      };
    }
  } catch (error) {
    console.error("Error creating token:", error);
    throw error;
  }
}

// // Execute the token creation process
// createToken()
//   .then(() => {
//     console.log("\nProcess completed!");
//   })
//   .catch((err) => {
//     console.error("\nFailed to complete token creation:", err);
//   });
