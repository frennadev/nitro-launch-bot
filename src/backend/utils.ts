import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { connection } from "../blockchain/common/connection";
import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import * as crypto from "crypto";
import { env } from "../config";
import { ENCRYPTION_ALGORITHM, ENCRYPTION_IV_LENGTH } from "./constants";
import axios from "axios";
import { TokenModel, UserModel } from "./models";
import { redisClient } from "../jobs/db";

export function encryptPrivateKey(privateKey: string): string {
  const SECRET_KEY = crypto.scryptSync(env.ENCRYPTION_SECRET, "salt", ENCRYPTION_IV_LENGTH * 2);
  try {
    const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);

    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, SECRET_KEY, iv);

    let encrypted = cipher.update(privateKey, "utf8", "hex");
    encrypted += cipher.final("hex");

    return `${iv.toString("hex")}:${encrypted}`;
  } catch (error) {
    throw new Error(`Encryption failed: ${(error as Error).message}`);
  }
}

export function decryptPrivateKey(encryptedPrivateKey: string): string {
  const SECRET_KEY = crypto.scryptSync(env.ENCRYPTION_SECRET, "salt", ENCRYPTION_IV_LENGTH * 2);

  try {
    const [ivHex, encryptedData] = encryptedPrivateKey.split(":");

    if (!ivHex || !encryptedData) {
      throw new Error("Invalid encrypted data format");
    }
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, SECRET_KEY, iv);
    let decrypted = decipher.update(encryptedData, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error(`Decryption failed: ${(error as Error).message}`);
  }
}

export async function uploadFileToPinata(file: ArrayBuffer, fileName: string) {
  try {
    const blob = new Blob([file]);
    const fileObj = new File([blob], fileName);
    const formData = new FormData();
    formData.append("file", fileObj);

    const metadata = JSON.stringify({
      name: fileName,
    });
    formData.append("pinataMetadata", metadata);

    const options = JSON.stringify({
      cidVersion: 0,
    });
    formData.append("pinataOptions", options);
    const resp = await fetch(`${env.PINATA_API_URL}/pinFileToIPFS`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.PINATA_JWT}`,
      },
      body: formData,
    });
    if (resp.status != 200) {
      throw Error(`Failed to upload File: ${await resp.text()}`);
    }
    const data = JSON.parse(await resp.text());
    return data.IpfsHash;
  } catch (error) {
    console.error(`Error occurred: ${error}`);
    throw error;
  }
}

export async function uploadJsonToPinata(jsonData: any, name: string) {
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

    const res = await axios.post(`${env.PINATA_API_URL}/pinJSONToIPFS`, data, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.PINATA_JWT}`,
      },
    });

    return res.data.IpfsHash;
  } catch (error) {
    console.error("Error uploading JSON to Pinata:", error);
    throw error;
  }
}

interface EditOptions {
  parse_mode?: "MarkdownV2" | "Markdown" | "HTML";
  reply_markup?: InlineKeyboard;
}

export async function editMessage(
  ctxOrBot: Context | Bot,
  text: string,
  opts: EditOptions = {},
  chatId?: number | string,
  messageId?: number
) {
  try {
    if ("editMessageText" in ctxOrBot) {
      await ctxOrBot.editMessageText(text, opts);
    } else {
      if (chatId == null || messageId == null) {
        throw new Error("chatId and messageId required when calling from bot instance");
      }
      await ctxOrBot.api.editMessageText(chatId, messageId, text, opts);
    }
  } catch (err) {
    console.error("Failed to edit message", err);
  }
}

export async function getTokenBalance(tokenAddress: string, walletAddress: string): Promise<number> {
  try {
    const mint = new PublicKey(tokenAddress);
    const owner = new PublicKey(walletAddress);
    
    console.log(`[getTokenBalance] Checking balance for token ${tokenAddress} in wallet ${walletAddress}`);
    
    const resp = await connection.getParsedTokenAccountsByOwner(owner, { mint });
    
    console.log(`[getTokenBalance] Found ${resp.value.length} token accounts for wallet ${walletAddress}`);
    
    if (resp.value.length === 0) {
      console.log(`[getTokenBalance] No token accounts found for token ${tokenAddress} in wallet ${walletAddress}`);
      return 0;
    }
    
    const totalBalance = resp.value.reduce((sum, { account }) => {
      const amt = account.data.parsed.info.tokenAmount.uiAmount || 0;
      console.log(`[getTokenBalance] Account balance: ${amt} tokens`);
      return sum + amt;
    }, 0);
    
    console.log(`[getTokenBalance] Total balance for ${walletAddress}: ${totalBalance} tokens`);
    return totalBalance;
    
  } catch (error) {
    console.error(`[getTokenBalance] Error checking balance for token ${tokenAddress} in wallet ${walletAddress}:`, error);
    throw error; // Re-throw the error instead of silently returning 0
  }
}

export async function getSolBalance(walletAddress: string): Promise<number> {
  const pubkey = new PublicKey(walletAddress);
  const lamports = await connection.getBalance(pubkey);
  return lamports / LAMPORTS_PER_SOL;
}

export const getTokenInfo = async (tokenAddress: string) => {
  const cacheKey = `${tokenAddress}::data`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached)[0];
    }
    const response = await axios.get(`https://api.dexscreener.com/tokens/v1/solana/${tokenAddress}`);
    const data = response.data || [];
    await redisClient.set(cacheKey, JSON.stringify(data), "EX", 180);

    return data[0];
  } catch (error) {
    console.error("Error fetching token market cap:", error);
  }
};
