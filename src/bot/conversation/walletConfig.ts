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
import { sendMessage } from "../../backend/sender";
import { safeAnswerCallbackQuery } from "../utils";

const walletConfigConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
): Promise<void> => {
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
Count: <b>${buyerWallets.length}/40</b>
Status: ${buyerWallets.length > 0 ? "✅ Ready" : "⚠️ Not configured"}

<i>💡 Keep your funding wallet topped up for launches</i>
`;

  await sendMessage(ctx, menuMessage, {
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

    if (fundingBalance <= totalMinimumRequired) {
      await sendMessage(
        next,
        `❌ Your funding wallet doesn't have enough SOL to mix funds.\n\n` +
          `<b>Required:</b> ${totalMinimumRequired.toFixed(6)} SOL\n` +
          `<b>Available:</b> ${fundingBalance.toFixed(6)} SOL\n\n` +
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

    // Calculate distribution amounts ensuring rent exemption
    const availableForDistribution = fundingBalance - totalMinimumRequired;
    const baseAmountPerWallet = availableForDistribution / buyerWallets.length;
    const finalAmountPerWallet = baseAmountPerWallet + OVERHEAD_PER_WALLET;

    // Show confirmation with details
    await sendMessage(
      next,
      `🔀 <b>Mix Funds Confirmation</b>\n\n` +
        `<b>Funding Wallet Balance:</b> ${fundingBalance.toFixed(6)} SOL\n` +
        `<b>Number of Buyer Wallets:</b> ${buyerWallets.length}\n` +
        `<b>Amount per Wallet:</b> ~${finalAmountPerWallet.toFixed(6)} SOL\n` +
        `<b>Includes Rent Exemption:</b> ${RENT_EXEMPTION_SOL.toFixed(6)} SOL\n\n` +
        `<i>This will distribute your funding wallet balance across all buyer wallets, ensuring each remains rent-exempt.</i>\n\n` +
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

        // Calculate even distribution with rent exemption
        const RENT_EXEMPTION_LAMPORTS = 1000880; // ~0.001 SOL (increased buffer)
        const TRANSACTION_FEE_LAMPORTS = 40000; // ~0.00004 SOL
        const BUFFER_LAMPORTS = 100000; // ~0.0001 SOL
        const OVERHEAD_PER_WALLET =
          RENT_EXEMPTION_LAMPORTS + TRANSACTION_FEE_LAMPORTS + BUFFER_LAMPORTS;

        const totalFundingLamports = Math.floor(fundingBalance * 1e9);

        // Reserve extra buffer for transaction fees across all transfers
        const totalTransferFees = buyerWallets.length * 10000; // 0.00001 SOL per transfer
        const totalOverhead =
          OVERHEAD_PER_WALLET * buyerWallets.length + totalTransferFees;
        const availableForDistribution = totalFundingLamports - totalOverhead;

        // Calculate exact amount per wallet (ensuring we don't exceed available funds)
        const baseAmountPerWallet = Math.floor(
          availableForDistribution / buyerWallets.length
        );
        const finalAmountPerWallet =
          baseAmountPerWallet + RENT_EXEMPTION_LAMPORTS;

        // Double-check we have enough for all wallets
        const totalNeeded = finalAmountPerWallet * buyerWallets.length;
        if (totalNeeded > totalFundingLamports) {
          await sendMessage(
            confirmCtx,
            `❌ Insufficient funds for distribution.\n\nNeed: ${(totalNeeded / 1e9).toFixed(6)} SOL\nHave: ${fundingBalance.toFixed(6)} SOL`
          );
          return conversation.halt();
        }

        // Since the mixer uses incremental distribution, we need to send to each wallet individually
        // to ensure even distribution. We'll use the simple direct transfer for true even distribution.
        let successfulTransfers = 0;

        await sendMessage(
          confirmCtx,
          `🔄 Distributing ${(finalAmountPerWallet / 1e9).toFixed(6)} SOL to each of ${buyerWallets.length} wallets...`
        );

        // Send to each wallet individually using simpleDirectTransfer for guaranteed even distribution
        const { simpleDirectTransfer } = await import(
          "../../blockchain/mixer/simple-transfer"
        );

        for (let i = 0; i < buyerWallets.length; i++) {
          const wallet = buyerWallets[i];

          try {
            // Check funding wallet balance before each transfer
            const currentBalance = await getWalletBalance(
              fundingWallet.publicKey
            );
            const currentBalanceLamports = Math.floor(currentBalance * 1e9);

            // For the last wallet, send remaining balance (minus small buffer for fees)
            let transferAmount = finalAmountPerWallet;
            if (i === buyerWallets.length - 1) {
              // Last wallet gets remaining balance minus fee buffer
              const feeBuffer = 50000; // ~0.00005 SOL buffer for fees
              transferAmount = Math.max(
                RENT_EXEMPTION_LAMPORTS,
                currentBalanceLamports - feeBuffer
              );
            }

            // Skip if insufficient funds
            if (currentBalanceLamports < transferAmount + 10000) {
              // 10000 lamports buffer
              console.error(
                `Insufficient funds for wallet ${i + 1}: have ${currentBalance.toFixed(6)} SOL, need ${(transferAmount / 1e9).toFixed(6)} SOL`
              );
              continue;
            }

            // Send exact amount to this single wallet
            await simpleDirectTransfer(
              fundingWallet.privateKey,
              [wallet.publicKey], // Single wallet
              [transferAmount], // Exact amount in lamports
              `MixFunds-${user.id}-Wallet${i + 1}`
            );

            successfulTransfers++;

            // Update progress every 5 wallets
            if ((i + 1) % 5 === 0 || i === buyerWallets.length - 1) {
              await sendMessage(
                confirmCtx,
                `📊 Progress: ${i + 1}/${buyerWallets.length} wallets completed`
              );
            }

            // Small delay between transfers to avoid overwhelming the network
            if (i < buyerWallets.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
          } catch (transferError) {
            console.error(`Transfer to wallet ${i + 1} failed:`, transferError);
            // Continue with next wallet even if one fails
          }
        }

        if (successfulTransfers === buyerWallets.length) {
          await sendMessage(
            confirmCtx,
            `✅ <b>Funds Mixed Successfully!</b>\n\n` +
              `Distributed funds across ${buyerWallets.length} buyer wallets using mixer.\n\n` +
              `<i>Each wallet received approximately ${(finalAmountPerWallet / 1e9).toFixed(6)} SOL (including rent exemption)</i>`,
            { parse_mode: "HTML" }
          );
        } else {
          await sendMessage(
            confirmCtx,
            `⚠️ <b>Partial Success</b>\n\n` +
              `Successfully mixed to ${successfulTransfers}/${buyerWallets.length} wallets.\n` +
              `Some batches may have failed. Check wallet balances.`,
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
