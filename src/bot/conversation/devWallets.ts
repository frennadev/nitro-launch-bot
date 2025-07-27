import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { CallBackQueries } from "../types";
import type { ParseMode } from "grammy/types";
import { sendMessage } from "../../backend/sender";
import {
  getUser,
  getAllDevWallets,
  setDefaultDevWallet,
  deleteDevWallet,
  addDevWallet,
  generateNewDevWallet,
} from "../../backend/functions-main";
import { secretKeyToKeypair } from "../../blockchain/common/utils";

const manageDevWalletsConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
): Promise<void> => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "❌ Unrecognized user");
    return conversation.halt();
  }

  // Get all dev wallets for the user
  const wallets = await getAllDevWallets(user.id);

  const header = `<b>💼 Developer Wallet Management</b>

You have <b>${wallets.length}/5</b> developer wallets configured.

`;

  const lines = wallets
    .map((w, i) => {
      const short = `${w.publicKey.slice(0, 6)}…${w.publicKey.slice(-4)}`;
      const defaultIndicator = w.isDefault ? " ⭐" : "";
      return `${i + 1}. <code>${short}</code>${defaultIndicator}`;
    })
    .join("\n");

  const messageText = header + lines + "\n\n<b>Select an action:</b>";

  const kb = new InlineKeyboard();

  // Add wallet management buttons for each wallet
  wallets.forEach((wallet) => {
    const short = `${wallet.publicKey.slice(0, 6)}…${wallet.publicKey.slice(-4)}`;
    if (!wallet.isDefault) {
      kb.text(
        `⭐ Set Default ${short}`,
        `${CallBackQueries.DEFAULT_DEV}_${wallet.id}`
      );
    }
    if (wallets.length > 1) {
      kb.text(
        `🗑️ Delete ${short}`,
        `${CallBackQueries.DELETE_DEV}_${wallet.id}`
      );
    }
    kb.row();
  });

  // Add new wallet options if under limit
  if (wallets.length < 5) {
    kb.text("➕ Generate New Wallet", CallBackQueries.GENERATE_DEV_WALLET)
      .text("📥 Import Wallet", CallBackQueries.IMPORT_DEV_WALLET)
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

    if (data === CallBackQueries.GENERATE_DEV_WALLET) {
      const newWallet = await generateNewDevWallet(user.id);
      const message = `<b>✅ New Developer Wallet Generated Successfully!</b>

<b>📍 Wallet Address:</b>
<code>${newWallet.publicKey}</code>

<b>🔐 Private Key:</b>
<code>${newWallet.privateKey}</code>

<b>⚠️ IMPORTANT SECURITY NOTICE:</b>
• Save your private key in a secure location
• Never share your private key with anyone
• Delete this message after saving your keys
• This is the only time you'll see your private key`;

      await sendMessage(next, message, { parse_mode: "HTML" });
      return conversation.halt();
    }

    if (data === CallBackQueries.IMPORT_DEV_WALLET) {
      const cancelKeyboard = new InlineKeyboard().text(
        "❌ Cancel",
        CallBackQueries.CANCEL_DEV_WALLET
      );

      await sendMessage(
        next,
        `<b>📥 Import Developer Wallet</b>

Please send the private key of the wallet you want to import:

<i>💡 Tip: Make sure you're in a private chat and delete the message after sending</i>`,
        {
          parse_mode: "HTML",
          reply_markup: cancelKeyboard,
        }
      );

      const privateKeyInput = await conversation.wait();

      if (
        privateKeyInput.callbackQuery?.data ===
        CallBackQueries.CANCEL_DEV_WALLET
      ) {
        await privateKeyInput.answerCallbackQuery();
        await sendMessage(privateKeyInput, "❌ Import cancelled");
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
        const newWallet = await addDevWallet(user.id, privateKey);

        const successMessage = `<b>✅ Wallet Imported Successfully!</b>

<b>📍 Wallet Address:</b>
<code>${newWallet.publicKey}</code>

<i>🛡️ Your wallet has been securely added to your developer wallets</i>`;

        await sendMessage(privateKeyInput, successMessage, {
          parse_mode: "HTML",
        });
      } catch (error: any) {
        await sendMessage(
          privateKeyInput,
          `<b>❌ Import Failed</b>

<b>Error:</b> ${error.message}

<i>Please check your private key format and try again</i>`,
          { parse_mode: "HTML" }
        );
      }

      return conversation.halt();
    }

    // Handle default and delete actions
    const idx = data.lastIndexOf("_");
    const action = data.substring(0, idx);
    const walletId = data.substring(idx + 1);

    switch (action) {
      case CallBackQueries.DEFAULT_DEV:
        try {
          const publicKey = await setDefaultDevWallet(user.id, walletId);
          const short = `${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`;

          await sendMessage(
            next,
            `<b>⭐ Default Wallet Updated</b>

<code>${short}</code> is now your default developer wallet.

<i>All new token deployments will use this wallet</i>`,
            { parse_mode: "HTML" }
          );
        } catch (error: any) {
          await sendMessage(
            next,
            `<b>❌ Failed to Set Default Wallet</b>

<b>Error:</b> ${error.message}`,
            { parse_mode: "HTML" }
          );
        }
        break;

      case CallBackQueries.DELETE_DEV:
        try {
          await deleteDevWallet(user.id, walletId);

          await sendMessage(
            next,
            `<b>🗑️ Wallet Removed Successfully</b>

The wallet has been removed from your developer wallets list.

<i>You can always add it back later if needed</i>`,
            { parse_mode: "HTML" }
          );
        } catch (error: any) {
          await sendMessage(
            next,
            `<b>❌ Failed to Delete Wallet</b>

<b>Error:</b> ${error.message}`,
            { parse_mode: "HTML" }
          );
        }
        break;

      default:
        await sendMessage(
          next,
          `<b>⚠️ Unknown Action</b>

The requested action could not be processed.`,
          { parse_mode: "HTML" }
        );
    }
  } catch (error: any) {
    await sendMessage(
      next,
      `<b>❌ An Error Occurred</b>

<b>Error:</b> ${error.message}

<i>Please try again or contact support if the issue persists</i>`,
      { parse_mode: "HTML" }
    );
  }

  conversation.halt();
};

export default manageDevWalletsConversation;
