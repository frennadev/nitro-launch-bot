import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { connection } from "../blockchain/common/connection";
import { logger } from "../blockchain/common/logger";
import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import * as crypto from "crypto";
import { env } from "../config";
import { ENCRYPTION_ALGORITHM, ENCRYPTION_IV_LENGTH } from "./constants";
import axios from "axios";
import { TokenModel, UserModel } from "./models";
import { redisClient } from "../jobs/db";
import { DexscreenerTokenResponse } from "./types";

export function encryptPrivateKey(privateKey: string): string {
  const SECRET_KEY = crypto.scryptSync(
    env.ENCRYPTION_SECRET,
    "salt",
    ENCRYPTION_IV_LENGTH * 2
  );
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
  const SECRET_KEY = crypto.scryptSync(
    env.ENCRYPTION_SECRET,
    "salt",
    ENCRYPTION_IV_LENGTH * 2
  );

  try {
    const [ivHex, encryptedData] = encryptedPrivateKey.split(":");

    if (!ivHex || !encryptedData) {
      throw new Error("Invalid encrypted data format");
    }
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      SECRET_KEY,
      iv
    );
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
        throw new Error(
          "chatId and messageId required when calling from bot instance"
        );
      }
      await ctxOrBot.api.editMessageText(chatId, messageId, text, opts);
    }
  } catch (err) {
    console.error("Failed to edit message", err);
  }
}

export async function getTokenBalance(
  tokenAddress: string,
  walletAddress: string
): Promise<number> {
  try {
    const mint = new PublicKey(tokenAddress);
    const owner = new PublicKey(walletAddress);

    console.log(
      `[getTokenBalance] Checking balance for token ${tokenAddress} in wallet ${walletAddress}`
    );

    const resp = await connection.getParsedTokenAccountsByOwner(owner, {
      mint,
    });

    console.log(
      `[getTokenBalance] Found ${resp.value.length} token accounts for wallet ${walletAddress}`
    );

    if (resp.value.length === 0) {
      console.log(
        `[getTokenBalance] No token accounts found for token ${tokenAddress} in wallet ${walletAddress}`
      );
      return 0;
    }

    const totalBalance = resp.value.reduce((sum, { account }) => {
      const amt = account.data.parsed.info.tokenAmount.uiAmount || 0;
      console.log(`[getTokenBalance] Account balance: ${amt} tokens`);
      return sum + amt;
    }, 0);

    console.log(
      `[getTokenBalance] Total balance for ${walletAddress}: ${totalBalance} tokens`
    );
    return totalBalance;
  } catch (error) {
    console.error(
      `[getTokenBalance] Error checking balance for token ${tokenAddress} in wallet ${walletAddress}:`,
      error
    );
    throw error; // Re-throw the error instead of silently returning 0
  }
}

export async function getSolBalance(walletAddress: string): Promise<number> {
  const pubkey = new PublicKey(walletAddress);
  const lamports = await connection.getBalance(pubkey);
  return lamports / LAMPORTS_PER_SOL;
}

export const getTokenInfo = async (
  tokenAddress: string
): DexscreenerTokenResponse => {
  const cacheKey = `${tokenAddress}::data`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached)[0];
    }
    const response = await axios.get(
      `https://api.dexscreener.com/tokens/v1/solana/${tokenAddress}`
    );
    const data: DexscreenerTokenResponse[] | [] = response.data || [];
    await redisClient.set(cacheKey, JSON.stringify(data), "EX", 180);

    return data[0];
  } catch (error) {
    console.error("Error fetching token market cap:", error);
  }
};

/**
 * Parse actual transaction amounts from blockchain transaction
 * Gets real SOL spent/received and tokens bought/sold instead of estimates
 */
export const parseTransactionAmounts = async (
  signature: string,
  walletAddress: string,
  tokenMint: string,
  transactionType: "buy" | "sell" = "buy"
): Promise<{
  actualSolSpent?: number;
  actualTokensReceived?: string;
  actualSolReceived?: number;
  actualTokensSold?: string;
  success: boolean;
  error?: string;
}> => {
  try {
    logger.info(
      `[parse-tx]: Parsing transaction ${signature} for wallet ${walletAddress.slice(0, 8)}`
    );

    // Get the parsed transaction from the blockchain
    const parsedTx = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!parsedTx) {
      throw new Error("Transaction not found");
    }

    if (!parsedTx.meta) {
      throw new Error("Transaction metadata not available");
    }

    if (parsedTx.meta.err) {
      throw new Error(
        `Transaction failed: ${JSON.stringify(parsedTx.meta.err)}`
      );
    }

    // Find the wallet's account index in the transaction
    const walletPubkey = new PublicKey(walletAddress);
    const accountKeys = parsedTx.transaction.message.accountKeys;
    const walletIndex = accountKeys.findIndex((key) =>
      key.pubkey.equals(walletPubkey)
    );

    if (walletIndex === -1) {
      throw new Error("Wallet not found in transaction");
    }

    // Parse SOL balance changes
    const preBalance = parsedTx.meta.preBalances[walletIndex];
    const postBalance = parsedTx.meta.postBalances[walletIndex];
    const solChange = (preBalance - postBalance) / LAMPORTS_PER_SOL;

    // Parse token balance changes
    const preTokenBalances = parsedTx.meta.preTokenBalances || [];
    const postTokenBalances = parsedTx.meta.postTokenBalances || [];

    // Find token balance changes for our specific token and wallet
    const preTokenBalance = preTokenBalances.find(
      (balance) => balance.mint === tokenMint && balance.owner === walletAddress
    );

    const postTokenBalance = postTokenBalances.find(
      (balance) => balance.mint === tokenMint && balance.owner === walletAddress
    );

    let tokenChange = "0";
    if (postTokenBalance && preTokenBalance) {
      tokenChange = (
        BigInt(postTokenBalance.uiTokenAmount.amount) -
        BigInt(preTokenBalance.uiTokenAmount.amount)
      ).toString();
    } else if (postTokenBalance && !preTokenBalance) {
      // New token account created
      tokenChange = postTokenBalance.uiTokenAmount.amount;
    } else if (!postTokenBalance && preTokenBalance) {
      // Token account emptied
      tokenChange = (-BigInt(preTokenBalance.uiTokenAmount.amount)).toString();
    }

    const result = {
      success: true,
    } as any;

    if (transactionType === "buy") {
      result.actualSolSpent = Math.abs(solChange); // Positive value for amount spent
      result.actualTokensReceived = tokenChange; // Should be positive for buys

      logger.info(
        `[parse-tx]: Buy transaction parsed - SOL spent: ${result.actualSolSpent}, Tokens received: ${result.actualTokensReceived}`
      );
    } else {
      result.actualSolReceived = Math.abs(solChange); // Positive value for amount received
      result.actualTokensSold = Math.abs(Number(tokenChange)).toString(); // Positive value for tokens sold

      logger.info(
        `[parse-tx]: Sell transaction parsed - SOL received: ${result.actualSolReceived}, Tokens sold: ${result.actualTokensSold}`
      );
    }

    return result;
  } catch (error: any) {
    logger.error(
      `[parse-tx]: Failed to parse transaction ${signature}:`,
      error
    );
    return {
      success: false,
      error: error.message || "Unknown parsing error",
    };
  }
};

/**
 * Enhanced transaction recording that uses actual amounts from blockchain
 */
export const recordTransactionWithActualAmounts = async (
  tokenAddress: string,
  walletPublicKey: string,
  transactionType:
    | "token_creation"
    | "dev_buy"
    | "snipe_buy"
    | "dev_sell"
    | "wallet_sell"
    | "external_sell",
  signature: string,
  success: boolean,
  launchAttempt: number,
  estimatedAmounts: {
    sellAttempt?: number;
    slippageUsed?: number;
    amountSol?: number;
    amountTokens?: string;
    sellPercent?: number;
    errorMessage?: string;
    retryAttempt?: number;
  } = {},
  parseActualAmounts: boolean = true
) => {
  const { recordTransaction } = await import("./functions");

  if (!success || !signature || !parseActualAmounts) {
    // Use estimated amounts for failed transactions or when parsing is disabled
    return await recordTransaction(
      tokenAddress,
      walletPublicKey,
      transactionType,
      signature,
      success,
      launchAttempt,
      estimatedAmounts
    );
  }

  try {
    // Parse actual amounts from blockchain
    const transactionTypeForParsing = transactionType.includes("sell")
      ? "sell"
      : "buy";
    const actualAmounts = await parseTransactionAmounts(
      signature,
      walletPublicKey,
      tokenAddress,
      transactionTypeForParsing
    );

    if (actualAmounts.success) {
      // Use actual amounts from blockchain
      const recordingData = {
        ...estimatedAmounts,
        // Override with actual amounts
        amountSol:
          transactionTypeForParsing === "buy"
            ? actualAmounts.actualSolSpent
            : actualAmounts.actualSolReceived,
        amountTokens:
          transactionTypeForParsing === "buy"
            ? actualAmounts.actualTokensReceived
            : actualAmounts.actualTokensSold,
      };

      logger.info(
        `[record-tx]: Using actual amounts from blockchain for ${transactionType} - SOL: ${recordingData.amountSol}, Tokens: ${recordingData.amountTokens}`
      );

      return await recordTransaction(
        tokenAddress,
        walletPublicKey,
        transactionType,
        signature,
        success,
        launchAttempt,
        recordingData
      );
    } else {
      // Fallback to estimated amounts if parsing failed
      logger.warn(
        `[record-tx]: Failed to parse actual amounts, using estimates: ${actualAmounts.error}`
      );
      return await recordTransaction(
        tokenAddress,
        walletPublicKey,
        transactionType,
        signature,
        success,
        launchAttempt,
        estimatedAmounts
      );
    }
  } catch (error: any) {
    // Fallback to estimated amounts on any error
    logger.error(
      `[record-tx]: Error parsing transaction amounts, using estimates:`,
      error
    );
    return await recordTransaction(
      tokenAddress,
      walletPublicKey,
      transactionType,
      signature,
      success,
      launchAttempt,
      estimatedAmounts
    );
  }
};

export async function checkTokenRenouncedAndFrozen(
  tokenMintAddress: string
): Promise<{
  isRenounced: boolean;
  isFrozen: boolean;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}> {
  try {
    const mintPubkey = new PublicKey(tokenMintAddress);
    const mintAccountInfo = await connection.getParsedAccountInfo(mintPubkey);

    if (!mintAccountInfo.value) {
      throw new Error("Mint account not found");
    }

    // @ts-ignore
    const mintData = mintAccountInfo.value.data.parsed.info;

    const mintAuthority = mintData.mintAuthority ?? null;
    const freezeAuthority = mintData.freezeAuthority ?? null;

    const isRenounced = mintAuthority === null;
    const isFrozen = freezeAuthority === null;

    return {
      isRenounced,
      isFrozen,
      mintAuthority,
      freezeAuthority,
    };
  } catch (error) {
    logger.error(`[checkTokenRenouncedAndFrozen] Error:`, error);
    throw error;
  }
}
