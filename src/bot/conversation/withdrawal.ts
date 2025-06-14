import { type Conversation } from "@grammyjs/conversations";
import { type Context, InlineKeyboard } from "grammy";
import {
  getUser,
  getAllBuyerWallets,
  getDevWallet,
  getDefaultDevWallet,
  getFundingWallet,
  getWalletBalance,
} from "../../backend/functions";
import { CallBackQueries } from "../types";
import { sendMessage } from "../../backend/sender";
import { decryptPrivateKey } from "../../backend/utils";
import { secretKeyToKeypair } from "../../blockchain/common/utils";
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { env } from "../../config";

const connection = new Connection(env.HELIUS_RPC_URL);

// Withdraw from Dev Wallet Conversation
export const withdrawDevWalletConversation = async (conversation: Conversation<Context>, ctx: Context) => {
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
    await sendMessage(ctx, `❌ Dev wallet has insufficient balance to withdraw.
    
<b>Current balance:</b> ${devBalance.toFixed(6)} SOL
<b>Minimum required:</b> 0.001 SOL (for transaction fees)`, { parse_mode: "HTML" });
    return conversation.halt();
  }

  // Get funding wallet for option
  const fundingWallet = await getFundingWallet(user.id);

  await sendMessage(ctx, `💸 <b>Withdraw from Dev Wallet</b>

<b>Dev Wallet:</b> <code>${devWalletAddress}</code>
<b>Available Balance:</b> ${devBalance.toFixed(6)} SOL

Where would you like to withdraw the funds?`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text("💳 To Funding Wallet", CallBackQueries.WITHDRAW_TO_FUNDING)
      .row()
      .text("🌐 To External Wallet", CallBackQueries.WITHDRAW_TO_EXTERNAL)
      .row()
      .text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL)
  });

  const destinationChoice = await conversation.waitFor("callback_query:data");
  await destinationChoice.answerCallbackQuery();

  if (destinationChoice.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL) {
    await sendMessage(destinationChoice, "Withdrawal cancelled.");
    return conversation.halt();
  }

  let destinationAddress: string;
  let destinationLabel: string;

  if (destinationChoice.callbackQuery?.data === CallBackQueries.WITHDRAW_TO_FUNDING) {
    if (!fundingWallet) {
      await sendMessage(destinationChoice, "❌ No funding wallet found. Please configure your funding wallet first.");
      return conversation.halt();
    }
    destinationAddress = fundingWallet.publicKey;
    destinationLabel = "Funding Wallet";
  } else if (destinationChoice.callbackQuery?.data === CallBackQueries.WITHDRAW_TO_EXTERNAL) {
    await sendMessage(destinationChoice, "Please enter the destination wallet address:", {
      reply_markup: new InlineKeyboard().text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL)
    });

    const addressInput = await conversation.wait();
    if (addressInput.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL) {
      await addressInput.answerCallbackQuery();
      await sendMessage(addressInput, "Withdrawal cancelled.");
      return conversation.halt();
    }

    const inputAddress = addressInput.message?.text?.trim();
    if (!inputAddress) {
      await sendMessage(addressInput, "❌ No address provided. Withdrawal cancelled.");
      return conversation.halt();
    }

    try {
      new PublicKey(inputAddress); // Validate address
      destinationAddress = inputAddress;
      destinationLabel = `External Wallet (${inputAddress.slice(0, 6)}...${inputAddress.slice(-4)})`;
    } catch (error) {
      await sendMessage(addressInput, "❌ Invalid wallet address. Withdrawal cancelled.");
      return conversation.halt();
    }
  } else {
    return conversation.halt();
  }

  // Calculate withdrawal amount (leave 0.001 SOL for fees)
  const withdrawAmount = Math.max(0, devBalance - 0.001);
  
  if (withdrawAmount <= 0) {
    await sendMessage(destinationChoice, "❌ Insufficient balance after accounting for transaction fees.");
    return conversation.halt();
  }

  // Confirm withdrawal
  await sendMessage(destinationChoice, `🔍 <b>Confirm Withdrawal</b>

<b>From:</b> Dev Wallet
<b>To:</b> ${destinationLabel}
<b>Amount:</b> ${withdrawAmount.toFixed(6)} SOL
<b>Remaining in dev wallet:</b> ~0.001 SOL (for fees)

Proceed with withdrawal?`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text("✅ Confirm Withdrawal", "confirm_dev_withdrawal")
      .row()
      .text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL)
  });

  const confirmation = await conversation.waitFor("callback_query:data");
  await confirmation.answerCallbackQuery();

  if (confirmation.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL) {
    await sendMessage(confirmation, "Withdrawal cancelled.");
    return conversation.halt();
  }

  if (confirmation.callbackQuery?.data === "confirm_dev_withdrawal") {
    try {
      await sendMessage(confirmation, "🔄 Processing withdrawal...");

      // Create and send transaction
      const devKeypair = secretKeyToKeypair(decryptPrivateKey(devWalletPrivateKey));
      const destinationPubkey = new PublicKey(destinationAddress);
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: devKeypair.publicKey,
          toPubkey: destinationPubkey,
          lamports: Math.floor(withdrawAmount * LAMPORTS_PER_SOL),
        })
      );

      const signature = await connection.sendTransaction(transaction, [devKeypair]);
      await connection.confirmTransaction(signature, 'confirmed');

      await sendMessage(confirmation, `✅ <b>Withdrawal Successful!</b>

<b>Amount:</b> ${withdrawAmount.toFixed(6)} SOL
<b>Destination:</b> ${destinationLabel}
<b>Transaction:</b> <code>${signature}</code>

<i>🔗 View on Solscan: https://solscan.io/tx/${signature}</i>`, { parse_mode: "HTML" });

    } catch (error: any) {
      await sendMessage(confirmation, `❌ Withdrawal failed: ${error.message}`);
    }
  }

  conversation.halt();
};

// Withdraw from Buyer Wallets Conversation
export const withdrawBuyerWalletsConversation = async (conversation: Conversation<Context>, ctx: Context) => {
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
  const walletBalances: { wallet: any, balance: number }[] = [];
  
  for (const wallet of buyerWallets) {
    const balance = await getWalletBalance(wallet.publicKey);
    walletBalances.push({ wallet, balance });
    totalBalance += balance;
  }

  if (totalBalance < 0.005) { // Need at least 0.001 per wallet for fees
    await sendMessage(ctx, `❌ Buyer wallets have insufficient total balance to withdraw.
    
<b>Total balance:</b> ${totalBalance.toFixed(6)} SOL
<b>Minimum required:</b> 0.005 SOL (for transaction fees across wallets)`, { parse_mode: "HTML" });
    return conversation.halt();
  }

  // Get funding wallet for option
  const fundingWallet = await getFundingWallet(user.id);

  const walletList = walletBalances
    .filter(wb => wb.balance > 0.001)
    .map((wb, i) => `${i + 1}. <code>${wb.wallet.publicKey.slice(0, 6)}...${wb.wallet.publicKey.slice(-4)}</code> - ${wb.balance.toFixed(6)} SOL`)
    .join('\n');

  await sendMessage(ctx, `💸 <b>Withdraw from Buyer Wallets</b>

<b>Wallets with withdrawable balance:</b>
${walletList}

<b>Total Available:</b> ${totalBalance.toFixed(6)} SOL

Where would you like to withdraw all funds?`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text("💳 To Funding Wallet", CallBackQueries.WITHDRAW_TO_FUNDING)
      .row()
      .text("🌐 To External Wallet", CallBackQueries.WITHDRAW_TO_EXTERNAL)
      .row()
      .text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL)
  });

  const destinationChoice = await conversation.waitFor("callback_query:data");
  await destinationChoice.answerCallbackQuery();

  if (destinationChoice.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL) {
    await sendMessage(destinationChoice, "Withdrawal cancelled.");
    return conversation.halt();
  }

  let destinationAddress: string;
  let destinationLabel: string;

  if (destinationChoice.callbackQuery?.data === CallBackQueries.WITHDRAW_TO_FUNDING) {
    if (!fundingWallet) {
      await sendMessage(destinationChoice, "❌ No funding wallet found. Please configure your funding wallet first.");
      return conversation.halt();
    }
    destinationAddress = fundingWallet.publicKey;
    destinationLabel = "Funding Wallet";
  } else if (destinationChoice.callbackQuery?.data === CallBackQueries.WITHDRAW_TO_EXTERNAL) {
    await sendMessage(destinationChoice, "Please enter the destination wallet address:", {
      reply_markup: new InlineKeyboard().text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL)
    });

    const addressInput = await conversation.wait();
    if (addressInput.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL) {
      await addressInput.answerCallbackQuery();
      await sendMessage(addressInput, "Withdrawal cancelled.");
      return conversation.halt();
    }

    const inputAddress = addressInput.message?.text?.trim();
    if (!inputAddress) {
      await sendMessage(addressInput, "❌ No address provided. Withdrawal cancelled.");
      return conversation.halt();
    }

    try {
      new PublicKey(inputAddress); // Validate address
      destinationAddress = inputAddress;
      destinationLabel = `External Wallet (${inputAddress.slice(0, 6)}...${inputAddress.slice(-4)})`;
    } catch (error) {
      await sendMessage(addressInput, "❌ Invalid wallet address. Withdrawal cancelled.");
      return conversation.halt();
    }
  } else {
    return conversation.halt();
  }

  // Calculate total withdrawal amount
  const withdrawableWallets = walletBalances.filter(wb => wb.balance > 0.001);
  const totalWithdrawAmount = withdrawableWallets.reduce((sum, wb) => sum + Math.max(0, wb.balance - 0.001), 0);

  if (totalWithdrawAmount <= 0) {
    await sendMessage(destinationChoice, "❌ No withdrawable balance after accounting for transaction fees.");
    return conversation.halt();
  }

  // Confirm withdrawal
  await sendMessage(destinationChoice, `🔍 <b>Confirm Bulk Withdrawal</b>

<b>From:</b> ${withdrawableWallets.length} Buyer Wallets
<b>To:</b> ${destinationLabel}
<b>Total Amount:</b> ${totalWithdrawAmount.toFixed(6)} SOL
<b>Transactions:</b> ${withdrawableWallets.length}

<i>💡 Each wallet will keep ~0.001 SOL for transaction fees</i>

Proceed with withdrawal?`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text("✅ Confirm Withdrawal", "confirm_buyer_withdrawal")
      .row()
      .text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL)
  });

  const confirmation = await conversation.waitFor("callback_query:data");
  await confirmation.answerCallbackQuery();

  if (confirmation.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL) {
    await sendMessage(confirmation, "Withdrawal cancelled.");
    return conversation.halt();
  }

  if (confirmation.callbackQuery?.data === "confirm_buyer_withdrawal") {
    try {
      await sendMessage(confirmation, "🔄 Processing bulk withdrawal...");

      const destinationPubkey = new PublicKey(destinationAddress);
      const results: { success: boolean, signature?: string, error?: string, wallet: string }[] = [];

      // Process each wallet
      for (const { wallet, balance } of withdrawableWallets) {
        try {
          const withdrawAmount = Math.max(0, balance - 0.001);
          if (withdrawAmount <= 0) continue;

          const { WalletModel } = await import("../../backend/models");
          const walletDoc = await WalletModel.findById(wallet.id);
          if (!walletDoc) continue;

          const keypair = secretKeyToKeypair(decryptPrivateKey(walletDoc.privateKey));
          
          const transaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: keypair.publicKey,
              toPubkey: destinationPubkey,
              lamports: Math.floor(withdrawAmount * LAMPORTS_PER_SOL),
            })
          );

          const signature = await connection.sendTransaction(transaction, [keypair]);
          await connection.confirmTransaction(signature, 'confirmed');

          results.push({
            success: true,
            signature,
            wallet: `${wallet.publicKey.slice(0, 6)}...${wallet.publicKey.slice(-4)}`
          });

          // Small delay between transactions
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error: any) {
          results.push({
            success: false,
            error: error.message,
            wallet: `${wallet.publicKey.slice(0, 6)}...${wallet.publicKey.slice(-4)}`
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      let resultMessage = `📊 <b>Bulk Withdrawal Results</b>

<b>Successful:</b> ${successCount}/${results.length}
<b>Failed:</b> ${failCount}
<b>Destination:</b> ${destinationLabel}

`;

      if (successCount > 0) {
        resultMessage += `<b>✅ Successful Transactions:</b>\n`;
        results.filter(r => r.success).forEach(r => {
          resultMessage += `• ${r.wallet}: <code>${r.signature}</code>\n`;
        });
      }

      if (failCount > 0) {
        resultMessage += `\n<b>❌ Failed Transactions:</b>\n`;
        results.filter(r => !r.success).forEach(r => {
          resultMessage += `• ${r.wallet}: ${r.error}\n`;
        });
      }

      await sendMessage(confirmation, resultMessage, { parse_mode: "HTML" });

    } catch (error: any) {
      await sendMessage(confirmation, `❌ Bulk withdrawal failed: ${error.message}`);
    }
  }

  conversation.halt();
};

// Withdraw from Funding Wallet Conversation
export const withdrawFundingWalletConversation = async (conversation: Conversation<Context>, ctx: Context) => {
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendMessage(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // Get funding wallet info
  const fundingWallet = await getFundingWallet(user.id);
  if (!fundingWallet) {
    await sendMessage(ctx, "❌ No funding wallet found. Please configure your funding wallet first.");
    return conversation.halt();
  }

  const fundingBalance = await getWalletBalance(fundingWallet.publicKey);

  if (fundingBalance < 0.001) {
    await sendMessage(ctx, `❌ Funding wallet has insufficient balance to withdraw.
    
<b>Current balance:</b> ${fundingBalance.toFixed(6)} SOL
<b>Minimum required:</b> 0.001 SOL (for transaction fees)`, { parse_mode: "HTML" });
    return conversation.halt();
  }

  await sendMessage(ctx, `💸 <b>Withdraw from Funding Wallet</b>

<b>Funding Wallet:</b> <code>${fundingWallet.publicKey}</code>
<b>Available Balance:</b> ${fundingBalance.toFixed(6)} SOL

Where would you like to withdraw the funds?`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text("🌐 To External Wallet", CallBackQueries.WITHDRAW_TO_EXTERNAL)
      .row()
      .text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL)
  });

  const destinationChoice = await conversation.waitFor("callback_query:data");
  await destinationChoice.answerCallbackQuery();

  if (destinationChoice.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL) {
    await sendMessage(destinationChoice, "Withdrawal cancelled.");
    return conversation.halt();
  }

  let destinationAddress: string;
  let destinationLabel: string;

  if (destinationChoice.callbackQuery?.data === CallBackQueries.WITHDRAW_TO_EXTERNAL) {
    await sendMessage(destinationChoice, "Please enter the destination wallet address:", {
      reply_markup: new InlineKeyboard().text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL)
    });

    const addressInput = await conversation.wait();
    if (addressInput.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL) {
      await addressInput.answerCallbackQuery();
      await sendMessage(addressInput, "Withdrawal cancelled.");
      return conversation.halt();
    }

    const inputAddress = addressInput.message?.text?.trim();
    if (!inputAddress) {
      await sendMessage(addressInput, "❌ No address provided. Withdrawal cancelled.");
      return conversation.halt();
    }

    try {
      new PublicKey(inputAddress); // Validate address
      destinationAddress = inputAddress;
      destinationLabel = `External Wallet (${inputAddress.slice(0, 6)}...${inputAddress.slice(-4)})`;
    } catch (error) {
      await sendMessage(addressInput, "❌ Invalid wallet address. Withdrawal cancelled.");
      return conversation.halt();
    }
  } else {
    return conversation.halt();
  }

  // Calculate withdrawal amount (leave 0.001 SOL for fees)
  const withdrawAmount = Math.max(0, fundingBalance - 0.001);
  
  if (withdrawAmount <= 0) {
    await sendMessage(destinationChoice, "❌ Insufficient balance after accounting for transaction fees.");
    return conversation.halt();
  }

  // Confirm withdrawal
  await sendMessage(destinationChoice, `🔍 <b>Confirm Withdrawal</b>

<b>From:</b> Funding Wallet
<b>To:</b> ${destinationLabel}
<b>Amount:</b> ${withdrawAmount.toFixed(6)} SOL
<b>Remaining in funding wallet:</b> ~0.001 SOL (for fees)

Proceed with withdrawal?`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text("✅ Confirm Withdrawal", "confirm_funding_withdrawal")
      .row()
      .text("❌ Cancel", CallBackQueries.CANCEL_WITHDRAWAL)
  });

  const confirmation = await conversation.waitFor("callback_query:data");
  await confirmation.answerCallbackQuery();

  if (confirmation.callbackQuery?.data === CallBackQueries.CANCEL_WITHDRAWAL) {
    await sendMessage(confirmation, "Withdrawal cancelled.");
    return conversation.halt();
  }

  if (confirmation.callbackQuery?.data === "confirm_funding_withdrawal") {
    try {
      await sendMessage(confirmation, "🔄 Processing withdrawal...");

      // Create and send transaction
      const fundingKeypair = secretKeyToKeypair(fundingWallet.privateKey);
      const destinationPubkey = new PublicKey(destinationAddress);
      
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: fundingKeypair.publicKey,
          toPubkey: destinationPubkey,
          lamports: Math.floor(withdrawAmount * LAMPORTS_PER_SOL),
        })
      );

      const signature = await connection.sendTransaction(transaction, [fundingKeypair]);
      await connection.confirmTransaction(signature, 'confirmed');

      await sendMessage(confirmation, `✅ <b>Withdrawal Successful!</b>

<b>Amount:</b> ${withdrawAmount.toFixed(6)} SOL
<b>Destination:</b> ${destinationLabel}
<b>Transaction:</b> <code>${signature}</code>

<i>🔗 View on Solscan: https://solscan.io/tx/${signature}</i>`, { parse_mode: "HTML" });

    } catch (error: any) {
      await sendMessage(confirmation, `❌ Withdrawal failed: ${error.message}`);
    }
  }

  conversation.halt();
}; 