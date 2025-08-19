import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  getUser,
  getFundingWallet,
  getWalletBalance,
  getAllBuyerWallets,
} from "../../backend/functions";
import { sendFirstMessage, sendMessage } from "../../backend/sender";
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

// Prefunded CTO operation function that bypasses the mixer
async function executePrefundedCTOOperation(
  tokenAddress: string,
  userId: string,
  totalAmount: number,
  detectedPlatform?: string
): Promise<{
  success: boolean;
  error?: string;
  successfulBuys: number;
  failedBuys: number;
}> {
  try {
    const { getAllTradingWallets } = await import(
      "../../backend/functions-main"
    );
    const { logger } = await import("../../blockchain/common/logger");

    logger.info(
      `[CTO-Prefunded] Starting prefunded CTO operation for token ${tokenAddress}, user ${userId}, amount ${totalAmount} SOL, platform: ${detectedPlatform || "auto-detected"}`
    );

    // Get buyer wallets with private keys - these should already be funded
    const buyerWallets = await getAllTradingWallets(userId);
    if (!buyerWallets || buyerWallets.length === 0) {
      return {
        success: false,
        error: "No buyer wallets found. Please configure buyer wallets first.",
        successfulBuys: 0,
        failedBuys: 0,
      };
    }

    logger.info(`[CTO-Prefunded] Found ${buyerWallets.length} buyer wallets`);

    // Check total available balance in buyer wallets
    const { getWalletBalance } = await import("../../backend/functions");
    let totalAvailableBalance = 0;
    const walletBalances = [];

    for (const wallet of buyerWallets) {
      const balance = await getWalletBalance(wallet.publicKey);
      walletBalances.push({ wallet, balance });
      totalAvailableBalance += balance;
    }

    if (totalAvailableBalance < totalAmount) {
      return {
        success: false,
        error: `Insufficient balance in buyer wallets. Available: ${totalAvailableBalance.toFixed(6)} SOL, Required: ${totalAmount.toFixed(6)} SOL`,
        successfulBuys: 0,
        failedBuys: 0,
      };
    }

    // Execute direct buys from buyer wallets using each wallet's full available balance
    // This maximizes buying power by using ALL available SOL from each wallet

    logger.info(
      `[CTO-Prefunded] Executing maximum balance buys across ${buyerWallets.length} wallets`
    );

    let successfulBuys = 0;
    let failedBuys = 0;
    let totalSpent = 0;

    // Import required functions for direct execution
    const { detectTokenPlatformWithCache } = await import(
      "../../service/token-detection-service"
    );

    // Detect platform for optimization
    await detectTokenPlatformWithCache(tokenAddress);

    // Execute buys sequentially to avoid overwhelming the network
    for (let i = 0; i < buyerWallets.length; i++) {
      const wallet = buyerWallets[i];
      const walletBalance = walletBalances[i].balance;

      // Calculate maximum spendable amount (reserve fees)
      const transactionFeeReserve = 0.01; // Priority fees + base fees
      const accountCreationReserve = 0.008; // ATA creation costs
      const totalFeeReserve = transactionFeeReserve + accountCreationReserve;
      const availableForSpend = walletBalance - totalFeeReserve;

      // Skip wallets with insufficient balance for any meaningful buy
      if (availableForSpend <= 0.001) {
        logger.warn(
          `[CTO-Prefunded] Skipping wallet ${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-4)} - insufficient balance: ${walletBalance.toFixed(6)} SOL (need > ${totalFeeReserve + 0.001} SOL)`
        );
        failedBuys++;
        continue;
      }

      logger.info(
        `[CTO-Prefunded] Wallet ${i + 1}/${buyerWallets.length}: ${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-4)} - Balance: ${walletBalance.toFixed(6)} SOL, Available: ${availableForSpend.toFixed(6)} SOL`
      );

      try {
        // Create keypair from private key
        const { Keypair } = await import("@solana/web3.js");
        const bs58 = await import("bs58");
        const walletKeypair = Keypair.fromSecretKey(
          bs58.default.decode(wallet.privateKey)
        );

        // Execute the buy using the main external buy function which handles platform detection
        const { executeExternalBuyNoConfirmation } = await import(
          "../../blockchain/pumpfun/externalBuyNoConfirmation"
        );

        // Create a dummy context for the function (it's not actually used in no-confirmation mode)
        const dummyCtx = {} as Context;

        // Use the full available balance for maximum buying power
        const result = await executeExternalBuyNoConfirmation(
          tokenAddress,
          walletKeypair,
          availableForSpend, // Use full available balance instead of fixed amount
          3, // slippage
          0.001, // priority fee
          dummyCtx
        );

        if (result.success) {
          successfulBuys++;
          totalSpent += availableForSpend;
          logger.info(
            `[CTO-Prefunded] Wallet ${i + 1} buy successful: ${availableForSpend.toFixed(6)} SOL spent - ${result.signature}`
          );
        } else {
          failedBuys++;
          logger.error(
            `[CTO-Prefunded] Wallet ${i + 1} buy failed: ${result.error}`
          );
        }

        // Small delay between buys to avoid rate limiting
        if (i < buyerWallets.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        failedBuys++;
        logger.error(
          `[CTO-Prefunded] Wallet ${i + 1} buy error:`,
          errorMessage
        );
      }
    }

    logger.info(
      `[CTO-Prefunded] CTO operation completed. Successful: ${successfulBuys}, Failed: ${failedBuys}, Total Spent: ${totalSpent.toFixed(6)} SOL`
    );

    return {
      success: successfulBuys > 0,
      successfulBuys,
      failedBuys,
      error: successfulBuys === 0 ? "All buy operations failed" : undefined,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const { logger } = await import("../../blockchain/common/logger");
    logger.error(`[CTO-Prefunded] Error:`, errorMessage);
    return {
      success: false,
      error: `Prefunded CTO operation failed: ${errorMessage}`,
      successfulBuys: 0,
      failedBuys: 0,
    };
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
    await sendMessage(ctx, "🚫 User not found. Please try again!");
    return conversation.halt();
  }

  // Get funding wallet
  const fundingWallet = await getFundingWallet(user.id);
  if (!fundingWallet) {
    await sendFirstMessage(
      ctx,
      "🔑 No funding wallet found. Please configure a funding wallet first!"
    );
    return conversation.halt();
  }

  // Check funding wallet balance
  const fundingBalance = await getWalletBalance(fundingWallet.publicKey);
  if (fundingBalance < 0.01) {
    await sendFirstMessage(
      ctx,
      [
        "💰 <b>Insufficient Balance</b>",
        "",
        "Your funding wallet needs at least 0.01 SOL for CTO operations.",
        "",
        `💳 <b>Current Balance:</b> <code>${fundingBalance.toFixed(6)} SOL</code>`,
        `✅ <b>Required Minimum:</b> <code>0.01 SOL</code>`,
        "",
        "Please add more SOL to your funding wallet to continue! 🔋",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Get buyer wallets for prefunded mode check
  const buyerWallets = await getAllBuyerWallets(user.id);

  // Calculate total buyer wallet balance
  let totalBuyerBalance = 0;
  if (buyerWallets.length > 0) {
    const buyerBalances = await Promise.all(
      buyerWallets.map(async (wallet) => {
        try {
          return await getWalletBalance(wallet.publicKey);
        } catch {
          return 0;
        }
      })
    );
    totalBuyerBalance = buyerBalances.reduce(
      (sum, balance) => sum + balance,
      0
    );
  }

  // Ask for CTO mode selection
  await sendFirstMessage(
    ctx,
    [
      "🎯 <b>CTO - Call To Others</b>",
      "",
      `🪙 <b>Token:</b> <code>${tokenAddress}</code>`,
      "",
      "🔧 <b>Choose CTO Mode:</b>",
      "",
      "🏦 <b>Standard Mode (Mixer)</b>",
      `💰 Available: ${fundingBalance.toFixed(6)} SOL`,
      "• Distribute funds via secure mixer 🔒",
      "• Anonymous transactions ⚡",
      "• Higher security & privacy 🛡️",
      "",
      "⚡ <b>Prefunded Mode (Direct)</b>",
      `💳 Available: ${totalBuyerBalance.toFixed(6)} SOL (${buyerWallets.length} wallets)`,
      "• Use pre-funded buyer wallets 🚀",
      "• Faster execution ⚡",
      "• No mixer delay 🕐",
      "",
      "💡 Select your preferred mode:",
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("🏦 Standard Mode", "mode_standard")
        .text("⚡ Prefunded Mode", "mode_prefunded")
        .row()
        .text("❌ Cancel", CallBackQueries.CANCEL),
    }
  );

  // Wait for mode selection
  const modeSelection = await conversation.waitFor("callback_query:data");
  await modeSelection.answerCallbackQuery();

  if (modeSelection.callbackQuery?.data === CallBackQueries.CANCEL) {
    await sendMessage(modeSelection, "❌ CTO operation cancelled!");
    return conversation.halt();
  }

  const selectedMode = modeSelection.callbackQuery?.data;
  const isStandardMode = selectedMode === "mode_standard";
  const isPrefundedMode = selectedMode === "mode_prefunded";

  // Validate mode selection
  if (isPrefundedMode && buyerWallets.length === 0) {
    await sendMessage(
      modeSelection,
      [
        "⚠️ <b>No Buyer Wallets Found</b>",
        "",
        "Prefunded mode requires buyer wallets to be configured first.",
        "",
        "💡 <b>Options:</b>",
        "• Configure buyer wallets in Wallet Config 🔧",
        "• Use Standard Mode instead 🏦",
        "• Cancel and setup wallets first ❌",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  if (isPrefundedMode && totalBuyerBalance < 0.01) {
    await sendMessage(
      modeSelection,
      [
        "💰 <b>Insufficient Buyer Wallet Balance</b>",
        "",
        `💳 <b>Total Available:</b> <code>${totalBuyerBalance.toFixed(6)} SOL</code>`,
        `✅ <b>Required Minimum:</b> <code>0.01 SOL</code>`,
        "",
        "💡 <b>Options:</b>",
        "• Fund your buyer wallets with SOL 💰",
        "• Use Standard Mode instead 🏦",
        "• Cancel and fund wallets first ❌",
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  let buyAmount: number;
  let currentContext: any; // Context for sending messages
  const modeDescription = isPrefundedMode
    ? "⚡ Prefunded Mode"
    : "🏦 Standard Mode";

  if (isPrefundedMode) {
    // PREFUNDED MODE: Use all available balance automatically
    buyAmount = totalBuyerBalance;
    const walletSource = `${buyerWallets.length} buyer wallets`;

    await sendMessage(
      modeSelection,
      [
        `💸 <b>${modeDescription} - Auto Amount Detection</b>`,
        "",
        `🪙 <b>Token:</b> <code>${tokenAddress}</code>`,
        `💰 <b>Total Available Balance:</b> ${buyAmount.toFixed(6)} SOL`,
        `💳 <b>Source:</b> ${walletSource}`,
        "",
        "⚡ <b>Prefunded Process:</b>",
        "• Using FULL balance from each wallet 💳",
        "• Execute direct buy transactions 🚀",
        "• No mixer delay - instant execution ⚡",
        "• Maximum buying power utilization 🚀",
        "",
        `📊 <b>Wallet Details:</b>`,
        `• Total Wallets: ${buyerWallets.length}`,
        `• Combined Balance: ${buyAmount.toFixed(6)} SOL`,
        `• Each wallet: Uses full available balance (minus fees)`,
        "",
        "🚀 <b>Ready to execute with detected balance!</b>",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("🚀 Execute CTO", "EXECUTE_PREFUNDED_CTO")
          .row()
          .text("❌ Cancel", CallBackQueries.CANCEL),
      }
    );

    // Wait for execution confirmation
    const executeConfirm = await conversation.wait();
    currentContext = executeConfirm;
    if (executeConfirm.callbackQuery?.data === CallBackQueries.CANCEL) {
      await executeConfirm.answerCallbackQuery();
      await sendMessage(executeConfirm, "❌ CTO operation cancelled!");
      return conversation.halt();
    }

    if (executeConfirm.callbackQuery?.data !== "EXECUTE_PREFUNDED_CTO") {
      await executeConfirm.answerCallbackQuery();
      await sendMessage(
        executeConfirm,
        "❌ Invalid selection. CTO operation cancelled!"
      );
      return conversation.halt();
    }

    await executeConfirm.answerCallbackQuery();
  } else {
    // STANDARD MODE: Ask for buy amount
    const walletSource = "funding wallet";
    const availableBalance = fundingBalance;

    await sendMessage(
      modeSelection,
      [
        `💸 <b>${modeDescription} - Amount Selection</b>`,
        "",
        `🪙 <b>Token:</b> <code>${tokenAddress}</code>`,
        `💰 <b>Available Balance:</b> ${availableBalance.toFixed(6)} SOL`,
        `💳 <b>Source:</b> ${walletSource}`,
        "",
        "💸 <b>How much SOL would you like to spend?</b>",
        "",
        "🔄 <b>Standard Process:</b>",
        "• Distribute funds via secure mixer 🔒",
        "• Execute coordinated buy transactions ⚡",
        "• Generate buying pressure on token 📈",
        "",
        "💡 <b>Enter amount in SOL:</b>",
        "Examples: <code>0.5</code> | <code>1.0</code> | <code>2.5</code>",
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
    currentContext = amountInput;
    if (amountInput.callbackQuery?.data === CallBackQueries.CANCEL) {
      await amountInput.answerCallbackQuery();
      await sendMessage(currentContext, "❌ CTO operation cancelled!");
      return conversation.halt();
    }

    const buyAmountText = amountInput.message?.text?.trim();
    if (!buyAmountText) {
      await sendMessage(
        currentContext,
        "🚫 No amount provided. CTO operation cancelled!"
      );
      return conversation.halt();
    }

    buyAmount = parseFloat(buyAmountText);
    if (isNaN(buyAmount) || buyAmount <= 0) {
      await sendMessage(
        currentContext,
        "⚠️ Invalid amount. Please enter a valid number!"
      );
      return conversation.halt();
    }
  }

  // Check if amount is available
  const availableBalance = isPrefundedMode ? totalBuyerBalance : fundingBalance;

  if (!isPrefundedMode) {
    // Only apply fee buffer check for standard mode
    const requiredBalance = buyAmount + 0.01; // 0.01 SOL buffer for fees

    if (requiredBalance > availableBalance) {
      await sendMessage(
        currentContext,
        [
          "💰 <b>Insufficient Balance</b>",
          "",
          `💸 <b>Requested Amount:</b> ${buyAmount.toFixed(6)} SOL`,
          `💳 <b>Available Balance:</b> ${availableBalance.toFixed(6)} SOL`,
          `✅ <b>Required (+ fees):</b> ${requiredBalance.toFixed(6)} SOL`,
          `🚨 <b>Shortage:</b> ${(requiredBalance - availableBalance).toFixed(6)} SOL`,
          "",
          "⚠️ Your funding wallet needs more SOL to proceed!",
          "",
          "💡 <b>Options:</b>",
          "• Enter a smaller amount 📉",
          "• Top up your funding wallet 💰",
          "• Check wallet balance and try again 🔄",
          "",
          "🔒 Fee buffer: 0.01 SOL for transaction costs",
        ].join("\n"),
        { parse_mode: "HTML" }
      );
      return conversation.halt();
    }
  }
  // For prefunded mode: Skip balance check - the execution logic will handle individual wallet balances and fees automatically

  // === PLATFORM DETECTION STEP ===
  const platformDetectionMessage = await sendMessage(
    currentContext,
    [
      "🔍 <b>Platform Detection</b>",
      "",
      `🪙 <b>Token:</b> <code>${tokenAddress}</code>`,
      "",
      "⏳ Analyzing token platform...",
      "",
      "🔎 <b>Checking supported exchanges:</b>",
      "• PumpFun Bonding Curve 🎯",
      "• PumpSwap DEX 🔄",
      "• Bonk Pool (Raydium) 🐕",
      "• CPMM (Graduated) 🏊",
      "",
      "⚡ Optimizing trading strategy...",
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
      case "meteora":
        platformIcon = "🌌";
        platformDetails = "Meteora DBC (Direct Bonding Curve)";
        break;
      case "heaven":
        platformIcon = "🌈";
        platformDetails = "Heaven DEX (Advanced Trading)";
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
    await sendMessage(
      ctx,
      [
        "✅ <b>Platform Detection Complete</b>",
        "",
        `🪙 <b>Token:</b> <code>${tokenAddress}</code>`,
        `🏢 <b>Platform:</b> ${platformIcon} ${platformDetails}`,
        "",
        "🎯 <b>Trading Strategy:</b>",
        (() => {
          switch (platform) {
            case "pumpfun":
              return "• Direct bonding curve trading for best prices 💰";
            case "pumpswap":
              return "• Jupiter → PumpSwap routing for optimal liquidity 🌊";
            case "bonk":
              return "• Bonk pool trading via Raydium Launch Lab 🚀";
            case "cpmm":
              return "• Raydium CPMM trading for graduated Bonk tokens 🏊";
            default:
              return "• Multi-platform fallback (Jupiter → PumpSwap → PumpFun) 🔄";
          }
        })(),
        "",
        "⚡ Proceeding automatically with optimal platform routing...",
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

    // Show buyer wallet details for prefunded mode
    let buyerWalletInfo = "";
    if (isPrefundedMode) {
      const buyerBalanceDetails = await Promise.all(
        buyerWallets.slice(0, 5).map(async (wallet, index) => {
          const balance = await getWalletBalance(wallet.publicKey);
          return `• Wallet ${index + 1}: ${balance.toFixed(4)} SOL`;
        })
      );

      buyerWalletInfo = [
        "",
        "💳 <b>Buyer Wallet Details:</b>",
        ...buyerBalanceDetails,
        ...(buyerWallets.length > 5
          ? [`• ...and ${buyerWallets.length - 5} more wallets`]
          : []),
        "",
      ].join("\n");
    }

    // Show final confirmation with platform information
    await sendMessage(
      currentContext,
      [
        `🎯 <b>CTO Operation Confirmation</b>`,
        "",
        `🪙 <b>Token:</b> <code>${tokenAddress}</code>`,
        `🏢 <b>Platform:</b> ${platformIcon} ${platformDetails}`,
        `🔧 <b>Mode:</b> ${modeDescription}`,
        `💰 <b>Buy Amount:</b> <code>${buyAmount.toFixed(6)} SOL</code>`,
        `📈 <b>Expected MC:</b> <code>$${expectedMarketCap}</code>`,
        `💳 <b>Balance:</b> <code>${availableBalance.toFixed(6)} SOL</code>`,
        buyerWalletInfo,
        "🔄 <b>Operation Process:</b>",
        ...(isPrefundedMode
          ? [
              `• Use ${buyerWallets.length} pre-funded buyer wallets 💳`,
              `• Execute direct buys on <b>${platformDetails}</b> 🚀`,
              "• Generate instant buying pressure ⚡",
            ]
          : [
              `• Distribute <code>${buyAmount.toFixed(6)} SOL</code> via secure mixer 🔒`,
              `• Execute coordinated buys on <b>${platformDetails}</b> ⚡`,
              "• Generate market buying pressure 📈",
            ]),
        "",
        "⚠️ This operation is irreversible!",
        "",
        "💡 Ready to proceed?",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("✅ Confirm & Execute", "confirm_cto")
          .row()
          .text("❌ Cancel Operation", CallBackQueries.CANCEL),
      }
    );
  } catch (platformError: any) {
    logger.error(
      `[CTO Platform Detection Error] Failed to detect platform for ${tokenAddress}:`,
      platformError
    );
    platform = "unknown"; // Set to unknown for fallback routing

    // Update the detection message with error and proceed automatically with fallback
    await sendMessage(
      ctx,
      [
        "⚠️ <b>Platform Detection Failed</b>",
        "",
        `🪙 <b>Token:</b> <code>${tokenAddress}</code>`,
        `🚫 <b>Status:</b> Detection Error`,
        `⚠️ <b>Error:</b> ${platformError.message || "Unknown error"}`,
        "",
        "🔄 <b>Fallback Strategy Activated:</b>",
        "• Multi-platform routing enabled 🌐",
        "• Jupiter → PumpSwap → PumpFun 🔄",
        "• Ensures maximum trading compatibility ✅",
        "",
        "⚡ Proceeding automatically with fallback routing...",
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
    // Calculate expected market cap for fallback operation
    const expectedMarketCapFallback = await calculateExpectedMarketCap(
      buyAmount,
      false // Use pumpfun progression as default for unknown platforms
    );

    // Show final confirmation with fallback information
    await sendMessage(
      currentContext,
      [
        "🎯 <b>CTO Operation Confirmation</b>",
        "",
        `🪙 <b>Token:</b> <code>${tokenAddress}</code>`,
        `🏢 <b>Platform:</b> ❓ Multi-Platform Fallback`,
        `🔧 <b>Mode:</b> ${modeDescription}`,
        `💰 <b>Buy Amount:</b> <code>${buyAmount.toFixed(6)} SOL</code>`,
        `📈 <b>Expected MC:</b> <code>$${expectedMarketCapFallback}</code>`,
        `💳 <b>Balance:</b> <code>${availableBalance.toFixed(6)} SOL</code>`,
        "",
        "🔄 <b>Operation Process:</b>",
        ...(isPrefundedMode
          ? [
              `• Use ${buyerWallets.length} pre-funded buyer wallets 💳`,
              "• Execute direct buys with multi-platform routing 🚀",
              "• Generate instant buying pressure ⚡",
            ]
          : [
              `• Distribute <code>${buyAmount.toFixed(6)} SOL</code> via secure mixer 🔒`,
              "• Execute coordinated buys with multi-platform routing ⚡",
              "• Generate market buying pressure 📈",
            ]),
        "",
        "🛡️ <b>Fallback Strategy:</b>",
        "• Jupiter → PumpSwap → PumpFun routing 🔄",
        "• Maximum compatibility across platforms 🌐",
        "• Auto-retry on different DEXs if needed ⚡",
        "",
        "⚠️ This operation is irreversible!",
        "",
        "💡 Ready to proceed?",
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("✅ Confirm & Execute", "confirm_cto")
          .row()
          .text("❌ Cancel Operation", CallBackQueries.CANCEL),
      }
    );
  }

  // Wait for confirmation
  const confirmation = await conversation.waitFor("callback_query:data");

  if (confirmation.callbackQuery?.data === CallBackQueries.CANCEL) {
    await confirmation.answerCallbackQuery();
    await sendMessage(confirmation, "❌ CTO operation cancelled!");
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
        [
          `🔄 <b>CTO Operation In Progress</b>`,
          "",
          `🪙 <b>Token:</b> <code>${tokenAddress}</code>`,
          `💰 <b>Amount:</b> <code>${buyAmount.toFixed(6)} SOL</code>`,
          `🏢 <b>Platform:</b> ${platform === "bonk" ? "🐕 Bonk Pool" : platform === "pumpfun" ? "🎯 PumpFun" : platform === "pumpswap" ? "🔄 PumpSwap" : "❓ Multi-Platform"}`,
          `🔧 <b>Mode:</b> ${modeDescription}`,
          "",
          ...(isPrefundedMode
            ? [
                "⏳ <b>Step 1:</b> Checking buyer wallet balances... 💳",
                "⏳ <b>Step 2:</b> Executing direct buy transactions... 🚀",
                "⏳ <b>Step 3:</b> Generating instant buying pressure... ⚡",
              ]
            : [
                "⏳ <b>Step 1:</b> Distributing SOL via secure mixer... 🔒",
                "⏳ <b>Step 2:</b> Executing coordinated buy transactions... ⚡",
                "⏳ <b>Step 3:</b> Generating buying pressure... 📈",
              ]),
          "",
          `🕐 <b>Estimated Time:</b> ${isPrefundedMode ? "15-30 seconds" : "30-60 seconds"}`,
          "",
          "⚡ Please wait while we process your CTO operation...",
        ].join("\n"),
        { parse_mode: "HTML" }
      );

      // Execute CTO operation with detected platform and mode
      let result;
      if (isPrefundedMode) {
        // Use prefunded execution that bypasses mixer
        result = await executePrefundedCTOOperation(
          tokenAddress,
          user.id,
          buyAmount,
          platform
        );
      } else {
        // Use standard execution with mixer
        const { executeCTOOperation } = await import(
          "../../blockchain/pumpfun/ctoOperation"
        );
        result = await executeCTOOperation(
          tokenAddress,
          user.id,
          buyAmount,
          platform
        );
      }

      if (result.success) {
        // Success message with detailed results
        await sendMessage(
          confirmation,
          [
            "✅ <b>CTO Operation Completed Successfully!</b>",
            "",
            `🪙 <b>Token:</b> <code>${tokenAddress}</code>`,
            `💰 <b>Total Spent:</b> <code>${buyAmount.toFixed(6)} SOL</code>`,
            `🎯 <b>Successful Buys:</b> <code>${result.successfulBuys || 0}</code>`,
            `❌ <b>Failed Buys:</b> <code>${result.failedBuys || 0}</code>`,
            "",
            "🎉 Buying pressure has been applied to the token!",
            "📊 Opening monitor page to track your position...",
            "",
            "⚡ Please wait while we load the monitoring interface...",
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
          await sendMessage(
            confirmation,
            [
              "⚠️ <b>CTO Operation Partially Completed</b>",
              "",
              `🪙 <b>Token:</b> <code>${tokenAddress}</code>`,
              `✅ <b>Successful Buys:</b> <code>${result.successfulBuys || 0}</code>`,
              `❌ <b>Failed Buys:</b> <code>${result.failedBuys || 0}</code>`,
              "",
              "🎯 Some buying pressure was successfully applied!",
              "",
              "⚠️ <b>Partial Success Details:</b>",
              "• Some transactions completed successfully ✅",
              "• Others failed due to network/mixer issues ❌",
              `• Reason: ${result.error || "Unknown mixer issues"}`,
              "",
              "📊 Opening monitor page to track your position...",
              "",
              "⚡ Your successful buys are still active and trackable...",
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
          await sendMessage(
            confirmation,
            [
              "❌ <b>CTO Operation Failed</b>",
              "",
              `🪙 <b>Token:</b> <code>${tokenAddress}</code>`,
              `💰 <b>Amount:</b> <code>${buyAmount.toFixed(6)} SOL</code>`,
              `🚫 <b>Status:</b> Complete Failure`,
              "",
              "📊 <b>Operation Results:</b>",
              `• ✅ <b>Successful Buys:</b> <code>${result.successfulBuys || 0}</code>`,
              `• ❌ <b>Failed Buys:</b> <code>${result.failedBuys || 0}</code>`,
              "",
              "🔍 <b>Error Details:</b>",
              `<code>${result.error || "Unknown error occurred"}</code>`,
              "",
              "⚠️ No buying pressure was applied to the token.",
              "",
              "💡 <b>Recommended Actions:</b>",
              "• Check your wallet balances 💳",
              "• Withdraw any remaining funds 💰",
              "• Retry the operation 🔄",
              "• Contact support if issues persist 📞",
              "",
              "🔒 Your funds are safe and can be withdrawn anytime!",
            ].join("\n"),
            {
              parse_mode: "HTML",
              reply_markup: new InlineKeyboard()
                .text(
                  "💳 Withdraw to Funding",
                  CallBackQueries.WITHDRAW_TO_FUNDING
                )
                .text(
                  "🌐 Withdraw to External",
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
              await sendMessage(failureAction, "❌ CTO operation cancelled!");
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
          `❌ <b>CTO Operation Error</b>\n\n${error.message || "Unknown error occurred"} 🚨`,
          { parse_mode: "HTML" }
        );
      } catch (msgError: any) {
        logger.warn("Failed to send error message:", msgError.message);
      }
    }
  }

  conversation.halt();
};
