import { Context, GrammyError } from "grammy";
import { InlineKeyboard } from "grammy";
import { sendMessage } from "../backend/sender";
import { env } from "../config";

export function escape(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/_/g, "\\_")
    .replace(/\*/g, "\\*")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/~/g, "\\~")
    .replace(/`/g, "\\`")
    .replace(/>/g, "\\>")
    .replace(/#/g, "\\#")
    .replace(/\+/g, "\\+")
    .replace(/-/g, "\\-")
    .replace(/=/g, "\\=")
    .replace(/\|/g, "\\|")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\./g, "\\.")
    .replace(/!/g, "\\!");
}

/**
 * Safely edit a message text with error handling for "message is not modified" errors
 */
export async function safeEditMessageText(
  ctx: Context,
  text: string,
  options?: {
    parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
    reply_markup?: InlineKeyboard;
    disable_web_page_preview?: boolean;
  }
): Promise<boolean> {
  try {
    await ctx.editMessageText(text, options);
    return true;
  } catch (error: any) {
    // Ignore "message is not modified" errors
    if (error.description?.includes("message is not modified")) {
      console.log("Message content unchanged, skipping edit");
      return true;
    }
    console.warn("Failed to edit message text:", error);
    return false;
  }
}

/**
 * Safely edit message reply markup with error handling for "message is not modified" errors
 */
export async function safeEditMessageReplyMarkup(
  ctx: Context,
  replyMarkup: InlineKeyboard
): Promise<boolean> {
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: replyMarkup });
    return true;
  } catch (error: any) {
    // Ignore "message is not modified" errors
    if (error.description?.includes("message is not modified")) {
      console.log("Message markup unchanged, skipping edit");
      return true;
    }
    console.warn("Failed to edit message reply markup:", error);
    return false;
  }
}

/**
 * Safely edit message with both text and markup, with fallback to sending new message
 */
export async function safeEditOrSendMessage(
  ctx: Context,
  text: string,
  options?: {
    parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
    reply_markup?: InlineKeyboard;
    disable_web_page_preview?: boolean;
  }
): Promise<void> {
  const editSuccess = await safeEditMessageText(ctx, text, options);

  if (!editSuccess) {
    // If editing fails for reasons other than "not modified", send a new message
    try {
      await sendMessage(ctx, text, options);
    } catch (error) {
      console.error("Failed to send fallback message:", error);
    }
  }
}

export function formatUSD(amount: number): string {
  const absAmount = Math.abs(amount);
  let formatted: string;

  if (absAmount >= 1_000_000_000) {
    formatted = (amount / 1_000_000_000).toFixed(2).replace(/\.00$/, "") + "B";
  } else if (absAmount >= 1_000_000) {
    formatted = (amount / 1_000_000).toFixed(2).replace(/\.00$/, "") + "M";
  } else if (absAmount >= 1_000) {
    formatted = (amount / 1_000).toFixed(2).replace(/\.00$/, "") + "k";
  } else {
    formatted = amount.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
    return formatted;
  }

  return (amount < 0 ? "-" : "") + "$" + formatted;
}
export function formatUSDFull(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Safely answer callback query with timeout error handling
 */
export async function safeAnswerCallbackQuery(
  ctx: Context,
  text?: string
): Promise<void> {
  try {
    await ctx.answerCallbackQuery(text);
  } catch (error: any) {
    // Ignore callback query timeout errors
    if (
      error instanceof GrammyError &&
      (error.description?.includes("query is too old") ||
        error.description?.includes("response timeout expired") ||
        error.description?.includes("query ID is invalid"))
    ) {
      console.debug(
        "Callback query timeout ignored (normal behavior):",
        error.description
      );
      return;
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Send an error message that automatically deletes after 2.5 seconds
 */
export async function sendErrorWithAutoDelete(
  ctx: Context,
  errorMessage: string,
  timeout: number = 2500
): Promise<void> {
  try {
    const sent = await sendMessage(ctx, errorMessage);

    // Auto-delete after specified timeout
    setTimeout(async () => {
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, sent.message_id);
      } catch (deleteError) {
        // Ignore deletion errors (message might already be deleted)
        console.debug("Failed to auto-delete error message:", deleteError);
      }
    }, timeout);
  } catch (error) {
    console.error("Failed to send error message:", error);
  }
}

/**
 * Send a temporary message that auto-deletes after specified timeout
 */
export async function sendTemporaryMessage(
  ctx: Context,
  message: string,
  timeout: number = 2500
): Promise<void> {
  try {
    const sent = await sendMessage(ctx, message);

    // Auto-delete after specified timeout
    setTimeout(async () => {
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, sent.message_id);
      } catch (deleteError) {
        // Ignore deletion errors (message might already be deleted)
        console.debug("Failed to auto-delete temporary message:", deleteError);
      }
    }, timeout);
  } catch (error) {
    console.error("Failed to send temporary message:", error);
  }
}

// Callback data compression utilities to handle long token addresses
// Telegram has a 64-byte limit for callback_data, so we need to compress long addresses

const CALLBACK_PREFIXES = {
  FUND_TOKEN_WALLETS: "ftw",
  SELL_DEV_SUPPLY: "sds",
  SELL_DEV: "sd",
  SELL_PERCENT: "sp",
  SELL_ALL: "sa",
  SELL_INDIVIDUAL: "si",
  AIRDROP_SOL: "as",
  REFRESH_LAUNCH_DATA: "rld",
  REFRESH_BONK_LAUNCH_DATA: "rbld",
  VIEW_TOKEN_TRADES: "vtt",
  LAUNCH_TOKEN: "lt",
  BUY_EXTERNAL_TOKEN: "bet",
  SELL_EXTERNAL_TOKEN: "set",
  CTO: "cto",
  CHART: "ch",
  // Add the actual enum values for LaunchMessageCallbacks
  refresh_launch_data: "rld",
  refresh_bonk_launch_data: "rbld",
};

// Compress callback data by using short prefixes and base64 encoding for addresses
export function compressCallbackData(
  action: string,
  tokenAddress: string
): string {
  // Debug logging and type validation
  if (typeof tokenAddress !== "string") {
    console.error(
      `[compressCallbackData] ERROR: tokenAddress is not a string!`,
      {
        action,
        tokenAddress,
        type: typeof tokenAddress,
        stack: new Error().stack,
      }
    );
    throw new Error(
      `tokenAddress must be a string, received ${typeof tokenAddress}: ${tokenAddress}`
    );
  }

  // Clean the token address first
  const cleanedTokenAddress = cleanTokenAddress(tokenAddress);

  const prefix = CALLBACK_PREFIXES[action as keyof typeof CALLBACK_PREFIXES];
  if (!prefix) {
    // Fallback to original format if no compression available
    return `${action}_${cleanedTokenAddress}`;
  }

  // Use base64 encoding for the token address to make it shorter
  const encodedAddress = Buffer.from(cleanedTokenAddress).toString("base64");
  return `${prefix}_${encodedAddress}`;
}

// Decompress callback data back to original format
export function decompressCallbackData(
  compressedData: string
): { action: string; tokenAddress: string } | null {
  const [prefix, encodedAddress] = compressedData.split("_");

  // Find the original action from the prefix
  const action = Object.keys(CALLBACK_PREFIXES).find(
    (key) => CALLBACK_PREFIXES[key as keyof typeof CALLBACK_PREFIXES] === prefix
  );

  if (!action || !encodedAddress) {
    return null;
  }

  try {
    // Decode the base64 address
    const tokenAddress = Buffer.from(encodedAddress, "base64").toString();
    return { action, tokenAddress };
  } catch (error) {
    return null;
  }
}

// Check if callback data is compressed
export function isCompressedCallbackData(data: string): boolean {
  const [prefix] = data.split("_");
  return Object.values(CALLBACK_PREFIXES).includes(prefix);
}

// Validate callback data length (Telegram has 64-byte limit)
export function validateCallbackData(data: string): boolean {
  return data.length <= 64;
}

// Clean and validate token address
export function cleanTokenAddress(tokenAddress: string): string {
  // Remove any "wallets_" prefix that might have been accidentally added
  if (typeof tokenAddress === "string" && tokenAddress.startsWith("wallets_")) {
    const cleaned = tokenAddress.substring(8); // Remove "wallets_" prefix
    console.warn(
      `[cleanTokenAddress] Removed 'wallets_' prefix from token address: ${cleaned}`
    );
    return cleaned;
  }
  return tokenAddress;
}

// Create safe callback data that won't exceed Telegram's limits
export function createSafeCallbackData(
  action: string,
  tokenAddress: string
): string {
  // Debug logging and type validation
  if (typeof tokenAddress !== "string") {
    console.error(
      `[createSafeCallbackData] ERROR: tokenAddress is not a string!`,
      {
        action,
        tokenAddress,
        type: typeof tokenAddress,
        stack: new Error().stack,
      }
    );
    throw new Error(
      `tokenAddress must be a string, received ${typeof tokenAddress}: ${tokenAddress}`
    );
  }

  // Clean the token address first
  const cleanedTokenAddress = cleanTokenAddress(tokenAddress);
  const compressed = compressCallbackData(action, cleanedTokenAddress);

  // If compressed data is still too long, try different strategies
  if (compressed.length > 64) {
    console.warn(
      `[createSafeCallbackData] Compressed data too long (${compressed.length} bytes), trying fallback strategies`
    );

    // Strategy 1: Try with shorter prefix
    const prefix = CALLBACK_PREFIXES[action as keyof typeof CALLBACK_PREFIXES];
    if (prefix && prefix.length < 4) {
      const shortCompressed = `${prefix}_${Buffer.from(cleanedTokenAddress).toString("base64")}`;
      if (shortCompressed.length <= 64) {
        return shortCompressed;
      }
    }

    // Strategy 2: Use a very short prefix and truncate address
    const shortPrefix = "cb";
    const maxAddressLength = 64 - shortPrefix.length - 1; // -1 for underscore
    const truncatedAddress = cleanedTokenAddress.substring(
      0,
      Math.max(10, maxAddressLength)
    );
    const fallbackData = `${shortPrefix}_${truncatedAddress}`;

    console.warn(
      `[createSafeCallbackData] Using fallback data: ${fallbackData} (${fallbackData.length} bytes)`
    );
    return fallbackData;
  }

  return compressed;
}

/**
 * Check if a user is authorized to use the bot
 */
export function isUserAuthorized(username?: string): boolean {
  if (!username) return false;

  const allowedUsers = env.ALLOWED_USERS.split(",").map((user: string) =>
    user.trim().toLowerCase()
  );

  // Remove @ symbol if present and convert to lowercase for comparison
  const cleanUsername = username.toLowerCase().replace(/^@/, "");

  return allowedUsers.includes(cleanUsername);
}
