import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { connection } from "./config";
import { logger } from "../jobs/logger";
import { TokenInfoService, TokenValue } from "./token-info-service";

export interface EnhancedTokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  image?: string;
  balance: bigint;
  balanceUI: number;
  priceUsd: number;
  balanceUsd: number;
  marketCap?: number;
  volume24h?: number;
  priceChange24h?: number;
  isToken2022?: boolean;
}

/**
 * Calculate Token-2022 value and market data
 * Works for Heaven DEX tokens
 */
export async function getToken2022Value(
  tokenAddress: string,
  tokenBalance: bigint,
  decimals: number = 9
): Promise<{ value: TokenValue | null; balanceUsd: number }> {
  const logId = `token-value-${tokenAddress.substring(0, 8)}`;
  
  try {
    // Get price from TokenInfoService
    const tokenInfoService = TokenInfoService.getInstance();
    const tokenInfo = await tokenInfoService.getTokenInfo(tokenAddress);
    
    if (!tokenInfo || !tokenInfo.price) {
      logger.warn(`[${logId}] No price data found`);
      return { value: null, balanceUsd: 0 };
    }
    
    // Calculate balance in USD
    const balanceUI = Number(tokenBalance) / Math.pow(10, decimals);
    const balanceUsd = balanceUI * tokenInfo.price;
    
    logger.info(`[${logId}] Price: $${tokenInfo.price}, Balance: ${balanceUI} tokens = $${balanceUsd.toFixed(2)}`);
    
    const value: TokenValue = {
      priceUsd: tokenInfo.price,
      marketCap: tokenInfo.marketCap,
      volume24h: tokenInfo.volume24h,
      priceChange24h: tokenInfo.priceChange24h
    };
    
    return {
      value,
      balanceUsd
    };
    
  } catch (error: any) {
    logger.error(`[${logId}] Error calculating token value: ${error.message}`);
    return { value: null, balanceUsd: 0 };
  }
}

/**
 * Enhanced token info for monitor display
 */
export async function getEnhancedTokenInfo(
  tokenAddress: string, 
  userPublicKey: PublicKey
): Promise<EnhancedTokenInfo> {
  const logId = `monitor-token-${tokenAddress.substring(0, 8)}`;
  
  try {
    // Get Token-2022 metadata
    const tokenInfoService = TokenInfoService.getInstance();
    const tokenInfo = await tokenInfoService.getTokenInfo(tokenAddress);
    
    if (!tokenInfo) {
      logger.warn(`[${logId}] No token metadata found`);
      return {
        address: tokenAddress,
        name: "Unknown Token",
        symbol: "UNKNOWN",
        decimals: 9,
        balance: BigInt(0),
        balanceUI: 0,
        priceUsd: 0,
        balanceUsd: 0
      };
    }
    
    // Get token balance
    const balance = await getToken2022Balance(tokenAddress, userPublicKey);
    
    // Get price and value
    const { value, balanceUsd } = await getToken2022Value(
      tokenAddress, 
      balance,
      tokenInfo.decimals
    );
    
    return {
      address: tokenAddress,
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals,
      image: tokenInfo.image,
      balance: balance,
      balanceUI: Number(balance) / Math.pow(10, tokenInfo.decimals),
      priceUsd: value?.priceUsd || 0,
      balanceUsd: balanceUsd,
      marketCap: value?.marketCap,
      volume24h: value?.volume24h,
      priceChange24h: value?.priceChange24h,
      isToken2022: tokenInfo.isToken2022
    };
    
  } catch (error: any) {
    logger.error(`[${logId}] Error getting enhanced token info: ${error.message}`);
    return {
      address: tokenAddress,
      name: "Unknown Token",
      symbol: "UNKNOWN", 
      decimals: 9,
      balance: BigInt(0),
      balanceUI: 0,
      priceUsd: 0,
      balanceUsd: 0
    };
  }
}

/**
 * Get Token-2022 balance (compatible with both SPL Token and Token-2022)
 */
export async function getToken2022Balance(tokenMint: string, userPubkey: PublicKey): Promise<bigint> {
  try {
    const tokenMintPk = new PublicKey(tokenMint);
    
    // First try Token-2022 program
    const token2022Accounts = await connection.getParsedTokenAccountsByOwner(
      userPubkey,
      { mint: tokenMintPk, programId: TOKEN_2022_PROGRAM_ID },
      "confirmed"
    );

    if (token2022Accounts.value.length > 0) {
      const balance = token2022Accounts.value[0].account.data.parsed.info.tokenAmount.amount;
      return BigInt(balance);
    }
    
    // Fallback to regular SPL Token program
    const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      userPubkey,
      { mint: tokenMintPk, programId: TOKEN_PROGRAM_ID },
      "confirmed"
    );

    if (tokenAccounts.value.length > 0) {
      const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
      return BigInt(balance);
    }
    
    return BigInt(0);
  } catch (error) {
    logger.debug(`Error getting token balance for ${tokenMint}: ${error}`);
    return BigInt(0);
  }
}

/**
 * Format token info for display
 */
export function formatTokenDisplay(tokenInfo: EnhancedTokenInfo): string {
  const { name, symbol, balanceUI, priceUsd, balanceUsd, priceChange24h } = tokenInfo;
  
  // Format name and symbol
  const displayName = name !== "Unknown Token" ? name : symbol;
  const displaySymbol = symbol !== "UNKNOWN" ? `($${symbol})` : "";
  
  // Format price
  const priceDisplay = priceUsd > 0 ? `$${formatPrice(priceUsd)}` : "No price";
  
  // Format balance value
  const valueDisplay = balanceUsd > 0 ? `≈ $${balanceUsd.toFixed(2)}` : "≈ $0.00";
  
  // Format price change
  const changeDisplay = priceChange24h 
    ? `${priceChange24h > 0 ? '+' : ''}${priceChange24h.toFixed(2)}%`
    : "";
  
  // Show Token-2022 indicator
  const token2022Indicator = tokenInfo.isToken2022 ? "🏆 Heaven DEX" : "";
  
  return `
🪙 <b>${displayName} ${displaySymbol}</b> ${token2022Indicator}
<code>${tokenInfo.address.substring(0, 8)}...${tokenInfo.address.substring(-4)}</code>

💰 Balance: ${formatNumber(balanceUI)} tokens
💵 Price: ${priceDisplay} ${changeDisplay}
💎 Value: ${valueDisplay}
`.trim();
}

/**
 * Format price based on value
 */
function formatPrice(price: number): string {
  if (price >= 1) {
    return price.toFixed(4);
  } else if (price >= 0.0001) {
    return price.toFixed(6);
  } else {
    return price.toExponential(2);
  }
}

/**
 * Format numbers with appropriate precision
 */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + "M";
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + "K";
  } else if (num >= 1) {
    return num.toFixed(2);
  } else {
    return num.toFixed(6);
  }
}