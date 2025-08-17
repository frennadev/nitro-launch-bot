import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { CallBackQueries } from "../types";
import { safeAnswerCallbackQuery } from "../utils";
import { sendFirstMessage } from "../../backend/sender";

// Market cap calculation function (same as in launchToken.ts)
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

export const predictMcConversation = async (
  conversation: Conversation<Context>,
  ctx: Context
): Promise<void> => {
  await safeAnswerCallbackQuery(ctx);

  // Get current SOL price for display
  const { getCurrentSolPrice } = await import("../../backend/utils");
  const currentSolPrice = await getCurrentSolPrice();

  // Calculate market caps for different buy amounts
  const buyAmounts = [5, 10, 20, 40];
  const pumpfunMcResults = await Promise.all(
    buyAmounts.map(async (amount) => ({
      amount,
      mc: await calculateExpectedMarketCap(amount, false),
    }))
  );

  const bonkMcResults = await Promise.all(
    buyAmounts.map(async (amount) => ({
      amount,
      mc: await calculateExpectedMarketCap(amount, true),
    }))
  );

  const message = `🔮 <b>Market Cap Predictor</b>
💎 <b>Current SOL Price:</b> $${currentSolPrice.toFixed(2)}

🚀 <b>PumpFun Estimates:</b>
${pumpfunMcResults.map((r) => `  ${r.amount} SOL → $${r.mc}`).join("\n")}

🟡 <b>Bonk.fun Estimates:</b>
${bonkMcResults.map((r) => `  ${r.amount} SOL → $${r.mc}`).join("\n")}

💡 <i>Estimates based on bonding curve mechanics</i>`;

  const keyboard = new InlineKeyboard()
    .text("💰 Custom Amount", "custom_mc_amount")
    .text("🔙 Back", CallBackQueries.BACK);

  await sendFirstMessage(ctx, message, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });

  while (true) {
    const response = await conversation.waitFor("callback_query");
    await safeAnswerCallbackQuery(response);

    const data = response.callbackQuery!.data;

    if (data === CallBackQueries.BACK) {
      // Import and start main menu conversation
      const mainMenuConversation = await import("./mainMenu");
      return await mainMenuConversation.default(conversation, response);
    }

    if (data === "custom_mc_amount") {
      await response.reply(
        "💰 **Enter your buy amount in SOL:**\n\n*Example: 15, 25.5, 50*",
        { parse_mode: "Markdown" }
      );

      const amountResponse = await conversation.waitFor("message:text");
      const amountText = amountResponse.message!.text!.trim();
      const amount = parseFloat(amountText);

      if (isNaN(amount) || amount <= 0) {
        await response.reply("❌ Please enter a valid positive number.");
        continue;
      }

      if (amount > 100) {
        await response.reply(
          "⚠️ Maximum buy amount is 100 SOL for estimation."
        );
        continue;
      }

      // Calculate custom amounts
      const pumpfunMc = await calculateExpectedMarketCap(amount, false);
      const bonkMc = await calculateExpectedMarketCap(amount, true);

      const customMessage = `
💰 <b>Custom Amount Results</b>

<b>Buy Amount:</b> ${amount} SOL
<b>Current SOL Price:</b> $${currentSolPrice.toFixed(2)}

📊 <b>Estimated Market Caps:</b>
🚀 <b>PumpFun:</b> $${pumpfunMc}
🟡 <b>Bonk.fun:</b> $${bonkMc}

💡 <i>These are estimates based on bonding curve progression</i>`;

      const customKeyboard = new InlineKeyboard()
        .text("💰 Another Amount", "custom_mc_amount")
        .row()
        .text("🔙 Back to Predictor", "back_to_predictor")
        .text("🔙 Main Menu", CallBackQueries.BACK);

      await response.reply(customMessage, {
        parse_mode: "HTML",
        reply_markup: customKeyboard,
      });

      // Wait for next action
      const nextResponse = await conversation.waitFor("callback_query");
      await safeAnswerCallbackQuery(nextResponse);

      const nextData = nextResponse.callbackQuery!.data;

      if (nextData === CallBackQueries.BACK) {
        // Import and start main menu conversation
        const mainMenuConversation = await import("./mainMenu");
        return await mainMenuConversation.default(conversation, nextResponse);
      }

      if (nextData === "back_to_predictor") {
        // Restart the conversation to show the main predictor
        return await predictMcConversation(conversation, nextResponse);
      }

      if (nextData === "custom_mc_amount") {
        // Continue the loop to ask for another amount
        continue;
      }
    }
  }
};
