import { type Conversation } from "@grammyjs/conversations";
import { type Context, InlineKeyboard } from "grammy";
import {
  createToken,
  getUser,
  enqueueTokenLaunch,
  getFundingWallet,
  getOrCreateFundingWallet,
  getAllBuyerWallets,
  generateNewBuyerWallet,
  getWalletBalance,
  preLaunchChecks,
  getDefaultDevWallet,
  getDevWallet,
  saveRetryData,
  getRetryData,
  clearRetryData,
  calculateTotalLaunchCost,
} from "../../backend/functions-main";
import { CallBackQueries } from "../types";
import { env } from "../../config";
import axios from "axios";
import { decryptPrivateKey } from "../../backend/utils";

enum QuickLaunchCallbacks {
  CANCEL = "CANCEL_QUICK_LAUNCH",
  CONFIRM_LAUNCH = "CONFIRM_QUICK_LAUNCH",
  FUND_DEV_WALLET = "FUND_DEV_WALLET",
  FUND_FUNDING_WALLET = "FUND_FUNDING_WALLET",
  SKIP_DEV_BUY = "SKIP_DEV_BUY",
  RETRY = "RETRY_QUICK_LAUNCH",
}

const cancelKeyboard = new InlineKeyboard().text("❌ Cancel", QuickLaunchCallbacks.CANCEL);
const retryKeyboard = new InlineKeyboard()
  .text("🔄 Try Again", QuickLaunchCallbacks.RETRY)
  .row()
  .text("❌ Cancel", QuickLaunchCallbacks.CANCEL);

// Store retry data
/*
interface QuickLaunchRetryData {
  name: string;
  symbol: string;
  description: string;
  fileData: ArrayBuffer;
  totalBuyAmount: number;
  devBuy: number;
  walletsNeeded: number;
}

let quickLaunchRetryData: QuickLaunchRetryData | null = null;
*/

async function sendMessage(ctx: Context, text: string, options: any = {}) {
  await ctx.reply(text, options);
}

async function waitForInputOrCancel(
  conversation: Conversation,
  ctx: Context,
  prompt: string,
  parseMode: string = "HTML",
  customKeyboard?: InlineKeyboard
) {
  await sendMessage(ctx, prompt, {
    parse_mode: parseMode,
    reply_markup: customKeyboard || cancelKeyboard,
  });

  const input = await conversation.waitFor(["message:text", "callback_query:data"]);
  if (input.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
    await input.answerCallbackQuery();
    await sendMessage(ctx, "Quick launch cancelled. Returning to main menu.");
    await conversation.halt();
    return null;
  }
  return input;
}

const quickLaunchConversation = async (conversation: Conversation, ctx: Context) => {
  // --------- VALIDATE USER ---------
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    await conversation.halt();
    return;
  }

  // Check if this is a retry attempt
  const existingRetryData = await getRetryData(user.id, "quick_launch");
  const isRetry = existingRetryData !== null;
  
  console.log("Quick Launch - Retry check:", { isRetry, existingRetryData });

  // -------- GET FUNDING WALLET ----------
  const fundingWallet = await getFundingWallet(user.id);
  if (!fundingWallet) {
    await sendMessage(ctx, "❌ No funding wallet found. Please configure your funding wallet in Wallet Config first.");
    await conversation.halt();
    return;
  }

  // -------- GET BUYER WALLETS ----------
  const buyerWallets = await getAllBuyerWallets(user.id);
  if (buyerWallets.length === 0) {
    await sendMessage(ctx, "❌ No buyer wallets found. Please add buyer wallets in Wallet Config first.");
    await conversation.halt();
    return;
  }

  // -------- CHECK DEV WALLET BALANCE ----------
  const devWalletAddress = await getDefaultDevWallet(String(user.id));
  const devBalance = await getWalletBalance(devWalletAddress);
  const minDevBalance = env.LAUNCH_FEE_SOL + 0.1; // Platform fee + buffer (hidden from user)

  if (devBalance < minDevBalance) {
    await sendMessage(ctx, `❌ <b>Insufficient dev wallet balance!</b>

💰 <b>Required:</b> At least ${minDevBalance.toFixed(4)} SOL
💳 <b>Available:</b> ${devBalance.toFixed(4)} SOL

<b>Your dev wallet needs funding for token creation and dev buy operations.</b>

<b>Please fund your dev wallet:</b>
<code>${devWalletAddress}</code>

<i>💡 Tap the address above to copy it</i>`, { parse_mode: "HTML", reply_markup: retryKeyboard });

    // Wait for retry or cancel
    const response = await conversation.waitFor("callback_query:data");
    if (response.callbackQuery?.data === QuickLaunchCallbacks.RETRY) {
      await response.answerCallbackQuery();
      // Restart the conversation
      return quickLaunchConversation(conversation, ctx);
    } else {
      await response.answerCallbackQuery();
      await sendMessage(ctx, "Process cancelled.");
      await conversation.halt();
      return;
    }
  }

  // -------- CHECK FUNDING WALLET BALANCE ----------
  const fundingBalance = await getWalletBalance(fundingWallet.publicKey);
  await sendMessage(ctx, `💳 Using funding wallet: ${fundingWallet.publicKey.slice(0, 6)}...${fundingWallet.publicKey.slice(-4)}\n💰 Balance: ${fundingBalance.toFixed(4)} SOL\n👥 Using ${buyerWallets.length} buyer wallets`);

  let name = "";
  let symbol = "";
  let description = "";
  let totalBuyAmount = 0;
  let devBuy = 0;
  let fileData: ArrayBuffer;

  // Use stored values if this is a retry, otherwise get new input
  if (isRetry && existingRetryData) {
    name = existingRetryData.name || "";
    symbol = existingRetryData.symbol || "";
    description = existingRetryData.description || "";
    totalBuyAmount = existingRetryData.totalBuyAmount || 0;
    devBuy = existingRetryData.devBuy || 0;
    fileData = existingRetryData.imageData?.buffer || new ArrayBuffer(0);
    
    await sendMessage(ctx, `🔄 <b>Retrying with previous values:</b>
• <b>Name:</b> ${name}
• <b>Symbol:</b> ${symbol}
• <b>Description:</b> ${description}
• <b>Buy Amount:</b> ${totalBuyAmount} SOL
• <b>Dev Buy:</b> ${devBuy} SOL`, { parse_mode: "HTML" });
    
    // Clear retry data after use
    await clearRetryData(user.id, "quick_launch");
  } else {
    // -------- GET TOKEN DETAILS --------
    await sendMessage(ctx, "🏷️ Enter token name (e.g., 'My Awesome Token'):", { reply_markup: cancelKeyboard });

    while (true) {
      const nameCtx = await conversation.waitFor(["message:text", "callback_query:data"]);
      
      if (nameCtx.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
        await nameCtx.answerCallbackQuery();
        await sendMessage(ctx, "Quick launch cancelled.");
        return conversation.halt();
      }
      
      if (nameCtx.message?.text) {
        const tokenName = nameCtx.message.text.trim();
        if (tokenName.length < 1 || tokenName.length > 32) {
          await sendMessage(ctx, "❌ Token name must be 1-32 characters. Please try again:");
        } else {
          name = tokenName;
          break;
        }
      }
    }

    await sendMessage(ctx, "🔤 Enter token symbol (e.g., 'MAT'):", { reply_markup: cancelKeyboard });

    while (true) {
      const symbolCtx = await conversation.waitFor(["message:text", "callback_query:data"]);
      
      if (symbolCtx.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
        await symbolCtx.answerCallbackQuery();
        await sendMessage(ctx, "Quick launch cancelled.");
        return conversation.halt();
      }
      
      if (symbolCtx.message?.text) {
        const tokenSymbol = symbolCtx.message.text.trim().toUpperCase();
        if (tokenSymbol.length < 1 || tokenSymbol.length > 10) {
          await sendMessage(ctx, "❌ Token symbol must be 1-10 characters. Please try again:");
        } else {
          symbol = tokenSymbol;
          break;
        }
      }
    }

    await sendMessage(ctx, "📝 Enter token description:", { reply_markup: cancelKeyboard });

    while (true) {
      const descCtx = await conversation.waitFor(["message:text", "callback_query:data"]);
      
      if (descCtx.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
        await descCtx.answerCallbackQuery();
        await sendMessage(ctx, "Quick launch cancelled.");
        return conversation.halt();
      }
      
      if (descCtx.message?.text) {
        const desc = descCtx.message.text.trim();
        if (desc.length < 1 || desc.length > 1000) {
          await sendMessage(ctx, "❌ Description must be 1-1000 characters. Please try again:");
        } else {
          description = desc;
          break;
        }
      }
    }

    // -------- GET TOKEN IMAGE --------
    await sendMessage(ctx, "🖼️ Upload an image for your token (max 20 MB):", { reply_markup: cancelKeyboard });

    let fileCtx;
    while (true) {
      const upd = await conversation.waitFor(["message:photo", "callback_query:data"]);
      if (upd.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
        await upd.answerCallbackQuery();
        await sendMessage(ctx, "Quick launch cancelled.");
        return conversation.halt();
      }
      if (upd.message?.photo) {
        fileCtx = upd;
        break;
      }
      await sendMessage(ctx, "❌ Please upload an image file.", { reply_markup: cancelKeyboard });
    }

    const file = await fileCtx.getFile();
    if ((file.file_size ?? 0) > 20 * 1024 * 1024) {
      await sendMessage(ctx, "❌ Image too large (max 20MB). Please start over.");
      await conversation.halt();
      return;
    }
    
    await sendMessage(ctx, "✅ Image uploaded successfully!");

    // Get file data
    const imageUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const { data } = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: "arraybuffer",
    });
    fileData = data;

    // -------- GET BUY AMOUNT --------
    await sendMessage(ctx, "💰 Enter the total SOL amount to buy tokens with (e.g., 1.5):", { reply_markup: cancelKeyboard });

    while (true) {
      const buyAmountCtx = await conversation.waitFor(["message:text", "callback_query:data"]);
      
      if (buyAmountCtx.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
        await buyAmountCtx.answerCallbackQuery();
        await sendMessage(ctx, "Quick launch cancelled.");
        return conversation.halt();
      }
      
      if (buyAmountCtx.message?.text) {
        const parsed = parseFloat(buyAmountCtx.message.text);
        if (isNaN(parsed) || parsed <= 0) {
          await sendMessage(ctx, "❌ Invalid amount. Please enter a positive number:");
        } else if (parsed > 50) {
          await sendMessage(ctx, "⚠️ Amount seems very high. Please enter a reasonable amount (0.1-50 SOL):");
        } else {
          totalBuyAmount = parsed;
          break;
        }
      }
    }

    // -------- GET DEV BUY AMOUNT --------
    await sendMessage(ctx, `💎 Enter SOL amount for dev to buy (0 to skip, recommended: 10-20% of buy amount = ${(totalBuyAmount * 0.15).toFixed(3)} SOL):`, { reply_markup: cancelKeyboard });

    while (true) {
      const devBuyCtx = await conversation.waitFor(["message:text", "callback_query:data"]);
      
      if (devBuyCtx.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
        await devBuyCtx.answerCallbackQuery();
        await sendMessage(ctx, "Quick launch cancelled.");
        return conversation.halt();
      }
      
      if (devBuyCtx.message?.text) {
        const parsed = parseFloat(devBuyCtx.message.text);
        if (isNaN(parsed) || parsed < 0) {
          await sendMessage(ctx, "❌ Invalid amount. Please enter 0 or a positive number:");
        } else if (parsed > totalBuyAmount) {
          await sendMessage(ctx, "⚠️ Dev buy amount should not exceed total buy amount. Please enter a smaller amount:");
        } else {
          devBuy = parsed;
          break;
        }
      }
    }

    // Calculate wallets needed
    const walletsNeeded = Math.min(Math.ceil(totalBuyAmount / 2), buyerWallets.length);

    // Store retry data for potential retry
    await saveRetryData(user.id, ctx.chat!.id!.toString(), "quick_launch", {
      name,
      symbol,
      description,
      imageData: Buffer.from(fileData),
      totalBuyAmount,
      devBuy,
      walletsNeeded
    });
  }

  // Calculate wallets needed for retry case too
  const walletsNeeded = Math.min(Math.ceil(totalBuyAmount / 2), buyerWallets.length);

  // -------- CALCULATE TOTAL COSTS --------
  const costBreakdown = calculateTotalLaunchCost(totalBuyAmount, devBuy, walletsNeeded, false); // Don't show platform fee to user
  const requiredFundingAmount = costBreakdown.totalCost; // User sees total without knowing about hidden fee

  // Check funding wallet balance
  if (fundingBalance < requiredFundingAmount) {
    await sendMessage(ctx, `❌ <b>Insufficient funding wallet balance!</b>

💰 <b>Cost Breakdown:</b>
• Buy Amount: ${costBreakdown.breakdown.buyAmount} SOL
• Dev Buy: ${costBreakdown.breakdown.devBuy} SOL  
• Wallet Fees: ${costBreakdown.breakdown.walletFees} SOL
• Buffer: ${costBreakdown.breakdown.buffer} SOL

<b>Funding Wallet Required:</b> ${requiredFundingAmount.toFixed(4)} SOL
<b>Funding Wallet Available:</b> ${fundingBalance.toFixed(4)} SOL

<b>Please fund your wallet:</b>
<code>${fundingWallet.publicKey}</code>

<i>💡 Tap the address above to copy it, then send the required SOL and try again.</i>`, { parse_mode: "HTML", reply_markup: retryKeyboard });

    // Wait for retry or cancel
    const response = await conversation.waitFor("callback_query:data");
    if (response.callbackQuery?.data === QuickLaunchCallbacks.RETRY) {
      await response.answerCallbackQuery();
      // Restart the conversation with stored data
      return quickLaunchConversation(conversation, ctx);
    } else {
      await response.answerCallbackQuery();
      await sendMessage(ctx, "Process cancelled.");
      await clearRetryData(user.id, "quick_launch");
      await conversation.halt();
      return;
    }
  }

  // --------- STEP 5: WALLET SETUP & FUNDING ---------
  await sendMessage(ctx, `<b>Step 5/6: Wallet Setup</b> 🔧

Setting up your wallets automatically...`, { parse_mode: "HTML" });

  // Ensure funding wallet exists (reuse existing variable)
  if (!fundingWallet) {
    const newFundingWallet = await getOrCreateFundingWallet(String(user.id));
    // Update the existing variable reference
    Object.assign(fundingWallet, newFundingWallet);
  }

  // Generate buyer wallets if needed (reuse existing variable)
  const additionalWalletsNeeded = Math.max(0, walletsNeeded - buyerWallets.length);
  
  if (additionalWalletsNeeded > 0) {
    await sendMessage(ctx, `🔄 Generating ${additionalWalletsNeeded} additional buyer wallets...`);
    for (let i = 0; i < additionalWalletsNeeded; i++) {
      await generateNewBuyerWallet(user.id);
    }
    // Refresh buyer wallets list
    const updatedBuyerWallets = await getAllBuyerWallets(user.id);
    buyerWallets.length = 0;
    buyerWallets.push(...updatedBuyerWallets);
  }

  // Get dev wallet (reuse existing variables)
  const { wallet: devWalletPrivateKey } = await getDevWallet(user.id);

  await sendMessage(ctx, `✅ Wallets ready:
• <b>Dev wallet:</b> ${devWalletAddress.slice(0, 6)}...${devWalletAddress.slice(-4)}
• <b>Funding wallet:</b> ${fundingWallet!.publicKey.slice(0, 6)}...${fundingWallet!.publicKey.slice(-4)}
• <b>Buyer wallets:</b> ${walletsNeeded} will be used for launch`, { parse_mode: "HTML" });

  // Check balances and calculate requirements (reuse existing variables)
  const currentDevBalance = await getWalletBalance(devWalletAddress);
  const currentFundingBalance = await getWalletBalance(fundingWallet!.publicKey);
  
  // Calculate costs including platform fee (use different variable name)
  const fullCostBreakdown = calculateTotalLaunchCost(totalBuyAmount, devBuy, walletsNeeded, true);
  const devRequired = Math.max(devBuy + env.LAUNCH_FEE_SOL + 0.1, env.LAUNCH_FEE_SOL + 0.1); // Dev buy + platform fee + buffer
  const fundingRequired = fullCostBreakdown.totalCost - env.LAUNCH_FEE_SOL; // Everything except platform fee
  
  await sendMessage(ctx, `💰 <b>Cost Breakdown:</b>

<b>💳 Dev Wallet:</b> ${currentDevBalance.toFixed(4)} SOL (need: ${devRequired.toFixed(4)} SOL)
• Dev Buy: ${devBuy} SOL
• Token Creation: ~0.1 SOL

<b>💰 Funding Wallet:</b> ${currentFundingBalance.toFixed(4)} SOL (need: ${fundingRequired.toFixed(4)} SOL)
• Buy Orders: ${totalBuyAmount} SOL
• Transaction Fees: ${fullCostBreakdown.breakdown.walletFees} SOL
• Buffer: ${fullCostBreakdown.breakdown.buffer} SOL

${currentDevBalance < devRequired || currentFundingBalance < fundingRequired ? '⚠️ <b>Funding needed!</b>' : '✅ <b>All wallets funded!</b>'}`, 
    { parse_mode: "HTML" }
  );

  // Handle funding if needed
  if (currentDevBalance < devRequired) {
    const fundDevKeyboard = new InlineKeyboard()
      .text("✅ I've funded it", QuickLaunchCallbacks.FUND_DEV_WALLET)
      .row()
      .text("❌ Cancel", QuickLaunchCallbacks.CANCEL);

    await sendMessage(ctx, `💳 <b>Fund Your Dev Wallet</b>

Your dev wallet needs more SOL for:
• <b>Dev Buy:</b> ${devBuy} SOL  
• <b>Token Creation:</b> ~0.1 SOL

<b>Please send ${devRequired.toFixed(4)} SOL to:</b>
<code>${devWalletAddress}</code>

<i>💡 Tap the address above to copy it</i>

Click "I've funded it" when done:`, 
      { parse_mode: "HTML", reply_markup: fundDevKeyboard }
    );

    while (true) {
      const fundingResponse = await conversation.waitFor("callback_query:data");
      
      if (fundingResponse.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
        await fundingResponse.answerCallbackQuery();
        await sendMessage(ctx, "Quick launch cancelled.");
        return conversation.halt();
      }
      
      if (fundingResponse.callbackQuery?.data === QuickLaunchCallbacks.FUND_DEV_WALLET) {
        await fundingResponse.answerCallbackQuery();
        
        // Check balance again
        const newDevBalance = await getWalletBalance(devWalletAddress);
        if (newDevBalance >= devRequired) {
          await sendMessage(ctx, `✅ Dev wallet funded! Balance: ${newDevBalance.toFixed(4)} SOL`);
          break;
        } else {
          const retryFundDevKeyboard = new InlineKeyboard()
            .text("✅ I've funded it", QuickLaunchCallbacks.FUND_DEV_WALLET)
            .row()
            .text("🔄 Try Again", QuickLaunchCallbacks.RETRY)
            .row()
            .text("❌ Cancel", QuickLaunchCallbacks.CANCEL);

          await sendMessage(ctx, `❌ Still insufficient funds. Current: ${newDevBalance.toFixed(4)} SOL, Need: ${devRequired.toFixed(4)} SOL

<b>Please fund your dev wallet:</b>
<code>${devWalletAddress}</code>

<i>💡 Tap the address above to copy it, then send the required SOL.</i>`, 
            { parse_mode: "HTML", reply_markup: retryFundDevKeyboard }
          );

          // Wait for retry or cancel
          const response = await conversation.waitFor("callback_query:data");
          console.log("Quick Launch Funding - Received callback data:", response.callbackQuery?.data);
          console.log("Quick Launch Funding - Expected retry data:", QuickLaunchCallbacks.RETRY);
          if (response.callbackQuery?.data === QuickLaunchCallbacks.RETRY) {
            await response.answerCallbackQuery();
            console.log("Quick Launch Funding - Retry button clicked - restarting conversation");
            // Restart the conversation with stored data
            return quickLaunchConversation(conversation, ctx);
          } else if (response.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
            await response.answerCallbackQuery();
            console.log("Quick Launch Funding - Cancel button clicked");
            await sendMessage(ctx, "Quick launch cancelled.");
            return conversation.halt();
          }
        }
      }
    }
  }

  if (currentFundingBalance < fundingRequired) {
    const fundFundingKeyboard = new InlineKeyboard()
      .text("✅ I've funded it", QuickLaunchCallbacks.FUND_FUNDING_WALLET)
      .row()
      .text("❌ Cancel", QuickLaunchCallbacks.CANCEL);

    await sendMessage(ctx, `💳 <b>Fund Your Funding Wallet</b>

Your funding wallet needs more SOL. Please send <b>${fundingRequired.toFixed(4)} SOL</b> to:

<code>${fundingWallet!.publicKey}</code>

This will cover:
• Buy orders: ${totalBuyAmount} SOL
• Transaction fees: ~${(walletsNeeded * 0.05).toFixed(3)} SOL  
• Buffer: 0.2 SOL

<i>💡 Tap the address above to copy it</i>

Click "I've funded it" when done:`, 
      { parse_mode: "HTML", reply_markup: fundFundingKeyboard }
    );

    while (true) {
      const fundingResponse = await conversation.waitFor("callback_query:data");
      
      if (fundingResponse.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
        await fundingResponse.answerCallbackQuery();
        await sendMessage(ctx, "Quick launch cancelled.");
        return conversation.halt();
      }
      
      if (fundingResponse.callbackQuery?.data === QuickLaunchCallbacks.FUND_FUNDING_WALLET) {
        await fundingResponse.answerCallbackQuery();
        
        // Check balance again
        const newFundingBalance = await getWalletBalance(fundingWallet!.publicKey);
        if (newFundingBalance >= fundingRequired) {
          await sendMessage(ctx, `✅ Funding wallet funded! Balance: ${newFundingBalance.toFixed(4)} SOL`);
          break;
        } else {
          const retryFundFundingKeyboard = new InlineKeyboard()
            .text("✅ I've funded it", QuickLaunchCallbacks.FUND_FUNDING_WALLET)
            .row()
            .text("🔄 Try Again", QuickLaunchCallbacks.RETRY)
            .row()
            .text("❌ Cancel", QuickLaunchCallbacks.CANCEL);

          await sendMessage(ctx, `❌ Still insufficient funds. Current: ${newFundingBalance.toFixed(4)} SOL, Need: ${fundingRequired.toFixed(4)} SOL

<b>Please fund your funding wallet:</b>
<code>${fundingWallet!.publicKey}</code>

<i>💡 Tap the address above to copy it, then send the required SOL.</i>`, 
            { parse_mode: "HTML", reply_markup: retryFundFundingKeyboard }
          );

          // Wait for retry or cancel
          const response = await conversation.waitFor("callback_query:data");
          console.log("Quick Launch Funding - Received callback data:", response.callbackQuery?.data);
          console.log("Quick Launch Funding - Expected retry data:", QuickLaunchCallbacks.RETRY);
          if (response.callbackQuery?.data === QuickLaunchCallbacks.RETRY) {
            await response.answerCallbackQuery();
            console.log("Quick Launch Funding - Retry button clicked - restarting conversation");
            // Restart the conversation with stored data
            return quickLaunchConversation(conversation, ctx);
          } else if (response.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
            await response.answerCallbackQuery();
            console.log("Quick Launch Funding - Cancel button clicked");
            await sendMessage(ctx, "Quick launch cancelled.");
            return conversation.halt();
          }
        }
      }
    }
  }

  // --------- STEP 6: CREATE TOKEN & LAUNCH ---------
  await sendMessage(ctx, `<b>Step 6/6: Final Confirmation</b> 🚀

<b>Ready to launch your token!</b>

<b>📋 Summary:</b>
• <b>Token:</b> ${name} (${symbol})
• <b>Total Buy Amount:</b> ${totalBuyAmount} SOL
• <b>Dev Buy:</b> ${devBuy > 0 ? `${devBuy} SOL` : 'None'}
• <b>Platform Fee:</b> ${env.LAUNCH_FEE_SOL} SOL
• <b>Total Cost:</b> ~${fullCostBreakdown.totalCost.toFixed(4)} SOL

This will:
1. Collect ${env.LAUNCH_FEE_SOL} SOL platform fee from dev wallet
2. Create your token on Pump.fun
3. Launch it immediately  
4. Execute buy orders from ${walletsNeeded} wallet${walletsNeeded > 1 ? 's' : ''} with random amounts
${devBuy > 0 ? '5. Execute dev buy order' : ''}

<b>Ready to proceed?</b>`, 
    { 
      parse_mode: "HTML", 
      reply_markup: new InlineKeyboard()
        .text("🚀 Launch Now!", QuickLaunchCallbacks.CONFIRM_LAUNCH)
        .row()
        .text("❌ Cancel", QuickLaunchCallbacks.CANCEL)
    }
  );

  const confirmResponse = await conversation.waitFor("callback_query:data");
  
  if (confirmResponse.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
    await confirmResponse.answerCallbackQuery();
    await sendMessage(ctx, "Quick launch cancelled.");
    return conversation.halt();
  }
  
  if (confirmResponse.callbackQuery?.data === QuickLaunchCallbacks.CONFIRM_LAUNCH) {
    await confirmResponse.answerCallbackQuery();
    
    try {
      // Create token
      await sendMessage(ctx, "🔄 Creating token...");
      
      const token = await createToken(user.id, name, symbol, description, Buffer.from(fileData));
      
      await sendMessage(ctx, `✅ Token created successfully!
<b>Address:</b> <code>${token.tokenAddress}</code>`);

      // Perform pre-launch checks
      await sendMessage(ctx, "🔄 Performing pre-launch checks...");
      
      const { WalletModel } = await import("../../backend/models");
      const buyerWalletDocs = await WalletModel.find({
        user: user.id,
        isBuyer: true,
      }).lean();
      
      // Use only the required number of wallets based on buy amount
      const buyerKeys = buyerWalletDocs.slice(0, walletsNeeded).map(w => decryptPrivateKey(w.privateKey));
      
      const checkResult = await preLaunchChecks(
        fundingWallet!.privateKey,
        devWalletPrivateKey,
        totalBuyAmount,
        devBuy,
        buyerKeys.length
      );
      
      if (!checkResult.success) {
        await sendMessage(ctx, `❌ <b>Pre-launch checks failed</b>

Please resolve the issues below and try launching manually from your tokens list:

${checkResult.message}`, { parse_mode: "HTML", reply_markup: retryKeyboard });

        // Wait for retry or cancel
        const response = await conversation.waitFor("callback_query:data");
        console.log("Quick Launch Pre-launch - Received callback data:", response.callbackQuery?.data);
        console.log("Quick Launch Pre-launch - Expected retry data:", QuickLaunchCallbacks.RETRY);
        if (response.callbackQuery?.data === QuickLaunchCallbacks.RETRY) {
          await response.answerCallbackQuery();
          console.log("Quick Launch Pre-launch - Retry button clicked - restarting conversation");
          // Restart the conversation with stored data
          return quickLaunchConversation(conversation, ctx);
        } else {
          await response.answerCallbackQuery();
          console.log("Quick Launch Pre-launch - Cancel button clicked");
          await sendMessage(ctx, "Quick launch cancelled.");
          return conversation.halt();
        }
      }

      // Launch token
      await sendMessage(ctx, "🚀 Launching token...");
      
      const result = await enqueueTokenLaunch(
        user.id,
        ctx.chat!.id,
        token.tokenAddress,
        fundingWallet!.privateKey,
        devWalletPrivateKey,
        buyerKeys,
        devBuy,
        totalBuyAmount
      );
      
      if (!result.success) {
        await sendMessage(ctx, "❌ Failed to submit launch. Please try again or launch manually from your tokens list.");
      } else {
        await sendMessage(ctx, `🎉 <b>Token Launch Submitted Successfully!</b>

Your token <b>${name} (${symbol})</b> is now being launched on Pump.fun!

<b>What happens next:</b>
• Token will be deployed to Pump.fun
• ${walletsNeeded} buyer wallets will purchase tokens with random amounts totaling ${totalBuyAmount} SOL
${devBuy > 0 ? `• Dev wallet will purchase ${devBuy} SOL` : ''}
• You'll receive updates as the launch progresses

<b>Token Address:</b> <code>${token.tokenAddress}</code>

<i>🔔 You'll get a notification when your launch is complete!</i>`, 
          { parse_mode: "HTML" }
        );
      }
      
    } catch (error: any) {
      await sendMessage(ctx, `❌ An error occurred during launch: ${error.message}

Please try again or contact support if the issue persists.`);
    }
  }

  conversation.halt();
};

export default quickLaunchConversation; 