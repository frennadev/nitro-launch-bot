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

  // === PLATFORM DETECTION STEP ===
  const platformDetectionMessage = await sendMessage(
    amountInput,
    `🔍 **Detecting Token Platform...**\n\n` +
    `**Token:** \`${tokenAddress}\`\n` +
    `⏳ Analyzing token to determine optimal trading platform...`,
    { parse_mode: "Markdown" }
  );

  let platform: string = 'unknown'; // Default platform
  
  try {
    // Use the improved platform detection with Bonk support
    const { detectTokenPlatformWithCache } = await import("../../service/token-detection-service");
    platform = await detectTokenPlatformWithCache(tokenAddress);
    
    // Log the platform detection result for transparency
    logger.info(`[CTO Platform Detection] Token ${tokenAddress} detected as ${platform} platform`);
    
    // Get additional platform details for better user information
    let platformDetails = "";
    let platformIcon = "";
    
    switch (platform) {
      case 'pumpfun':
        platformIcon = "🎯";
        platformDetails = "PumpFun Bonding Curve (Active Launch)";
        break;
      case 'pumpswap':
        platformIcon = "🔄";
        platformDetails = "PumpSwap DEX (Graduated/Listed)";
        break;
      case 'bonk':
        platformIcon = "🐕";
        platformDetails = "Bonk Pool (Raydium Launch Lab)";
        break;
      case 'cpmm':
        platformIcon = "🏊";
        platformDetails = "Raydium CPMM (Graduated Bonk)";
        break;
      case 'unknown':
        platformIcon = "❓";
        platformDetails = "Unknown Platform (Will try multiple DEXs)";
        break;
      default:
        platformIcon = "❓";
        platformDetails = "Unknown Platform";
    }

    // Update the message with platform detection results and proceed automatically
    await ctx.api.editMessageText(
      ctx.chat!.id,
      platformDetectionMessage.message_id,
      `✅ **Platform Detection Complete**\n\n` +
      `**Token:** \`${tokenAddress}\`\n` +
      `**Detected Platform:** ${platformIcon} ${platformDetails}\n` +
      `**Trading Strategy:** Will use optimal routing for ${platform} tokens\n\n` +
      `📊 **Platform Details:**\n` +
      `• ${platform === 'pumpfun' ? 'Direct bonding curve trading for best prices' : ''}` +
      `• ${platform === 'pumpswap' ? 'Jupiter → PumpSwap routing for liquidity' : ''}` +
      `• ${platform === 'bonk' ? 'Bonk pool trading via Raydium Launch Lab' : ''}` +
      `• ${platform === 'cpmm' ? 'Raydium CPMM trading for graduated Bonk tokens' : ''}` +
      `• ${platform === 'unknown' ? 'Multi-platform fallback (Jupiter → PumpSwap → PumpFun)' : ''}` +
      `\n` +
      `🔄 **Proceeding automatically with optimal platform routing...**`,
      { parse_mode: "Markdown" }
    );

    // Log the automatic platform detection
    logger.info(`[CTO Platform Auto-Detection] Automatically using ${platform} platform for token ${tokenAddress}`);
    
    // Brief pause to show the detection result
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Show final confirmation with platform information
    await sendMessage(
      amountInput,
      `🔍 **CTO Confirmation**\n\n` +
      `**Token:** \`${tokenAddress}\`\n` +
      `**Platform:** ${platformIcon} ${platformDetails}\n` +
      `**Buy Amount:** ${buyAmount.toFixed(6)} SOL\n` +
      `**Funding Wallet Balance:** ${fundingBalance.toFixed(6)} SOL\n\n` +
      `**Process:**\n` +
      `1. Distribute ${buyAmount.toFixed(6)} SOL to buy wallets via mixer\n` +
      `2. Execute coordinated buy transactions on ${platform} platform\n` +
      `3. Create buying pressure on the token\n\n` +
      `⚠️ **Important:** This operation cannot be undone.\n\n` +
      `Do you want to proceed with the CTO operation?`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("✅ Confirm CTO", "confirm_cto")
          .text("❌ Cancel", CallBackQueries.CANCEL)
      }
    );

  } catch (platformError: any) {
    logger.error(`[CTO Platform Detection Error] Failed to detect platform for ${tokenAddress}:`, platformError);
    platform = 'unknown'; // Set to unknown for fallback routing
    
    // Update the detection message with error and proceed automatically with fallback
    await ctx.api.editMessageText(
      ctx.chat!.id,
      platformDetectionMessage.message_id,
      `⚠️ **Platform Detection Failed**\n\n` +
      `**Token:** \`${tokenAddress}\`\n` +
      `**Error:** ${platformError.message || "Unknown error"}\n\n` +
      `**Fallback Strategy:**\n` +
      `The system will use multi-platform fallback routing:\n` +
      `• Jupiter → PumpSwap → PumpFun\n` +
      `• This ensures maximum compatibility\n\n` +
      `🔄 **Proceeding automatically with fallback routing...**`,
      { parse_mode: "Markdown" }
    );

    // Log the automatic fallback decision
    logger.info(`[CTO Platform Auto-Fallback] Automatically using fallback routing for token ${tokenAddress} due to detection failure`);
    
    // Brief pause to show the fallback message
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Show final confirmation with fallback information
    await sendMessage(
      amountInput,
      `🔍 **CTO Confirmation (Fallback)**\n\n` +
      `**Token:** \`${tokenAddress}\`\n` +
      `**Platform:** ❓ Unknown (Fallback Routing)\n` +
      `**Buy Amount:** ${buyAmount.toFixed(6)} SOL\n` +
      `**Funding Wallet Balance:** ${fundingBalance.toFixed(6)} SOL\n\n` +
      `**Process:**\n` +
      `1. Distribute ${buyAmount.toFixed(6)} SOL to buy wallets via mixer\n` +
      `2. Execute coordinated buy transactions with fallback routing\n` +
      `3. Create buying pressure on the token\n\n` +
      `⚠️ **Important:** This operation cannot be undone.\n\n` +
      `Do you want to proceed with the CTO operation?`,
      {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard()
          .text("✅ Confirm CTO", "confirm_cto")
          .text("❌ Cancel", CallBackQueries.CANCEL)
      }
    );
  }

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
      await confirmation.answerCallbackQuery("🔄 Starting CTO operation...");
    } catch (error: any) {
      logger.warn("Failed to answer callback query (likely timeout):", error.message);
      // Continue with operation even if callback query fails
    }

    try {
      // Show processing message
      const processingMessage = await sendMessage(
        confirmation,
        `🔄 **Processing CTO Operation...**\n\n` +
        `⏳ Step 1: Distributing ${buyAmount.toFixed(6)} SOL to buy wallets via mixer...\n` +
        `⏳ Step 2: Executing buy transactions...\n\n` +
        `This may take 30-60 seconds. Please wait...`,
        { parse_mode: "Markdown" }
      );

      // Execute CTO operation with detected platform
      const { executeCTOOperation } = await import("../../blockchain/pumpfun/ctoOperation");
      const result = await executeCTOOperation(tokenAddress, user.id, buyAmount, platform);

      if (result.success) {
        // Success message with detailed results
        await confirmation.api.editMessageText(
          confirmation.chat!.id,
          processingMessage.message_id,
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
          await confirmation.api.editMessageText(
            confirmation.chat!.id,
            processingMessage.message_id,
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
          await confirmation.api.editMessageText(
            confirmation.chat!.id,
            processingMessage.message_id,
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

          // Wait for user action on the failure message with timeout handling
          try {
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
          } catch (waitError: any) {
            logger.warn("Timeout waiting for user action on failure message:", waitError.message);
            // Continue to halt the conversation
          }
        }
      }
    } catch (error: any) {
      logger.error("Error executing CTO operation:", error);
      
      // Use safe error message sending with timeout handling
      try {
        await sendMessage(
          confirmation,
          `❌ **CTO Operation Error**\n\n${error.message || "Unknown error occurred"}`,
          { parse_mode: "Markdown" }
        );
      } catch (msgError: any) {
        logger.warn("Failed to send error message:", msgError.message);
      }
    }
  }

  conversation.halt();
}; 