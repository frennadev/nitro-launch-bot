import { type Conversation } from "@grammyjs/conversations";
import { type Context } from "grammy";
import { InlineKeyboard } from "grammy";
import {
  createToken,
  getUser,
  getDefaultDevWallet,
  getOrCreateFundingWallet,
} from "../../backend/functions";
import { createBonkToken } from "../../blockchain/letsbonk/integrated-token-creator";
import axios from "axios";
import { CallBackQueries } from "../types";
import { sendLoadingMessage } from "../loading";
import { sendErrorWithAutoDelete } from "../utils";
import { sendMessage } from "../../backend/sender";
import { fetchTokenMetadata, TokenMetadataResponse } from "../token-metadata";
import { PublicKey } from "@solana/web3.js";

const cancelKeyboard = new InlineKeyboard().text(
  "❌ Cancel",
  CallBackQueries.BACK
);

const relaunchTokenConversation = async (
  conversation: Conversation,
  ctx: Context,
  data: {
    mode: string;
    tokenAddress: string;
  }
) => {
  await ctx.answerCallbackQuery();
  const user = await getUser(ctx.chat!.id.toString());
  if (!user) {
    await sendErrorWithAutoDelete(ctx, "Unrecognized user ❌");
    return conversation.halt();
  }

  // === 1) Ask for launch mode first ===
  const modeKeyboard = new InlineKeyboard()
    .text("🎉 PumpFun", CallBackQueries.PUMPFUN)
    .row()
    .text("🚀 LetsBonk", CallBackQueries.LETSBONK)
    .row()
    .text("❌ Cancel", CallBackQueries.BACK);
  const tokenAddress = data.tokenAddress;
  const tokenMetadata = await fetchTokenMetadata(new PublicKey(tokenAddress));

  await sendMessage(
    ctx,
    `🔄 <b>Relaunch Existing Token</b>\n\n` +
      `📋 <b>Token Information</b>\n` +
      `\n` +
      `🏷️ <b>Name:</b> <code>${tokenMetadata?.name || "Unknown"}</code>\n` +
      `🔤 <b>Symbol:</b> <code>${tokenMetadata?.symbol || "Unknown"}</code>\n` +
      `📝 <b>Description:</b> ${tokenMetadata?.description || "No description available"}\n` +
      `💰 <b>Total Supply:</b> <code>${tokenMetadata?.supply ? tokenMetadata.supply.toLocaleString() : "Unknown"}</code>\n` +
      `🔢 <b>Decimals:</b> <code>${tokenMetadata?.decimals || "Unknown"}</code>\n` +
      `📍 <b>Contract Address:</b>\n<code>${tokenAddress}</code>\n` +
      `📅 <b>Created On:</b> <code>${tokenMetadata?.createdOn || "Unknown"}</code>\n` +
      `\n` +
      `🔗 <b>Image:</b> ${tokenMetadata?.image ? `<a href="${tokenMetadata.image}">View Image</a>` : "No image available"}\n` +
      `\n` +
      `ℹ️ <b>Note:</b> You can relaunch your token on either PumpFun or LetsBonk.\n` +
      `\n` +
      `🚀 <b>Choose your launch platform:</b>`,
    {
      parse_mode: "HTML",
      reply_markup: modeKeyboard,
    }
  );

  let mode: CallBackQueries.PUMPFUN | CallBackQueries.LETSBONK;
  while (true) {
    const modeUpd = await conversation.wait();
    const data = modeUpd.callbackQuery?.data;
    if (!data || data === CallBackQueries.BACK) {
      if (data === CallBackQueries.BACK) {
        await modeUpd.answerCallbackQuery();
        await sendMessage(ctx, "Token creation cancelled.");
      }
      return conversation.halt();
    }
    await modeUpd.answerCallbackQuery();
    if (data === CallBackQueries.PUMPFUN) {
      mode = CallBackQueries.PUMPFUN;
      await modeUpd.reply("✅ Launch mode set to <b>PumpFun</b>.", {
        parse_mode: "HTML",
      });
      break;
    }
    if (data === CallBackQueries.LETSBONK) {
      mode = CallBackQueries.LETSBONK;
      await modeUpd.reply("✅ Launch mode set to <b>LetsBonk</b>.", {
        parse_mode: "HTML",
      });
      break;
    }
  }

  // === 2) Now send the token‐details prompt and wallet instructions ===
  const devWalletAddress = await getDefaultDevWallet(user.id);
  const fundingWalletAddress = await getOrCreateFundingWallet(user.id);

  await sendMessage(
    ctx,
    "🚀 <b>Token Launch Setup Instructions</b>\n\n" +
      "📝 Please send your token details as <b>name, symbol, description</b>, separated by commas.\n" +
      "<i>Example: <code>TokenName,TKN,My great token</code></i>\n\n" +
      "<b>Launch Instructions:</b>\n" +
      "🤖 Fund dev wallet with a minimum of <b>0.15 SOL</b> + your desired dev‐buy amount (optional)\n" +
      `<code>${devWalletAddress}</code>\n\n` +
      "💰 Fund your funding wallet with buyer amount + <b>0.1 SOL</b>\n" +
      `<code>${fundingWalletAddress}</code>\n`,
    { parse_mode: "HTML", reply_markup: cancelKeyboard }
  );

  // === 3) Collect name,symbol,description ===

  const { name, symbol, description } = tokenMetadata as TokenMetadataResponse;

  let twitter: string = "";
  let telegram: string = "";
  let website: string = "";

  // Ask for all socials with smart detection
  await sendMessage(
    ctx,
    "🌐 <b>Smart Link Detection</b> (Optional)\n\n" +
      "🚀 <b>Just paste your links!</b> I'll automatically detect and organize them:\n" +
      "• 🐦 Twitter/X links (twitter.com, x.com, @username)\n" +
      "• 💬 Telegram links (t.me, @channel)\n" +
      "• 🌐 Website links (any domain)\n\n" +
      "<i>Examples that work:</i>\n" +
      "• <code>https://x.com/mytoken @mytelegram mywebsite.com</code>\n" +
      "• <code>@myhandle, t.me/mychannel, website.io</code>\n" +
      "• <code>twitter.com/user telegram.me/group https://site.com</code>\n\n" +
      "Type 'skip' to leave all blank.",
    { parse_mode: "HTML", reply_markup: cancelKeyboard }
  );

  while (true) {
    const upd = await conversation.wait();
    if (upd.callbackQuery?.data === CallBackQueries.BACK) {
      await upd.answerCallbackQuery();
      await sendMessage(ctx, "Token creation cancelled.");
      return conversation.halt();
    }
    if (upd.message?.text) {
      const text = upd.message.text.trim();

      // Import smart link detector
      const { SmartLinkDetector } = await import(
        "../../utils/smart-link-detector"
      );

      // Use smart detection
      const detectionResult = SmartLinkDetector.detectAndCategorizeLinks(text);

      if (detectionResult.success || text.toLowerCase() === "skip") {
        // Assign detected links
        twitter = detectionResult.links.twitter;
        telegram = detectionResult.links.telegram;
        website = detectionResult.links.website;

        // Show confirmation message
        if (detectionResult.success) {
          await sendMessage(ctx, detectionResult.message, {
            parse_mode: "Markdown",
            reply_markup: cancelKeyboard,
          });
        }

        break;
      } else {
        // Show error and ask again
        await sendMessage(
          ctx,
          `❌ <b>Link Detection Failed</b>\n\n${detectionResult.message}\n\n` +
            "Please try again with valid links or type 'skip' to continue without links.",
          { parse_mode: "HTML", reply_markup: cancelKeyboard }
        );
        continue;
      }
    }
  }

  // === 4) Ask for image upload ===
  //   await sendMessage(ctx, "Upload an image for your token (max 20 MB):", {
  //     reply_markup: cancelKeyboard,
  //   });

  //   let fileCtx;
  //   while (true) {
  //     const upd = await conversation.wait();
  //     if (upd.callbackQuery?.data === CallBackQueries.BACK) {
  //       await upd.answerCallbackQuery();
  //       await sendMessage(ctx, "Token creation cancelled.");
  //       return conversation.halt();
  //     }
  //     if (upd.message?.photo) {
  //       fileCtx = upd;
  //       break;
  //     }
  //   }

  //   const file = await fileCtx.getFile();
  //   if ((file.file_size ?? 0) > 20 * 1024 * 1024) {
  //     await sendMessage(ctx, "Image too large. Please start over.");
  //     return conversation.halt();
  //   }

  //   const imageUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const imageUrl = tokenMetadata?.image;
  let fileData: ArrayBuffer;

  try {
    const { data } = await axios.get<ArrayBuffer>(imageUrl!, {
      responseType: "arraybuffer",
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    fileData = data;
  } catch (error) {
    console.error("Failed to fetch image from IPFS:", error);
    // Use a fallback empty buffer or skip image processing
    fileData = new ArrayBuffer(0);
  }
  console.log(fileData);

  // === 5) Create token based on mode and show result ===
  const { update } = await sendLoadingMessage(
    ctx,
    "🔄 <b>Creating your token...</b>\n\n⏳ Processing image and metadata..."
  );

  let token: any;
  if (mode === CallBackQueries.PUMPFUN) {
    token = await createToken(user.id, name, symbol, description, fileData, {
      website,
      telegram,
      twitter,
    });
  } else {
    token = await createBonkToken(name, symbol, imageUrl!, true, user.id, {
      website,
      telegram,
      twitter,
    });
  }

  if (mode === CallBackQueries.PUMPFUN) {
    await update(
      `🎉 <b>Token Created Successfully!</b>\n\n✅ Your PumpFun token is ready to launch!\n\n<b>Token Address:</b> <code>${token.tokenAddress}</code>`
    );

    const launchKb = new InlineKeyboard().text(
      "🚀 Launch Token",
      `${CallBackQueries.LAUNCH_TOKEN}_${token.tokenAddress}`
    );

    let socialsInfo = "";
    const socialLinks = [];
    if (twitter) {
      socialLinks.push(`🐦 <a href="${twitter}">X (Twitter)</a>`);
    }
    if (telegram) {
      socialLinks.push(`💬 <a href="${telegram}">Telegram</a>`);
    }
    if (website) {
      socialLinks.push(`🌐 <a href="${website}">Website</a>`);
    }
    if (socialLinks.length > 0) {
      socialsInfo = socialLinks.join(" | ") + "\n";
    }
    await ctx.reply(
      `🎉 <b>Token Created Successfully!</b>
🚀 <b>Platform:</b> <code>PumpFun</code>

📊 <b>Token Details:</b>
💎 <b>Name:</b> <code>${name}</code>
🏷️ <b>Symbol:</b> <code>${symbol}</code>
📝 <b>Description:</b> ${description}
🔗 <b>Contract Address:</b> <code>${token.tokenAddress}</code>

${socialsInfo ? `🌐 <b>Social Links:</b>\n${socialsInfo}` : ""}

✅ <b>Status:</b> Ready for launch on PumpFun! 🚀`,
      { parse_mode: "HTML", reply_markup: launchKb }
    );
  } else {
    await update(
      `🎉 <b>Token Created Successfully!</b>\n\n✅ Your LetsBonk token is ready to launch!\n\n<b>Token Address:</b> <code>${token.tokenAddress}</code>`
    );

    const launchKb = new InlineKeyboard().text(
      "🚀 Launch Token",
      `${CallBackQueries.LAUNCH_TOKEN}_${token.tokenAddress}`
    );

    let socialsInfo = "";
    const socialLinks = [];
    if (twitter) {
      socialLinks.push(`🐦 <a href="${twitter}">X (Twitter)</a>`);
    }
    if (telegram) {
      socialLinks.push(`💬 <a href="${telegram}">Telegram</a>`);
    }
    if (website) {
      socialLinks.push(`🌐 <a href="${website}">Website</a>`);
    }
    if (socialLinks.length > 0) {
      socialsInfo = socialLinks.join(" | ") + "\n";
    }
    await ctx.reply(
      `🎉 <b>Token Created Successfully!</b>
🚀 <b>Platform:</b> <code>LetsBonk</code>

📊 <b>Token Details:</b>
💎 <b>Name:</b> <code>${name}</code>
🏷️ <b>Symbol:</b> <code>${symbol}</code>
📝 <b>Description:</b> ${description}
🔗 <b>Contract Address:</b> <code>${token.tokenAddress}</code>

${socialsInfo ? `🌐 <b>Social Links:</b>\n${socialsInfo}` : ""}

✅ <b>Status:</b> Ready for launch on LetsBonk! 🚀`,
      { parse_mode: "HTML", reply_markup: launchKb }
    );

    conversation.halt();
  }
};

export default relaunchTokenConversation;
