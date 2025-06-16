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
  generateNewDevWallet 
} from "../../backend/functions-main";
import { secretKeyToKeypair } from "../../blockchain/common/utils";

const manageDevWalletsConversation = async (conversation: Conversation<Context>, ctx: Context) => {
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // Get all dev wallets for the user
  const wallets = await getAllDevWallets(user.id);

  const header = `<b>Developer Wallet Management</b>
You have <b>${wallets.length}/5</b> dev wallets.

`;
  
  const lines = wallets.map((w, i) => {
    const short = `${w.publicKey.slice(0, 6)}…${w.publicKey.slice(-4)}`;
    const defaultIndicator = w.isDefault ? " ⭐" : "";
    return `${i + 1}. <code>${short}</code>${defaultIndicator}`;
  }).join("\n");
  
  const messageText = header + lines + "\n\nSelect an action:";

  const kb = new InlineKeyboard();
  
  // Add wallet management buttons for each wallet
  wallets.forEach((wallet) => {
    const short = `${wallet.publicKey.slice(0, 6)}…${wallet.publicKey.slice(-4)}`;
    if (!wallet.isDefault) {
      kb.text(`⭐ Set Default ${short}`, `${CallBackQueries.DEFAULT_DEV}_${wallet.id}`);
    }
    if (wallets.length > 1) {
      kb.text(`🗑️ Delete ${short}`, `${CallBackQueries.DELETE_DEV}_${wallet.id}`);
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
      return conversation.halt();
    }
    
    if (data === CallBackQueries.GENERATE_DEV_WALLET) {
      const newWallet = await generateNewDevWallet(user.id);
      await next.reply(
        `✅ New dev wallet generated!\n\n<b>Address:</b> <code>${newWallet.publicKey}</code>\n\n<b>Private Key:</b>\n<code>${newWallet.privateKey}</code>\n\n<i>⚠️ Save this private key securely and delete this message!</i>`,
        { parse_mode: "HTML" }
      );
      return conversation.halt();
    }
    
    if (data === CallBackQueries.IMPORT_DEV_WALLET) {
      const cancelKeyboard = new InlineKeyboard().text("❌ Cancel", CallBackQueries.CANCEL_DEV_WALLET);
      
      await sendMessage(next, "Please send the private key of the wallet you want to import:", {
        reply_markup: cancelKeyboard,
      });

      const privateKeyInput = await conversation.wait();
      
      if (privateKeyInput.callbackQuery?.data === CallBackQueries.CANCEL_DEV_WALLET) {
        await privateKeyInput.answerCallbackQuery();
        await sendMessage(privateKeyInput, "Import cancelled.");
        return conversation.halt();
      }

      const privateKey = privateKeyInput.message?.text?.trim();
      if (!privateKey) {
        await sendMessage(privateKeyInput, "❌ No private key provided. Import cancelled.");
        return conversation.halt();
      }

      try {
        // Validate private key
        const keypair = secretKeyToKeypair(privateKey);
        const newWallet = await addDevWallet(user.id, privateKey);
        
        await sendMessage(privateKeyInput, 
          `✅ Wallet imported successfully!\n\n<b>Address:</b> <code>${newWallet.publicKey}</code>`,
          { parse_mode: "HTML" }
        );
      } catch (error: any) {
        await sendMessage(privateKeyInput, `❌ Import failed: ${error.message}`);
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
          await next.reply(`⭐ <code>${short}</code> is now your default developer wallet.`, { parse_mode: "HTML" });
        } catch (error: any) {
          await next.reply(`❌ Error: ${error.message}`);
        }
        break;
        
      case CallBackQueries.DELETE_DEV:
        try {
          await deleteDevWallet(user.id, walletId);
          await next.reply(`🗑️ Wallet has been removed from your list.`, { parse_mode: "HTML" });
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

export default manageDevWalletsConversation;
