import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser, getFundingWallet } from "../../backend/functions";
import { getTokenBalance, getTokenInfo } from "../../backend/utils";
import { sendMessage } from "../../backend/sender";
import { logger } from "../../blockchain/common/logger";
import { executeExternalSell } from "../../blockchain/pumpfun/externalSell";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import { escape, safeEditMessageText } from "../utils";

const externalTokenSellConversation = async (
  conversation: Conversation,
  ctx: Context,
  tokenAddress: string,
  sellPercent: number
) => {
  // Don't answer callback query here - already handled by main handler
  
  // Show immediate loading state
  await safeEditMessageText(ctx,
    `🔄 **Preparing ${sellPercent}% sell order...**\n\n⏳ Validating wallet and balance...`,
    { parse_mode: "Markdown" }
  );
  
  // --------- VALIDATE USER ---------
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await safeEditMessageText(ctx, "Unrecognized user ❌");
    await conversation.halt();
    return;
  }

  // -------- GET FUNDING WALLET ----------
  const fundingWallet = await getFundingWallet(user.id);
  if (!fundingWallet) {
    await safeEditMessageText(ctx,
      "❌ No funding wallet found. Please configure a funding wallet first."
    );
    await conversation.halt();
    return;
  }

  try {
    // Check token balance first (this is the critical check)
    logger.info(
      `[ExternalTokenSell] Checking balance for token ${tokenAddress} in funding wallet ${fundingWallet.publicKey}`
    );

    let totalTokenBalance = 0;
    try {
      totalTokenBalance = await getTokenBalance(tokenAddress, fundingWallet.publicKey);
      logger.info(
        `[ExternalTokenSell] Funding wallet balance: ${totalTokenBalance} tokens`
      );
    } catch (error) {
      logger.error(
        `[ExternalTokenSell] Error checking balance for funding wallet:`,
        error
      );
      await safeEditMessageText(ctx,
        "❌ Error checking token balance in funding wallet. Please try again."
      );
      await conversation.halt();
      return;
    }

    if (totalTokenBalance === 0) {
      await safeEditMessageText(ctx,
        "❌ No tokens found in your funding wallet for this token address."
      );
      await conversation.halt();
      return;
    }

    // Calculate tokens to sell immediately
    const tokensToSell = Math.floor((totalTokenBalance * sellPercent) / 100);

    // Get token information in background (optional, don't block on this)
    let tokenName = "Unknown Token";
    let tokenSymbol = "Unknown";
    let tokenPrice = 0;
    let valueToSell = 0;
    
    // Quick token info fetch with timeout
    try {
      const tokenInfo = await Promise.race([
        getTokenInfo(tokenAddress),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]) as any; // Type assertion since Promise.race with mixed types is complex
      
      if (tokenInfo && tokenInfo.baseToken) {
        tokenName = tokenInfo.baseToken.name || "Unknown Token";
        tokenSymbol = tokenInfo.baseToken.symbol || "Unknown";
      }
      if (tokenInfo && tokenInfo.priceUsd) {
        tokenPrice = parseFloat(tokenInfo.priceUsd) || 0;
        valueToSell = (totalTokenBalance * tokenPrice * sellPercent) / 100;
      }
    } catch (error) {
      logger.warn(`[ExternalTokenSell] Token info fetch failed or timed out, proceeding with defaults:`, error);
      // Continue with defaults - don't let this block the sell
    }

    // Show confirmation immediately
    const confirmationMessage = [
      `🔍 **Confirm External Token Sell**`,
      ``,
      `**Token:** ${escape(tokenName)} (${escape(tokenSymbol)})`,
      `**Address:** \`${tokenAddress}\``,
      ``,
      `📊 **Sell Details:**`,
      `• Sell Percentage: ${sellPercent}%`,
      `• Tokens to Sell: ${escape(tokensToSell.toLocaleString())}`,
      tokenPrice > 0 ? `• Estimated Value: ${escape(`$${valueToSell.toFixed(2)}`)}` : `• Estimated Value: Unknown`,
      `• Using: Funding Wallet`,
      ``,
      `⚠️ **Important Notes:**`,
      `• This is an external token sell (not launched via our bot)`,
      `• Slippage may be higher than expected`,
      `• This operation cannot be undone`,
      ``,
      `Do you want to proceed with the sell?`,
    ].join("\n");

    const keyboard = new InlineKeyboard()
      .text("✅ Confirm Sell", "confirm_external_sell")
      .text("❌ Cancel", "cancel_external_sell")
      .row();

    await safeEditMessageText(ctx, confirmationMessage, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });

    const response = await conversation.waitFor("callback_query:data");
    await response.answerCallbackQuery();

    if (response.callbackQuery?.data === "cancel_external_sell") {
      await sendMessage(response, "❌ External token sell cancelled.");
      await conversation.halt();
      return;
    }

    if (response.callbackQuery?.data === "confirm_external_sell") {
      await sendMessage(
        response,
        "🔄 **Processing external token sell...**\n\n⏳ This may take a few moments..."
      );

      try {
        // Execute the external token sell using funding wallet
        const keypair = secretKeyToKeypair(fundingWallet.privateKey);
        const result = await executeExternalSell(tokenAddress, keypair, tokensToSell);

        if (result.success) {
          const platformText = result.platform === 'pumpswap' ? '⚡ Pumpswap' : '🚀 PumpFun';
          const solReceivedText = result.solReceived || "Unknown";
          await sendMessage(
            response,
            `✅ **External token sell completed successfully!**\n\n📊 **Results:**\n• Platform: ${platformText}\n• SOL Received: ${solReceivedText} SOL\n• Transaction: \`${result.signature}\``,
            { parse_mode: "Markdown" }
          );
        } else {
          await sendMessage(
            response,
            `❌ **External token sell failed**\n\n${result.error || "Unknown error occurred"}`,
            { parse_mode: "Markdown" }
          );
        }
      } catch (error: any) {
        logger.error("Error executing external token sell:", error);
        await sendMessage(
          response,
          `❌ **Error during external token sell**\n\n${error.message}`
        );
      }
    }
  } catch (error: any) {
    logger.error("Error in external token sell conversation:", error);
    await ctx.reply(`❌ Error: ${error.message}`);
  }

  await conversation.halt();
};

export default externalTokenSellConversation;
