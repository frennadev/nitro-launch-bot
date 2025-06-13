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
} from "../../backend/functions";
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

// Store retry data for quick launch
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
  // Check if this is a retry attempt
  const isRetry = quickLaunchRetryData !== null;
  
  // --------- VALIDATE USER ---------
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  let name: string, symbol: string, description: string, fileData: ArrayBuffer;
  let totalBuyAmount: number, devBuy: number, walletsNeeded: number;

  if (isRetry && quickLaunchRetryData) {
    // Use stored data for retry
    ({ name, symbol, description, fileData, totalBuyAmount, devBuy, walletsNeeded } = quickLaunchRetryData);
    
    await sendMessage(ctx, `🔄 <b>Retrying Quick Launch</b>

<b>Using previous input:</b>
• <b>Token:</b> ${name} (${symbol})
• <b>Total Buy Amount:</b> ${totalBuyAmount} SOL
• <b>Dev Buy:</b> ${devBuy > 0 ? `${devBuy} SOL` : 'None'}
• <b>Wallets:</b> ${walletsNeeded}

Proceeding to wallet setup...`, { parse_mode: "HTML" });

    // Clear retry data after use
    quickLaunchRetryData = null;
  } else {
    // Original input collection flow
    await sendMessage(ctx, `🚀 <b>Quick Launch - Create & Launch Token in Minutes!</b>

This guided process will help you:
• Create your token with smart defaults
• Set up wallets automatically 
• Launch with optimal settings
• Get your token live on Pump.fun

Let's get started! 🎯`, { parse_mode: "HTML", reply_markup: cancelKeyboard });

    // --------- STEP 1: TOKEN DETAILS ---------
    await sendMessage(ctx, `<b>Step 1/6: Token Details</b> 📝

Please send your token details as <b>name, symbol, description</b>, separated by commas.

<b>Example:</b> <code>Rocket Token,ROCKET,The next big memecoin on Solana!</code>

<i>💡 Tip: Keep the symbol short (3-6 characters) and description engaging!</i>`, 
      { parse_mode: "HTML", reply_markup: cancelKeyboard }
    );

    let details: string[];
    while (true) {
      const upd = await conversation.wait();
      if (upd.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
        await upd.answerCallbackQuery();
        await sendMessage(ctx, "Quick launch cancelled.");
        return conversation.halt();
      }
      if (upd.message?.text) {
        details = upd.message.text.split(",").map((s) => s.trim());
        if (details.length === 3 && details.every(d => d.length > 0)) {
          // Validate symbol length
          if (details[1].length > 10) {
            await sendMessage(ctx, "⚠️ Symbol should be 10 characters or less. Please try again:", {
              parse_mode: "HTML",
              reply_markup: cancelKeyboard,
            });
            continue;
          }
          break;
        }
        await sendMessage(ctx, "❌ Invalid format. Please send exactly 3 parts: <b>name,symbol,description</b>", {
          parse_mode: "HTML",
          reply_markup: cancelKeyboard,
        });
      }
    }

    [name, symbol, description] = details;
    await sendMessage(ctx, `✅ Token details saved:
• <b>Name:</b> ${name}
• <b>Symbol:</b> ${symbol}
• <b>Description:</b> ${description}`, { parse_mode: "HTML" });

    // --------- STEP 2: TOKEN IMAGE ---------
    await sendMessage(ctx, `<b>Step 2/6: Token Image</b> 🖼️

Upload an image for your token (max 20 MB).

<i>💡 Tip: Use a square image (1:1 ratio) for best results. High quality PNG or JPG works best!</i>`, 
      { parse_mode: "HTML", reply_markup: cancelKeyboard }
    );

    let fileCtx;
    while (true) {
      const upd = await conversation.wait();
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
      return conversation.halt();
    }

    await sendMessage(ctx, "✅ Image uploaded successfully!");

    // Get file data
    const imageUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const { data } = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: "arraybuffer",
    });
    fileData = data;

    // --------- STEP 3: BUY AMOUNT ---------
    await sendMessage(ctx, `<b>Step 3/6: Total Buy Amount</b> 💰

How much SOL should be spent in total across buyer wallets?

<b>Recommended amounts:</b>
• <code>0.5</code> SOL - Conservative (1 wallet)
• <code>1.5</code> SOL - Moderate (2 wallets)
• <code>3.0</code> SOL - Aggressive (2+ wallets)

<i>💡 Wallet count will be determined automatically based on amount (max 2 SOL per wallet)</i>`, 
      { parse_mode: "HTML", reply_markup: cancelKeyboard }
    );

    while (true) {
      const updatedCtx = await waitForInputOrCancel(conversation, ctx, "Enter total SOL amount for buyer wallets:");
      if (!updatedCtx) return;
      
      const parsed = parseFloat(updatedCtx.message!.text);
      if (isNaN(parsed) || parsed <= 0) {
        await sendMessage(ctx, "❌ Invalid amount. Please enter a positive number:");
      } else if (parsed > 20) {
        await sendMessage(ctx, "⚠️ Amount seems high. Please enter a reasonable amount (0.1-20 SOL):");
      } else if (parsed < 0.1) {
        await sendMessage(ctx, "⚠️ Amount too small. Minimum 0.1 SOL needed:");
      } else {
        totalBuyAmount = parsed;
        break;
      }
    }

    // Calculate number of wallets needed based on amount
    if (totalBuyAmount <= 1) {
      walletsNeeded = 1;
    } else if (totalBuyAmount <= 2) {
      walletsNeeded = 2;
    } else {
      // For amounts over 2 SOL, ensure no wallet gets more than 2 SOL
      walletsNeeded = Math.ceil(totalBuyAmount / 2);
      // Cap at 10 wallets maximum
      walletsNeeded = Math.min(walletsNeeded, 10);
    }

    await sendMessage(ctx, `✅ Total buy amount: ${totalBuyAmount} SOL
📊 Will use ${walletsNeeded} buyer wallet${walletsNeeded > 1 ? 's' : ''}

<i>💡 Amount will be distributed randomly using our mixer for natural patterns!</i>`, { parse_mode: "HTML" });

    // --------- STEP 4: DEV BUY AMOUNT ---------
    const skipDevKeyboard = new InlineKeyboard()
      .text("Skip Dev Buy", QuickLaunchCallbacks.SKIP_DEV_BUY)
      .row()
      .text("❌ Cancel", QuickLaunchCallbacks.CANCEL);

    await sendMessage(ctx, `<b>Step 4/6: Dev Buy (Optional)</b> 👨‍💻

Should your dev wallet also buy tokens? This can help with initial liquidity.

<b>Recommended:</b>
• <code>0</code> - Skip dev buy
• <code>0.1</code> - Small dev position
• <code>0.2</code> - Moderate dev position

Enter amount in SOL (or click Skip):`, 
      { parse_mode: "HTML", reply_markup: skipDevKeyboard }
    );

    while (true) {
      const updatedCtx = await conversation.waitFor(["message:text", "callback_query:data"]);
      
      if (updatedCtx.callbackQuery?.data === QuickLaunchCallbacks.CANCEL) {
        await updatedCtx.answerCallbackQuery();
        await sendMessage(ctx, "Quick launch cancelled.");
        return conversation.halt();
      }
      
      if (updatedCtx.callbackQuery?.data === QuickLaunchCallbacks.SKIP_DEV_BUY) {
        await updatedCtx.answerCallbackQuery();
        devBuy = 0;
        break;
      }
      
      if (updatedCtx.message?.text) {
        const parsed = parseFloat(updatedCtx.message.text);
        if (isNaN(parsed) || parsed < 0) {
          await sendMessage(ctx, "❌ Invalid amount. Please enter 0 or a positive number:");
        } else if (parsed > 2) {
          await sendMessage(ctx, "⚠️ Dev buy amount seems high. Please enter a reasonable amount (0-2 SOL):");
        } else {
          devBuy = parsed;
          break;
        }
      }
    }

    await sendMessage(ctx, devBuy > 0 
      ? `✅ Dev buy set: ${devBuy} SOL`
      : `✅ Skipping dev buy`
    );

    // Store data for potential retry
    quickLaunchRetryData = {
      name,
      symbol,
      description,
      fileData,
      totalBuyAmount,
      devBuy,
      walletsNeeded
    };
  }

  // --------- STEP 5: WALLET SETUP & FUNDING ---------
  await sendMessage(ctx, `<b>Step 5/6: Wallet Setup</b> 🔧

Setting up your wallets automatically...`, { parse_mode: "HTML" });

  // Ensure funding wallet exists
  let fundingWallet = await getFundingWallet(user.id);
  if (!fundingWallet) {
    fundingWallet = await getOrCreateFundingWallet(String(user.id));
  }

  // Generate buyer wallets if needed
  let buyerWallets = await getAllBuyerWallets(user.id);
  const additionalWalletsNeeded = Math.max(0, walletsNeeded - buyerWallets.length);
  
  if (additionalWalletsNeeded > 0) {
    await sendMessage(ctx, `🔄 Generating ${additionalWalletsNeeded} additional buyer wallets...`);
    for (let i = 0; i < additionalWalletsNeeded; i++) {
      await generateNewBuyerWallet(user.id);
    }
    buyerWallets = await getAllBuyerWallets(user.id);
  }

  // Get dev wallet
  const devWalletAddress = await getDefaultDevWallet(String(user.id));
  const { wallet: devWalletPrivateKey } = await getDevWallet(user.id);

  await sendMessage(ctx, `✅ Wallets ready:
• <b>Dev wallet:</b> ${devWalletAddress.slice(0, 6)}...${devWalletAddress.slice(-4)}
• <b>Funding wallet:</b> ${fundingWallet!.publicKey.slice(0, 6)}...${fundingWallet!.publicKey.slice(-4)}
• <b>Buyer wallets:</b> ${walletsNeeded} will be used for launch`, { parse_mode: "HTML" });

  // Check balances and calculate requirements
  const devBalance = await getWalletBalance(devWalletAddress);
  const fundingBalance = await getWalletBalance(fundingWallet!.publicKey);
  
  const devRequired = devBuy > 0 ? Math.max(devBuy + 0.1, 0.1) : 0.1; // Min 0.1 SOL for dev wallet
  const fundingRequired = totalBuyAmount + (walletsNeeded * 0.05) + 0.2; // Buy amount + fees + buffer
  
  await sendMessage(ctx, `💰 <b>Balance Check:</b>

<b>Dev Wallet:</b> ${devBalance.toFixed(4)} SOL (need: ${devRequired.toFixed(4)} SOL)
<b>Funding Wallet:</b> ${fundingBalance.toFixed(4)} SOL (need: ${fundingRequired.toFixed(4)} SOL)

${devBalance < devRequired || fundingBalance < fundingRequired ? '⚠️ <b>Funding needed!</b>' : '✅ <b>Sufficient funds!</b>'}`, 
    { parse_mode: "HTML" }
  );

  // Handle funding if needed
  if (devBalance < devRequired) {
    const fundDevKeyboard = new InlineKeyboard()
      .text("✅ I've funded it", QuickLaunchCallbacks.FUND_DEV_WALLET)
      .row()
      .text("❌ Cancel", QuickLaunchCallbacks.CANCEL);

    await sendMessage(ctx, `💳 <b>Fund Your Dev Wallet</b>

Your dev wallet needs more SOL. Please send <b>${devRequired.toFixed(4)} SOL</b> to:

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
        quickLaunchRetryData = null; // Clear retry data
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
            quickLaunchRetryData = null; // Clear retry data
            return conversation.halt();
          }
        }
      }
    }
  }

  if (fundingBalance < fundingRequired) {
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
            quickLaunchRetryData = null; // Clear retry data
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
• <b>Total Cost:</b> ~${(totalBuyAmount + devBuy + (walletsNeeded * 0.05) + 0.2).toFixed(4)} SOL

This will:
1. Create your token on Pump.fun
2. Launch it immediately  
3. Execute buy orders from ${walletsNeeded} wallet${walletsNeeded > 1 ? 's' : ''} with random amounts
${devBuy > 0 ? '4. Execute dev buy order' : ''}

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
      
      const token = await createToken(user.id, name, symbol, description, fileData);
      
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
          quickLaunchRetryData = null; // Clear retry data
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