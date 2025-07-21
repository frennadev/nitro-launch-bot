import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  getUser,
  getFundingWallet,
  getWalletBalance,
} from "../../backend/functions";
import { sendMessage } from "../../backend/sender";
import { logger } from "../../blockchain/common/logger";
import { CallBackQueries } from "../types";
import { safeEditMessageText, sendErrorWithAutoDelete } from "../utils";

// Market cap calculation function for CTO operations
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
    await sendMessage(
      ctx,
      "❌ No funding wallet found. Please configure a funding wallet first."
    );
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
    [
      "📈 <b>CTO - Call To Others</b>",
      "",
      `<b>Token:</b> <code>${tokenAddress}</code>`,
      `<b>Funding Wallet Balance:</b> <b>${fundingBalance.toFixed(6)} SOL</b>`,
      "",
      "💰 <b>How much SOL do you want to spend on this token?</b>",
      "",
      "<i>This will:</i>",
      "• Distribute funds to buy wallets via mixer",
      "• Execute coordinated buy transactions",
      "• Create buying pressure on the token",
      "",
      "<b>Enter the amount in SOL</b> (e.g., <code>0.5</code>, <code>1</code>, <code>2.5</code>):",
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text(
        "❌ Cancel",
        CallBackQueries.CANCEL
      ),
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
    await sendMessage(
      amountInput,
      "❌ No amount provided. CTO operation cancelled."
    );
    return conversation.halt();
  }

  const buyAmount = parseFloat(buyAmountText);
  if (isNaN(buyAmount) || buyAmount <= 0) {
    await sendMessage(
      amountInput,
      "❌ Invalid amount. Please enter a valid number."
    );
    return conversation.halt();
  }

  // Check if amount is available (leave some buffer for fees)
  const requiredBalance = buyAmount + 0.01; // 0.01 SOL buffer for fees
  if (requiredBalance > fundingBalance) {
    await sendMessage(
      amountInput,
      [
        "❌ <b>Insufficient Balance</b>",
        "",
        `<b>Requested:</b> <code>${buyAmount.toFixed(6)} SOL</code>`,
        `<b>Available:</b> <code>${fundingBalance.toFixed(6)} SOL</code>`,
        `<b>Required (with fees):</b> <code>${requiredBalance.toFixed(6)} SOL</code>`,
        "",
        "<i>Please enter a smaller amount or add more SOL to your funding wallet.</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // === PLATFORM DETECTION STEP ===
  const platformDetectionMessage = await sendMessage(
    amountInput,
    [
      "🔍 <b>Detecting Token Platform...</b>",
      "",
      `<b>Token:</b> <code>${tokenAddress}</code>`,
      "",
      "⏳ <i>Analyzing token to determine optimal trading platform...</i>",
    ].join("\n"),
    { parse_mode: "HTML" }
  );

  let platform: string = "unknown"; // Default platform

  try {
    // Use the improved platform detection with Bonk support
    const { detectTokenPlatformWithCache } = await import(
      "../../service/token-detection-service"
    );
    platform = await detectTokenPlatformWithCache(tokenAddress);

    // Log the platform detection result for transparency
    logger.info(
      `[CTO Platform Detection] Token ${tokenAddress} detected as ${platform} platform`
    );

    // Get additional platform details for better user information
    let platformDetails = "";
    let platformIcon = "";

    switch (platform) {
      case "pumpfun":
        platformIcon = "🎯";
        platformDetails = "PumpFun Bonding Curve (Active Launch)";
        break;
      case "pumpswap":
        platformIcon = "🔄";
        platformDetails = "PumpSwap DEX (Graduated/Listed)";
        break;
      case "bonk":
        platformIcon = "🐕";
        platformDetails = "Bonk Pool (Raydium Launch Lab)";
        break;
      case "cpmm":
        platformIcon = "🏊";
        platformDetails = "Raydium CPMM (Graduated Bonk)";
        break;
      case "unknown":
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
      [
        "✅ <b>Platform Detection Complete</b>",
        "",
        `<b>Token:</b> <code>${tokenAddress}</code>`,
        `<b>Detected Platform:</b> ${platformIcon} ${platformDetails}`,
        "",
        "<b>Trading Strategy:</b>",
        (() => {
          switch (platform) {
            case "pumpfun":
              return "• Direct bonding curve trading for best prices";
            case "pumpswap":
              return "• Jupiter → PumpSwap routing for optimal liquidity";
            case "bonk":
              return "• Bonk pool trading via Raydium Launch Lab";
            case "cpmm":
              return "• Raydium CPMM trading for graduated Bonk tokens";
            default:
              return "• Multi-platform fallback (Jupiter → PumpSwap → PumpFun)";
          }
        })(),
        "",
        "🔄 <i>Proceeding automatically with optimal platform routing...</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );

    // Log the automatic platform detection
    logger.info(
      `[CTO Platform Auto-Detection] Automatically using ${platform} platform for token ${tokenAddress}`
    );

    // Brief pause to show the detection result
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Calculate expected market cap for CTO operation
    const expectedMarketCap = await calculateExpectedMarketCap(
      buyAmount,
      platform === "bonk"
    );

    // Show final confirmation with platform information
    await sendMessage(
      amountInput,
      [
        "🔍 <b>CTO Confirmation</b>",
        "",
        `<b>Token:</b> <code>${tokenAddress}</code>`,
        `<b>Platform:</b> ${platformIcon} ${platformDetails}`,
        `<b>Buy Amount:</b> <b>${buyAmount.toFixed(6)} SOL</b>`,
        `<b>Expected Market Cap:</b> <b>${expectedMarketCap}</b>`,
        `<b>Funding Wallet Balance:</b> <b>${fundingBalance.toFixed(6)} SOL</b>`,
        "",
        "<b>Process:</b>",
        `1. Distribute <b>${buyAmount.toFixed(6)} SOL</b> to buy wallets via mixer`,
        `2. Execute coordinated buy transactions on <b>${platformDetails}</b>`,
        "3. Create buying pressure on the token",
        "",
        "⚠️ <b>Important:</b> This operation cannot be undone.",
        "",
        "<b>Do you want to proceed with the CTO operation?</b>",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("✅ Confirm CTO", "confirm_cto")
          .text("❌ Cancel", CallBackQueries.CANCEL),
      }
    );
  } catch (platformError: any) {
    logger.error(
      `[CTO Platform Detection Error] Failed to detect platform for ${tokenAddress}:`,
      platformError
    );
    platform = "unknown"; // Set to unknown for fallback routing

    // Update the detection message with error and proceed automatically with fallback
    await ctx.api.editMessageText(
      ctx.chat!.id,
      platformDetectionMessage.message_id,
      [
        "⚠️ <b>Platform Detection Failed</b>",
        "",
        `<b>Token:</b> <code>${tokenAddress}</code>`,
        `<b>Error:</b> ${platformError.message || "Unknown error"}`,
        "",
        "<b>Fallback Strategy:</b>",
        "• Multi-platform routing: Jupiter → PumpSwap → PumpFun",
        "• Ensures maximum compatibility for trading",
        "",
        "🔄 <i>Proceeding automatically with fallback routing...</i>",
      ].join("\n"),
      { parse_mode: "HTML" }
    );

    // Log the automatic fallback decision
    logger.info(
      `[CTO Platform Auto-Fallback] Automatically using fallback routing for token ${tokenAddress} due to detection failure`
    );

    // Brief pause to show the fallback message
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Show final confirmation with fallback information
    await sendMessage(
      amountInput,
      [
        "🔍 <b>CTO Confirmation (Fallback)</b>",
        "",
        `<b>Token:</b> <code>${tokenAddress}</code>`,
        `<b>Platform:</b> ❓ Unknown (Fallback Routing)`,
        `<b>Buy Amount:</b> <b>${buyAmount.toFixed(6)} SOL</b>`,
        `<b>Funding Wallet Balance:</b> <b>${fundingBalance.toFixed(6)} SOL</b>`,
        "",
        "<b>Process:</b>",
        `1. Distribute <b>${buyAmount.toFixed(6)} SOL</b> to buy wallets via mixer`,
        "2. Execute coordinated buy transactions with fallback routing",
        "3. Create buying pressure on the token",
        "",
        "⚠️ <b>Important:</b> This operation cannot be undone.",
        "",
        "<b>Do you want to proceed with the CTO operation?</b>",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("✅ Confirm CTO", "confirm_cto")
          .text("❌ Cancel", CallBackQueries.CANCEL),
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
      logger.warn(
        "Failed to answer callback query (likely timeout):",
        error.message
      );
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
      const { executeCTOOperation } = await import(
        "../../blockchain/pumpfun/ctoOperation"
      );
      const result = await executeCTOOperation(
        tokenAddress,
        user.id,
        buyAmount,
        platform
      );

      if (result.success) {
        // Success message with detailed results
        await confirmation.api.editMessageText(
          confirmation.chat!.id,
          processingMessage.message_id,
          [
            "✅ <b>CTO Operation Completed Successfully!</b>",
            "",
            `<b>Token:</b> <code>${tokenAddress}</code>`,
            `<b>Total Spent:</b> <b>${buyAmount.toFixed(6)} SOL</b>`,
            `<b>Successful Buys:</b> <b>${result.successfulBuys || 0}</b>`,
            `<b>Failed Buys:</b> <b>${result.failedBuys || 0}</b>`,
            "",
            "🎉 <b>Buying pressure has been applied to the token!</b>",
            "",
            "📊 <b>Opening monitor page to track your position...</b>",
          ].join("\n"),
          { parse_mode: "HTML" }
        );

        // Wait a moment then open the monitor page
        await new Promise((resolve) => setTimeout(resolve, 2000));

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
            [
              "⚠️ <b>CTO Operation Partially Completed</b>",
              "",
              `<b>Token:</b> <code>${tokenAddress}</code>`,
              `<b>Successful Buys:</b> <b>${result.successfulBuys || 0}</b>`,
              `<b>Failed Buys:</b> <b>${result.failedBuys || 0}</b>`,
              "",
              "✅ <b>Some buying pressure was applied!</b>",
              "",
              "⚠️ <b>Note:</b> Not all transactions succeeded.",
              `<b>Reason:</b> ${result.error || "Unknown mixer issues"}`,
              "",
              "📊 <b>Opening monitor page to track your position...</b>",
            ].join("\n"),
            { parse_mode: "HTML" }
          );

          // Still open monitor page for partial success
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const { ctoMonitorConversation } = await import("./ctoMonitor");
          await ctoMonitorConversation(
            conversation,
            confirmation,
            tokenAddress
          );
        } else {
          // Complete failure
          await confirmation.api.editMessageText(
            confirmation.chat!.id,
            processingMessage.message_id,
            [
              "❌ <b>CTO Operation Failed</b>",
              "",
              `<b>Token:</b> <code>${tokenAddress}</code>`,
              `<b>Error:</b> ${result.error || "Unknown error occurred"}`,
              "",
              "<b>Details:</b>",
              `• <b>Successful Buys:</b> ${result.successfulBuys || 0}`,
              `• <b>Failed Buys:</b> ${result.failedBuys || 0}`,
              "",
              "⚠️ <b>No buying pressure was applied due to failure.</b>",
              "",
              "<b>Actions:</b>",
              "• Withdraw remaining funds",
              "• Try again",
              "• Close this message",
              "",
              "<i>If the issue persists, please contact support.</i>",
            ].join("\n"),
            {
              parse_mode: "HTML",
              reply_markup: new InlineKeyboard()
                .text(
                  "💳 Withdraw to Funding Wallet",
                  CallBackQueries.WITHDRAW_TO_FUNDING
                )
                .text(
                  "🌐 Withdraw to External Wallet",
                  CallBackQueries.WITHDRAW_TO_EXTERNAL
                )
                .row()
                .text("🔄 Try Again", `cto_${tokenAddress}`)
                .text("❌ Close", CallBackQueries.CANCEL),
            }
          );

          // Wait for user action on the failure message with timeout handling
          try {
            const failureAction = await conversation.waitFor(
              "callback_query:data"
            );

            // Answer callback query with timeout handling
            try {
              await failureAction.answerCallbackQuery();
            } catch (error: any) {
              logger.warn(
                "Failed to answer failure action callback query:",
                error.message
              );
              // Continue with operation even if callback query fails
            }

            const actionData = failureAction.callbackQuery?.data;

            if (actionData === CallBackQueries.WITHDRAW_TO_FUNDING) {
              // Start funding wallet withdrawal conversation
              const { withdrawFundingWalletConversation } = await import(
                "./withdrawal"
              );
              return await withdrawFundingWalletConversation(
                conversation,
                failureAction
              );
            } else if (actionData === CallBackQueries.WITHDRAW_TO_EXTERNAL) {
              // Start buyer wallets withdrawal conversation (most likely to have funds after CTO failure)
              const { withdrawBuyerWalletsConversation } = await import(
                "./withdrawal"
              );
              return await withdrawBuyerWalletsConversation(
                conversation,
                failureAction
              );
            } else if (actionData === `cto_${tokenAddress}`) {
              // Restart CTO conversation
              return await ctoConversation(
                conversation,
                failureAction,
                tokenAddress
              );
            } else if (actionData === CallBackQueries.CANCEL) {
              await sendMessage(failureAction, "❌ CTO operation cancelled.");
              return conversation.halt();
            }
          } catch (waitError: any) {
            logger.warn(
              "Timeout waiting for user action on failure message:",
              waitError.message
            );
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
