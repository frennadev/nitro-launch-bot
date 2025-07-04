import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser, getFundingWallet, getAllTradingWallets } from "../../backend/functions";
import { getTokenBalance, getTokenInfo } from "../../backend/utils";
import { sendMessage } from "../../backend/sender";
import { logger } from "../../blockchain/common/logger";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import { escape, safeEditMessageText, sendErrorWithAutoDelete } from "../utils";
import JupiterPumpswapService from "../../service/jupiter-pumpswap-service";

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
        const result = await executeExternalTokenSellWithJupiter(tokenAddress, buyerWalletPrivateKeys, sellPercent);

        if (result.success) {
          const solReceivedText = result.totalSolReceived?.toFixed(6) || "Unknown";
          
          // Determine platforms used from results
          const platformsUsed = new Set();
          if (result.results) {
            result.results.forEach((r: any) => {
              if (r.success && r.platform) {
                platformsUsed.add(r.platform);
              }
            });
          }
          
          const platformText = platformsUsed.size > 0 
            ? Array.from(platformsUsed).map(p => {
                switch(p) {
                  case 'jupiter': return '🔄 Jupiter';
                  case 'pumpswap': return '💫 Pumpswap';
                  case 'pumpfun': return '🚀 PumpFun';
                  default: return `📈 ${p}`;
                }
              }).join(', ')
            : '📈 Smart Routing';
          
          await sendMessage(
            response,
            `✅ **External token sell completed successfully!**\n\n📊 **Results:**\n• Successful Sells: ${result.successfulSells}\n• Failed Sells: ${result.failedSells}\n• Total SOL Received: ${solReceivedText} SOL\n• Platform: ${platformText}`,
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
        await sendErrorWithAutoDelete(ctx, `❌ **Error during external token sell**\n\n${error.message}`);
      }
    }
  } catch (error: any) {
    logger.error("Error in external token sell conversation:", error);
    await sendErrorWithAutoDelete(ctx, `❌ Error: ${error.message}`);
  }

  await conversation.halt();
};

// Enhanced external token sell using Jupiter-Pumpswap service
const executeExternalTokenSellWithJupiter = async (
  tokenAddress: string,
  buyerWalletPrivateKeys: string[],
  sellPercent: number
) => {
  const logIdentifier = `external-sell-${tokenAddress.substring(0, 8)}`;
  logger.info(`[${logIdentifier}]: Starting external token sell using Jupiter-Pumpswap service`);

  try {
    const jupiterPumpswapService = new JupiterPumpswapService();
    const results = [];
    let successfulSells = 0;
    let failedSells = 0;
    let totalSolReceived = 0;

    // Process each wallet that has tokens
    for (let i = 0; i < buyerWalletPrivateKeys.length; i++) {
      try {
        const walletKeypair = secretKeyToKeypair(buyerWalletPrivateKeys[i]);
        
        // Check wallet's token balance
        const walletBalance = await getTokenBalance(tokenAddress, walletKeypair.publicKey.toBase58());
        if (walletBalance <= 0) {
          logger.info(`[${logIdentifier}]: Wallet ${i + 1} has no tokens, skipping`);
          continue;
        }

        // Calculate tokens to sell from this wallet
        const tokensToSell = Math.floor((walletBalance * sellPercent) / 100);
        if (tokensToSell <= 0) {
          logger.info(`[${logIdentifier}]: Wallet ${i + 1} has insufficient tokens to sell, skipping`);
          continue;
        }

        logger.info(`[${logIdentifier}]: Wallet ${i + 1} selling ${tokensToSell} tokens (${sellPercent}% of ${walletBalance})`);

        // Execute sell using Jupiter-Pumpswap service
        const result = await jupiterPumpswapService.executeSell(
          tokenAddress,
          walletKeypair,
          tokensToSell
        );

        if (result.success) {
          successfulSells++;
          const solReceived = parseFloat(result.solReceived || "0");
          totalSolReceived += solReceived;
          
          logger.info(`[${logIdentifier}]: Wallet ${i + 1} sell successful via ${result.platform}: ${result.signature}`);
          logger.info(`[${logIdentifier}]: Wallet ${i + 1} received ${solReceived} SOL`);
          
          results.push({
            success: true,
            wallet: walletKeypair.publicKey.toBase58(),
            signature: result.signature,
            platform: result.platform,
            solReceived
          });
        } else {
          failedSells++;
          logger.warn(`[${logIdentifier}]: Wallet ${i + 1} sell failed: ${result.error}`);
          
          results.push({
            success: false,
            wallet: walletKeypair.publicKey.toBase58(),
            error: result.error
          });
        }
      } catch (error: any) {
        failedSells++;
        logger.error(`[${logIdentifier}]: Wallet ${i + 1} error: ${error.message}`);
        
        results.push({
          success: false,
          wallet: "unknown",
          error: error.message
        });
      }
    }

    logger.info(`[${logIdentifier}]: External sell completed - ${successfulSells} successful, ${failedSells} failed, ${totalSolReceived.toFixed(6)} SOL received`);

    return {
      success: successfulSells > 0,
      successfulSells,
      failedSells,
      totalSolReceived,
      results
    };

  } catch (error: any) {
    logger.error(`[${logIdentifier}]: External sell failed:`, error);
    return {
      success: false,
      successfulSells: 0,
      failedSells: buyerWalletPrivateKeys.length,
      error: error.message
    };
  }
};

export default externalTokenSellConversation;
