import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser, getFundingWallet } from "../../backend/functions";
import { getTokenBalance, getTokenInfo } from "../../backend/utils";
import { sendMessage } from "../../backend/sender";
import { logger } from "../../blockchain/common/logger";
import { executeExternalSell } from "../../blockchain/pumpfun/externalSell";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import { escape } from "../utils";

const externalTokenSellConversation = async (
  conversation: Conversation,
  ctx: Context,
  tokenAddress: string,
  sellPercent: number
) => {
  await ctx.answerCallbackQuery();
  // --------- VALIDATE USER ---------
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await ctx.reply("Unrecognized user ❌");
    await conversation.halt();
    return;
  }

  // -------- GET FUNDING WALLET ----------
  const fundingWallet = await getFundingWallet(user.id);
  if (!fundingWallet) {
    await ctx.reply(
      "❌ No funding wallet found. Please configure a funding wallet first."
    );
    await conversation.halt();
    return;
  }

  try {
    // Get token information
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      await ctx.reply(
        "❌ Token information not available. Cannot proceed with sell."
      );
      await conversation.halt();
      return;
    }

    // Check token balance in funding wallet
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
      await ctx.reply(
        "❌ Error checking token balance in funding wallet. Please try again."
      );
      await conversation.halt();
      return;
    }

    if (totalTokenBalance === 0) {
      await ctx.reply(
        "❌ No tokens found in your funding wallet for this token address."
      );
      await conversation.halt();
      return;
    }

    const totalValue = totalTokenBalance * (tokenInfo.priceUsd || 0);
    const tokensToSell = (totalTokenBalance * sellPercent) / 100;
    const valueToSell = (totalValue * sellPercent) / 100;

    // Show confirmation
    const confirmationMessage = [
      `🔍 **Confirm External Token Sell**`,
      ``,
      `**Token:** ${escape(tokenInfo.name || "Unknown")} (${escape(tokenInfo.symbol || "Unknown")})`,
      `**Address:** \`${tokenAddress}\``,
      ``,
      `📊 **Sell Details:**`,
      `• Sell Percentage: ${sellPercent}%`,
      `• Tokens to Sell: ${escape(tokensToSell.toLocaleString())}`,
      `• Estimated Value: ${escape(`$${valueToSell.toFixed(2)}`)}`,
      `• Wallets with Tokens: ${walletsWithBalance}`,
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

    await sendMessage(ctx, confirmationMessage, {
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
        // Get buyer wallet private keys
        const { WalletModel } = await import("../../backend/models");
        const buyerWalletDocs = await WalletModel.find({
          user: user.id,
          isBuyer: true,
        }).lean();

        const buyerWalletKeys = buyerWalletDocs.map((w) => w.privateKey);

        // Execute the external token sell
        const result = await executeExternalTokenSell(
          tokenAddress,
          buyerWalletKeys,
          sellPercent
        );

        if (result.success) {
          await sendMessage(
            response,
            `🎉 **External token sell completed successfully!**\n\n📊 **Results:**\n• Successful Sells: ${result.successfulSells}\n• Failed Sells: ${result.failedSells}\n• Total SOL Received: ${result.totalSolReceived?.toFixed(6) || "0"} SOL`
          );
        } else {
          await sendMessage(
            response,
            `❌ **External token sell failed**\n\n${result.error || "Unknown error occurred"}`
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
