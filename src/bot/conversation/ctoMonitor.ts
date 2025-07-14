import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser, getAllTradingWallets } from "../../backend/functions";
import { getTokenBalance, getTokenInfo } from "../../backend/utils";
import { sendMessage } from "../../backend/sender";
import { logger } from "../../blockchain/common/logger";
import { CallBackQueries } from "../types";
import { escape } from "../utils";

export const ctoMonitorConversation = async (
  conversation: Conversation<Context>,
  ctx: Context,
  tokenAddress: string
): Promise<void> => {
  // Don't answer callback query here if it's already been answered
  try {
    await ctx.answerCallbackQuery();
  } catch (error: any) {
    logger.warn("Failed to answer callback query in CTO monitor (likely already answered):", error.message);
    // Continue with monitor - this is not critical
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
    `📊 **CTO Monitor Loading...**\n\n` +
    `Token: \`${tokenAddress}\`\n\n` +
    `🔄 Checking your holdings across all wallets...`,
    { parse_mode: "Markdown" }
  );

  try {
    // Get token information with timeout
    const tokenInfoPromise = getTokenInfo(tokenAddress);
    const tokenInfo = await Promise.race([
      tokenInfoPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Token info timeout')), 10000))
    ]) as any;
    
    const tokenName = tokenInfo?.baseToken?.name || "Unknown Token";
    const tokenSymbol = tokenInfo?.baseToken?.symbol || "Unknown";
    const tokenPrice = parseFloat(tokenInfo?.priceUsd || "0");
    const marketCap = tokenInfo?.marketCap || 0;

    // Get buyer wallets
    const buyerWallets = await getAllTradingWallets(user.id);
    
    // Check holdings across all wallets with timeout
    let totalTokenBalance = 0;
    let totalValueUsd = 0;
    let walletsWithBalance = 0;
    const walletHoldings: Array<{
      address: string;
      balance: number;
      valueUsd: number;
      shortAddress: string;
      rawBalance: number;
    }> = [];

    const balanceCheckPromises = buyerWallets.map(async (wallet) => {
      try {
        const balance = await Promise.race([
          getTokenBalance(tokenAddress, wallet.publicKey),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Balance check timeout')), 5000))
        ]) as number;
        
        if (balance > 0) {
          const balanceFormatted = balance / 1e6; // Convert to human readable
          const valueUsd = balanceFormatted * tokenPrice;
          
          return {
            address: wallet.publicKey,
            balance: balanceFormatted,
            valueUsd: valueUsd,
            shortAddress: wallet.publicKey.slice(0, 6) + "…" + wallet.publicKey.slice(-4),
            rawBalance: balance
          };
        }
        return null;
      } catch (error) {
        logger.warn(`[CTO Monitor] Error checking balance for wallet ${wallet.publicKey}:`, error);
        return null;
      }
    });

    const balanceResults = await Promise.allSettled(balanceCheckPromises);
    
    balanceResults.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        const holding = result.value;
        totalTokenBalance += holding.rawBalance;
        totalValueUsd += holding.valueUsd;
        walletsWithBalance++;
        walletHoldings.push(holding);
      }
    });

    // Format total balance
    const totalBalanceFormatted = totalTokenBalance / 1e6;

    // Build monitor message
    let monitorMessage = [
      `📊 **CTO Monitor**`,
      ``,
      `**Token:** ${escape(tokenName)} (${escape(tokenSymbol)})`,
      `**Address:** \`${tokenAddress}\``,
      ``,
      `💰 **Your Holdings:**`,
      `• Total Tokens: ${escape(totalBalanceFormatted.toLocaleString(undefined, { maximumFractionDigits: 2 }))}`,
      totalValueUsd > 0 ? `• Total Value: ${escape(`$${totalValueUsd.toFixed(2)}`)}` : "",
      `• Wallets with Balance: ${walletsWithBalance}/${buyerWallets.length}`,
      ``,
      `📈 **Market Data:**`,
      tokenPrice > 0 ? `• Price: ${escape(`$${tokenPrice.toFixed(8)}`)}` : "• Price: Unknown",
      marketCap > 0 ? `• Market Cap: ${escape(`$${marketCap.toLocaleString()}`)}` : "• Market Cap: Unknown",
      ``,
    ].filter(Boolean).join("\n");

    // Add wallet breakdown if there are holdings
    if (walletsWithBalance > 0) {
      monitorMessage += `**💎 Wallet Breakdown:**\n`;
      walletHoldings.forEach((holding, index) => {
        const valueText = holding.valueUsd > 0 ? ` (${escape(`$${holding.valueUsd.toFixed(2)}`)}$)` : "";
        monitorMessage += `${index + 1}. ${holding.shortAddress}: ${escape(holding.balance.toLocaleString(undefined, { maximumFractionDigits: 2 }))}${valueText}\n`;
      });
      monitorMessage += `\n`;
    } else {
      monitorMessage += `❌ **No tokens found in your wallets**\n\n`;
    }

    monitorMessage += `Use the buttons below to manage your position ⬇️`;

    // Create keyboard with relevant actions
    const keyboard = new InlineKeyboard()
      .text("🔄 Refresh", `refresh_cto_monitor_${tokenAddress}`)
      .text("📊 Chart", `chart_${tokenAddress}`)
      .row();

    // Add sell buttons only if user has tokens
    if (walletsWithBalance > 0) {
      keyboard
        .text("💸 Sell 25%", `sell_ca_25_${tokenAddress}`)
        .text("💸 Sell 50%", `sell_ca_50_${tokenAddress}`)
        .row()
        .text("💸 Sell 75%", `sell_ca_75_${tokenAddress}`)
        .text("💸 Sell 100%", `sell_ca_100_${tokenAddress}`)
        .row();
    }

    keyboard
      .text("🔙 Back", CallBackQueries.BACK)
      .text("❌ Close", CallBackQueries.CANCEL);

    // Update the loading message with the monitor data
    await ctx.api.editMessageText(
      ctx.chat!.id,
      loadingMessage.message_id,
      monitorMessage,
      {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      }
    );

    // Pin the monitor message for easy access
    try {
      await ctx.api.pinChatMessage(ctx.chat!.id, loadingMessage.message_id, { disable_notification: true });
      logger.info(`[CTO Monitor] Monitor message pinned for token ${tokenAddress}`);
    } catch (pinError) {
      logger.warn(`[CTO Monitor] Failed to pin monitor message:`, pinError);
    }

    // Wait for user interactions
    while (true) {
      const response = await conversation.waitFor("callback_query:data");
      const data = response.callbackQuery?.data;

      // Handle refresh
      if (data === `refresh_cto_monitor_${tokenAddress}`) {
        await response.answerCallbackQuery("🔄 Refreshing...");
        // Restart the monitor conversation to refresh data
        return await ctoMonitorConversation(conversation, response, tokenAddress);
      }

      // Handle sell buttons - let global handlers take over
      if (data?.startsWith("sell_ca_")) {
        return conversation.halt();
      }

      // Handle chart
      if (data === `chart_${tokenAddress}`) {
        await response.answerCallbackQuery("📊 Opening chart...");
        await response.reply(
          `📊 **Chart Links**\n\n` +
          `**Token:** \`${tokenAddress}\`\n\n` +
          `• [DexScreener](https://dexscreener.com/solana/${tokenAddress})\n` +
          `• [Photon](https://photon-sol.tinyastro.io/en/lp/${tokenAddress})\n` +
          `• [Raydium](https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${tokenAddress})`,
          { parse_mode: "Markdown" }
        );
        continue;
      }

      // Handle back/cancel
      if (data === CallBackQueries.BACK || data === CallBackQueries.CANCEL) {
        await response.answerCallbackQuery();
        await response.reply("✅ CTO Monitor closed.");
        return conversation.halt();
      }

      // Unknown callback
      await response.answerCallbackQuery();
    }

  } catch (error: any) {
    logger.error(`[CTO Monitor] Error:`, error);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      loadingMessage.message_id,
      `❌ **CTO Monitor Error**\n\n` +
      `Failed to load monitor data: ${error.message}`,
      { parse_mode: "Markdown" }
    );
    return conversation.halt();
  }
};
