import {
  enqueueWalletSell,
  getUser,
  getUserTokenWithBuyWallets,
} from "../backend/functions";
import { TokenState } from "../backend/types";
import { decryptPrivateKey } from "../backend/utils";
import { connectDB } from "./db";

const walletSellConversation = async (
  tokenAddress: string,
  sellPercent: number
) => {
  await connectDB();
  // --------- VALIDATE USER ---------
  const user = await getUser("5676818477");
  if (!user) {
    console.log("Unrecognized user ❌");
    return;
  }

  // -------- VALIDATE TOKEN ----------
  const token = await getUserTokenWithBuyWallets(user.id, tokenAddress);
  if (!token) {
    console.log("Token not found ❌");
    return;
  }
  if (token.state !== TokenState.LAUNCHED) {
    console.log("Token is not launched yet 😑");
    return;
  }
  if (token.launchData?.lockWalletSell === true) {
    console.log("Wallet sell job is currently processing");
    return;
  }

  // ------ SEND WALLET SELL DATA TO QUEUE WITH LOADING STATE -----
  console.log(
    "💸 **Submitting wallet sells...**\n\n⏳ Preparing transactions..."
  );

  try {
    // FIXED: Properly decrypt private keys from populated wallet documents
    const buyWallets = token.launchData!.buyWallets.map((wallet: any) => {
      if (!wallet.privateKey) {
        throw new Error("Wallet private key not found in database");
      }
      return decryptPrivateKey(wallet.privateKey);
    });

    // FIXED: Properly decrypt dev wallet private key
    const devWalletPrivateKey = decryptPrivateKey(
      (token.launchData!.devWallet! as any).privateKey
    );

    console.log(
      "Submitting wallet sell job with data:",
      buyWallets,
      devWalletPrivateKey,
      sellPercent
    );

    // const result = await enqueueWalletSell(
    //   user.id,
    //   Number(user.telegramId),
    //   tokenAddress,
    //   devWalletPrivateKey,
    //   buyWallets,
    //   sellPercent
    // );

    // if (!result.success) {
    //   console.log(
    //     "❌ **Failed to submit wallet sells**\n\nAn error occurred while submitting wallet sell details for execution. Please try again."
    //   );
    //   console.log(
    //     "An error occurred while submitting wallet sell details for execution ❌. Please try again.."
    //   );
    // } else {
    //   console.log(
    //     "🎉 **Wallet sells submitted successfully!**\n\n⏳ Your wallet sells are now in the queue and will be processed shortly.\n\n📱 You'll receive a notification once the sells are completed."
    //   );
    // }
  } catch (error: any) {
    console.log(
      "❌ **Failed to decrypt wallet keys**\n\nThere was an issue accessing your wallet data. Please try again."
    );
  }
};

walletSellConversation("FsVKLfQcjthDsStgDyV9CTGKPHAYdYRzoeBkWM4Hbonk", 100)
  .then(() => console.log("Wallet sell conversation completed"))
  .catch((error) => console.error("Error in wallet sell conversation:", error));
