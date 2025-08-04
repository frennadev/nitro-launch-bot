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
  ctx: Context,
  initialPage: number = 1
): Promise<void> => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // Track current page
  let currentPage = initialPage;

  // Main conversation loop
  while (true) {
    // Get all buyer wallets for the user (refresh on each iteration)
    const wallets = await getAllBuyerWallets(user.id);

    const header = `<b>👥 Buyer Wallet Management</b>
You have <b>${wallets.length}/${MAX_WALLETS}</b> buyer wallets.

`;

    // Calculate pagination
    const totalPages = Math.ceil(wallets.length / WALLETS_PER_PAGE);
    
    // Ensure current page is within valid range
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (totalPages === 0) currentPage = 1;

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
        kb.text(
          `⬅️ Previous Page`,
          `${CallBackQueries.PREV_PAGE}_${currentPage - 1}`
        );
      }
      if (currentPage < totalPages) {
        kb.text(
          `Next Page ➡️`,
          `${CallBackQueries.NEXT_PAGE}_${currentPage + 1}`
        );
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
          `🔄 <b>Generate New Buyer Wallets</b>\n\nYou currently have <b>${wallets.length}/${MAX_WALLETS}</b> buyer wallets.\n\n💡 You can generate up to <b>${remainingSlots}</b> more wallets.\n\nPlease enter the number of wallets to generate:`,
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
        let successMessage = `✅ Successfully generated <b>${quantity}</b> new buyer wallet${quantity > 1 ? "s" : ""}!\n\n`;
        if (quantity === 1) {
          // Single wallet - show full details
          const wallet = generatedWallets[0];
          const addressDisplay = `${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-8)}`;

          successMessage += [
            `🔐 <b>Wallet Details:</b>`,
            `<b>Address:</b> <code>${addressDisplay}</code>`,
            `<b>Full Address:</b> <code>${wallet.publicKey}</code>`,
            ``,
            `🔑 <b>Private Key:</b>`,
            `<tg-spoiler>${wallet.privateKey}</tg-spoiler>`,
            ``,
            `⚠️ <i>Save this private key securely and delete this message!</i>`,
          ].join("\n");
        } else {
          // Multiple wallets - show summary and list
          successMessage += [`📋 <b>Generated Wallets:</b>`, ``].join("\n");

          generatedWallets.forEach((wallet, index) => {
            const shortAddress = `${wallet.publicKey.slice(0, 6)}...${wallet.publicKey.slice(-4)}`;
            successMessage += `${index + 1}. <code>${shortAddress}</code>\n`;
          });

          successMessage += `\n💡 <i>Use the Export button to get private keys for individual wallets.</i>`;
        }

        await sendMessage(next, successMessage, {
          parse_mode: "HTML",
        });

        return conversation.halt();
      }

      if (data === CallBackQueries.IMPORT_BUYER_WALLET) {
        // Check if user can add more wallets
        if (wallets.length >= MAX_WALLETS) {
          await sendMessage(
            next,
            `❌ You have reached the maximum limit of ${MAX_WALLETS} buyer wallets. Please delete some wallets before importing new ones.`
          );
          return conversation.halt();
        }

        const cancelKeyboard = new InlineKeyboard().text(
          "❌ Cancel",
          CallBackQueries.CANCEL_BUYER_WALLET
        );

        await sendMessage(
          next,
          `📥 <b>Import Buyer Wallet</b>\n\nPlease enter the private key of the wallet you want to import:`,
          {
            parse_mode: "HTML",
            reply_markup: cancelKeyboard,
          }
        );

        const privateKeyInput = await conversation.wait();

        // Handle callback queries first (like cancel button)
        if (privateKeyInput.callbackQuery?.data === CallBackQueries.CANCEL_BUYER_WALLET) {
          await privateKeyInput.answerCallbackQuery();
          await sendMessage(privateKeyInput, "Wallet import cancelled.");
          return conversation.halt();
        }

        // If it's a callback query but not cancel, ignore and wait for text message
        if (privateKeyInput.callbackQuery && privateKeyInput.callbackQuery.data !== CallBackQueries.CANCEL_BUYER_WALLET) {
          await privateKeyInput.answerCallbackQuery();
          await sendMessage(
            privateKeyInput,
            "❌ Please send your private key as a text message, not by clicking buttons."
          );
          return conversation.halt();
        }

        // Check if it's actually a text message
        if (!privateKeyInput.message?.text) {
          await sendMessage(
            privateKeyInput,
            [
              "❌ <b>Invalid message type</b>",
              "",
              "Please send your private key as a <b>text message</b>.",
              "",
              "💡 <b>Make sure to:</b>",
              "• Type or paste the private key",
              "• Send as text (not photo, file, or voice)",
              "• Don't use any special formatting",
              "",
              "<i>Please try again.</i>"
            ].join("\n"),
            { parse_mode: "HTML" }
          );
          return conversation.halt();
        }

        const privateKey = privateKeyInput.message.text.trim();
        
        // Debug logging to help identify the issue
        console.log('🔍 Debug - Import wallet input received:');
        console.log('  Message type:', 'text');
        console.log('  Raw text:', privateKeyInput.message.text);
        console.log('  Raw text length:', privateKeyInput.message.text.length);
        console.log('  Trimmed text:', privateKey);
        console.log('  Trimmed length:', privateKey.length);
        console.log('  privateKey type:', typeof privateKey);
        console.log('  privateKey === "":', privateKey === "");
        
        // Enhanced validation with detailed error messages
        if (!privateKey || privateKey.length === 0) {
          await sendMessage(
            privateKeyInput,
            [
              "❌ <b>No private key provided</b>",
              "",
              "Please enter a valid private key.",
              "",
              "💡 <b>Private key should be:</b>",
              "• Base58 encoded string",
              "• Usually 87-88 characters long",
              "• Example format: 5Hp7fTYnE2hd6d...(continues)",
              "",
              "<i>Import cancelled.</i>"
            ].join("\n"),
            { parse_mode: "HTML" }
          );
          return conversation.halt();
        }

        // Additional validation for common issues
        if (privateKey.includes(" ") && privateKey.split(" ").length > 1) {
          await sendMessage(
            privateKeyInput,
            [
              "❌ <b>Invalid private key format</b>",
              "",
              "It looks like you entered a seed phrase instead of a private key.",
              "",
              "💡 <b>To get your private key:</b>",
              "1. Open your wallet app (Phantom, Solflare, etc.)",
              "2. Go to Settings → Export Private Key",
              "3. Copy the private key (not the seed phrase)",
              "",
              "<i>Import cancelled.</i>"
            ].join("\n"),
            { parse_mode: "HTML" }
          );
          return conversation.halt();
        }

        try {
          // Validate and convert private key
          const keypair = secretKeyToKeypair(privateKey);
          const newWallet = await addBuyerWallet(user.id, privateKey);

          const successMessage = [
            `✅ <b>Wallet Imported Successfully!</b>`,
            ``,
            `<b>Address:</b> <code>${newWallet.publicKey.slice(0, 8)}...${newWallet.publicKey.slice(-8)}</code>`,
            `<b>Full Address:</b> <code>${newWallet.publicKey}</code>`,
            ``,
            `💡 <i>Your wallet has been added to your buyer wallets list.</i>`,
          ].join("\n");

          await sendMessage(privateKeyInput, successMessage, {
            parse_mode: "HTML",
          });
        } catch (error: any) {
          let errorMessage = "❌ <b>Import failed</b>\n\n";
          
          if (error.message.includes("Invalid secret key format")) {
            errorMessage += [
              "The private key format is invalid.",
              "",
              "💡 <b>Common issues:</b>",
              "• Private key must be Base58 encoded",
              "• Should be 87-88 characters long",
              "• Don't include extra characters or spaces",
              "• Make sure you copied the entire key",
              "",
              "💡 <b>How to get your private key:</b>",
              "1. Open your wallet (Phantom, Solflare, etc.)",
              "2. Go to Settings → Security → Export Private Key",
              "3. Copy the full private key string",
              "",
              "<i>Please try again with a valid private key.</i>"
            ].join("\n");
          } else if (error.message.includes("Invalid secret key: key must be a non-empty string")) {
            errorMessage += [
              "No private key was received.",
              "",
              "💡 <b>Please make sure to:</b>",
              "• Type or paste your private key",
              "• Send it as a text message",
              "• Don't send as a file or image",
              "",
              "<i>Please try the import process again.</i>"
            ].join("\n");
          } else {
            errorMessage += [
              `Error: ${error.message}`,
              "",
              "💡 <b>Need help?</b>",
              "Make sure your private key is:",
              "• A valid Solana private key",
              "• Base58 encoded format",
              "• Copied correctly without extra characters"
            ].join("\n");
          }
          
          await sendMessage(privateKeyInput, errorMessage, {
            parse_mode: "HTML"
          });
        }

        return conversation.halt();
      }

      // Handle pagination
      if (data.startsWith(CallBackQueries.PREV_PAGE)) {
        const pageMatch = data.match(new RegExp(`${CallBackQueries.PREV_PAGE}_(\\d+)`));
        if (pageMatch) {
          const newPage = parseInt(pageMatch[1]);
          if (newPage >= 1) {
            currentPage = newPage;
            continue; // Continue the loop to show the new page
          }
        }
      }

      if (data.startsWith(CallBackQueries.NEXT_PAGE)) {
        const pageMatch = data.match(new RegExp(`${CallBackQueries.NEXT_PAGE}_(\\d+)`));
        if (pageMatch) {
          const newPage = parseInt(pageMatch[1]);
          const totalPages = Math.ceil(wallets.length / WALLETS_PER_PAGE);
          if (newPage <= totalPages) {
            currentPage = newPage;
            continue; // Continue the loop to show the new page
          }
        }
      }

      // Handle export and delete actions
      const idx = data.lastIndexOf("_");
      const action = data.substring(0, idx);
      const walletId = data.substring(idx + 1);

      switch (action) {
        case CallBackQueries.EXPORT_BUYER_WALLET:
          try {
            const privateKey = await getBuyerWalletPrivateKey(
              user.id,
              walletId
            );
            const wallet = wallets.find((w) => w.id === walletId);
            if (wallet) {
              const shortAddress = `${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-8)}`;

              const exportMessage = [
                `🔐 <b>Buyer Wallet Export</b>`,
                ``,
                `<b>Address:</b> <code>${shortAddress}</code>`,
                `<b>Full Address:</b> <code>${wallet.publicKey}</code>`,
                ``,
                `🔑 <b>Private Key:</b>`,
                `<span class="tg-spoiler">${privateKey}</span>`,
                ``,
                `⚠️ <i>Save this private key securely and delete this message!</i>`,
              ].join("\n");

              const deleteKeyboard = new InlineKeyboard().text(
                "🗑️ Delete Message",
                "del_message"
              );

              await sendMessage(next, exportMessage, {
                parse_mode: "HTML",
                reply_markup: deleteKeyboard,
              });
            }
          } catch (error: any) {
            await next.reply(`❌ Error: ${error.message}`);
          }
          break;

        case CallBackQueries.DELETE_BUYER_WALLET:
          try {
            await deleteBuyerWallet(user.id, walletId);
            await next.reply(
              `🗑️ Buyer wallet has been removed from your list.`,
              {
                parse_mode: "HTML",
              }
            );
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
