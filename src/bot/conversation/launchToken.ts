import { type Conversation } from "@grammyjs/conversations";
import { type Context, InlineKeyboard } from "grammy";
import {
  enqueueTokenLaunch,
  enqueueTokenLaunchRetry,
  enqueuePrepareTokenLaunch,
  getUser,
  getUserToken,
  preLaunchChecks,
  getFundingWallet,
  getAllBuyerWallets,
  getWalletBalance,
  saveRetryData,
  getRetryData,
  clearRetryData,
  calculateTotalLaunchCost,
  getDefaultDevWallet,
  getDevWallet,
  getCurrentDevWalletPrivateKey,
  autoReplaceLaunchedTokenAddress,
} from "../../backend/functions";
import { TokenState } from "../../backend/types";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import { decryptPrivateKey } from "../../backend/utils";
import { CallBackQueries } from "../types";
import { env } from "../../config";
import { startLoadingState, sendLoadingMessage } from "../loading";
import { safeAnswerCallbackQuery } from "../utils";
import { logger } from "../../blockchain/common/logger";

enum LaunchCallBackQueries {
  CANCEL = "CANCEL_LAUNCH",
  CONFIRM_LAUNCH = "CONFIRM_LAUNCH",
  RETRY = "RETRY_LAUNCH",
}

const cancelKeyboard = new InlineKeyboard().text(
  "❌ Cancel",
  LaunchCallBackQueries.CANCEL
);
const retryKeyboard = new InlineKeyboard()
  .text("🔄 Try Again", LaunchCallBackQueries.RETRY)
  .row()
  .text("❌ Cancel", LaunchCallBackQueries.CANCEL);

async function sendMessage(ctx: Context, text: string, options: any = {}) {
  await ctx.reply(text, options);
}

async function waitForInputOrCancel(
  conversation: Conversation,
  ctx: Context,
  prompt: string,
  parseMode: string = "HTML"
) {
  await sendMessage(ctx, prompt, {
    parse_mode: parseMode,
    reply_markup: cancelKeyboard,
  });

  const input = await conversation.waitFor([
    "message:text",
    "callback_query:data",
  ]);
  if (input.callbackQuery?.data === LaunchCallBackQueries.CANCEL) {
    await sendMessage(ctx, "Process cancelled. Returning to the beginning.");
    await conversation.halt();
    return null;
  }
  return input;
}

const launchTokenConversation = async (
  conversation: Conversation,
  ctx: Context,
  tokenAddress: string
) => {
  await safeAnswerCallbackQuery(ctx);
  // --------- VALIDATE USER ---------
  const user = await getUser(ctx.chat!.id!.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    await conversation.halt();
    return;
  }

  // Check if this is a retry attempt
  const existingRetryData = await getRetryData(user.id, "launch_token");
  const isRetry = existingRetryData !== null;

  console.log("Launch Token - Retry check:", { isRetry, existingRetryData });

  // -------- VALIDATE TOKEN ----------
  let token = await getUserToken(user.id, tokenAddress);
  if (!token) {
    await sendMessage(ctx, "Token not found ❌");
    await conversation.halt();
    return;
  }
  if (token.state === TokenState.LAUNCHING) {
    await sendMessage(ctx, "Token is currently launching 🔄");
    await conversation.halt();
    return;
  }
  if (token.state === TokenState.LAUNCHED) {
    await sendMessage(ctx, "Token is already launched 🚀");
    await conversation.halt();
    return;
  }

  // -------- CHECK IF TOKEN IS ALREADY LAUNCHED ON OTHER PLATFORMS --------
  // Automatically replace token address if it's already launched/listed
  try {
    const replacementResult = await autoReplaceLaunchedTokenAddress(user.id, tokenAddress);
    
    if (replacementResult.wasReplaced) {
      // Token was replaced with a new address
      await sendMessage(
        ctx,
        `🔄 <b>Token Address Replaced</b>

The original token address was already ${replacementResult.reason?.includes('listed') ? 'listed' : 'launched'} on a trading platform.

✅ <b>Automatically assigned new address:</b>
<code>${replacementResult.newTokenAddress}</code>

Your token metadata remains the same:
• <b>Name:</b> ${token.name}
• <b>Symbol:</b> ${token.symbol}
• <b>Description:</b> ${token.description}

Continuing with launch process...`,
        { parse_mode: "HTML" }
      );
      
      // Update the token address for the rest of the conversation
      tokenAddress = replacementResult.newTokenAddress;
      
      // Get the updated token data
      const updatedToken = await getUserToken(user.id, tokenAddress);
      if (!updatedToken) {
        await sendMessage(ctx, "Error: Could not retrieve updated token data ❌");
        await conversation.halt();
        return;
      }
      token = updatedToken;
    }
  } catch (error: any) {
    logger.error(`[launchToken] Error during token address replacement: ${error.message}`);
    await sendMessage(
      ctx,
      `❌ <b>Error checking token status</b>

Could not verify if token is already launched. Please try again or contact support.

Error: ${error.message}`,
      { parse_mode: "HTML" }
    );
    await conversation.halt();
    return;
  }

  // -------- FOR RETRIES -------
  // Instead of automatically retrying with old values, let user enter new values
  if ((token.launchData?.launchStage || 1) > 1) {
    await sendMessage(
      ctx,
      `🔄 <b>Previous launch attempt detected</b>

This token has a previous launch attempt. You can:
• Enter new launch amounts (recommended)
• Or continue with previous values

<b>Previous values:</b>
• Buy Amount: ${token.launchData?.buyAmount || 0} SOL  
• Dev Buy: ${token.launchData?.devBuy || 0} SOL

Would you like to enter new values or use previous ones?`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🆕 Enter New Values", "NEW_VALUES")
          .text("🔄 Use Previous Values", "USE_PREVIOUS")
          .row()
          .text("❌ Cancel", LaunchCallBackQueries.CANCEL),
      }
    );

    const retryChoice = await conversation.waitFor("callback_query:data");
    await safeAnswerCallbackQuery(retryChoice);

    if (retryChoice.callbackQuery?.data === LaunchCallBackQueries.CANCEL) {
      await sendMessage(ctx, "Launch cancelled.");
      await conversation.halt();
      return;
    }

    if (retryChoice.callbackQuery?.data === "USE_PREVIOUS") {
      // Use the automatic retry with stored values
      const result = await enqueueTokenLaunchRetry(
        user.id,
        Number(user.telegramId),
        token.tokenAddress
      );
      if (!result.success) {
        await sendMessage(
          ctx,
          "An error occurred while submitting token launch for retry ❌. Please try again.."
        );
      } else {
        await sendMessage(
          ctx,
          "Token Launch details has been submitted for retry ✅.\nYou would get a message once your launch has been completed."
        );
      }
      await conversation.halt();
      return;
    }

    // If "NEW_VALUES" selected, continue with the normal flow to get new input
    await sendMessage(ctx, "✅ You can now enter new launch amounts.");
  }

  // -------- GET FUNDING WALLET ----------
  const fundingWallet = await getFundingWallet(user.id);
  if (!fundingWallet) {
    await sendMessage(
      ctx,
      "❌ No funding wallet found. Please configure your funding wallet in Wallet Config first."
    );
    await conversation.halt();
    return;
  }

  // -------- GET BUYER WALLETS ----------
  const buyerWallets = await getAllBuyerWallets(user.id);
  if (buyerWallets.length === 0) {
    await sendMessage(
      ctx,
      "❌ No buyer wallets found. Please add buyer wallets in Wallet Config first."
    );
    await conversation.halt();
    return;
  }

  // -------- CHECK DEV WALLET BALANCE ----------
  const devWalletAddress = await getDefaultDevWallet(String(user.id));
  const devBalance = await getWalletBalance(devWalletAddress);
  const minDevBalance = env.LAUNCH_FEE_SOL + 0.1; // Platform fee + buffer (hidden from user)

  if (devBalance < minDevBalance) {
    const launchKb = new InlineKeyboard().text(
      "🚀 Launch Token",
      `${CallBackQueries.LAUNCH_TOKEN}_${tokenAddress}`
    );

    await sendMessage(
      ctx,
      `❌ <b>Insufficient dev wallet balance!</b>

💰 <b>Required:</b> At least ${minDevBalance.toFixed(4)} SOL
💳 <b>Available:</b> ${devBalance.toFixed(4)} SOL

<b>Your dev wallet needs funding for token creation and dev buy operations.</b>

<b>Please fund your dev wallet:</b>
<code>${devWalletAddress}</code>

<i>💡 Tap the address above to copy it</i>`,
      { parse_mode: "HTML", reply_markup: launchKb }
    );

    await conversation.halt();
    return;
  }

  // -------- CHECK FUNDING WALLET BALANCE ----------
  const fundingBalance = await getWalletBalance(fundingWallet.publicKey);
  await sendMessage(
    ctx,
    `💳 Using funding wallet: <code>${fundingWallet.publicKey}</code>\n💰 Balance: ${fundingBalance.toFixed(4)} SOL\n👥 Using ${buyerWallets.length} buyer wallets`,
    { parse_mode: "HTML" }
  );

  let buyAmount = 0;
  let devBuy = 0;

  // Use stored values if this is a retry, otherwise get new input
  if (isRetry && existingRetryData) {
    buyAmount = existingRetryData.buyAmount;
    devBuy = existingRetryData.devBuy;
    await sendMessage(
      ctx,
      `🔄 <b>Retrying with previous values:</b>
• <b>Buy Amount:</b> ${buyAmount} SOL
• <b>Dev Buy:</b> ${devBuy} SOL`,
      { parse_mode: "HTML" }
    );

    // Clear retry data after use
    await clearRetryData(user.id, "launch_token");
  } else {
    // -------- GET BUY AMOUNT --------
    await sendMessage(
      ctx,
      "💰 Enter the total SOL amount to buy tokens with (e.g., 1.5):",
      { reply_markup: cancelKeyboard }
    );

    buyAmountLoop: while (true) {
      const buyAmountCtx = await conversation.waitFor([
        "message:text",
        "callback_query:data",
      ]);

      if (buyAmountCtx.callbackQuery?.data === LaunchCallBackQueries.CANCEL) {
        await buyAmountCtx.answerCallbackQuery();
        await sendMessage(ctx, "Launch cancelled.");
        return conversation.halt();
      }

      if (buyAmountCtx.message?.text) {
        const parsed = parseFloat(buyAmountCtx.message.text);
        if (isNaN(parsed) || parsed <= 0) {
          await sendMessage(
            ctx,
            "❌ Invalid amount. Please enter a positive number:"
          );
          continue;
        } else if (parsed > 46.5) {
          await sendMessage(
            ctx,
            "⚠️ Maximum buy amount is 46.5 SOL due to our 20-wallet system limit. Please enter a smaller amount (0.1-46.5 SOL):"
          );
          continue;
        } else {
          buyAmount = parsed;

          // -------- CHECK WALLET REQUIREMENTS --------
          const { calculateRequiredWallets, allocateWalletsFromPool } =
            await import("../../backend/functions-main");

          try {
            const requiredWallets = calculateRequiredWallets(buyAmount);
            const currentWalletCount = buyerWallets.length;

            if (currentWalletCount < requiredWallets) {
              const walletsNeeded = requiredWallets - currentWalletCount;

              await sendMessage(
                ctx,
                `🔍 <b>Wallet Check</b>

💰 <b>Buy Amount:</b> ${buyAmount} SOL
👥 <b>Required Wallets:</b> ${requiredWallets}
📊 <b>Current Wallets:</b> ${currentWalletCount}
⚠️ <b>Missing Wallets:</b> ${walletsNeeded}

You need ${walletsNeeded} more wallet${walletsNeeded > 1 ? "s" : ""} for this buy amount. Choose an option:`,
                {
                  parse_mode: "HTML",
                  reply_markup: new InlineKeyboard()
                    .text(
                      `📥 Import ${walletsNeeded} Wallet${walletsNeeded > 1 ? "s" : ""}`,
                      "import_missing_wallets"
                    )
                    .row()
                    .text(
                      `🔧 Generate ${walletsNeeded} Wallet${walletsNeeded > 1 ? "s" : ""}`,
                      "generate_missing_wallets"
                    )
                    .row()
                    .text("❌ Cancel", LaunchCallBackQueries.CANCEL),
                }
              );

              const walletChoice = await conversation.waitFor(
                "callback_query:data"
              );
              await walletChoice.answerCallbackQuery();

              if (
                walletChoice.callbackQuery?.data ===
                LaunchCallBackQueries.CANCEL
              ) {
                await sendMessage(walletChoice, "Launch cancelled.");
                return conversation.halt();
              }

              if (
                walletChoice.callbackQuery?.data === "import_missing_wallets"
              ) {
                // Import wallets flow
                await sendMessage(
                  walletChoice,
                  `📥 <b>Import ${walletsNeeded} Wallet${walletsNeeded > 1 ? "s" : ""}</b>

Please send the private key of wallet 1/${walletsNeeded}:

<i>💡 Send one private key per message. You'll be prompted for each wallet.</i>`,
                  {
                    parse_mode: "HTML",
                    reply_markup: new InlineKeyboard().text(
                      "❌ Cancel",
                      LaunchCallBackQueries.CANCEL
                    ),
                  }
                );

                for (let i = 0; i < walletsNeeded; i++) {
                  if (i > 0) {
                    await sendMessage(
                      walletChoice,
                      `📥 Please send the private key of wallet ${i + 1}/${walletsNeeded}:`,
                      {
                        reply_markup: new InlineKeyboard().text(
                          "❌ Cancel",
                          LaunchCallBackQueries.CANCEL
                        ),
                      }
                    );
                  }

                  const privateKeyInput = await conversation.wait();

                  if (
                    privateKeyInput.callbackQuery?.data ===
                    LaunchCallBackQueries.CANCEL
                  ) {
                    await privateKeyInput.answerCallbackQuery();
                    await sendMessage(privateKeyInput, "Import cancelled.");
                    return conversation.halt();
                  }

                  const privateKey = privateKeyInput.message?.text?.trim();
                  if (!privateKey) {
                    await sendMessage(
                      privateKeyInput,
                      "❌ No private key provided. Import cancelled."
                    );
                    return conversation.halt();
                  }

                  try {
                    const { addBuyerWallet } = await import(
                      "../../backend/functions-main"
                    );
                    await addBuyerWallet(user.id, privateKey);
                    await sendMessage(
                      privateKeyInput,
                      `✅ Wallet ${i + 1}/${walletsNeeded} imported successfully!`,
                      { parse_mode: "HTML" }
                    );
                  } catch (error: any) {
                    await sendMessage(
                      privateKeyInput,
                      `❌ Failed to import wallet ${i + 1}: ${error.message}\n\nPlease try again with a valid private key:`,
                      { parse_mode: "HTML" }
                    );
                    i--; // Retry this wallet
                  }
                }

                await sendMessage(
                  walletChoice,
                  `🎉 <b>All ${walletsNeeded} wallets imported successfully!</b>\n\nProceeding with token launch...`,
                  { parse_mode: "HTML" }
                );
              } else if (
                walletChoice.callbackQuery?.data === "generate_missing_wallets"
              ) {
                // Generate wallets flow
                await sendMessage(
                  walletChoice,
                  `🔧 <b>Generating ${walletsNeeded} Wallet${walletsNeeded > 1 ? "s" : ""}...</b>

⏳ Allocating wallets from pool...`,
                  { parse_mode: "HTML" }
                );

                try {
                  let retryCount = 0;
                  const maxRetries = 3;

                  while (retryCount < maxRetries) {
                    try {
                      await allocateWalletsFromPool(user.id, walletsNeeded);
                      await sendMessage(
                        walletChoice,
                        `🎉 <b>Successfully generated ${walletsNeeded} wallet${walletsNeeded > 1 ? "s" : ""}!</b>

✅ All wallets have been permanently added to your account and can be reused for future launches.

Proceeding with token launch...`,
                        { parse_mode: "HTML" }
                      );
                      break;
                    } catch (error: any) {
                      retryCount++;
                      if (retryCount < maxRetries) {
                        await sendMessage(
                          walletChoice,
                          `⚠️ Generation attempt ${retryCount} failed: ${error.message}\n\n🔄 Retrying... (${retryCount}/${maxRetries})`,
                          { parse_mode: "HTML" }
                        );
                        await new Promise((resolve) =>
                          setTimeout(resolve, 1000)
                        ); // Wait 1 second before retry
                      } else {
                        throw error;
                      }
                    }
                  }
                } catch (error: any) {
                  await sendMessage(
                    walletChoice,
                    `❌ <b>Failed to generate wallets after 3 attempts</b>

Error: ${error.message}

Please try importing wallets manually or try again later.`,
                    { parse_mode: "HTML" }
                  );
                  return conversation.halt();
                }
              }

              // Refresh buyer wallets list after import/generation
              const updatedBuyerWallets = await getAllBuyerWallets(user.id);
              // Update the buyerWallets variable for the rest of the flow
              Object.assign(buyerWallets, updatedBuyerWallets);
              buyerWallets.length = updatedBuyerWallets.length;
              updatedBuyerWallets.forEach((wallet, index) => {
                buyerWallets[index] = wallet;
              });
            }

            break buyAmountLoop; // Exit the buy amount input loop
          } catch (error: any) {
            if (error.message.includes("exceeds maximum")) {
              await sendMessage(
                ctx,
                `❌ <b>Buy Amount Too Large</b>

${error.message}

Please enter a smaller buy amount:`,
                { parse_mode: "HTML" }
              );
              // Continue the loop to ask for buy amount again
              continue buyAmountLoop;
            }
            throw error;
          }
        }
      }
    }

    // -------- GET DEV BUY AMOUNT --------
    await sendMessage(
      ctx,
      `💎 Enter SOL amount for dev to buy (0 to skip, recommended: 10-20% of buy amount = ${(buyAmount * 0.15).toFixed(3)} SOL):`,
      { reply_markup: cancelKeyboard }
    );

    while (true) {
      const devBuyCtx = await conversation.waitFor([
        "message:text",
        "callback_query:data",
      ]);

      if (devBuyCtx.callbackQuery?.data === LaunchCallBackQueries.CANCEL) {
        await devBuyCtx.answerCallbackQuery();
        await sendMessage(ctx, "Launch cancelled.");
        return conversation.halt();
      }

      if (devBuyCtx.message?.text) {
        const parsed = parseFloat(devBuyCtx.message.text);
        if (isNaN(parsed) || parsed < 0) {
          await sendMessage(
            ctx,
            "❌ Invalid amount. Please enter 0 or a positive number:"
          );
        } else if (parsed > buyAmount) {
          await sendMessage(
            ctx,
            "⚠️ Dev buy amount should not exceed total buy amount. Please enter a smaller amount:"
          );
        } else {
          devBuy = parsed;
          break;
        }
      }
    }

    // Store retry data for potential retry
    await saveRetryData(user.id, ctx.chat!.id!.toString(), "launch_token", {
      tokenAddress,
      buyAmount,
      devBuy,
    });
  }

  // -------- CALCULATE TOTAL COSTS --------
  // Calculate funding requirement: buy amount + dev buy + wallet fees + buffer
  const walletFees = buyerWallets.length * 0.005; // 0.005 SOL per wallet for transaction fees
  const requiredFundingAmount = buyAmount + devBuy + walletFees + 0.1; // Reduced buffer since fees are now calculated accurately

  // Check funding wallet balance against total requirement
  if (fundingBalance < requiredFundingAmount) {
    const launchKb = new InlineKeyboard().text(
      "🚀 Launch Token",
      `${CallBackQueries.LAUNCH_TOKEN}_${tokenAddress}`
    );

    await sendMessage(
      ctx,
      `❌ <b>Insufficient funding wallet balance!</b>

💰 <b>Required Amount Breakdown:</b>
• Buy Amount: ${buyAmount} SOL
• Dev Buy: ${devBuy} SOL
• Wallet Fees: ${walletFees.toFixed(3)} SOL (${buyerWallets.length} wallets × 0.005)
• Buffer: 0.1 SOL

<b>Total Required:</b> ${requiredFundingAmount.toFixed(4)} SOL
<b>Available:</b> ${fundingBalance.toFixed(4)} SOL
<b>Shortfall:</b> ${(requiredFundingAmount - fundingBalance).toFixed(4)} SOL

<b>Please fund your wallet:</b>
<code>${fundingWallet.publicKey}</code>

<i>💡 Tap the address above to copy it, then send the required SOL.</i>`,
      { parse_mode: "HTML", reply_markup: launchKb }
    );

    await conversation.halt();
    return;
  }

  // ------- CHECKS BEFORE LAUNCH ------
  const checksLoading = await sendLoadingMessage(
    ctx,
    "🔍 **Performing pre-launch checks...**\n\n⏳ Validating parameters..."
  );

  // Get buyer wallet private keys
  const { WalletModel } = await import("../../backend/models");
  const buyerWalletDocs = await WalletModel.find({
    user: user.id,
    isBuyer: true,
  }).lean();

  const buyerKeys = buyerWalletDocs.map((w) => decryptPrivateKey(w.privateKey));

  await checksLoading.update(
    "🔍 **Performing pre-launch checks...**\n\n💰 Checking wallet balances..."
  );

  const checkResult = await preLaunchChecks(
    fundingWallet.privateKey,
    (token.launchData!.devWallet! as unknown as { privateKey: string })
      .privateKey,
    buyAmount,
    devBuy,
    buyerKeys.length
  );

  if (!checkResult.success) {
    await checksLoading.update(
      `❌ **Pre-launch checks failed**\n\n${checkResult.message}\n\nPlease resolve the issues and try again.`
    );

    await sendMessage(
      ctx,
      `❌ <b>PreLaunch checks failed</b>

Please resolve the issues below and retry:

${checkResult.message}`,
      { parse_mode: "HTML", reply_markup: retryKeyboard }
    );

    // Wait for retry or cancel
    const response = await conversation.waitFor("callback_query:data");
    await response.answerCallbackQuery();

    if (response.callbackQuery?.data === LaunchCallBackQueries.RETRY) {
      // Exit conversation and let user manually retry from tokens list
      await sendMessage(
        response,
        "🔄 Please resolve the issues and try launching again from your tokens list."
      );
      await conversation.halt();
      return;
    } else {
      await sendMessage(response, "Process cancelled.");
      await clearRetryData(user.id, "launch_token");
      await conversation.halt();
      return;
    }
  }

  await checksLoading.update(
    "✅ **Pre-launch checks completed successfully!**\n\n🚀 Submitting launch to queue..."
  );

  // ------ SEND LAUNCH DATA TO QUEUE -----
  const result = await enqueuePrepareTokenLaunch(
    user.id,
    ctx.chat!.id,
    tokenAddress,
    fundingWallet.privateKey,
    (token.launchData!.devWallet! as unknown as { privateKey: string })
      .privateKey,
    buyerKeys,
    devBuy,
    buyAmount
  );

  if (!result.success) {
    await checksLoading.update(
      "❌ **Failed to submit launch**\n\nAn error occurred while submitting launch details for execution. Please try again."
    );
    await sendMessage(
      ctx,
      "An error occurred while submitting launch details for execution ❌. Please try again.."
    );
  } else {
    await checksLoading.update(
      "🎉 **Launch submitted successfully!**\n\n⏳ Your token launch is now in the queue and will be processed shortly.\n\n📱 You'll receive a notification once the launch is completed."
    );

    // Start the loading state for the actual launch process
    await startLoadingState(ctx, "token_launch", tokenAddress);
  }
};

export default launchTokenConversation;
