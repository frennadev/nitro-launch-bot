import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  getUser,
  getDefaultDevWallet,
  getOrCreateFundingWallet,
  getAllBuyerWallets,
  getWalletBalance,
} from "../../backend/functions-main";
import { CallBackQueries } from "../types";
import type { ParseMode } from "grammy/types";
import { sendMessage, sendFirstMessage } from "../../backend/sender";
import { safeAnswerCallbackQuery } from "../utils";

const walletConfigConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
): Promise<void> => {
  // Only answer callback query if there is one (e.g., from button clicks, not commands)
  if (ctx.callbackQuery) {
    await safeAnswerCallbackQuery(ctx);
  }

  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // Get wallet data
  const devWalletAddress = await getDefaultDevWallet(String(user.id));
  const fundingWalletAddress = await getOrCreateFundingWallet(String(user.id));
  const buyerWallets = await getAllBuyerWallets(String(user.id));

  // Get balances
  const devBalance = await getWalletBalance(devWalletAddress);
  const fundingBalance = (await getWalletBalance(fundingWalletAddress)) - 0.01;

  const keyboard = new InlineKeyboard()
    .text("🔧 Developer Wallet", CallBackQueries.CHANGE_DEV_WALLET)
    .text("💰 Funding Wallet", CallBackQueries.GENERATE_FUNDING_WALLET)
    .row()
    .text("👥 Buyer Wallets", CallBackQueries.MANAGE_BUYER_WALLETS)
    .row()
    .text("🔀 Mix Funds", CallBackQueries.MIX_FUNDS)
    .row()
    .text("💸 Withdraw Dev", CallBackQueries.WITHDRAW_DEV_WALLET)
    .text("💸 Withdraw Funding", CallBackQueries.WITHDRAW_FUNDING_WALLET)
    .row()
    .text("💸 Withdraw Buyers", CallBackQueries.WITHDRAW_BUYER_WALLETS)
    .row()
    .text("← Back", CallBackQueries.BACK);

  const menuMessage = `
<b>💼 Wallet Configuration</b>

<b>🔧 Developer Wallet</b>
<code>${devWalletAddress}</code>
Balance: <b>${devBalance.toFixed(4)} SOL</b>

<b>💰 Funding Wallet</b>
<code>${fundingWalletAddress}</code>
Balance: <b>${fundingBalance.toFixed(4)} SOL</b>

<b>👥 Buyer Wallets</b>
Count: <b>${buyerWallets.length}/73</b>
Status: ${buyerWallets.length > 0 ? "✅ Ready" : "⚠️ Not configured"}

<i>💡 Keep your funding wallet topped up for launches</i>
`;

  await sendFirstMessage(ctx, menuMessage, {
    parse_mode: "HTML" as ParseMode,
    reply_markup: keyboard,
  });

  const next = await conversation.wait();
  const data = next.callbackQuery?.data;
  if (!data) return conversation.halt();

  await next.answerCallbackQuery();

  if (data === CallBackQueries.BACK) {
    // Import and start main menu conversation
    const mainMenuConversation = await import("./mainMenu");
    return await mainMenuConversation.default(conversation, next);
  }

  if (data === CallBackQueries.GENERATE_FUNDING_WALLET) {
    await next.reply(
      "⚠️ This will replace your current funding wallet. Any funds in the old wallet will need to be transferred manually.\n\nAre you sure you want to continue?",
      {
        reply_markup: new InlineKeyboard()
          .text("✅ Yes, Generate New", "confirm_generate_funding")
          .text("❌ Cancel", CallBackQueries.BACK),
      }
    );

    const confirmCtx = await conversation.wait();
    if (confirmCtx.callbackQuery?.data === "confirm_generate_funding") {
      await confirmCtx.answerCallbackQuery();
      try {
        const { generateNewFundingWallet } = await import(
          "../../backend/functions-main"
        );
        const newWallet = await generateNewFundingWallet(String(user.id));

        await sendMessage(
          confirmCtx,
          `✅ New funding wallet generated!\n\n<b>Address:</b> <code>${newWallet.publicKey}</code>\n\n<b>Private Key:</b>\n<code>${newWallet.privateKey}</code>\n\n<i>⚠️ Save this private key securely and delete this message!</i>`,
          { parse_mode: "HTML" }
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        await sendMessage(confirmCtx, `❌ Error: ${errorMessage}`);
      }
    } else {
      await confirmCtx.answerCallbackQuery();
      await sendMessage(confirmCtx, "Operation cancelled.");
    }
    return conversation.halt();
  }

  if (data === CallBackQueries.WITHDRAW_DEV_WALLET) {
    // Import and start dev wallet withdrawal conversation
    const { withdrawDevWalletConversation } = await import("./withdrawal");
    return await withdrawDevWalletConversation(conversation, next);
  }

  if (data === CallBackQueries.WITHDRAW_BUYER_WALLETS) {
    // Import and start buyer wallets withdrawal conversation
    const { withdrawBuyerWalletsConversation } = await import("./withdrawal");
    return await withdrawBuyerWalletsConversation(conversation, next);
  }

  if (data === CallBackQueries.WITHDRAW_FUNDING_WALLET) {
    // Import and start funding wallet withdrawal conversation
    const { withdrawFundingWalletConversation } = await import("./withdrawal");
    return await withdrawFundingWalletConversation(conversation, next);
  }

  if (data === CallBackQueries.MANAGE_BUYER_WALLETS) {
    // Import and start buyer wallets management conversation
    const { default: manageBuyerWalletsConversation } = await import(
      "./buyerWallets"
    );
    return await manageBuyerWalletsConversation(conversation, next);
  }

  if (data === CallBackQueries.CHANGE_DEV_WALLET) {
    // Import and start dev wallet management conversation
    const { default: devWalletsConversation } = await import("./devWallets");
    return await devWalletsConversation(conversation, next);
  }

  if (data === CallBackQueries.MIX_FUNDS) {
    // Check if user has buyer wallets and funding wallet balance
    if (buyerWallets.length === 0) {
      await sendMessage(
        next,
        "❌ You need to create buyer wallets first to mix funds.",
        {
          reply_markup: new InlineKeyboard()
            .text(
              "👥 Create Buyer Wallets",
              CallBackQueries.MANAGE_BUYER_WALLETS
            )
            .row()
            .text("← Back", CallBackQueries.BACK),
        }
      );
      return conversation.halt();
    }

    // Calculate minimum required for rent exemption + fees
    const RENT_EXEMPTION_SOL = 0.00209088; // Rent-exempt minimum per account
    const TRANSACTION_FEE_SOL = 0.00001; // Estimated transaction fee per transfer
    const BUFFER_SOL = 0.00001; // Small buffer for safety
    const OVERHEAD_PER_WALLET =
      RENT_EXEMPTION_SOL + TRANSACTION_FEE_SOL + BUFFER_SOL;
    const totalMinimumRequired = OVERHEAD_PER_WALLET * buyerWallets.length;
    const availableForMixing = fundingBalance * 0.9;

    if (availableForMixing <= totalMinimumRequired) {
      await sendMessage(
        next,
        `❌ Your funding wallet doesn't have enough SOL to mix funds.\n\n` +
          `<b>Required (90% of wallet):</b> ${totalMinimumRequired.toFixed(6)} SOL\n` +
          `<b>Available (90% of ${fundingBalance.toFixed(6)} SOL):</b> ${availableForMixing.toFixed(6)} SOL\n\n` +
          `<i>Each wallet needs ${OVERHEAD_PER_WALLET.toFixed(6)} SOL minimum for rent exemption + fees.</i>`,
        {
          parse_mode: "HTML" as ParseMode,
          reply_markup: new InlineKeyboard().text(
            "← Back",
            CallBackQueries.BACK
          ),
        }
      );
      return conversation.halt();
    }

    // Use the new 73-wallet distribution system for proper randomized amounts
    const { generateBuyDistribution, calculateRequiredWallets } = await import("../../backend/functions");
    
    // Calculate the total amount available for distribution
    const totalAmountForDistribution = availableForMixing;
    
    // ✅ FIXED: Calculate how many wallets are actually needed for this amount
    const walletsNeeded = calculateRequiredWallets(totalAmountForDistribution);
    const actualWalletsToUse = Math.min(walletsNeeded, buyerWallets.length);
    
    // Generate the proper 73-wallet distribution using only the needed wallets
    const distributionAmounts = generateBuyDistribution(
      totalAmountForDistribution,
      actualWalletsToUse, // ✅ Use calculated wallet count, not all wallets!
      0.01 // randomSeed (optional)
    );
    
    // Calculate average amount for display (based on actual wallets used)
    const averageAmountPerWallet = totalAmountForDistribution / actualWalletsToUse;
    const totalBuyerWallets = buyerWallets.length;

    // Show confirmation with details
    await sendMessage(
      next,
      `🔀 <b>Mix Funds Confirmation (73-Wallet System)</b>\n\n` +
        `<b>Funding Wallet Balance:</b> ${fundingBalance.toFixed(6)} SOL\n` +
        `<b>Amount to Mix (90%):</b> ${(fundingBalance * 0.9).toFixed(6)} SOL\n` +
        `<b>Reserve (10%):</b> ${(fundingBalance * 0.1).toFixed(6)} SOL\n` +
        `<b>Total Buyer Wallets:</b> ${totalBuyerWallets}\n` +
        `<b>Wallets Needed for Amount:</b> ${actualWalletsToUse} wallets\n` +
        `<b>Average per Used Wallet:</b> ~${averageAmountPerWallet.toFixed(6)} SOL\n` +
        `<b>Distribution:</b> Tiered (${actualWalletsToUse <= 15 ? 'Tier 1' : actualWalletsToUse <= 25 ? 'Tier 1-2' : actualWalletsToUse <= 39 ? 'Tier 1-3' : actualWalletsToUse <= 58 ? 'Tier 1-4' : 'All Tiers'})\n` +
        `<b>Large buys (≥2.0 SOL):</b> ${actualWalletsToUse >= 40 ? 'Yes (Wallets 40+)' : 'No (Amount too small)'}\n\n` +
        `<i>🎯 Smart wallet selection: Only uses ${actualWalletsToUse} of your ${totalBuyerWallets} wallets based on the amount being mixed.</i>\n\n` +
        `Are you sure you want to proceed?`,
      {
        parse_mode: "HTML" as ParseMode,
        reply_markup: new InlineKeyboard()
          .text("✅ Yes, Mix Funds", "confirm_mix_funds")
          .text("❌ Cancel", CallBackQueries.BACK),
      }
    );

    const confirmCtx = await conversation.wait();
    if (confirmCtx.callbackQuery?.data === "confirm_mix_funds") {
      await confirmCtx.answerCallbackQuery();

      try {
        const { getFundingWallet } = await import("../../backend/functions");
        const fundingWallet = await getFundingWallet(String(user.id));

        if (!fundingWallet) {
          await sendMessage(confirmCtx, "❌ Funding wallet not found.");
          return conversation.halt();
        }

        await sendMessage(
          confirmCtx,
          "🔄 Mixing funds... This may take a moment."
        );

        // Use 90% of funding wallet balance for mixing (leave 10% as reserve)
        const availableForMixing = fundingBalance * 0.9;
        const totalFundingLamports = Math.floor(availableForMixing * 1e9);

        // Reserve extra buffer for transaction fees (only for wallets actually being used)
        const totalTransferFees = actualWalletsToUse * 10000; // 0.00001 SOL per transfer

        // Calculate total amount for mixer (we'll let the mixer handle distribution)
        const totalAmountForMixer =
          (totalFundingLamports - totalTransferFees) / 1e9;

        // Double-check we have enough for mixer operation
        if (totalAmountForMixer <= 0) {
          await sendMessage(
            confirmCtx,
            `❌ Insufficient funds for mixer operation.\n\nNeed: ${(totalAmountForDistribution + (totalTransferFees / 1e9)).toFixed(6)} SOL minimum\nHave: ${fundingBalance.toFixed(6)} SOL`
          );
          return conversation.halt();
        }

        // ✅ FIXED: Get only the wallet addresses that will actually receive funds
        const destinationAddresses = buyerWallets
          .slice(0, actualWalletsToUse) // Only use the first N wallets needed
          .map((wallet) => wallet.publicKey);

        await sendMessage(
          confirmCtx,
          `🔄 Starting mixer operation for ${actualWalletsToUse} of ${buyerWallets.length} wallets...`
        );

        // Use the new 73-wallet distribution mixer
        const { initializeMixerWithCustomAmounts } = await import(
          "../../blockchain/mixer/init-mixer"
        );

        try {
          const mixerResult = await initializeMixerWithCustomAmounts(
            fundingWallet.privateKey,
            fundingWallet.privateKey,
            destinationAddresses,
            distributionAmounts
          );

          // Check mixer results
          if (mixerResult && mixerResult.successCount > 0) {
            await sendMessage(
              confirmCtx,
              `✅ <b>Smart Wallet Distribution Complete!</b>\n\n` +
                `Mixed ${totalAmountForDistribution.toFixed(6)} SOL (90% of funding wallet) across ${actualWalletsToUse} of ${buyerWallets.length} buyer wallets.\n\n` +
                `<b>Successful transfers:</b> ${mixerResult.successCount}/${mixerResult.totalRoutes || actualWalletsToUse}\n` +
                `<b>Distribution:</b> Tiered amounts (${actualWalletsToUse <= 15 ? 'Tier 1' : actualWalletsToUse <= 25 ? 'Tier 1-2' : actualWalletsToUse <= 39 ? 'Tier 1-3' : actualWalletsToUse <= 58 ? 'Tier 1-4' : 'All Tiers'})\n` +
                `<b>Large buys (≥2.0 SOL):</b> ${actualWalletsToUse >= 40 ? 'Yes (Wallets 40+)' : 'No (Amount too small)'}\n` +
                `<b>Unused wallets:</b> ${buyerWallets.length - actualWalletsToUse} (kept clean for future use)\n` +
                `<b>Reserve remaining:</b> ${(fundingBalance * 0.1).toFixed(6)} SOL\n\n` +
                `<i>🎯 Smart selection: Only used the exact number of wallets needed for optimal distribution</i>`,
              { parse_mode: "HTML" }
            );
          } else {
            await sendMessage(
              confirmCtx,
              `⚠️ <b>Mixer Operation Completed</b>\n\n` +
                `Operation processed but results unclear. Please check wallet balances.\n\n` +
                `<i>If wallets didn't receive funds, the mixer may have used optimized distribution.</i>`,
              { parse_mode: "HTML" }
            );
          }
        } catch (mixerError) {
          console.error("Mixer operation failed:", mixerError);
          await sendMessage(
            confirmCtx,
            `❌ <b>Mixer Operation Failed</b>\n\n` +
              `Error: ${mixerError instanceof Error ? mixerError.message : "Unknown mixer error"}\n\n` +
              `<i>Please try again or check wallet balances manually.</i>`,
            { parse_mode: "HTML" }
          );
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";
        await sendMessage(confirmCtx, `❌ Error mixing funds: ${errorMessage}`);
      }
    } else {
      await confirmCtx.answerCallbackQuery();
      await sendMessage(confirmCtx, "Mix funds cancelled.");
    }
    return conversation.halt();
  }

  conversation.halt();
};

export default walletConfigConversation;
