import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser, getFundingWallet, getWalletBalance } from "../../backend/functions";
import { sendMessage } from "../../backend/sender";
import { logger } from "../../blockchain/common/logger";
import { CallBackQueries } from "../types";
import { safeEditMessageText, sendErrorWithAutoDelete } from "../utils";

export const ctoConversation = async (
  conversation: Conversation<Context>,
  ctx: Context,
  tokenAddress: string
): Promise<void> => {
  await ctx.answerCallbackQuery();
  
  // Validate user
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "❌ User not found. Please try again.");
    return conversation.halt();
  }

  // Get funding wallet
  const fundingWallet = await getFundingWallet(user.id);
  if (!fundingWallet) {
    await sendMessage(ctx, "❌ No funding wallet found. Please configure a funding wallet first.");
    return conversation.halt();
  }

  // Check funding wallet balance
  const fundingBalance = await getWalletBalance(fundingWallet.publicKey);
  if (fundingBalance < 0.01) {
    await sendMessage(
      ctx,
      `❌ **Insufficient Balance**\n\n` +
      `Your funding wallet needs at least 0.01 SOL for CTO operations.\n\n` +
      `**Current Balance:** ${fundingBalance.toFixed(6)} SOL\n` +
      `**Required:** 0.01 SOL minimum`,
      { parse_mode: "Markdown" }
    );
    return conversation.halt();
  }

  // Ask for buy amount
  await sendMessage(
    ctx,
    `📈 **CTO - Call To Others**\n\n` +
    `**Token:** \`${tokenAddress}\`\n` +
    `**Funding Wallet Balance:** ${fundingBalance.toFixed(6)} SOL\n\n` +
    `💰 **How much SOL do you want to spend on this token?**\n\n` +
    `This will:\n` +
    `• Use the mixer to distribute funds to buy wallets\n` +
    `• Execute coordinated buy transactions\n` +
    `• Create buying pressure on the token\n\n` +
    `Enter the amount in SOL (e.g., 0.5, 1, 2.5):`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("❌ Cancel", CallBackQueries.CANCEL)
    }
  );

  // Wait for amount input
  const amountInput = await conversation.wait();
  if (amountInput.callbackQuery?.data === CallBackQueries.CANCEL) {
    await amountInput.answerCallbackQuery();
    await sendMessage(amountInput, "❌ CTO operation cancelled.");
    return conversation.halt();
  }

  const buyAmountText = amountInput.message?.text?.trim();
  if (!buyAmountText) {
    await sendMessage(amountInput, "❌ No amount provided. CTO operation cancelled.");
    return conversation.halt();
  }

  const buyAmount = parseFloat(buyAmountText);
  if (isNaN(buyAmount) || buyAmount <= 0) {
    await sendMessage(amountInput, "❌ Invalid amount. Please enter a valid number.");
    return conversation.halt();
  }

  // Check if amount is available (leave some buffer for fees)
  const requiredBalance = buyAmount + 0.01; // 0.01 SOL buffer for fees
  if (requiredBalance > fundingBalance) {
    await sendMessage(
      amountInput,
      `❌ **Insufficient Balance**\n\n` +
      `**Requested:** ${buyAmount.toFixed(6)} SOL\n` +
      `**Available:** ${fundingBalance.toFixed(6)} SOL\n` +
      `**Required (with fees):** ${requiredBalance.toFixed(6)} SOL\n\n` +
      `Please enter a smaller amount or add more SOL to your funding wallet.`,
      { parse_mode: "Markdown" }
    );
    return conversation.halt();
  }

  // Show confirmation
  await sendMessage(
    amountInput,
    `🔍 **Confirm CTO Operation**\n\n` +
    `**Token:** \`${tokenAddress}\`\n` +
    `**Buy Amount:** ${buyAmount.toFixed(6)} SOL\n` +
    `**Funding Wallet Balance:** ${fundingBalance.toFixed(6)} SOL\n\n` +
    `**Process:**\n` +
    `1. Distribute ${buyAmount.toFixed(6)} SOL to buy wallets via mixer\n` +
    `2. Execute coordinated buy transactions\n` +
    `3. Create buying pressure on the token\n\n` +
    `⚠️ **Important:** This operation cannot be undone.\n\n` +
    `Do you want to proceed?`,
    {
      parse_mode: "Markdown",
      reply_markup: new InlineKeyboard()
        .text("✅ Confirm CTO", "confirm_cto")
        .text("❌ Cancel", CallBackQueries.CANCEL)
    }
  );

  // Wait for confirmation
  const confirmation = await conversation.waitFor("callback_query:data");
  
  if (confirmation.callbackQuery?.data === CallBackQueries.CANCEL) {
    await confirmation.answerCallbackQuery();
    await sendMessage(confirmation, "❌ CTO operation cancelled.");
    return conversation.halt();
  }

  if (confirmation.callbackQuery?.data === "confirm_cto") {
    // Answer callback query immediately to prevent timeout
    try {
      await confirmation.answerCallbackQuery();
    } catch (error: any) {
      logger.warn("Failed to answer callback query (likely timeout):", error.message);
      // Continue with operation even if callback query fails
    }

    try {
      // Show processing message
      await sendMessage(
        confirmation,
        `🔄 **Processing CTO Operation...**\n\n` +
        `⏳ Step 1: Distributing ${buyAmount.toFixed(6)} SOL to buy wallets via mixer...\n` +
        `⏳ Step 2: Executing buy transactions...\n\n` +
        `This may take 30-60 seconds. Please wait...`,
        { parse_mode: "Markdown" }
      );

      // Execute CTO operation
      const { executeCTOOperation } = await import("../../blockchain/pumpfun/ctoOperation");
      const result = await executeCTOOperation(tokenAddress, user.id, buyAmount);

      if (result.success) {
        // Success message with detailed results
        await sendMessage(
          confirmation,
          `✅ **CTO Operation Completed Successfully!**\n\n` +
          `**Token:** \`${tokenAddress}\`\n` +
          `**Total Spent:** ${buyAmount.toFixed(6)} SOL\n` +
          `**Successful Buys:** ${result.successfulBuys || 0}\n` +
          `**Failed Buys:** ${result.failedBuys || 0}\n\n` +
          `🎉 **Buying pressure has been applied to the token!**\n\n` +
          `📊 **Opening monitor page to track your position...**`,
          { parse_mode: "Markdown" }
        );

        // Wait a moment then open the monitor page
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Start the CTO monitor conversation
        const { ctoMonitorConversation } = await import("./ctoMonitor");
        await ctoMonitorConversation(conversation, confirmation, tokenAddress);
      } else {
        // Check if this was a partial success that we should handle differently
        if (result.successfulBuys && result.successfulBuys > 0) {
          // Partial success - some buys worked
          await sendMessage(
            confirmation,
            `⚠️ **CTO Operation Partially Completed**\n\n` +
            `**Token:** \`${tokenAddress}\`\n` +
            `**Successful Buys:** ${result.successfulBuys || 0}\n` +
            `**Failed Buys:** ${result.failedBuys || 0}\n\n` +
            `✅ **Some buying pressure was applied!**\n\n` +
            `⚠️ **Note:** Not all transactions succeeded due to:\n${result.error || "Unknown mixer issues"}\n\n` +
            `📊 **Opening monitor page to track your position...**`,
            { parse_mode: "Markdown" }
          );

          // Still open monitor page for partial success
          await new Promise(resolve => setTimeout(resolve, 2000));
          const { ctoMonitorConversation } = await import("./ctoMonitor");
          await ctoMonitorConversation(conversation, confirmation, tokenAddress);
        } else {
          // Complete failure
          await sendMessage(
            confirmation,
            `❌ **CTO Operation Failed**\n\n` +
            `**Error:** ${result.error || "Unknown error occurred"}\n\n` +
            `**Details:**\n` +
            `• Successful Buys: ${result.successfulBuys || 0}\n` +
            `• Failed Buys: ${result.failedBuys || 0}\n\n` +
            `Please try again or contact support if the issue persists.`,
            { 
              parse_mode: "Markdown",
              reply_markup: new InlineKeyboard()
                .text("💳 Withdraw to Funding Wallet", CallBackQueries.WITHDRAW_TO_FUNDING)
                .text("🌐 Withdraw to External Wallet", CallBackQueries.WITHDRAW_TO_EXTERNAL)
                .row()
                .text("🔄 Try Again", `cto_${tokenAddress}`)
                .text("❌ Close", CallBackQueries.CANCEL)
            }
          );

          // Wait for user action on the failure message
          const failureAction = await conversation.waitFor("callback_query:data");
          
          // Answer callback query with timeout handling
          try {
            await failureAction.answerCallbackQuery();
          } catch (error: any) {
            logger.warn("Failed to answer failure action callback query:", error.message);
            // Continue with operation even if callback query fails
          }

          const actionData = failureAction.callbackQuery?.data;
          
          if (actionData === CallBackQueries.WITHDRAW_TO_FUNDING) {
            // Start funding wallet withdrawal conversation
            const { withdrawFundingWalletConversation } = await import("./withdrawal");
            return await withdrawFundingWalletConversation(conversation, failureAction);
          } else if (actionData === CallBackQueries.WITHDRAW_TO_EXTERNAL) {
            // Start buyer wallets withdrawal conversation (most likely to have funds after CTO failure)
            const { withdrawBuyerWalletsConversation } = await import("./withdrawal");
            return await withdrawBuyerWalletsConversation(conversation, failureAction);
          } else if (actionData === `cto_${tokenAddress}`) {
            // Restart CTO conversation
            return await ctoConversation(conversation, failureAction, tokenAddress);
          } else if (actionData === CallBackQueries.CANCEL) {
            await sendMessage(failureAction, "❌ CTO operation cancelled.");
            return conversation.halt();
          }
        }
      }
    } catch (error: any) {
      logger.error("Error executing CTO operation:", error);
      await sendErrorWithAutoDelete(
        confirmation,
        `❌ **CTO Operation Error**\n\n${error.message || "Unknown error occurred"}`
      );
    }
  }

  conversation.halt();
}; 