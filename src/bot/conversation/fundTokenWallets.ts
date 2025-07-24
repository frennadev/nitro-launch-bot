import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser, fundTokenWallets, getAllBuyerWallets, getWalletBalance } from "../../backend/functions";
import { getTokenBalance } from "../../backend/utils";
import { sendMessage } from "../../backend/sender";
import { CallBackQueries } from "../types";
import { logger } from "../../blockchain/common/logger";
import bot from "../index";

export const fundTokenWalletsConversation = async (
  conversation: Conversation<Context>,
  ctx: Context,
  tokenAddress: string
): Promise<void> => {
  logger.info(`[fundTokenWalletsConversation] Conversation entered for token: ${tokenAddress}`);
  
  try {
    await ctx.answerCallbackQuery();
  } catch (error: any) {
    logger.warn(
      "Failed to answer callback query in fund token wallets (likely already answered):",
      error.message
    );
  }

  // Validate user
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "❌ User not found. Please try again.");
    return conversation.halt();
  }

  // Show loading message
  const loadingMessage = await sendMessage(
    ctx,
    `💰 **Fund Token Wallets**\n\n` +
      `Token: \`${tokenAddress}\`\n\n` +
      `🔍 Checking wallets that hold this token...\n\n` +
      `💡 **Tip:** You can always use /menu or /start to return to the main menu.`,
    { parse_mode: "Markdown" }
  );

  try {
    // Get buyer wallets
    const buyerWallets = await getAllBuyerWallets(user.id);
    if (buyerWallets.length === 0) {
          try {
      await bot.api.editMessageText(
        ctx.chat!.id,
        loadingMessage.message_id,
        "❌ **No buyer wallets found**\n\nPlease add buyer wallets first before funding token wallets.",
        { parse_mode: "Markdown" }
      );
    } catch (error: any) {
      if (error.description?.includes("message is not modified")) {
        logger.debug("[fundTokenWallets] Message content unchanged, skipping edit");
      } else {
        logger.error("[fundTokenWallets] Failed to edit message:", error);
        await sendMessage(ctx, "❌ **No buyer wallets found**\n\nPlease add buyer wallets first before funding token wallets.");
      }
    }
      return conversation.halt();
    }

    // Check which wallets hold the token
    const walletHoldings: Array<{
      address: string;
      tokenBalance: number;
      solBalance: number;
    }> = [];

    for (const wallet of buyerWallets) {
      try {
        const tokenBalance = await getTokenBalance(tokenAddress, wallet.publicKey);
        const solBalance = await getWalletBalance(wallet.publicKey);
        
        if (tokenBalance > 0) {
          walletHoldings.push({
            address: wallet.publicKey,
            tokenBalance,
            solBalance,
          });
        }
      } catch (error) {
        logger.warn(
          `[fundTokenWallets] Error checking wallet ${wallet.publicKey}:`,
          error
        );
      }
    }

    if (walletHoldings.length === 0) {
          try {
      await bot.api.editMessageText(
        ctx.chat!.id,
        loadingMessage.message_id,
        "❌ **No wallets hold this token**\n\nNone of your buyer wallets currently hold this token.",
        { parse_mode: "Markdown" }
      );
    } catch (error: any) {
      if (error.description?.includes("message is not modified")) {
        logger.debug("[fundTokenWallets] Message content unchanged, skipping edit");
      } else {
        logger.error("[fundTokenWallets] Failed to edit message:", error);
        await sendMessage(ctx, "❌ **No wallets hold this token**\n\nNone of your buyer wallets currently hold this token.");
      }
    }
      return conversation.halt();
    }

    // Sort wallets by token balance (highest first)
    walletHoldings.sort((a, b) => b.tokenBalance - a.tokenBalance);

    // Calculate total token balance and SOL balance
    const totalTokenBalance = walletHoldings.reduce((sum, w) => sum + w.tokenBalance, 0);
    const totalSolBalance = walletHoldings.reduce((sum, w) => sum + w.solBalance, 0);

    // Show wallet summary
    const summaryText = [
      `💰 **Fund Token Wallets**`,
      ``,
      `**Token:** \`${tokenAddress}\``,
      `**Wallets with tokens:** ${walletHoldings.length}`,
      `**Total token balance:** ${(totalTokenBalance / 1e6).toFixed(2)} tokens`,
      `**Total SOL balance:** ${totalSolBalance.toFixed(6)} SOL`,
      ``,
      `**Top 5 wallets by token balance:**`,
      ...walletHoldings.slice(0, 5).map((w, i) => 
        `${i + 1}. \`${w.address.slice(0, 6)}...${w.address.slice(-4)}\` - ${(w.tokenBalance / 1e6).toFixed(2)} tokens (${w.solBalance.toFixed(6)} SOL)`
      ),
      ``,
      `Choose how you want to fund these wallets:`,
    ].join("\n");

    const keyboard = new InlineKeyboard()
      .text("💰 Fund All Wallets", `fund_all_wallets_${tokenAddress}`)
      .row()
      .text("🎯 Fund Top 5 Wallets", `fund_top_wallets_${tokenAddress}_5`)
      .text("🎯 Fund Top 10 Wallets", `fund_top_wallets_${tokenAddress}_10`)
      .row()
      .text("❌ Cancel", CallBackQueries.CANCEL_FUND_TOKEN);

    try {
      await bot.api.editMessageText(
        ctx.chat!.id,
        loadingMessage.message_id,
        summaryText,
        {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        }
      );
    } catch (error: any) {
      // Ignore "message is not modified" errors
      if (error.description?.includes("message is not modified")) {
        logger.debug("[fundTokenWallets] Message content unchanged, skipping edit");
      } else {
        logger.error("[fundTokenWallets] Failed to edit message:", error);
        // Fallback: send a new message
        await sendMessage(ctx, summaryText, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      }
    }

    // Wait for user selection
    const response = await conversation.waitFor("callback_query");
    const data = response.callbackQuery?.data;

    if (data === CallBackQueries.CANCEL_FUND_TOKEN) {
      await sendMessage(ctx, "❌ Fund token wallets cancelled.");
      return conversation.halt();
    }

    if (data?.startsWith("fund_all_wallets_")) {
      await handleFundingSelection(ctx, conversation, tokenAddress, user.id, true);
    } else if (data?.startsWith("fund_top_wallets_")) {
      const parts = data.split("_");
      const walletCount = parseInt(parts[parts.length - 1]);
      await handleFundingSelection(ctx, conversation, tokenAddress, user.id, false, walletCount);
    }

  } catch (error: any) {
    logger.error("[fundTokenWallets] Error:", error);
    
    // Don't re-throw the error, just handle it gracefully
    try {
      await bot.api.editMessageText(
        ctx.chat!.id,
        loadingMessage.message_id,
        `❌ **Error occurred**\n\n${error.message || "Unknown error"}`,
        { parse_mode: "Markdown" }
      );
    } catch (editError: any) {
      if (editError.description?.includes("message is not modified")) {
        logger.debug("[fundTokenWallets] Message content unchanged, skipping edit");
      } else {
        logger.error("[fundTokenWallets] Failed to edit error message:", editError);
        await sendMessage(ctx, `❌ **Error occurred**\n\n${error.message || "Unknown error"}`);
      }
    }
    
    // End the conversation gracefully instead of letting it crash
    return conversation.halt();
  }
};

const handleFundingSelection = async (
  ctx: Context,
  conversation: Conversation<Context>,
  tokenAddress: string,
  userId: string,
  fundAllWallets: boolean,
  topWalletCount?: number
) => {
  const selectionText = fundAllWallets 
    ? "all wallets that hold this token"
    : `top ${topWalletCount} wallets with most tokens`;

  const message = await sendMessage(
    ctx,
    `💰 **Fund ${selectionText}**\n\n` +
      `Enter the total amount of SOL you want to distribute:\n\n` +
      `💡 **Example:** 5.0 (will distribute 5 SOL randomly among selected wallets)`,
    { parse_mode: "Markdown" }
  );

  // Wait for amount input
  const amountResponse = await conversation.waitFor("message:text");
  const amountText = amountResponse.message?.text?.trim();

  if (!amountText) {
    await sendMessage(ctx, "❌ No amount provided. Operation cancelled.");
    return conversation.halt();
  }

  const amount = parseFloat(amountText);
  if (isNaN(amount) || amount <= 0) {
    await sendMessage(ctx, "❌ Invalid amount. Please enter a positive number.");
    return conversation.halt();
  }

  if (amount > 100) {
    await sendMessage(ctx, "❌ Amount too high. Maximum is 100 SOL.");
    return conversation.halt();
  }

  // Show confirmation
  const confirmationText = [
    `💰 **Confirm Funding**`,
    ``,
    `**Token:** \`${tokenAddress}\``,
    `**Total amount:** ${amount} SOL`,
    `**Target:** ${fundAllWallets ? "All wallets" : `Top ${topWalletCount} wallets`}`,
    `**Method:** Mixer (for privacy)`,
    ``,
    `⚠️ **This will:**`,
    `• Use your funding wallet`,
    `• Distribute SOL through mixer`,
    `• Send random amounts to each wallet`,
    `• Ensure no wallet gets <50% of max amount`,
    ``,
    `Proceed with funding?`,
  ].join("\n");

  const confirmKeyboard = new InlineKeyboard()
    .text("✅ Confirm", `confirm_fund_${tokenAddress}_${amount}_${fundAllWallets ? "all" : topWalletCount}`)
    .text("❌ Cancel", CallBackQueries.CANCEL_FUND_TOKEN);

  try {
    await bot.api.editMessageText(
      ctx.chat!.id,
      message.message_id,
      confirmationText,
      {
        parse_mode: "Markdown",
        reply_markup: confirmKeyboard,
      }
    );
  } catch (error: any) {
    if (error.description?.includes("message is not modified")) {
      logger.debug("[fundTokenWallets] Message content unchanged, skipping edit");
    } else {
      logger.error("[fundTokenWallets] Failed to edit confirmation message:", error);
      await sendMessage(ctx, confirmationText, {
        parse_mode: "Markdown",
        reply_markup: confirmKeyboard,
      });
    }
  }

  // Wait for confirmation
  const confirmResponse = await conversation.waitFor("callback_query");
  const confirmData = confirmResponse.callbackQuery?.data;

  if (confirmData === CallBackQueries.CANCEL_FUND_TOKEN) {
    await sendMessage(ctx, "❌ Funding cancelled.");
    return conversation.halt();
  }

  if (confirmData?.startsWith("confirm_fund_")) {
    await executeFunding(ctx, tokenAddress, userId, amount, fundAllWallets, topWalletCount, ctx.chat!.id, message.message_id);
  }
};

const executeFunding = async (
  ctx: Context,
  tokenAddress: string,
  userId: string,
  amount: number,
  fundAllWallets: boolean,
  topWalletCount: number | undefined,
  chatId: number,
  messageId: number
) => {
  try {
    await bot.api.editMessageText(
      chatId,
      messageId,
      `🔀 **Funding in Progress**\n\n` +
        `💰 Distributing ${amount} SOL...\n` +
        `⏳ Using mixer for privacy...\n` +
        `🔄 Please wait...`,
      { parse_mode: "Markdown" }
    );
  } catch (error: any) {
    if (error.description?.includes("message is not modified")) {
      logger.debug("[executeFunding] Message content unchanged, skipping edit");
    } else {
      logger.error("[executeFunding] Failed to edit progress message:", error);
    }
  }

  try {
    const result = await fundTokenWallets(
      userId,
      tokenAddress,
      amount,
      fundAllWallets,
      topWalletCount
    );

    if (result.success) {
      const successText = [
        `✅ **Funding Completed Successfully!**`,
        ``,
        `**Token:** \`${tokenAddress}\``,
        `**Total distributed:** ${result.totalFunded.toFixed(6)} SOL`,
        `**Wallets funded:** ${result.fundedWallets}`,
        `**Target:** ${fundAllWallets ? "All wallets" : `Top ${topWalletCount} wallets`}`,
        ``,
        `🎉 **Your wallets now have additional SOL for gas fees!**`,
        ``,
        `💡 **Next steps:**`,
        `• Monitor your token position`,
        `• Sell when ready`,
        `• Use the additional SOL for transactions`,
      ].join("\n");

      try {
        await bot.api.editMessageText(chatId, messageId, successText, {
          parse_mode: "Markdown",
        });
      } catch (error: any) {
        if (error.description?.includes("message is not modified")) {
          logger.debug("[executeFunding] Message content unchanged, skipping edit");
        } else {
          logger.error("[executeFunding] Failed to edit success message:", error);
          await sendMessage(ctx, successText, { parse_mode: "Markdown" });
        }
      }
    } else {
      const errorText = [
        `❌ **Funding Failed**`,
        ``,
        `**Error:** ${result.error}`,
        ``,
        `Please check:`,
        `• Funding wallet balance`,
        `• Wallet configuration`,
        `• Try again later`,
      ].join("\n");

      try {
        await bot.api.editMessageText(chatId, messageId, errorText, {
          parse_mode: "Markdown",
        });
      } catch (error: any) {
        if (error.description?.includes("message is not modified")) {
          logger.debug("[executeFunding] Message content unchanged, skipping edit");
        } else {
          logger.error("[executeFunding] Failed to edit error message:", error);
          await sendMessage(ctx, errorText, { parse_mode: "Markdown" });
        }
      }
    }
  } catch (error: any) {
    logger.error("[executeFunding] Error:", error);
    try {
      await bot.api.editMessageText(
        chatId,
        messageId,
        `❌ **Funding Error**\n\n${error.message || "Unknown error occurred"}`,
        { parse_mode: "Markdown" }
      );
    } catch (editError: any) {
      if (editError.description?.includes("message is not modified")) {
        logger.debug("[executeFunding] Message content unchanged, skipping edit");
      } else {
        logger.error("[executeFunding] Failed to edit error message:", editError);
        await sendMessage(ctx, `❌ **Funding Error**\n\n${error.message || "Unknown error occurred"}`);
      }
    }
  }
}; 