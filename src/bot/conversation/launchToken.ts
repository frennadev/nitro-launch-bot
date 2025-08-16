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
  launchBonkToken,
} from "../../backend/functions";
import { TokenState, LaunchDestination } from "../../backend/types";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import { decryptPrivateKey } from "../../backend/utils";
import { CallBackQueries } from "../types";
import { env } from "../../config";
import { startLoadingState, sendLoadingMessage } from "../loading";
import { safeAnswerCallbackQuery } from "../utils";
import { logger } from "../../blockchain/common/logger";
import { sendMessage } from "../../backend/sender";

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

// Add market cap calculation function after the imports
async function calculateExpectedMarketCap(
  buyAmount: number,
  isBonkToken: boolean
): Promise<string> {
  // Get current SOL price from API
  const { getCurrentSolPrice } = await import("../../backend/utils");
  const currentSolPrice = await getCurrentSolPrice();

  // Bonding curve constants (in SOL)
  const STARTING_MC_SOL = 30; // Starting market cap is 30 SOL
  const FINAL_MC_SOL = 85; // Final market cap is 85 SOL (bonding curve completion)

  // Non-linear bonding curve progression based on SOL amounts
  const pumpfunProgression = [
    { buyAmount: 0, marketCapSol: 30 },
    { buyAmount: 10, marketCapSol: 44 },
    { buyAmount: 20, marketCapSol: 66 },
    { buyAmount: 30, marketCapSol: 93 },
    { buyAmount: 40, marketCapSol: 126 },
    { buyAmount: 50, marketCapSol: 165 },
    { buyAmount: 60, marketCapSol: 209 },
    { buyAmount: 70, marketCapSol: 264 },
    { buyAmount: 85, marketCapSol: 385 },
  ];

  const bonkProgression = [
    { buyAmount: 0, marketCapSol: 30 },
    { buyAmount: 10, marketCapSol: 41 },
    { buyAmount: 20, marketCapSol: 60 },
    { buyAmount: 30, marketCapSol: 82 },
    { buyAmount: 40, marketCapSol: 110 },
    { buyAmount: 50, marketCapSol: 143 },
    { buyAmount: 60, marketCapSol: 181 },
    { buyAmount: 70, marketCapSol: 231 },
    { buyAmount: 85, marketCapSol: 385 },
  ];

  // Use appropriate progression based on platform
  const progression = isBonkToken ? bonkProgression : pumpfunProgression;

  // Find the expected market cap in SOL using interpolation
  let expectedMarketCapSol = 30; // Default starting value (30 SOL)

  for (let i = 0; i < progression.length - 1; i++) {
    const current = progression[i];
    const next = progression[i + 1];

    if (buyAmount >= current.buyAmount && buyAmount <= next.buyAmount) {
      // Linear interpolation between two points
      const ratio =
        (buyAmount - current.buyAmount) / (next.buyAmount - current.buyAmount);
      expectedMarketCapSol =
        current.marketCapSol +
        ratio * (next.marketCapSol - current.marketCapSol);
      break;
    } else if (buyAmount > next.buyAmount) {
      // If buy amount exceeds the range, use the last known value
      expectedMarketCapSol = next.marketCapSol;
    }
  }

  // Convert SOL market cap to USD using current SOL price
  const expectedMarketCapUsd = expectedMarketCapSol * currentSolPrice;

  // Round to nearest $100
  const roundedMC = Math.round(expectedMarketCapUsd / 100) * 100;

  // Format the display
  if (roundedMC >= 1000) {
    return `${(roundedMC / 1000).toFixed(1)}K`;
  } else {
    return `${roundedMC}`;
  }
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
    await sendMessage(ctx, "❌ Unrecognized user");
    await conversation.halt();
    return;
  }

  // Check if this is a retry attempt
  const existingRetryData = await getRetryData(user.id, "launch_token");
  const isRetry = existingRetryData !== null;

  console.log("Launch Token - Retry check:", { isRetry, existingRetryData });
  // Show initial loading message
  //   await ctx.reply(
  //     `<b>🚀 Token Launch Initiated</b>

  // <b>📋 Token Details:</b>
  // <code>${tokenAddress}</code>

  // <b>⏳ Status:</b> <i>Initializing launch process...</i>

  // <b>🔄 Next Steps:</b>
  // • Select launch mode
  // • Validate user permissions
  // • Check token status
  // • Verify wallet balances
  // • Configure launch parameters

  // <i>💡 You can use /menu or /start to return to the main menu at any time.</i>`,
  //     {
  //       parse_mode: "HTML",
  //       reply_markup: new InlineKeyboard().text(
  //         "❌ Cancel Launch",
  //         LaunchCallBackQueries.CANCEL
  //       ),
  //     }
  //   );

  // Prompt for launch mode selection
  const launchModeKeyboard = new InlineKeyboard()
    .text("🎯 Normal Launch", "NORMAL_LAUNCH")
    .row()
    .text("💰 Prefunded Launch", "PREFUNDED_LAUNCH")
    .row()
    .text("❌ Cancel", LaunchCallBackQueries.CANCEL);

  await sendMessage(
    ctx,
    `<b>🚀 Token Launch Initiated</b>

<b>📋 Token Details:</b>
<code>${tokenAddress}</code>

<b>⏳ Status:</b> <i>Initializing launch process...</i>

<b>🚀 Choose Your Launch Mode</b>

<b>🎯 Normal Launch:</b>
• Standard launch process
• Funds distributed during launch
• Real-time wallet management

<b>💰 Prefunded Launch:</b>
• Pre-allocated funding to wallets
• Faster execution speed
• Optimized for high-volume launches

<b>🔄 Next Steps:</b>
• Select launch mode
• Validate user permissions
• Check token status
• Verify wallet balances
• Configure launch parameters

<i>💡 You can use /menu or /start to return to the main menu at any time.</i>`,
    { parse_mode: "HTML", reply_markup: launchModeKeyboard }
  );

  const launchModeChoice = await conversation.waitFor("callback_query:data");
  await safeAnswerCallbackQuery(launchModeChoice);

  if (launchModeChoice.callbackQuery?.data === LaunchCallBackQueries.CANCEL) {
    await sendMessage(ctx, "Launch cancelled.");
    await conversation.halt();
    return;
  }
  let totalBalance = 0;

  // Store the selected launch mode
  let launchMode: "normal" | "prefunded";
  if (launchModeChoice.callbackQuery?.data === "NORMAL_LAUNCH") {
    launchMode = "normal";
    await sendMessage(
      ctx,
      "✅ Normal Launch mode selected. Proceeding with standard launch process..."
    );
  } else if (launchModeChoice.callbackQuery?.data === "PREFUNDED_LAUNCH") {
    launchMode = "prefunded";

    // Get all buyer wallets and their balances
    const buyerWallets = await getAllBuyerWallets(user.id);
    if (buyerWallets.length === 0) {
      await sendMessage(
        ctx,
        "❌ No buyer wallets found. Please add buyer wallets in Wallet Config first."
      );
      await conversation.halt();
      return;
    }
    let filteredBuyWallets = await Promise.all(
      buyerWallets.map(async (wallet) => {
        const walletBalance = await getWalletBalance(wallet.publicKey);
        return { ...wallet, balance: walletBalance };
      })
    );
    filteredBuyWallets = filteredBuyWallets.filter(
      (wallet) => wallet.balance > 0.1
    );

    // Get balances for all buyer wallets
    let walletList = "";

    for (let i = 0; i < filteredBuyWallets.length; i++) {
      const wallet = filteredBuyWallets[i];
      const balance = wallet.balance;
      totalBalance += balance;

      // Truncate wallet address to first 8 and last 4 characters
      const truncatedAddress = `${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-4)}`;

      walletList += `${i + 1}. <code>${truncatedAddress}</code> - <code>${balance.toFixed(4)} SOL</code>\n`;
    }

    await sendMessage(
      ctx,
      `✅ <b>Prefunded Launch Mode Selected</b>

<b>💳 Your Buyer Wallets:</b>

${walletList}
<b>📊 Summary:</b>
• <b>Total Wallets:</b> <code>${filteredBuyWallets.length}</code>
• <b>Combined Balance:</b> <code>${totalBalance.toFixed(4)} SOL</code>

<b>⚠️ Important Instructions:</b>
• Fund the wallets you wish to use for this launch
• Each wallet will purchase tokens with its available balance
• Ensure wallets have sufficient SOL for your desired buy amounts
• Leave some SOL in each wallet for transaction fees (~0.005 SOL per wallet)

<b>🚀 Next:</b> Once you've funded your desired wallets, we'll proceed with the launch configuration.

<b>📋 Full wallet addresses:</b>
${filteredBuyWallets.map((wallet, i) => `${i + 1}. <code>${wallet.publicKey}</code>`).join("\n")}

<i>💡 Tap any wallet address above to copy it for funding.</i>`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("▶️ Continue", "CONTINUE_PREFUNDED")
          .row()
          .text("❌ Cancel", LaunchCallBackQueries.CANCEL),
      }
    );

    const continueChoice = await conversation.waitFor("callback_query:data");
    await safeAnswerCallbackQuery(continueChoice);

    if (continueChoice.callbackQuery?.data === LaunchCallBackQueries.CANCEL) {
      await sendMessage(ctx, "Launch cancelled.");
      await conversation.halt();
      return;
    }

    if (continueChoice.callbackQuery?.data === "CONTINUE_PREFUNDED") {
      await sendMessage(
        ctx,
        "✅ Proceeding with prefunded launch configuration..."
      );
    }
  } else {
    await sendMessage(ctx, "❌ Invalid launch mode selected.");
    await conversation.halt();
    return;
  }
  //   await sendMessage(
  //     ctx,
  //     `<b>🚀 Token Launch Initiated</b>
  // ${launchMode === "normal" ? "🎯 Normal Launch mode selected." : "💰 Prefunded Launch mode selected."}

  // <b>📋 Token Details:</b>
  // <code>${tokenAddress}</code>

  // <b>⏳ Status:</b> <i>Initializing launch process...</i>

  // <b>🔄 Next Steps:</b>
  // • Validating user permissions
  // • Checking token status
  // • Verifying wallet balances
  // • Configuring launch parameters

  // <i>💡 You can use /menu or /start to return to the main menu at any time.</i>`,
  //     {
  //       parse_mode: "HTML",
  //       reply_markup: new InlineKeyboard().text(
  //         "❌ Cancel Launch",
  //         LaunchCallBackQueries.CANCEL
  //       ),
  //     }
  //   );

  // -------- VALIDATE TOKEN ----------
  let token = await getUserToken(user.id, tokenAddress);
  if (!token) {
    await sendMessage(ctx, "❌ Token not found");
    await conversation.halt();
    return;
  }
  if (token.state === TokenState.LAUNCHING) {
    await sendMessage(ctx, "🔄 Token is currently launching");
    await conversation.halt();
    return;
  }
  if (token.state === TokenState.LAUNCHED) {
    await sendMessage(ctx, "🚀 Token is already launched");
    await conversation.halt();
    return;
  }

  // -------- CHECK IF TOKEN IS ALREADY LAUNCHED ON OTHER PLATFORMS --------
  // Automatically replace token address if it's already launched/listed
  try {
    const replacementResult = await autoReplaceLaunchedTokenAddress(
      user.id,
      tokenAddress
    );

    if (replacementResult.wasReplaced) {
      // Token was replaced with a new address
      await sendMessage(
        ctx,
        `
<b>🔄 Token Address Automatically Replaced</b>

<b>Reason:</b> The original token address was already ${replacementResult.reason?.includes("listed") ? "<b>listed</b>" : "<b>launched</b>"} on a trading platform.

<b>New Token Address:</b>
<code>${replacementResult.newTokenAddress}</code>

<b>Token Details:</b>
• <b>Name:</b> <code>${token.name}</code>
• <b>Symbol:</b> <code>${token.symbol}</code>
• <b>Description:</b> <code>${token.description}</code>

<i>✅ Continuing with the launch process using the new address.</i>`,
        { parse_mode: "HTML" }
      );

      // Update the token address for the rest of the conversation
      tokenAddress = replacementResult.newTokenAddress;

      // Get the updated token data
      const updatedToken = await getUserToken(user.id, tokenAddress);
      if (!updatedToken) {
        await sendMessage(
          ctx,
          "❌ Error: Could not retrieve updated token data"
        );
        await conversation.halt();
        return;
      }
      token = updatedToken;
    }
  } catch (error: any) {
    logger.error(
      `[launchToken] Error during token address replacement: ${error.message}`
    );
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
      `<b>🔄 Previous Launch Attempt Detected</b>

Your token has a previous launch attempt that was not completed.

<b>📊 Previous Launch Parameters:</b>
• <b>Buy Amount:</b> <code>${token.launchData?.buyAmount || 0}</code> SOL
• <b>Dev Buy:</b> <code>${token.launchData?.devBuy || 0}</code> SOL

<b>🎯 Choose your next action:</b>
• <b>New Values:</b> Enter fresh launch parameters
• <b>Previous Values:</b> Continue with stored parameters

<i>💡 We recommend entering new values to ensure optimal launch conditions.</i>`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🆕 Enter New Values", "NEW_VALUES")
          .row()
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
          "❌ An error occurred while submitting token launch for retry. Please try again."
        );
      } else {
        await sendMessage(
          ctx,
          `<b>🔄 Token Launch Retry Submitted</b>

Your token launch has been successfully resubmitted using your previous parameters.

<b>📊 Launch Details:</b>
• <b>Buy Amount:</b> <code>${token.launchData?.buyAmount || 0}</code> SOL
• <b>Dev Buy:</b> <code>${token.launchData?.devBuy || 0}</code> SOL

<b>⏳ Status:</b> Processing in queue

<i>🔔 You will receive a notification once your launch is completed.</i>`,
          { parse_mode: "HTML" }
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
  let filteredBuyWallets = await Promise.all(
    buyerWallets.map(async (wallet) => {
      const walletBalance = await getWalletBalance(wallet.publicKey);
      return { ...wallet, balance: walletBalance };
    })
  );
  filteredBuyWallets = filteredBuyWallets.filter(
    (wallet) => wallet.balance > 0.1
  );

  // Check if this is a Bonk token - if so, we'll collect input but use direct launch
  const isBonkToken =
    token.launchData?.destination === LaunchDestination.LETSBONK;

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
      `❌ <b>Insufficient Dev Wallet Balance</b>

💰 <b>Balance Details:</b>
• <b>Required:</b> <code>${minDevBalance.toFixed(4)} SOL</code>
• <b>Current:</b> <code>${devBalance.toFixed(4)} SOL</code>
• <b>Shortfall:</b> <code>${(minDevBalance - devBalance).toFixed(4)} SOL</code>

⚠️ Your dev wallet needs additional SOL to cover platform fees and transaction costs.

<b>💳 Dev Wallet Address:</b>
<code>${devWalletAddress}</code>

<i>💡 Tap the address above to copy it, then send the required SOL to continue with the launch.</i>`,
      { parse_mode: "HTML", reply_markup: launchKb }
    );

    await conversation.halt();
    return;
  }

  // -------- CHECK FUNDING WALLET BALANCE ----------
  const fundingBalance = await getWalletBalance(fundingWallet.publicKey);
  await sendMessage(
    ctx,
    `📊 <b>Wallet Status Check</b>

💳 <b>Funding Wallet:</b>
<code>${fundingWallet.publicKey}</code>

💰 <b>Available Balance:</b>
<code>${fundingBalance.toFixed(4)} SOL</code>

👥 <b>Buyer Wallets:</b>
<code>${filteredBuyWallets.length} wallet${filteredBuyWallets.length !== 1 ? "s" : ""} configured</code>

✅ <b>Status:</b> All wallets ready for launch`,
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
      `🔄 **Retrying Token Launch**

**📊 Using Previous Parameters:**
• **Buy Amount:** \`${buyAmount}\` SOL
• **Dev Buy:** \`${devBuy}\` SOL

⏳ **Status:** Proceeding with stored launch parameters

💡 **Note:** These values were saved from your previous launch attempt.`,
      { parse_mode: "Markdown" }
    );

    // Clear retry data after use
    await clearRetryData(user.id, "launch_token");
  } else {
    // -------- GET BUY AMOUNT --------
    // Calculate maximum buy amount based on current wallet count
    const { calculateMaxBuyAmount, calculateMaxBuyAmountWithWallets } =
      await import("../../backend/functions-main");
    const maxBuyAmount = calculateMaxBuyAmount();
    const maxBuyAmountWithCurrentWallets = calculateMaxBuyAmountWithWallets(
      filteredBuyWallets.length
    );

    if (launchMode == "normal") {
      buyAmountLoop: while (true) {
        await sendMessage(
          ctx,
          `💰 <b>Enter Buy Amount</b>

📊 <b>Wallet Configuration:</b>
• <b>Current Funded Wallets:</b> ${filteredBuyWallets.length}/40
• <b>Your Maximum:</b> ${maxBuyAmountWithCurrentWallets.toFixed(1)} SOL
• <b>System Maximum:</b> ${maxBuyAmount.toFixed(1)} SOL (with 40 wallets)

💡 <b>Please enter a value between 0.1 and ${maxBuyAmountWithCurrentWallets.toFixed(1)} SOL</b>

<i>💭 This is the total SOL amount that will be used to purchase tokens across all your buyer wallets.</i>`,
          {
            parse_mode: "HTML",
            reply_markup: cancelKeyboard,
          }
        );

        // if (launch === "prefunded") {
        //   break;
        // }

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
          } else if (parsed > maxBuyAmountWithCurrentWallets) {
            await sendMessage(
              ctx,
              `❌ <b>Buy Amount Exceeds Limit</b>

<b>💰 Amount Details:</b>
• <b>Requested:</b> <code>${parsed} SOL</code>
• <b>Your Maximum:</b> <code>${maxBuyAmountWithCurrentWallets.toFixed(1)} SOL</code>
• <b>Current Funded Wallets:</b> <code>${filteredBuyWallets.length} wallet${filteredBuyWallets.length !== 1 ? "s" : ""}</code>

<b>📋 Valid Range:</b>
<code>0.1 - ${maxBuyAmountWithCurrentWallets.toFixed(1)} SOL</code>

<i>💡 Please enter an amount within the valid range to continue.</i>`,
              { parse_mode: "HTML" }
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
                  `🔍 <b>Wallet Configuration Check</b>

<b>📊 Launch Parameters:</b>
• <b>Buy Amount:</b> <code>${buyAmount} SOL</code>
• <b>Required Wallets:</b> <code>${requiredWallets}</code>
• <b>Current Wallets:</b> <code>${currentWalletCount}</code>

<b>⚠️ Missing Wallets:</b> <code>${walletsNeeded} wallet${walletsNeeded > 1 ? "s" : ""}</code>

<b>🎯 Choose your next action:</b>
To proceed with this buy amount, you need ${walletsNeeded} additional wallet${walletsNeeded > 1 ? "s" : ""}. Select an option below:

<i>💡 Generated wallets are permanently added to your account for future use.</i>`,
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
                    `📥 <b>Import Missing Wallets</b>

<b>📊 Import Progress:</b> Wallet 1/${walletsNeeded}

<b>🔑 Please send the private key for wallet 1:</b>

<b>📋 Instructions:</b>
• Send one private key per message
• You'll be prompted for each wallet individually
• Private keys are encrypted and stored securely

<i>💡 Make sure your private key is valid and has some SOL for transactions.</i>`,
                    {
                      parse_mode: "HTML",
                      reply_markup: new InlineKeyboard().text(
                        "❌ Cancel Import",
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
                        {
                          parse_mode: "HTML",
                        }
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
                  walletChoice.callbackQuery?.data ===
                  "generate_missing_wallets"
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
                          `<b>🎉 Wallet Generation Complete</b>

<b>✅ Successfully Generated:</b>
<code>${walletsNeeded} wallet${walletsNeeded > 1 ? "s" : ""}</code>

<b>💾 Wallet Status:</b>
• <i>Permanently added to your account</i>
• <i>Ready for immediate use</i>
• <i>Available for future launches</i>

<b>🚀 Next Step:</b>
<i>Proceeding with token launch configuration...</i>`,
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
    }

    if (buyAmount == 0) {
      buyAmount = Number(totalBalance.toFixed(4));
    }

    // -------- GET DEV BUY AMOUNT --------
    const expectedMarketCap = await calculateExpectedMarketCap(
      buyAmount,
      isBonkToken
    );
    await sendMessage(
      ctx,
      `💎 <b>Developer Buy Configuration</b>

<b>📊 Launch Summary:</b>
• <b>Total Buy Amount:</b> <code>${buyAmount} SOL</code>
• <b>Expected Market Cap:</b> <code>$${expectedMarketCap}</code>

<b>🎯 Developer Buy Amount:</b>
Enter the SOL amount for the developer to purchase (or 0 to skip)

<b>📋 Valid Range:</b>
<code>0 - ${buyAmount} SOL</code>

<i>💭 Developer buys help establish initial liquidity and show confidence in the project.</i>`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("⏭️ Skip (0 SOL)", "DEV_BUY_0")
          .text("❌ Cancel", LaunchCallBackQueries.CANCEL),
      }
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
  const walletFees = filteredBuyWallets.length * 0.005; // 0.005 SOL per wallet for transaction fees
  const requiredFundingAmount = buyAmount + devBuy + walletFees + 0.1; // Reduced buffer since fees are now calculated accurately

  // Check funding wallet balance against total requirement
  if (launchMode == "normal" && fundingBalance < requiredFundingAmount) {
    const launchKb = new InlineKeyboard().text(
      "🚀 Launch Token",
      `${CallBackQueries.LAUNCH_TOKEN}_${tokenAddress}`
    );

    await sendMessage(
      ctx,
      `❌ <b>Insufficient Funding Wallet Balance</b>

<b>💰 Balance Analysis:</b>
• <b>Required:</b> <code>${requiredFundingAmount.toFixed(4)} SOL</code>
• <b>Available:</b> <code>${fundingBalance.toFixed(4)} SOL</code>
• <b>Shortfall:</b> <code>${(requiredFundingAmount - fundingBalance).toFixed(4)} SOL</code>

<b>📊 Cost Breakdown:</b>
• <b>Buy Amount:</b> <code>${buyAmount} SOL</code>
• <b>Dev Buy:</b> <code>${devBuy} SOL</code>
• <b>Transaction Fees:</b> <code>${walletFees.toFixed(3)} SOL</code> (${buyerWallets.length} wallets)
• <b>Network Buffer:</b> <code>0.1 SOL</code>

<b>💳 Funding Wallet Address:</b>
<code>${fundingWallet.publicKey}</code>

<i>💡 Tap the address above to copy it, then send the required SOL to continue with your launch.</i>`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text(
            "🚀 Launch Token",
            `${CallBackQueries.LAUNCH_TOKEN}_${tokenAddress}`
          )
          .row()
          .text("❌ Cancel", LaunchCallBackQueries.CANCEL),
      }
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

  let result: any;

  if (isBonkToken) {
    // Bonk tokens: ensure mixing is performed before on-chain launch
    await checksLoading.update(
      "🚀 **Launching Bonk token...**\n\n⏳ Mixing funds and creating token on Raydium Launch Lab..."
    );

    // Use backend function to handle mixing and launch
    const { launchBonkToken } = await import("../../backend/functions");
    result = await launchBonkToken(
      user.id,
      tokenAddress,
      buyAmount,
      devBuy,
      launchMode
    );

    if (result.success) {
      await checksLoading.update(
        "🎉 **Bonk token launched successfully!**\n\n✅ Your token is now live on Raydium Launch Lab.\n\n📱 Sending detailed success notification..."
      );

      // Send Bonk-specific success notification
      const { sendBonkLaunchSuccessNotification } = await import("../message");
      await sendBonkLaunchSuccessNotification(
        ctx,
        ctx.chat!.id,
        tokenAddress,
        result.tokenName,
        result.tokenSymbol
      );
    } else {
      await checksLoading.update(
        "❌ **Bonk token launch failed**\n\nAn error occurred during launch. Please try again."
      );

      await sendMessage(
        ctx,
        `❌ <b>Bonk token launch failed</b>\n\nError: ${result.error}\n\nPlease try again or contact support if the issue persists.`,
        { parse_mode: "HTML", reply_markup: retryKeyboard }
      );
    }
  } else {
    // PumpFun tokens use the complex staging process
    await checksLoading.update(
      "🚀 **Submitting PumpFun token launch...**\n\n⏳ Queuing for staged launch process..."
    );

    result = await enqueuePrepareTokenLaunch(
      user.id,
      ctx.chat!.id,
      tokenAddress,
      fundingWallet.privateKey,
      (token.launchData!.devWallet! as unknown as { privateKey: string })
        .privateKey,
      buyerKeys,
      devBuy,
      buyAmount,
      launchMode
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
  }
};

export default launchTokenConversation;
