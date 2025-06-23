import { Context } from "grammy";
import { InlineKeyboard } from "grammy";

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
      await ctx.reply(text, options);
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
