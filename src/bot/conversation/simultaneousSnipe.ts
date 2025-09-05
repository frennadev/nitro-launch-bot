import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { CallBackQueries } from "../types";
import type { ParseMode } from "grammy/types";
import { sendMessage } from "../../backend/sender";
import {
  getUser,
  getAllBuyerWallets,
  getFundingWallet,
  getWalletBalance,
} from "../../backend/functions";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { env } from "../../config";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import { executeExternalBuy } from "../../blockchain/pumpfun/externalBuy";

export const simultaneousSnipeConversation = async (
  conversation: Conversation<Context>,
  ctx: Context,
  platform: "pumpfun" | "bonk",
  tokenAddress: string,
  buyAmount: number
): Promise<void> => {
  await ctx.answerCallbackQuery();
  
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(
      ctx,
      "❌ <b>Access Denied</b>\n\nUnrecognized user. Please start the bot first.",
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  const platformName = platform === "pumpfun" ? "PumpFun" : "LetsBonk";
  const platformEmoji = platform === "pumpfun" ? "🎉" : "🚀";

  // Get buyer wallets
  const buyerWallets = await getAllBuyerWallets(user.id);
  if (!buyerWallets || buyerWallets.length === 0) {
    await sendMessage(
      ctx,
      [
        "❌ <b>No Buyer Wallets</b>",
        "",
        "You don't have any buyer wallets configured.",
        "",
        "⚙️ Please configure buyer wallets first using the wallet management menu.",
        "",
        "<i>You need buyer wallets to use the simultaneous snipe method.</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Get funding wallet for distribution
  const fundingWallet = await getFundingWallet(user.id);
  if (!fundingWallet) {
    await sendMessage(
      ctx,
      [
        "❌ <b>No Funding Wallet</b>",
        "",
        "No funding wallet available for distribution.",
        "",
        "⚙️ Please configure a funding wallet first.",
        "",
        "<i>Use the wallet management menu to set up your funding wallet.</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Check funding wallet balance
  const fundingBalance = await getWalletBalance(fundingWallet.publicKey);
  const totalNeeded = buyAmount * buyerWallets.length;
  const feeReserve = 0.001 * buyerWallets.length; // Reserve for transaction fees
  const totalRequired = totalNeeded + feeReserve;

  if (fundingBalance < totalRequired) {
    await sendMessage(
      ctx,
      [
        "❌ <b>Insufficient Balance</b>",
        "",
        `💰 <b>Current Balance:</b> <code>${fundingBalance.toFixed(6)} SOL</code>`,
        `💵 <b>Total Required:</b> <code>${totalRequired.toFixed(6)} SOL</code>`,
        `  • Buy Amount: <code>${totalNeeded.toFixed(6)} SOL</code>`,
        `  • Fee Reserve: <code>${feeReserve.toFixed(6)} SOL</code>`,
        "",
        `<i>Please fund your wallet before proceeding.</i>`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Show confirmation with details
  const messageText = `
🎯 <b>Simultaneous Snipe Confirmation</b>

${platformEmoji} <b>Platform:</b> ${platformName}
📍 <b>Token:</b> <code>${tokenAddress}</code>
💵 <b>Amount per Wallet:</b> <code>${buyAmount.toFixed(6)} SOL</code>
👥 <b>Total Wallets:</b> <code>${buyerWallets.length}</code>
💰 <b>Total Amount:</b> <code>${totalNeeded.toFixed(6)} SOL</code>
💳 <b>Funding Wallet:</b> <code>${fundingWallet.publicKey.slice(0, 8)}...${fundingWallet.publicKey.slice(-8)}</code>

⚡ <b>This will:</b>
• Distribute funds to all ${buyerWallets.length} buyer wallets
• Execute simultaneous buy transactions
• Use all wallets to snipe the token

⚠️ <b>Are you ready to proceed?</b>
`.trim();

  const keyboard = new InlineKeyboard()
    .text("✅ Confirm Simultaneous Snipe", "confirm_simultaneous_snipe")
    .row()
    .text("❌ Cancel", CallBackQueries.CANCEL_SNIPE_METHOD);

  await sendMessage(ctx, messageText, {
    parse_mode: "HTML" as ParseMode,
    reply_markup: keyboard,
  });

  const confirmation = await conversation.waitFor("callback_query:data");
  await confirmation.answerCallbackQuery();

  if (confirmation.callbackQuery?.data === CallBackQueries.CANCEL_SNIPE_METHOD) {
    await sendMessage(
      confirmation,
      "❌ <b>Simultaneous Snipe Cancelled</b>\n\nOperation has been cancelled.",
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  if (confirmation.callbackQuery?.data === "confirm_simultaneous_snipe") {
    try {
      await sendMessage(
        confirmation,
        [
          "🔄 <b>Processing Simultaneous Snipe</b>",
          "",
          "⏳ Step 1: Distributing funds to buyer wallets...",
          "",
          "<i>Please wait while we process your transactions</i>",
        ].join("\n"),
        { parse_mode: "HTML" }
      );

      // Step 1: Distribute funds using mixer
      const { runMixer } = await import("../../blockchain/mixer/index");
      const destinationAddresses = buyerWallets.map(wallet => wallet.publicKey);
      
      const mixerResult = await runMixer(
        fundingWallet.privateKey,
        fundingWallet.privateKey, // Use same wallet for fees
        totalNeeded,
        destinationAddresses,
        {
          parallelMode: true,          // Enable parallel mode for speed (safety tests passed)
          maxConcurrentTx: 3,          // Keep concurrent options available
          balanceCheckTimeout: 5000,   // 5 second timeout for balance checks
          fastMode: false,             // Disable optimizations for stability
        }
      );

      // Check mixer results
      const successfulRoutes = mixerResult.results?.filter(result => result.success) || [];
      
      if (successfulRoutes.length === 0) {
        await sendMessage(
          confirmation,
          [
            "❌ <b>Fund Distribution Failed</b>",
            "",
            "The mixer failed to distribute funds to buyer wallets.",
            "",
            "🔍 <b>Error:</b>",
            `<code>${mixerResult.results?.[0]?.error || "Unknown mixer error"}</code>`,
            "",
            "<i>Please try again or contact support if the issue persists.</i>",
          ].join("\n"),
          { parse_mode: "HTML" }
        );
        return conversation.halt();
      }

      await sendMessage(
        confirmation,
        [
          "✅ <b>Fund Distribution Complete</b>",
          "",
          `💰 Successfully distributed funds to ${successfulRoutes.length} wallets`,
          "",
          "⏳ Step 2: Executing simultaneous buy transactions...",
          "",
          "<i>Please wait while we execute the buy transactions</i>",
        ].join("\n"),
        { parse_mode: "HTML" }
      );

      // Step 2: Execute simultaneous buys
      const buyPromises = buyerWallets.map(async (wallet) => {
        try {
          const keypair = secretKeyToKeypair(wallet.privateKey);
          const result = await executeExternalBuy(
            tokenAddress,
            keypair,
            buyAmount,
            3, // 3% slippage
            0.002, // Priority fee
            ctx
          );
          return {
            wallet: wallet.publicKey,
            success: result.success,
            signature: result.signature,
            error: result.error,
            platform: result.platform
          };
        } catch (error: any) {
          return {
            wallet: wallet.publicKey,
            success: false,
            signature: "",
            error: error.message,
            platform: "unknown"
          };
        }
      });

      const buyResults = await Promise.all(buyPromises);
      const successfulBuys = buyResults.filter(result => result.success);
      const failedBuys = buyResults.filter(result => !result.success);

      // Create result message
      const resultMessage = [
        "🎯 <b>Simultaneous Snipe Results</b>",
        "",
        `${platformEmoji} <b>Platform:</b> ${platformName}`,
        `📍 <b>Token:</b> <code>${tokenAddress}</code>`,
        `💵 <b>Amount per Wallet:</b> <code>${buyAmount.toFixed(6)} SOL</code>`,
        "",
        `✅ <b>Successful Buys:</b> ${successfulBuys.length}/${buyResults.length}`,
        `❌ <b>Failed Buys:</b> ${failedBuys.length}/${buyResults.length}`,
        "",
      ];

      if (successfulBuys.length > 0) {
        resultMessage.push("🎉 <b>Successful Transactions:</b>");
        successfulBuys.forEach((result, index) => {
          const shortWallet = `${result.wallet.slice(0, 6)}...${result.wallet.slice(-4)}`;
          const shortSig = `${result.signature.slice(0, 8)}...${result.signature.slice(-8)}`;
          resultMessage.push(`${index + 1}. <code>${shortWallet}</code> - <code>${shortSig}</code>`);
        });
      }

      if (failedBuys.length > 0) {
        resultMessage.push("");
        resultMessage.push("❌ <b>Failed Transactions:</b>");
        failedBuys.forEach((result, index) => {
          const shortWallet = `${result.wallet.slice(0, 6)}...${result.wallet.slice(-4)}`;
          resultMessage.push(`${index + 1}. <code>${shortWallet}</code> - ${result.error}`);
        });
      }

      resultMessage.push("");
      resultMessage.push("💡 <i>Check your buyer wallets for the purchased tokens.</i>");

      await sendMessage(
        confirmation,
        resultMessage.join("\n"),
        { parse_mode: "HTML" }
      );

    } catch (error: any) {
      await sendMessage(
        confirmation,
        [
          "❌ <b>Simultaneous Snipe Failed</b>",
          "",
          "An unexpected error occurred during the simultaneous snipe process.",
          "",
          "🔍 <b>Error Details:</b>",
          `<code>${error.message}</code>`,
          "",
          "<i>Please try again or contact support if the issue persists.</i>",
        ].join("\n"),
        { parse_mode: "HTML" }
      );
    }
  }

  conversation.halt();
};

export default simultaneousSnipeConversation; 