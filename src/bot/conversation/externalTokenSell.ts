import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser, getFundingWallet, getAllTradingWallets } from "../../backend/functions";
import { getTokenBalance, getTokenInfo, decryptPrivateKey } from "../../backend/utils";
import { sendMessage } from "../../backend/sender";
import { logger } from "../../blockchain/common/logger";
import { executeExternalTokenSell } from "../../blockchain/pumpfun/externalSell";
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

  // -------- GET BUYER WALLETS ----------
  const buyerWallets = await getAllTradingWallets(user.id);
  if (buyerWallets.length === 0) {
    await safeEditMessageText(ctx,
      "❌ No buyer wallets found. Please configure buyer wallets first."
    );
    await conversation.halt();
    return;
  }

  try {
    // Check token balance across all buyer wallets
    logger.info(
      `[ExternalTokenSell] Checking balance for token ${tokenAddress} across ${buyerWallets.length} buyer wallets`
    );

    let totalTokenBalance = 0;
    const walletsWithBalance = [];
    
    for (const wallet of buyerWallets) {
      try {
        const balance = await getTokenBalance(tokenAddress, wallet.publicKey);
        if (balance > 0) {
          totalTokenBalance += balance;
          walletsWithBalance.push({
            publicKey: wallet.publicKey,
            privateKey: wallet.privateKey,
            balance: balance
          });
          logger.info(
            `[ExternalTokenSell] Wallet ${wallet.publicKey}: ${balance} tokens`
          );
        }
      } catch (error) {
        logger.warn(
          `[ExternalTokenSell] Error checking balance for wallet ${wallet.publicKey}:`,
          error
        );
      }
    }

    logger.info(
      `[ExternalTokenSell] Total balance across buyer wallets: ${totalTokenBalance} tokens`
    );

    if (totalTokenBalance === 0) {
      await safeEditMessageText(ctx,
        "❌ No tokens found in your buyer wallets for this token address."
      );
      await conversation.halt();
      return;
    }

    // Calculate tokens to sell immediately
    const tokensToSell = Math.floor((totalTokenBalance * sellPercent) / 100);

    // **DEBUG LOGGING - Track exact calculation**
    logger.info(`[ExternalTokenSell] DEBUG: totalTokenBalance = ${totalTokenBalance}`);
    logger.info(`[ExternalTokenSell] DEBUG: sellPercent = ${sellPercent}%`);
    logger.info(`[ExternalTokenSell] DEBUG: tokensToSell calculated = ${tokensToSell}`);
    logger.info(`[ExternalTokenSell] DEBUG: Calculation: Math.floor((${totalTokenBalance} * ${sellPercent}) / 100) = ${tokensToSell}`);

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
        valueToSell = ((totalTokenBalance / 1e6) * tokenPrice * sellPercent) / 100;
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
      `• Tokens to Sell: ${escape((tokensToSell / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }))}`,
      tokenPrice > 0 ? `• Estimated Value: ${escape(`$${valueToSell.toFixed(2)}`)}` : `• Estimated Value: Unknown`,
      `• Using: Buyer Wallets`,
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
        // Execute the external token sell using buyer wallets
        const buyerWalletPrivateKeys = walletsWithBalance.map(w => w.privateKey);
        const result = await executeExternalTokenSell(tokenAddress, buyerWalletPrivateKeys, sellPercent);

        if (result.success) {
          const solReceivedText = result.totalSolReceived?.toFixed(6) || "Unknown";
          await sendMessage(
            response,
            `✅ **External token sell completed successfully!**\n\n📊 **Results:**\n• Successful Sells: ${result.successfulSells}\n• Failed Sells: ${result.failedSells}\n• Total SOL Received: ${solReceivedText} SOL\n• Platform: 🚀 PumpFun`,
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
