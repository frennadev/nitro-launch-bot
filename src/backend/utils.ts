import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { connection } from "../blockchain/common/connection";
import { logger } from "../blockchain/common/logger";
import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import * as crypto from "crypto";
import { env } from "../config";
import { ENCRYPTION_ALGORITHM, ENCRYPTION_IV_LENGTH } from "./constants";
import axios from "axios";
import { BonkAddressModel, TokenModel, UsedBonkAddressModel, UserModel } from "./models";
import { redisClient } from "../jobs/db";
import { DexscreenerTokenResponse } from "./types";

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
      console.log(resp)
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
    console.log({ walletAddress });

    // Validate addresses first
    let mint: PublicKey;
    let owner: PublicKey;

    try {
      mint = new PublicKey(tokenAddress);
      owner = new PublicKey(walletAddress);
    } catch (error) {
      console.error(`[getTokenBalance] Invalid address format - token: ${tokenAddress}, wallet: ${walletAddress}`);
      return 0;
    }

    console.log(`[getTokenBalance] Checking balance for token ${tokenAddress} in wallet ${walletAddress}`);

    // Try to get token accounts with better error handling
    let resp;
    try {
      resp = await connection.getParsedTokenAccountsByOwner(owner, {
        mint,
      });
    } catch (rpcError: any) {
      // Handle specific RPC errors
      if (rpcError.message?.includes("Token mint could not be unpacked")) {
        console.warn(
          `[getTokenBalance] Token mint unpacking failed for ${tokenAddress} - token may not exist or use different program`
        );
        return 0;
      } else if (rpcError.message?.includes("Invalid param")) {
        console.warn(`[getTokenBalance] Invalid parameters for token ${tokenAddress}`);
        return 0;
      } else {
        console.error(`[getTokenBalance] RPC error for token ${tokenAddress}:`, rpcError);
        // Try alternative approach for Token-2022 or other programs
        try {
          const { TOKEN_2022_PROGRAM_ID } = await import("@solana/spl-token");
          resp = await connection.getParsedTokenAccountsByOwner(owner, {
            mint,
            programId: TOKEN_2022_PROGRAM_ID,
          });
          console.log(`[getTokenBalance] Successfully fetched using Token-2022 program`);
        } catch (token2022Error) {
          console.error(`[getTokenBalance] Token-2022 attempt also failed:`, token2022Error);
          return 0;
        }
      }
    }

    if (!resp || !resp.value) {
      console.log(`[getTokenBalance] No response received for token ${tokenAddress}`);
      return 0;
    }

    console.log(`[getTokenBalance] Found ${resp.value.length} token accounts for wallet ${walletAddress}`);

    if (resp.value.length === 0) {
      console.log(`[getTokenBalance] No token accounts found for token ${tokenAddress} in wallet ${walletAddress}`);
      return 0;
    }

    const totalBalance = resp.value.reduce((sum, { account }) => {
      try {
        // Use raw amount (not uiAmount) for precise token calculations
        const rawAmount = account.data.parsed.info.tokenAmount.amount || "0";
        const amt = parseInt(rawAmount, 10);
        console.log(
          `[getTokenBalance] Account balance: ${amt} raw tokens (${account.data.parsed.info.tokenAmount.uiAmount} UI amount)`
        );
        return sum + amt;
      } catch (parseError) {
        console.warn(`[getTokenBalance] Error parsing account data:`, parseError);
        return sum;
      }
    }, 0);

    console.log(`[getTokenBalance] Total balance for ${walletAddress}: ${totalBalance} tokens`);
    return totalBalance;
  } catch (error) {
    console.error(
      `[getTokenBalance] Error checking balance for token ${tokenAddress} in wallet ${walletAddress}:`,
      error
    );
    // Return 0 instead of throwing to prevent cascade failures
    return 0;
  }
}

export async function getSolBalance(
  walletAddress: string,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): Promise<number> {
  const pubkey = new PublicKey(walletAddress);
  const lamports = await connection.getBalance(pubkey, commitment);
  return lamports / LAMPORTS_PER_SOL;
}

// Birdeye API types
export interface BirdeyeResponse {
  data: BirdeyeData;
  success: boolean;
}

export interface BirdeyeData {
  address: string;
  decimals: number;
  symbol: string;
  name: string;
  marketCap: number;
  fdv: number;
  extensions: BirdeyeExtensions;
  logoURI: string;
  liquidity: number;
  lastTradeUnixTime: number;
  lastTradeHumanTime: Date;
  price: number;
  history1mPrice: number;
  priceChange1mPercent: number;
  history5mPrice: number;
  priceChange5mPercent: number;
  history30mPrice: number;
  priceChange30mPercent: number;
  history1hPrice: number;
  priceChange1hPercent: number;
  history2hPrice: number;
  priceChange2hPercent: number;
  history4hPrice: number;
  priceChange4hPercent: number;
  history6hPrice: number;
  priceChange6hPercent: number;
  history8hPrice: number;
  priceChange8hPercent: number;
  history12hPrice: number;
  priceChange12hPercent: number;
  history24hPrice: number;
  priceChange24hPercent: number;
  uniqueWallet1m: number;
  uniqueWalletHistory1m: number;
  uniqueWallet1mChangePercent: number;
  uniqueWallet5m: number;
  uniqueWalletHistory5m: number;
  uniqueWallet5mChangePercent: number;
  uniqueWallet30m: number;
  uniqueWalletHistory30m: number;
  uniqueWallet30mChangePercent: number;
  uniqueWallet1h: number;
  uniqueWalletHistory1h: number;
  uniqueWallet1hChangePercent: number;
  uniqueWallet2h: number;
  uniqueWalletHistory2h: number;
  uniqueWallet2hChangePercent: number;
  uniqueWallet4h: number;
  uniqueWalletHistory4h: number;
  uniqueWallet4hChangePercent: number;
  uniqueWallet8h: number;
  uniqueWalletHistory8h: number;
  uniqueWallet8hChangePercent: number;
  uniqueWallet24h: number;
  uniqueWalletHistory24h: number;
  uniqueWallet24hChangePercent: number;
  totalSupply: number;
  circulatingSupply: number;
  holder: number;
  trade1m: number;
  tradeHistory1m: number;
  trade1mChangePercent: number;
  sell1m: number;
  sellHistory1m: number;
  sell1mChangePercent: number;
  buy1m: number;
  buyHistory1m: number;
  buy1mChangePercent: number;
  v1m: number;
  v1mUSD: number;
  vHistory1m: number;
  vHistory1mUSD: number;
  v1mChangePercent: number;
  vBuy1m: number;
  vBuy1mUSD: number;
  vBuyHistory1m: number;
  vBuyHistory1mUSD: number;
  vBuy1mChangePercent: number;
  vSell1m: number;
  vSell1mUSD: number;
  vSellHistory1m: number;
  vSellHistory1mUSD: number;
  vSell1mChangePercent: number;
  trade5m: number;
  tradeHistory5m: number;
  trade5mChangePercent: number;
  sell5m: number;
  sellHistory5m: number;
  sell5mChangePercent: number;
  buy5m: number;
  buyHistory5m: number;
  buy5mChangePercent: number;
  v5m: number;
  v5mUSD: number;
  vHistory5m: number;
  vHistory5mUSD: number;
  v5mChangePercent: number;
  vBuy5m: number;
  vBuy5mUSD: number;
  vBuyHistory5m: number;
  vBuyHistory5mUSD: number;
  vBuy5mChangePercent: number;
  vSell5m: number;
  vSell5mUSD: number;
  vSellHistory5m: number;
  vSellHistory5mUSD: number;
  vSell5mChangePercent: number;
  trade30m: number;
  tradeHistory30m: number;
  trade30mChangePercent: number;
  sell30m: number;
  sellHistory30m: number;
  sell30mChangePercent: number;
  buy30m: number;
  buyHistory30m: number;
  buy30mChangePercent: number;
  v30m: number;
  v30mUSD: number;
  vHistory30m: number;
  vHistory30mUSD: number;
  v30mChangePercent: number;
  vBuy30m: number;
  vBuy30mUSD: number;
  vBuyHistory30m: number;
  vBuyHistory30mUSD: number;
  vBuy30mChangePercent: number;
  vSell30m: number;
  vSell30mUSD: number;
  vSellHistory30m: number;
  vSellHistory30mUSD: number;
  vSell30mChangePercent: number;
  trade1h: number;
  tradeHistory1h: number;
  trade1hChangePercent: number;
  sell1h: number;
  sellHistory1h: number;
  sell1hChangePercent: number;
  buy1h: number;
  buyHistory1h: number;
  buy1hChangePercent: number;
  v1h: number;
  v1hUSD: number;
  vHistory1h: number;
  vHistory1hUSD: number;
  v1hChangePercent: number;
  vBuy1h: number;
  vBuy1hUSD: number;
  vBuyHistory1h: number;
  vBuyHistory1hUSD: number;
  vBuy1hChangePercent: number;
  vSell1h: number;
  vSell1hUSD: number;
  vSellHistory1h: number;
  vSellHistory1hUSD: number;
  vSell1hChangePercent: number;
  trade2h: number;
  tradeHistory2h: number;
  trade2hChangePercent: number;
  sell2h: number;
  sellHistory2h: number;
  sell2hChangePercent: number;
  buy2h: number;
  buyHistory2h: number;
  buy2hChangePercent: number;
  v2h: number;
  v2hUSD: number;
  vHistory2h: number;
  vHistory2hUSD: number;
  v2hChangePercent: number;
  vBuy2h: number;
  vBuy2hUSD: number;
  vBuyHistory2h: number;
  vBuyHistory2hUSD: number;
  vBuy2hChangePercent: number;
  vSell2h: number;
  vSell2hUSD: number;
  vSellHistory2h: number;
  vSellHistory2hUSD: number;
  vSell2hChangePercent: number;
  trade4h: number;
  tradeHistory4h: number;
  trade4hChangePercent: number;
  sell4h: number;
  sellHistory4h: number;
  sell4hChangePercent: number;
  buy4h: number;
  buyHistory4h: number;
  buy4hChangePercent: number;
  v4h: number;
  v4hUSD: number;
  vHistory4h: number;
  vHistory4hUSD: number;
  v4hChangePercent: number;
  vBuy4h: number;
  vBuy4hUSD: number;
  vBuyHistory4h: number;
  vBuyHistory4hUSD: number;
  vBuy4hChangePercent: number;
  vSell4h: number;
  vSell4hUSD: number;
  vSellHistory4h: number;
  vSellHistory4hUSD: number;
  vSell4hChangePercent: number;
  trade8h: number;
  tradeHistory8h: number;
  trade8hChangePercent: number;
  sell8h: number;
  sellHistory8h: number;
  sell8hChangePercent: number;
  buy8h: number;
  buyHistory8h: number;
  buy8hChangePercent: number;
  v8h: number;
  v8hUSD: number;
  vHistory8h: number;
  vHistory8hUSD: number;
  v8hChangePercent: number;
  vBuy8h: number;
  vBuy8hUSD: number;
  vBuyHistory8h: number;
  vBuyHistory8hUSD: number;
  vBuy8hChangePercent: number;
  vSell8h: number;
  vSell8hUSD: number;
  vSellHistory8h: number;
  vSellHistory8hUSD: number;
  vSell8hChangePercent: number;
  trade24h: number;
  tradeHistory24h: number;
  trade24hChangePercent: number;
  sell24h: number;
  sellHistory24h: number;
  sell24hChangePercent: number;
  buy24h: number;
  buyHistory24h: number;
  buy24hChangePercent: number;
  v24h: number;
  v24hUSD: number;
  vHistory24h: number;
  vHistory24hUSD: number;
  v24hChangePercent: number;
  vBuy24h: number;
  vBuy24hUSD: number;
  vBuyHistory24h: number;
  vBuyHistory24hUSD: number;
  vBuy24hChangePercent: number;
  vSell24h: number;
  vSell24hUSD: number;
  vSellHistory24h: number;
  vSellHistory24hUSD: number;
  vSell24hChangePercent: number;
  numberMarkets: number;
}

export interface BirdeyeExtensions {
  description: string;
}

/**
 * Get token information from Birdeye API
 */
export const getBirdeyeTokenInfo = async (tokenAddress: string): Promise<BirdeyeData | null> => {
  try {
    const response = await axios.get("https://public-api.birdeye.so/defi/token_overview?address=" + tokenAddress, {
      headers: {
        accept: "application/json",
        "x-chain": "solana",
        "X-API-KEY": "e750e17792ae478983170f78486de13c",
      },
      timeout: 5000,
    });

    const data: BirdeyeResponse = response.data || {};

    if (!data.success || !data.data) {
      console.log(`[getBirdeyeTokenInfo] Birdeye API returned unsuccessful response for ${tokenAddress}`);
      return null;
    }

    console.log(`[getBirdeyeTokenInfo] Successfully fetched data for ${tokenAddress}:`, {
      name: data.data.name,
      symbol: data.data.symbol,
      marketCap: data.data.marketCap,
      price: data.data.price,
      liquidity: data.data.liquidity,
    });

    return data.data;
  } catch (error: any) {
    console.error(`[getBirdeyeTokenInfo] Error fetching token info for ${tokenAddress}:`, error.message);
    return null;
  }
};

export const getTokenInfo = async (tokenAddress: string) => {
  const cacheKey = `${tokenAddress}::data`;
  try {
    // Try to get from cache first
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        console.log(`[getTokenInfo] Cache hit for ${tokenAddress}`);
        return JSON.parse(cached);
      }
    } catch (redisError) {
      console.warn(`[getTokenInfo] Redis cache failed for ${tokenAddress}:`, redisError);
      // Continue without cache
    }

    // First try Birdeye API
    console.log(`[getTokenInfo] Fetching from Birdeye API for ${tokenAddress}`);
    const birdeyeData = await getBirdeyeTokenInfo(tokenAddress);

    if (birdeyeData) {
      // Convert Birdeye data to DexScreener-compatible format for backward compatibility
      const convertedData = {
        chainId: "solana",
        dexId: "birdeye",
        url: `https://birdeye.so/token/${tokenAddress}`,
        pairAddress: tokenAddress, // Use token address as pair address for Birdeye
        baseToken: {
          address: tokenAddress,
          name: birdeyeData.name,
          symbol: birdeyeData.symbol,
          decimals: birdeyeData.decimals,
        },
        quoteToken: {
          address: "So11111111111111111111111111111111111111112", // WSOL
          name: "Wrapped SOL",
          symbol: "SOL",
          decimals: 9,
        },
        priceNative: birdeyeData.price ? (birdeyeData.price / 240).toString() : "0", // Rough SOL price estimate
        priceUsd: birdeyeData.price ? birdeyeData.price.toString() : "0",
        marketCap: birdeyeData.marketCap || 0,
        liquidity: {
          usd: birdeyeData.liquidity || 0,
          base: 0,
          quote: 0,
        },
        fdv: birdeyeData.fdv || birdeyeData.marketCap || 0,
        pairCreatedAt: Date.now() - 86400000, // Estimate 1 day ago
        info: {
          imageUrl: birdeyeData.logoURI || null,
          websites: [`https://birdeye.so/token/${tokenAddress}`],
          socials: [],
        },
        // Additional Birdeye-specific data
        birdeye: {
          totalSupply: birdeyeData.totalSupply,
          circulatingSupply: birdeyeData.circulatingSupply,
          holder: birdeyeData.holder,
          priceChange24h: birdeyeData.priceChange24hPercent,
          volume24h: birdeyeData.v24hUSD,
          trades24h: birdeyeData.trade24h,
        },
      };

      // Try to cache the result
      try {
        await redisClient.set(cacheKey, JSON.stringify(convertedData), "EX", 180);
      } catch (redisError) {
        console.warn(`[getTokenInfo] Redis cache set failed for ${tokenAddress}:`, redisError);
      }

      console.log(`[getTokenInfo] Birdeye data successfully converted for ${tokenAddress}`);
      return convertedData;
    }

    // If Birdeye fails, try DexScreener as fallback
    console.log(`[getTokenInfo] Birdeye failed, trying DexScreener fallback for ${tokenAddress}`);
    const response = await axios.get(`https://api.dexscreener.com/tokens/v1/solana/${tokenAddress}`, {
      timeout: 5000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NitroBot/1.0)",
      },
    });

    const data = response.data || [];
    console.log(`[getTokenInfo] DexScreener response for ${tokenAddress}:`, {
      status: response.status,
      dataLength: data.length,
      hasFirstItem: !!data[0],
    });

    // If DexScreener returns empty data, try PumpFun fallback
    if (!data || data.length === 0 || !data[0]) {
      console.log(`[getTokenInfo] DexScreener returned empty data, trying PumpFun fallback...`);
      const pumpfunData = await getPumpFunTokenInfo(tokenAddress);
      if (pumpfunData) {
        console.log(`[getTokenInfo] PumpFun fallback successful for ${tokenAddress}`);

        // Try to cache the PumpFun result
        try {
          await redisClient.set(cacheKey, JSON.stringify(pumpfunData), "EX", 60); // Shorter cache for PumpFun data
        } catch (redisError) {
          console.warn(`[getTokenInfo] Redis cache set failed for PumpFun data:`, redisError);
        }

        return pumpfunData;
      }
    }

    // Try to cache the DexScreener result
    try {
      await redisClient.set(cacheKey, JSON.stringify(data[0]), "EX", 180);
    } catch (redisError) {
      console.warn(`[getTokenInfo] Redis cache set failed for ${tokenAddress}:`, redisError);
    }

    return data[0];
  } catch (error: any) {
    console.error(`[getTokenInfo] Complete failure for ${tokenAddress}:`, {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
    });

    // Try PumpFun fallback on complete API failure
    console.log(`[getTokenInfo] All APIs failed, trying PumpFun fallback as last resort...`);
    try {
      const pumpfunData = await getPumpFunTokenInfo(tokenAddress);
      if (pumpfunData) {
        console.log(`[getTokenInfo] PumpFun fallback successful after API failure`);
        return pumpfunData;
      }
    } catch (pumpfunError) {
      console.warn(`[getTokenInfo] PumpFun fallback also failed:`, pumpfunError);
    }

    return null; // Return null instead of undefined for better error handling
  }
};

/**
 * Get token market data from PumpFun bonding curve (fallback when DexScreener fails)
 */
export const getPumpFunTokenInfo = async (tokenAddress: string) => {
  try {
    // Import PumpFun utilities dynamically to avoid circular imports
    const { getBondingCurve, getBondingCurveData } = await import("../blockchain/pumpfun/utils");
    const { PublicKey } = await import("@solana/web3.js");
    const { connection } = await import("../blockchain/common/connection");
    const { getMint } = await import("@solana/spl-token");

    console.log(`[getPumpFunTokenInfo] Fetching bonding curve data for ${tokenAddress}`);

    const mintPk = new PublicKey(tokenAddress);
    const { bondingCurve } = getBondingCurve(mintPk);
    const bondingCurveData = await getBondingCurveData(bondingCurve);

    if (!bondingCurveData) {
      console.log(`[getPumpFunTokenInfo] No bonding curve data found - not a PumpFun token`);
      return null;
    }

    console.log(`[getPumpFunTokenInfo] Bonding curve data found, calculating market metrics...`);

    // Get token metadata
    let tokenName = "Unknown Token";
    let tokenSymbol = "UNK";
    let tokenDecimals = 6; // PumpFun tokens are typically 6 decimals

    try {
      const mintInfo = await getMint(connection, mintPk);
      tokenDecimals = mintInfo.decimals;
      console.log(`[getPumpFunTokenInfo] Token decimals: ${tokenDecimals}`);
    } catch (error) {
      console.warn(`[getPumpFunTokenInfo] Could not fetch mint info, using default decimals`);
    }

    // Calculate market metrics from bonding curve data
    const virtualSolReserves = Number(bondingCurveData.virtualSolReserves) / 1e9; // Convert lamports to SOL
    const virtualTokenReserves = Number(bondingCurveData.virtualTokenReserves) / Math.pow(10, tokenDecimals);
    const realTokenReserves = Number(bondingCurveData.realTokenReserves) / Math.pow(10, tokenDecimals);
    const tokenTotalSupply = Number(bondingCurveData.tokenTotalSupply) / Math.pow(10, tokenDecimals);

    // Calculate price: SOL per token
    const priceInSol = virtualSolReserves / virtualTokenReserves;

    // Estimate SOL price (this could be fetched from an API for more accuracy)
    const estimatedSolPrice = 240; // USD, could be made dynamic
    const priceUsd = priceInSol * estimatedSolPrice;

    // Calculate market cap: circulating supply * price
    const circulatingSupply = tokenTotalSupply - realTokenReserves; // Tokens that have been bought
    const marketCap = circulatingSupply * priceUsd;

    // Calculate liquidity (total SOL in the curve)
    const liquidityUsd = virtualSolReserves * estimatedSolPrice;

    // Calculate bonding curve progress (percentage of tokens sold)
    const bondingCurveProgress = ((tokenTotalSupply - realTokenReserves) / tokenTotalSupply) * 100;

    console.log(`[getPumpFunTokenInfo] Calculated metrics:`, {
      priceUsd: priceUsd.toFixed(8),
      marketCap: marketCap.toFixed(2),
      liquidityUsd: liquidityUsd.toFixed(2),
      circulatingSupply: circulatingSupply.toFixed(0),
      bondingCurveProgress: bondingCurveProgress.toFixed(2),
    });

    // Return data in DexScreener-compatible format
    return {
      chainId: "solana",
      dexId: "pumpfun",
      url: `https://pump.fun/${tokenAddress}`,
      pairAddress: bondingCurve.toBase58(),
      baseToken: {
        address: tokenAddress,
        name: tokenName,
        symbol: tokenSymbol,
        decimals: tokenDecimals,
      },
      quoteToken: {
        address: "So11111111111111111111111111111111111111112", // WSOL
        name: "Wrapped SOL",
        symbol: "SOL",
        decimals: 9,
      },
      priceNative: priceInSol.toString(),
      priceUsd: priceUsd.toString(),
      marketCap: marketCap,
      liquidity: {
        usd: liquidityUsd,
        base: realTokenReserves,
        quote: virtualSolReserves,
      },
      fdv: tokenTotalSupply * priceUsd, // Fully diluted valuation
      pairCreatedAt: Date.now() - 86400000, // Estimate 1 day ago
      bondingCurveProgress: bondingCurveProgress,
      info: {
        imageUrl: null,
        websites: [`https://pump.fun/${tokenAddress}`],
        socials: [],
      },
    };
  } catch (error: any) {
    console.error(`[getPumpFunTokenInfo] Error calculating token info:`, error);
    return null;
  }
};

/**
 * Calculate token holdings worth based on current bonding curve price
 */
export const calculateTokenHoldingsWorth = async (
  tokenAddress: string,
  totalTokens: string
): Promise<{
  worthInSol: number;
  worthInUsd: number;
  pricePerToken: number;
  marketCap: number;
  bondingCurveProgress: number;
}> => {
  try {
    const tokenInfo = await getPumpFunTokenInfo(tokenAddress);

    if (!tokenInfo) {
      return {
        worthInSol: 0,
        worthInUsd: 0,
        pricePerToken: 0,
        marketCap: 0,
        bondingCurveProgress: 0,
      };
    }

    // Convert token amount to human readable format (assuming 6 decimals)
    const tokenAmount = Number(totalTokens) / 1e6;
    const pricePerToken = Number(tokenInfo.priceUsd);
    const pricePerTokenInSol = Number(tokenInfo.priceNative);

    // Calculate worth
    const worthInUsd = tokenAmount * pricePerToken;
    const worthInSol = tokenAmount * pricePerTokenInSol;

    return {
      worthInSol,
      worthInUsd,
      pricePerToken,
      marketCap: tokenInfo.marketCap,
      bondingCurveProgress: tokenInfo.bondingCurveProgress || 0,
    };
  } catch (error: any) {
    console.error(`[calculateTokenHoldingsWorth] Error calculating holdings worth:`, error);
    return {
      worthInSol: 0,
      worthInUsd: 0,
      pricePerToken: 0,
      marketCap: 0,
      bondingCurveProgress: 0,
    };
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
    logger.info(`[parse-tx]: Parsing transaction ${signature} for wallet ${walletAddress.slice(0, 8)}`);

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
      throw new Error(`Transaction failed: ${JSON.stringify(parsedTx.meta.err)}`);
    }

    // Find the wallet's account index in the transaction
    const walletPubkey = new PublicKey(walletAddress);
    const accountKeys = parsedTx.transaction.message.accountKeys;
    const walletIndex = accountKeys.findIndex((key) => key.pubkey.equals(walletPubkey));

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
        BigInt(postTokenBalance.uiTokenAmount.amount) - BigInt(preTokenBalance.uiTokenAmount.amount)
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
    logger.error(`[parse-tx]: Failed to parse transaction ${signature}:`, error);
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
    | "external_sell"
    | "external_buy",
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
    const transactionTypeForParsing = transactionType.includes("sell") ? "sell" : "buy";
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
        amountSol: transactionTypeForParsing === "buy" ? actualAmounts.actualSolSpent : actualAmounts.actualSolReceived,
        amountTokens:
          transactionTypeForParsing === "buy" ? actualAmounts.actualTokensReceived : actualAmounts.actualTokensSold,
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
      logger.warn(`[record-tx]: Failed to parse actual amounts, using estimates: ${actualAmounts.error}`);
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
    logger.error(`[record-tx]: Error parsing transaction amounts, using estimates:`, error);
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

export async function checkTokenRenouncedAndFrozen(tokenMintAddress: string): Promise<{
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

export function formatTokenLink(tokenAddress: string): string {
  return `https://letsbonk.fun/token/${tokenAddress}`;
}

export async function archiveAddress(
  publicKey: string,
  tokenName: string,
  tokenSymbol: string,
  transactionSignature?: string
) {
  try {
    const address = await BonkAddressModel.findOne({ publicKey });

    if (!address) {
      console.log(`Address ${publicKey} not found in main collection.`);
      return false;
    }

    const usedAddress = new UsedBonkAddressModel({
      publicKey: address.publicKey,
      secretKey: address.secretKey,
      rawSecretKey: address.rawSecretKey,
      tokenName,
      tokenSymbol,
      transactionSignature,
      createdAt: new Date(),
      usedAt: new Date(),
    });

    await usedAddress.save();

    await BonkAddressModel.deleteOne({ _id: address._id });

    console.log(`Archived address ${publicKey} to used collection.`);
    return true;
  } catch (error) {
    console.error("Error archiving address:", error);
    return false;
  }
}
