import type { Context } from "grammy";
import { InlineKeyboardMarkup } from "grammy/types";
import bot from "../bot";

interface EditOptions {
  parse_mode?: "MarkdownV2" | "Markdown" | "HTML";
  reply_markup?: InlineKeyboardMarkup;
}

type SavedMessage = {
  chatId: number | string;
  messageId: number;
  timestamp?: number;
};
export const lastMessageMap = new Map<string, SavedMessage>();

export async function sendMessage(
  ctx: Context,
  text: string,
  opts: EditOptions = {}
) {
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
    const lastMessage = getLastMessage(chatId as number);
    if (!lastMessage && ctx.message) {
      // Get the previous message ID (one before current message)
      const previousMessageId = ctx.message.message_id - 1;
      lastMessageMap.set(String(chatId), {
        chatId: chatId as number,
        messageId: previousMessageId,
      });
    }
    if (ctx.message !== undefined) {
      try {
        await ctx.api.deleteMessage(
          ctx.message.chat.id,
          ctx.message.message_id
        );
      } catch {
        // Ignore deletion errors (message might already be deleted)
      }
    }
    if (lastMessage !== undefined) {
      const now = Date.now();
      const messageAge = now - (lastMessage.timestamp || 0);
      const twoMinutesInMs = 1 * 60 * 1000;

      if (messageAge < twoMinutesInMs) {
        try {
          const editResult = await ctx.api.editMessageText(
            lastMessage.chatId,
            lastMessage.messageId,
            text,
            opts
          );
          if (typeof editResult !== "boolean") {
            msgResult = editResult;
            return msgResult;
          }
        } catch {
          // Ignore deletion errors (message might already be deleted)
        }
      }
    }
    if (lastMessage) {
      try {
        // await ctx.api.deleteMessage(lastMessage.chatId, lastMessage.messageId);
      } catch {
        // Ignore deletion errors (message might already be deleted)
      }
    }
    msgResult = await ctx.reply(text, opts);
  }

  if (chatId != null && msgResult && typeof msgResult !== "boolean") {
    lastMessageMap.set(String(chatId), {
      chatId,
      messageId: msgResult.message_id,
      timestamp: Date.now(),
    });
  }

  return msgResult;
}

export function getLastMessage(
  chat: number | string
): SavedMessage | undefined {
  return lastMessageMap.get(String(chat));
}

export const sendNotification = async (
  chatId: number,
  message: string,
  keyboard?: InlineKeyboardMarkup
) => {
  await bot.api.sendMessage(chatId, message, {
    parse_mode: "HTML",
    reply_markup: keyboard || { remove_keyboard: true },
  });
};

export async function sendFirstMessage(
  ctx: Context,
  text: string,
  opts: EditOptions = {}
) {
  const chatId = ctx.chat?.id;

  // Use ctx.reply for the first message in a conversation/command
  const msgResult = await ctx.reply(text, opts);

  // Set this as the last message for future edits
  if (chatId != null && msgResult && typeof msgResult !== "boolean") {
    lastMessageMap.set(String(chatId), {
      chatId,
      messageId: msgResult.message_id,
      timestamp: Date.now(),
    });
  }

  return msgResult;
}
