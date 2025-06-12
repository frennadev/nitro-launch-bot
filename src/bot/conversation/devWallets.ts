import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { CallBackQueries } from "../types";
import type { ParseMode } from "grammy/types";
import { sendMessage } from "../../backend/sender";
import bot from "..";

const manageDevWalletsConversation = async (conversation: Conversation<Context>, ctx: Context) => {
  const wallets = [
    "DevAddr1ABCDEFG12345",
    "DevAddr2HIJKLMN67890",
    "DevAddr3OPQRSTU24680",
    "DevAddr4VWXYZAB13579",
    "DevAddr5CDEFGHI97531",
  ];

  const header = `<b>Developer Wallet Management</b>
Please use the buttons below to:
• Select a wallet for deployment
• Set a default wallet
• Remove an obsolete wallet

`;
  const lines = wallets.map((w, i) => `${i + 1}. <code>${w}</code>`).join("\n");
  const messageText = header + lines;

  const kb = new InlineKeyboard();
  wallets.forEach((address) => {
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
    kb.text(`Select `, `${CallBackQueries.SELECT_DEV}_${address}`)
      .text(`Set Default `, `${CallBackQueries.DEFAULT_DEV}_${address}`)
      .text(`🗑️ Delete ${short}`, `${CallBackQueries.DELETE_DEV}_${address}`)
      .row();
  });
  kb.text("🔙 Back", CallBackQueries.BACK);

  await sendMessage(ctx, messageText, {
    parse_mode: "HTML" as ParseMode,
    reply_markup: kb,
  });

  const next = await conversation.wait();
  const data = next.callbackQuery?.data;
  if (!data) return conversation.halt();

  const idx = data.lastIndexOf("_");
  const action = data.substring(0, idx);
  const address = data.substring(idx + 1);
  await next.answerCallbackQuery();

  console.log({ action, address });
  switch (action) {
    case CallBackQueries.SELECT_DEV:
      await next.reply(`✅ You have selected <code>${address}</code> for deployment.`, { parse_mode: "HTML" });

      break;
    case CallBackQueries.DEFAULT_DEV:
      await next.reply(`⭐ <code>${address}</code> is now your default developer wallet.`, { parse_mode: "HTML" });
      break;
    case CallBackQueries.DELETE_DEV:
      await next.reply(`🗑️ <code>${address}</code> has been removed from your list.`, { parse_mode: "HTML" });
      break;
    default:
      await next.reply("⚠️ Unknown action.", { parse_mode: "HTML" });
  }

  conversation.halt();
};

export default manageDevWalletsConversation;
