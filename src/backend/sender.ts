import type { Context } from "grammy";

interface EditOptions {
  parse_mode?: "MarkdownV2" | "Markdown" | "HTML";
  reply_markup?: any;
}

type SavedMessage = { chatId: number | string; messageId: number };
const lastMessageMap = new Map<string, SavedMessage>();

export async function sendMessage(ctx: Context, text: string, opts: EditOptions = {}) {
  const chatId = ctx.chat?.id;
  const callbackMsg = ctx.callbackQuery?.message;
  let msgResult;

  if (callbackMsg) {
    try {
      const res = await ctx.editMessageText(text, opts);
      if (typeof res !== "boolean") {
        msgResult = res;
      } else {
        msgResult = await ctx.reply(text, opts);
      }
    } catch {
      msgResult = await ctx.reply(text, opts);
    }
  } else {
    msgResult = await ctx.reply(text, opts);
  }

  if (chatId != null && msgResult && typeof msgResult !== "boolean") {
    lastMessageMap.set(String(chatId), { chatId, messageId: msgResult.message_id });
  }

  return msgResult;
}

export function getLastMessage(chat: number | string): SavedMessage | undefined {
  return lastMessageMap.get(String(chat));
}
