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

const WALLETS_PER_PAGE = 5; // Increased from 3 to 5 for better UI with 40 wallets
const MAX_WALLETS = 40; // Updated from 20 to 40

const manageBuyerWalletsConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
): Promise<void> => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // Main conversation loop
  while (true) {
    // Get all buyer wallets for the user (refresh on each iteration)
    const wallets = await getAllBuyerWallets(user.id);

    const header = `<b>👥 Buyer Wallet Management</b>
You have <b>${wallets.length}/${MAX_WALLETS}</b> buyer wallets.

`;

    // Calculate pagination
    const totalPages = Math.ceil(wallets.length / WALLETS_PER_PAGE);
    const currentPage = 1; // Default to first page, can be enhanced with page tracking

    const startIndex = (currentPage - 1) * WALLETS_PER_PAGE;
    const endIndex = Math.min(startIndex + WALLETS_PER_PAGE, wallets.length);
    const currentWallets = wallets.slice(startIndex, endIndex);

    const lines = currentWallets
      .map((w, i) => {
        const short = `${w.publicKey.slice(0, 6)}…${w.publicKey.slice(-4)}`;
        const globalIndex = startIndex + i + 1;
        return `${globalIndex}. <code>${short}</code>`;
      })
      .join("\n");

    const messageText =
      header +
      (lines || "<i>No buyer wallets configured</i>") +
      `\n\n📄 Page ${currentPage}/${totalPages}` +
      "\n\nSelect an action:";

    const kb = new InlineKeyboard();

    // Add wallet management buttons for current page wallets
    currentWallets.forEach((wallet) => {
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

    // Add pagination controls if needed
    if (totalPages > 1) {
      if (currentPage > 1) {
        kb.text(`⬅️ Previous Page`, `${CallBackQueries.PREV_PAGE}_${currentPage - 1}`);
      }
      if (currentPage < totalPages) {
        kb.text(`Next Page ➡️`, `${CallBackQueries.NEXT_PAGE}_${currentPage + 1}`);
      }
      kb.row();
    }

    // Add new wallet options if under limit
    if (wallets.length < MAX_WALLETS) {
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
        // Calculate how many wallets can still be generated
        const remainingSlots = MAX_WALLETS - wallets.length;
        
        const cancelKeyboard = new InlineKeyboard().text(
          "❌ Cancel",
          CallBackQueries.CANCEL_BUYER_WALLET
        );

        await sendMessage(
          next,
          `🔄 **Generate New Buyer Wallets**\n\nYou currently have <b>${wallets.length}/${MAX_WALLETS}</b> buyer wallets.\n\n<b>Maximum wallets you can generate:</b> ${remainingSlots}\n\nPlease enter the number of new wallets you want to generate (1-${remainingSlots}):`,
          {
            parse_mode: "HTML",
            reply_markup: cancelKeyboard,
          }
        );

        const quantityInput = await conversation.wait();

        if (
          quantityInput.callbackQuery?.data ===
          CallBackQueries.CANCEL_BUYER_WALLET
        ) {
          await quantityInput.answerCallbackQuery();
          await sendMessage(quantityInput, "Wallet generation cancelled.");
          return conversation.halt();
        }

        const quantityText = quantityInput.message?.text?.trim();
        if (!quantityText) {
          await sendMessage(
            quantityInput,
            "❌ No quantity provided. Generation cancelled."
          );
          return conversation.halt();
        }

        const quantity = parseInt(quantityText);
        if (isNaN(quantity) || quantity < 1 || quantity > remainingSlots) {
          await sendMessage(
            quantityInput,
            `❌ Invalid quantity. Please enter a number between 1 and ${remainingSlots}.`
          );
          return conversation.halt();
        }

        // Generate the requested number of wallets
        const generatedWallets = [];
        for (let i = 0; i < quantity; i++) {
          const newWallet = await generateNewBuyerWallet(user.id);
          generatedWallets.push(newWallet);
        }

        // Create success message
        let successMessage = `✅ Successfully generated <b>${quantity}</b> new buyer wallet${quantity > 1 ? 's' : ''}!\n\n`;
        
        if (quantity === 1) {
          // Single wallet - show full details
          const wallet = generatedWallets[0];
          successMessage += `<b>Address:</b> <code>${wallet.publicKey}</code>\n\n<b>Private Key:</b>\n<code>${wallet.privateKey}</code>\n\n<i>⚠️ Save this private key securely and delete this message!</i>`;
        } else {
          // Multiple wallets - show summary and list
          successMessage += `<b>Generated Wallets:</b>\n`;
          generatedWallets.forEach((wallet, index) => {
            const short = `${wallet.publicKey.slice(0, 6)}…${wallet.publicKey.slice(-4)}`;
            successMessage += `${index + 1}. <code>${short}</code>\n`;
          });
          successMessage += `\n<i>⚠️ Private keys have been generated but not shown for security. Use the export function to get individual private keys.</i>`;
        }

        await sendMessage(quantityInput, successMessage, { parse_mode: "HTML" });
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

      // Handle pagination
      if (data.startsWith(CallBackQueries.PREV_PAGE) || data.startsWith(CallBackQueries.NEXT_PAGE)) {
        // For now, just continue the loop to refresh the page
        // In a full implementation, you'd track the page number
        continue;
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
            // Continue the loop to show updated wallet list
            continue;
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

    return conversation.halt();
  }
};

export default manageBuyerWalletsConversation;
