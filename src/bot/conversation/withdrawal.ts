import { type Conversation } from "@grammyjs/conversations";
import { type Context, InlineKeyboard } from "grammy";
import {
  getUser,
  getAllBuyerWallets,
  getDevWallet,
  getDefaultDevWallet,
  getFundingWallet,
  getWalletBalance,
  getBuyerWalletPrivateKey,
} from "../../backend/functions-main";
import { CallBackQueries } from "../types";
import { sendMessage } from "../../backend/sender";
import { decryptPrivateKey } from "../../backend/utils";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { env } from "../../config";

const connection = new Connection(env.UTILS_HELIUS_RPC);

// Withdraw from Dev Wallet Conversation
export const withdrawDevWalletConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // Get dev wallet info
  const devWalletAddress = await getDefaultDevWallet(String(user.id));
  const { wallet: devWalletPrivateKey } = await getDevWallet(user.id);
  const devBalance = await getWalletBalance(devWalletAddress);

  if (devBalance < 0.001) {
    await sendMessage(
      ctx,
      `❌ <b>Insufficient Balance</b>
      
<b>Dev Wallet:</b> <code>${devWalletAddress}</code>
<b>Current Balance:</b> <b>${devBalance.toFixed(6)} SOL</b>
<b>Minimum Required:</b> <b>0.001 SOL</b>

<i>Please deposit more SOL to proceed with withdrawal.</i>`,
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Get funding wallet for option
  const fundingWallet = await getFundingWallet(user.id);

  await sendMessage(
    ctx,
    `💸 <b>Withdraw from Dev Wallet</b>

<b>Dev Wallet:</b> <code>${devWalletAddress}</code>
<b>Available Balance:</b> <b>${devBalance.toFixed(6)} SOL</b>

<b>Choose withdrawal destination:</b>`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("💳 To Funding Wallet", CallBackQueries.WITHDRAW_TO_FUNDING)
        .row()
        .text("🌐 To External Wallet", CallBackQueries.WITHDRAW_TO_EXTERNAL)
        .row()
        .text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL),
    }
  );

  const destinationChoice = await conversation.waitFor("callback_query:data");
  await destinationChoice.answerCallbackQuery();

  if (
    destinationChoice.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL
  ) {
    await sendMessage(destinationChoice, "Withdrawal cancelled.");
    return conversation.halt();
  }

  let destinationAddress: string;
  let destinationLabel: string;

  if (
    destinationChoice.callbackQuery?.data ===
    CallBackQueries.WITHDRAW_TO_FUNDING
  ) {
    if (!fundingWallet) {
      await sendMessage(
        destinationChoice,
        "❌ No funding wallet found. Please configure your funding wallet first."
      );
      return conversation.halt();
    }
    destinationAddress = fundingWallet.publicKey;
    destinationLabel = "Funding Wallet";
  } else if (
    destinationChoice.callbackQuery?.data ===
    CallBackQueries.WITHDRAW_TO_EXTERNAL
  ) {
    await sendMessage(
      destinationChoice,
      "Please enter the destination wallet address:",
      {
        reply_markup: new InlineKeyboard().text(
          "❌ Cancel",
          CallBackQueries.CANCEL_WITHDRAWAL
        ),
      }
    );

    const addressInput = await conversation.wait();
    if (
      addressInput.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL
    ) {
      await addressInput.answerCallbackQuery();
      await sendMessage(addressInput, "Withdrawal cancelled.");
      return conversation.halt();
    }

    const inputAddress = addressInput.message?.text?.trim();
    if (!inputAddress) {
      await sendMessage(
        addressInput,
        "❌ No address provided. Withdrawal cancelled."
      );
      return conversation.halt();
    }

    try {
      new PublicKey(inputAddress); // Validate address
      destinationAddress = inputAddress;
      destinationLabel = `External Wallet (${inputAddress.slice(0, 6)}...${inputAddress.slice(-4)})`;
    } catch (error) {
      await sendMessage(
        addressInput,
        "❌ Invalid wallet address. Withdrawal cancelled."
      );
      return conversation.halt();
    }
  } else {
    return conversation.halt();
  }

  // Calculate withdrawal amount (leave 0.001 SOL for network costs)
  const withdrawAmount = Math.max(0, devBalance - 0.001);
  // Calculate 0.5% fee (but don't show to user)
  const feeAmount = withdrawAmount * 0.005;
  const netWithdrawAmount = withdrawAmount - feeAmount;

  if (netWithdrawAmount <= 0) {
    await sendMessage(
      destinationChoice,
      "❌ Insufficient balance to withdraw."
    );
    return conversation.halt();
  }

  // Confirm withdrawal
  await sendMessage(
    destinationChoice,
    `🔍 <b>Confirm Withdrawal from Dev Wallet</b>

<b>From:</b> Dev Wallet
<b>To:</b> ${destinationLabel}
<b>Amount:</b> ${netWithdrawAmount.toFixed(6)} SOL

Proceed with withdrawal?`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("✅ Confirm Withdrawal", "confirm_dev_withdrawal")
        .row()
        .text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL),
    }
  );

  const confirmation = await conversation.waitFor("callback_query:data");
  await confirmation.answerCallbackQuery();

  if (confirmation.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL) {
    await sendMessage(confirmation, "Withdrawal cancelled.");
    return conversation.halt();
  }

  if (confirmation.callbackQuery?.data === "confirm_dev_withdrawal") {
    try {
      await sendMessage(confirmation, "🔄 Processing withdrawal...");

      const devKeypair = secretKeyToKeypair(devWalletPrivateKey);
      const destinationPubkey = new PublicKey(destinationAddress);
      const feeWalletPubkey = new PublicKey(env.PLATFORM_FEE_WALLET);

      const transaction = new Transaction()
        .add(
          SystemProgram.transfer({
            fromPubkey: devKeypair.publicKey,
            toPubkey: destinationPubkey,
            lamports: Math.floor(netWithdrawAmount * LAMPORTS_PER_SOL),
          })
        )
        .add(
          SystemProgram.transfer({
            fromPubkey: devKeypair.publicKey,
            toPubkey: feeWalletPubkey,
            lamports: Math.floor(feeAmount * LAMPORTS_PER_SOL),
          })
        );

      const signature = await connection.sendTransaction(transaction, [
        devKeypair,
      ]);
      await connection.confirmTransaction(signature, "confirmed");

      await sendMessage(
        confirmation,
        `✅ <b>Withdrawal from Dev Wallet Successful!</b>

<b>Amount:</b> ${netWithdrawAmount.toFixed(6)} SOL
<b>Destination:</b> ${destinationLabel}
<b>Transaction:</b> <code>${signature}</code>

<i>🔗 View on Solscan: https://solscan.io/tx/${signature}</i>`,
        { parse_mode: "HTML" }
      );
    } catch (error: any) {
      await sendMessage(
        confirmation,
        `❌ Withdrawal failed: ${error.message}`,
        { parse_mode: "HTML" }
      );
    }
  }

  conversation.halt();
};

// Withdraw from Buyer Wallets Conversation
export const withdrawBuyerWalletsConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
) => {
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // Get buyer wallets
  const buyerWallets = await getAllBuyerWallets(user.id);

  if (buyerWallets.length === 0) {
    await sendMessage(ctx, "❌ No buyer wallets found.");
    return conversation.halt();
  }

  // Check balances
  let totalBalance = 0;
  const walletBalances: { wallet: any; balance: number }[] = [];

  for (const wallet of buyerWallets) {
    const balance = await getWalletBalance(wallet.publicKey);
    walletBalances.push({ wallet, balance });
    totalBalance += balance;
  }

  if (totalBalance < 0.005) {
    // Need at least 0.001 per wallet for network costs
    await sendMessage(
      ctx,
      `❌ Buyer wallets have insufficient total balance to withdraw.

<b>Total balance:</b> ${totalBalance.toFixed(6)} SOL
<b>Minimum required:</b> 0.005 SOL`,
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  // Get funding wallet for option
  const fundingWallet = await getFundingWallet(user.id);

  const walletList = walletBalances
    .filter((wb) => wb.balance > 0.001)
    .map(
      (wb, i) =>
        `${i + 1}. <code>${wb.wallet.publicKey.slice(0, 6)}...${wb.wallet.publicKey.slice(-4)}</code> - ${wb.balance.toFixed(6)} SOL`
    )
    .join("\n");

  await sendMessage(
    ctx,
    `💸 <b>Withdraw from Buyer Wallets</b>

<b>Wallets with withdrawable balance:</b>
${walletList}

<b>Total Available:</b> <b>${totalBalance.toFixed(6)} SOL</b>

<b>Choose withdrawal destination:</b>`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("💳 To Funding Wallet", CallBackQueries.WITHDRAW_TO_FUNDING)
        .row()
        .text("🌐 To External Wallet", CallBackQueries.WITHDRAW_TO_EXTERNAL)
        .row()
        .text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL),
    }
  );

  const destinationChoice = await conversation.waitFor("callback_query:data");
  await destinationChoice.answerCallbackQuery();

  if (
    destinationChoice.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL
  ) {
    await sendMessage(destinationChoice, "Withdrawal cancelled.");
    return conversation.halt();
  }

  let destinationAddress: string;
  let destinationLabel: string;

  if (
    destinationChoice.callbackQuery?.data ===
    CallBackQueries.WITHDRAW_TO_FUNDING
  ) {
    if (!fundingWallet) {
      await sendMessage(
        destinationChoice,
        "❌ No funding wallet found. Please configure your funding wallet first."
      );
      return conversation.halt();
    }
    destinationAddress = fundingWallet.publicKey;
    destinationLabel = "Funding Wallet";
  } else if (
    destinationChoice.callbackQuery?.data ===
    CallBackQueries.WITHDRAW_TO_EXTERNAL
  ) {
    await sendMessage(
      destinationChoice,
      "Please enter the destination wallet address:",
      {
        reply_markup: new InlineKeyboard().text(
          "❌ Cancel",
          CallBackQueries.CANCEL_WITHDRAWAL
        ),
      }
    );

    const addressInput = await conversation.wait();
    if (
      addressInput.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL
    ) {
      await addressInput.answerCallbackQuery();
      await sendMessage(addressInput, "Withdrawal cancelled.");
      return conversation.halt();
    }

    const inputAddress = addressInput.message?.text?.trim();
    if (!inputAddress) {
      await sendMessage(
        addressInput,
        "❌ No address provided. Withdrawal cancelled."
      );
      return conversation.halt();
    }

    try {
      new PublicKey(inputAddress); // Validate address
      destinationAddress = inputAddress;
      destinationLabel = `External Wallet (${inputAddress.slice(0, 6)}...${inputAddress.slice(-4)})`;
    } catch (error) {
      await sendMessage(
        addressInput,
        "❌ Invalid wallet address. Withdrawal cancelled."
      );
      return conversation.halt();
    }
  } else {
    return conversation.halt();
  }

  // Calculate total withdrawal amount and fee
  const totalWithdrawAmount = Math.max(
    0,
    totalBalance - 0.001 * buyerWallets.length
  );
  const totalFeeAmount = totalWithdrawAmount * 0.005;
  const totalNetWithdrawAmount = totalWithdrawAmount - totalFeeAmount;

  if (totalNetWithdrawAmount <= 0) {
    await sendMessage(
      ctx,
      "❌ Insufficient balance to withdraw from buyer wallets."
    );
    return conversation.halt();
  }

  // Confirm withdrawal from buyer wallets
  await sendMessage(
    destinationChoice,
    `🔍 <b>Confirm Withdrawal from Buyer Wallets</b>

<b>From:</b> ${walletBalances.filter((wb) => wb.balance > 0.001).length} Buyer Wallets
<b>To:</b> ${destinationLabel}
<b>Total Amount:</b> <b>${totalNetWithdrawAmount.toFixed(6)} SOL</b>

<i>Are you sure you want to proceed with this withdrawal?</i>`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("✅ Confirm Withdrawal", "confirm_buyer_withdrawal")
        .text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL),
    }
  );

  const confirmation = await conversation.waitFor("callback_query:data");
  await confirmation.answerCallbackQuery();

  if (confirmation.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL) {
    await sendMessage(confirmation, "Withdrawal cancelled.");
    return conversation.halt();
  }

  if (confirmation.callbackQuery?.data === "confirm_buyer_withdrawal") {
    try {
      await sendMessage(
        confirmation,
        "🔄 Processing withdrawals from buyer wallets..."
      );

      let successfulWithdrawals = 0;
      let totalWithdrawn = 0;
      let totalFeeWithdrawn = 0;
      const failedWallets = [];
      const destinationPubkey = new PublicKey(destinationAddress);
      const feeWalletPubkey = new PublicKey(env.PLATFORM_FEE_WALLET);

      for (const { wallet } of walletBalances) {
        try {
          const balance = await getWalletBalance(wallet.publicKey);
          const withdrawAmount = Math.max(0, balance - 0.001);
          if (withdrawAmount > 0) {
            const feeAmount = withdrawAmount * 0.005;
            const netAmount = withdrawAmount - feeAmount;

            if (netAmount > 0) {
              // Get the private key for this wallet
              const privateKey = await getBuyerWalletPrivateKey(
                user.id,
                wallet.id
              );
              const keypair = secretKeyToKeypair(privateKey);

              const transaction = new Transaction()
                .add(
                  SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: destinationPubkey,
                    lamports: Math.floor(netAmount * LAMPORTS_PER_SOL),
                  })
                )
                .add(
                  SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: feeWalletPubkey,
                    lamports: Math.floor(feeAmount * LAMPORTS_PER_SOL),
                  })
                );

              const signature = await connection.sendTransaction(transaction, [
                keypair,
              ]);
              await connection.confirmTransaction(signature, "confirmed");
              successfulWithdrawals++;
              totalWithdrawn += netAmount;
              totalFeeWithdrawn += feeAmount;
            }
          }
        } catch (error: any) {
          failedWallets.push({ wallet, error: error.message });
        }
      }

      if (successfulWithdrawals > 0) {
        await sendMessage(
          confirmation,
          `✅ <b>Buyer Wallets Withdrawal Complete!</b>

📊 <b>Summary:</b>
• <b>Successful:</b> ${successfulWithdrawals}/${walletBalances.length} wallets
• <b>Total Withdrawn:</b> ${totalWithdrawn.toFixed(6)} SOL
• <b>Destination:</b> ${destinationLabel}

🎉 <i>Your funds have been successfully transferred!</i>`,
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .text("🔙 Back to Menu", "back_to_main")
              .row()
              .text("📊 View Wallets", "view_wallets"),
          }
        );
      } else {
        await sendMessage(
          confirmation,
          `❌ <b>Withdrawal Failed</b>

⚠️ <i>No funds could be withdrawn from any buyer wallet.</i>

<b>Possible reasons:</b>
• Insufficient balance in wallets
• Network connectivity issues
• Transaction fees too high

💡 <i>Please check your wallet balances and try again.</i>`,
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .text("🔄 Try Again", "retry_withdrawal")
              .row()
              .text("🔙 Back to Menu", "back_to_main"),
          }
        );
      }

      if (failedWallets.length > 0) {
        await sendMessage(
          confirmation,
          `⚠️ <b>Failed Withdrawals:</b> ${failedWallets.length} wallet(s) failed to withdraw.`,
          { parse_mode: "HTML" }
        );
      }
    } catch (error: any) {
      await sendMessage(
        confirmation,
        `❌ Withdrawal from buyer wallets failed: ${error.message}`
      );
    }
  }

  conversation.halt();
};

// Withdraw from Funding Wallet Conversation
export const withdrawFundingWalletConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
) => {
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // Get funding wallet info
  const fundingWallet = await getFundingWallet(user.id);
  if (!fundingWallet) {
    await sendMessage(
      ctx,
      `❌ <b>No Funding Wallet Found</b>

🚫 <i>You need to configure your funding wallet before withdrawing.</i>

💡 <b>How to setup:</b>
• Go to Settings
• Select "Configure Funding Wallet"
• Import or generate a new wallet

<i>Once configured, you can withdraw your funds easily!</i>`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("⚙️ Go to Settings", "settings_menu")
          .row()
          .text("🔙 Back to Menu", "back_to_main"),
      }
    );
    return conversation.halt();
  }

  const fundingBalance = await getWalletBalance(fundingWallet.publicKey);

  if (fundingBalance < 0.001) {
    await sendMessage(
      ctx,
      `❌ <b>Insufficient Balance</b>
      
<b>Funding Wallet:</b> <code>${fundingWallet.publicKey}</code>
<b>Current Balance:</b> <b>${fundingBalance.toFixed(6)} SOL</b>
<b>Minimum Required:</b> <b>0.001 SOL</b>

<i>Please deposit more SOL to proceed with withdrawal.</i>`,
      { parse_mode: "HTML" }
    );
    return conversation.halt();
  }

  await sendMessage(
    ctx,
    `💸 <b>Withdraw from Funding Wallet</b>

<b>Funding Wallet:</b> <code>${fundingWallet.publicKey}</code>
<b>Available Balance:</b> <b>${fundingBalance.toFixed(6)} SOL</b>

<b>Choose withdrawal destination:</b>`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("🌐 To External Wallet", CallBackQueries.WITHDRAW_TO_EXTERNAL)
        .text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL),
    }
  );

  const destinationChoice = await conversation.waitFor("callback_query:data");
  await destinationChoice.answerCallbackQuery();

  if (
    destinationChoice.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL
  ) {
    await sendMessage(destinationChoice, "Withdrawal cancelled.");
    return conversation.halt();
  }

  let destinationAddress: string;
  let destinationLabel: string;

  if (
    destinationChoice.callbackQuery?.data ===
    CallBackQueries.WITHDRAW_TO_EXTERNAL
  ) {
    await sendMessage(
      destinationChoice,
      "Please enter the destination wallet address:",
      {
        reply_markup: new InlineKeyboard().text(
          "❌ Cancel",
          CallBackQueries.CANCEL_WITHDRAWAL
        ),
      }
    );

    const addressInput = await conversation.wait();
    if (
      addressInput.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL
    ) {
      await addressInput.answerCallbackQuery();
      await sendMessage(addressInput, "Withdrawal cancelled.");
      return conversation.halt();
    }

    const inputAddress = addressInput.message?.text?.trim();
    if (!inputAddress) {
      await sendMessage(
        addressInput,
        "❌ No address provided. Withdrawal cancelled."
      );
      return conversation.halt();
    }

    try {
      new PublicKey(inputAddress); // Validate address
      destinationAddress = inputAddress;
      destinationLabel = `External Wallet (${inputAddress.slice(0, 6)}...${inputAddress.slice(-4)})`;
    } catch (error) {
      await sendMessage(
        addressInput,
        "❌ Invalid wallet address. Withdrawal cancelled."
      );
      return conversation.halt();
    }
  } else {
    return conversation.halt();
  }

  // Calculate withdrawal amount (leave 0.001 SOL for network costs)
  const withdrawAmount = Math.max(0, fundingBalance - 0.001);
  const feeAmount = withdrawAmount * 0.005;
  const netWithdrawAmount = withdrawAmount - feeAmount;

  if (netWithdrawAmount <= 0) {
    await sendMessage(
      ctx,
      "❌ Insufficient balance to withdraw from funding wallet."
    );
    return conversation.halt();
  }
  // Confirm withdrawal
  await sendMessage(
    ctx,
    `🔍 <b>Confirm Withdrawal from Funding Wallet</b>

<b>From:</b> Funding Wallet
<b>To:</b> ${destinationLabel}
<b>Amount:</b> <b>${netWithdrawAmount.toFixed(6)} SOL</b>

<i>⚠️ This action cannot be undone. Please verify the details above.</i>

💡 <i>Are you ready to proceed with this withdrawal?</i>`,
    {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("✅ Confirm Withdrawal", "confirm_funding_withdrawal")
        .row()
        .text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL),
    }
  );

  const confirmation = await conversation.waitFor("callback_query:data");
  await confirmation.answerCallbackQuery();

  if (confirmation.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL) {
    await sendMessage(confirmation, "Withdrawal cancelled.");
    return conversation.halt();
  }

  if (confirmation.callbackQuery?.data === "confirm_funding_withdrawal") {
    try {
      await sendMessage(
        confirmation,
        "🔄 Processing withdrawal from funding wallet..."
      );

      // Create and send transaction
      const fundingKeypair = secretKeyToKeypair(fundingWallet.privateKey);
      const destinationPubkey = new PublicKey(destinationAddress);
      const feeWalletPubkey = new PublicKey(env.PLATFORM_FEE_WALLET);

      const transaction = new Transaction()
        .add(
          SystemProgram.transfer({
            fromPubkey: fundingKeypair.publicKey,
            toPubkey: destinationPubkey,
            lamports: Math.floor(netWithdrawAmount * LAMPORTS_PER_SOL),
          })
        )
        .add(
          SystemProgram.transfer({
            fromPubkey: fundingKeypair.publicKey,
            toPubkey: feeWalletPubkey,
            lamports: Math.floor(feeAmount * LAMPORTS_PER_SOL),
          })
        );

      const signature = await connection.sendTransaction(transaction, [
        fundingKeypair,
      ]);
      await connection.confirmTransaction(signature, "confirmed");

      await sendMessage(
        confirmation,
        `✅ <b>Withdrawal Successful!</b>

💰 <b>Transaction Details:</b>
• <b>Amount:</b> ${netWithdrawAmount.toFixed(6)} SOL
• <b>Destination:</b> ${destinationLabel}
• <b>Transaction ID:</b> <code>${signature}</code>

🎉 <i>Your funds have been successfully transferred!</i>

🔗 <a href="https://solscan.io/tx/${signature}">View on Solscan</a>`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("🔙 Back to Menu", "back_to_main")
            .row()
            .text("📊 View Wallets", "view_wallets")
            .text("💸 New Withdrawal", "new_withdrawal"),
        }
      );
    } catch (error: any) {
      await sendMessage(
        confirmation,
        `❌ <b>Withdrawal Failed</b>

⚠️ <b>Error:</b> ${error.message}

💡 <b>What you can do:</b>
• Check your wallet balance
• Verify network connectivity
• Try again in a few moments

<i>If the problem persists, please contact support.</i>`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard()
            .text("🔄 Try Again", "retry_funding_withdrawal")
            .row()
            .text("🔙 Back to Menu", "back_to_main")
            .text("💬 Support", "contact_support"),
        }
      );
    }
  }

  conversation.halt();
};
