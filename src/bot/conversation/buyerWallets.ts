import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { CallBackQueries } from "../types";
import type { ParseMode } from "grammy/types";
import { sendMessage } from "../../backend/sender";
import {
  getUser,
  getAllBuyerWallets,
  addBuyerWallet,
  generateNewBuyerWallet,
  deleteBuyerWallet,
  getBuyerWalletPrivateKey,
} from "../../backend/functions-main";
import { secretKeyToKeypair } from "../../blockchain/common/utils";

const manageBuyerWalletsConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // Get all buyer wallets for the user
  const wallets = await getAllBuyerWallets(user.id);

  const header = `<b>👥 Buyer Wallet Management</b>
You have <b>${wallets.length}/20</b> buyer wallets.

`;

  const lines = wallets
    .map((w, i) => {
      const short = `${w.publicKey.slice(0, 6)}…${w.publicKey.slice(-4)}`;
      return `${i + 1}. <code>${short}</code>`;
    })
    .join("\n");

  const messageText =
    header +
    (lines || "<i>No buyer wallets configured</i>") +
    "\n\nSelect an action:";

  const kb = new InlineKeyboard();

  // Add wallet management buttons for each wallet
  wallets.forEach((wallet) => {
    const short = `${wallet.publicKey.slice(0, 6)}…${wallet.publicKey.slice(-4)}`;
    kb.text(
      `📤 Export ${short}`,
      `${CallBackQueries.EXPORT_BUYER_WALLET}_${wallet.id}`
    )
      .text(
        `🗑️ Delete ${short}`,
        `${CallBackQueries.DELETE_BUYER_WALLET}_${wallet.id}`
      )
      .row();
  });

  // Add new wallet options if under limit
  if (wallets.length < 20) {
    kb.text("➕ Generate New Wallet", CallBackQueries.GENERATE_BUYER_WALLET)
      .text("📥 Import Wallet", CallBackQueries.IMPORT_BUYER_WALLET)
      .row();
  }

  kb.text("🔙 Back", CallBackQueries.BACK);

  await sendMessage(ctx, messageText, {
    parse_mode: "HTML" as ParseMode,
    reply_markup: kb,
  });

  const next = await conversation.wait();
  const data = next.callbackQuery?.data;
  if (!data) return conversation.halt();

  await next.answerCallbackQuery();

  try {
    if (data === CallBackQueries.BACK) {
      // Import and start wallet config conversation (since this is accessed from wallet config)
      const walletConfigConversation = await import("./walletConfig");
      return await walletConfigConversation.default(conversation, next);
    }

    if (data === CallBackQueries.GENERATE_BUYER_WALLET) {
      const newWallet = await generateNewBuyerWallet(user.id);
      await next.reply(
        `✅ New buyer wallet generated!\n\n<b>Address:</b> <code>${newWallet.publicKey}</code>\n\n<b>Private Key:</b>\n<code>${newWallet.privateKey}</code>\n\n<i>⚠️ Save this private key securely and delete this message!</i>`,
        { parse_mode: "HTML" }
      );
      return conversation.halt();
    }

    if (data === CallBackQueries.IMPORT_BUYER_WALLET) {
      const cancelKeyboard = new InlineKeyboard().text(
        "❌ Cancel",
        CallBackQueries.CANCEL_BUYER_WALLET
      );

      await sendMessage(
        next,
        "Please send the private key of the buyer wallet you want to import:",
        {
          reply_markup: cancelKeyboard,
        }
      );

      const privateKeyInput = await conversation.wait();

      if (
        privateKeyInput.callbackQuery?.data ===
        CallBackQueries.CANCEL_BUYER_WALLET
      ) {
        await privateKeyInput.answerCallbackQuery();
        await sendMessage(privateKeyInput, "Import cancelled.");
        return conversation.halt();
      }

      const privateKey = privateKeyInput.message?.text?.trim();
      if (!privateKey) {
        await sendMessage(
          privateKeyInput,
          "❌ No private key provided. Import cancelled."
        );
        return conversation.halt();
      }

      try {
        // Validate private key
        const keypair = secretKeyToKeypair(privateKey);
        const newWallet = await addBuyerWallet(user.id, privateKey);

        await sendMessage(
          privateKeyInput,
          `✅ Buyer wallet imported successfully!\n\n<b>Address:</b> <code>${newWallet.publicKey}</code>`,
          { parse_mode: "HTML" }
        );
      } catch (error: any) {
        await sendMessage(
          privateKeyInput,
          `❌ Import failed: ${error.message}`
        );
      }

      return conversation.halt();
    }

    // Handle export and delete actions
    const idx = data.lastIndexOf("_");
    const action = data.substring(0, idx);
    const walletId = data.substring(idx + 1);

    switch (action) {
      case CallBackQueries.EXPORT_BUYER_WALLET:
        try {
          const privateKey = await getBuyerWalletPrivateKey(user.id, walletId);
          const wallet = wallets.find((w) => w.id === walletId);
          if (wallet) {
            const msg = [
              "*Buyer Wallet Private Key*",
              `*Address:* \`${wallet.publicKey}\``,
              "```",
              privateKey,
              "```",
              "_Copy it now and delete the message as soon as you're done\\._",
            ].join("\n");
            const keyboard = new InlineKeyboard().text(
              "🗑 Delete",
              "del_message"
            );
            await next.reply(msg, {
              parse_mode: "MarkdownV2",
              reply_markup: keyboard,
            });
          }
        } catch (error: any) {
          await next.reply(`❌ Error: ${error.message}`);
        }
        break;

      case CallBackQueries.DELETE_BUYER_WALLET:
        try {
          await deleteBuyerWallet(user.id, walletId);
          await next.reply(`🗑️ Buyer wallet has been removed from your list.`, {
            parse_mode: "HTML",
          });
        } catch (error: any) {
          await next.reply(`❌ Error: ${error.message}`);
        }
        break;

      default:
        await next.reply("⚠️ Unknown action.", { parse_mode: "HTML" });
    }
  } catch (error: any) {
    await next.reply(`❌ An error occurred: ${error.message}`);
  }

  conversation.halt();
};

export default manageBuyerWalletsConversation;
