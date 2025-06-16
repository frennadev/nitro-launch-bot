import bot from ".";
import type { Context } from "grammy";

export interface LoadingState {
  chatId: number;
  messageId: number;
  operation: string;
  startTime: number;
}

// Store active loading states
const activeLoadingStates = new Map<string, LoadingState>();

// Loading animations
const loadingFrames = ["⏳", "⌛", "⏳", "⌛"];
const progressFrames = ["🔄", "🔃", "🔄", "🔃"];
const processingFrames = ["⚡", "✨", "⚡", "✨"];

// Operation-specific messages
const operationMessages = {
  token_launch: {
    initial: "🚀 **Launching your token...**\n\n⏳ Preparing launch sequence...",
    phases: [
      "🔍 Validating token parameters...",
      "💰 Checking wallet balances...",
      "🏗️ Creating token on Pump.fun...",
      "💎 Executing dev buy...",
      "🛒 Distributing to buyer wallets...",
      "📊 Finalizing launch...",
    ],
    success: "🎉 **Token launched successfully!**",
    error: "❌ **Token launch failed**",
  },
  dev_sell: {
    initial: "💰 **Processing dev sell...**\n\n⏳ Preparing transaction...",
    phases: [
      "🔍 Validating sell parameters...",
      "💎 Calculating token amounts...",
      "📤 Executing sell transaction...",
      "✅ Confirming transaction...",
    ],
    success: "🎉 **Dev sell completed successfully!**",
    error: "❌ **Dev sell failed**",
  },
  wallet_sell: {
    initial: "💸 **Processing wallet sells...**\n\n⏳ Preparing transactions...",
    phases: [
      "🔍 Validating wallet holdings...",
      "💎 Calculating sell amounts...",
      "📤 Executing sell transactions...",
      "✅ Confirming transactions...",
    ],
    success: "🎉 **Wallet sells completed successfully!**",
    error: "❌ **Wallet sells failed**",
  },
  transaction: {
    initial: "📡 **Processing transaction...**\n\n⏳ Preparing...",
    phases: [
      "🔍 Validating transaction...",
      "📤 Broadcasting to network...",
      "⏰ Waiting for confirmation...",
    ],
    success: "✅ **Transaction confirmed!**",
    error: "❌ **Transaction failed**",
  },
};

/**
 * Start a loading state for a long-running operation
 */
export async function startLoadingState(
  ctx: Context,
  operation: keyof typeof operationMessages,
  identifier?: string
): Promise<string> {
  const chatId = ctx.chat!.id;
  const loadingKey = identifier ? `${chatId}-${operation}-${identifier}` : `${chatId}-${operation}`;
  
  const config = operationMessages[operation];
  const message = await ctx.reply(config.initial, { parse_mode: "Markdown" });
  
  const loadingState: LoadingState = {
    chatId,
    messageId: message.message_id,
    operation,
    startTime: Date.now(),
  };
  
  activeLoadingStates.set(loadingKey, loadingState);
  
  // Start animation
  startLoadingAnimation(loadingKey);
  
  return loadingKey;
}

/**
 * Update loading state with progress information
 */
export async function updateLoadingState(
  loadingKey: string,
  phase: number,
  customMessage?: string
): Promise<void> {
  const state = activeLoadingStates.get(loadingKey);
  if (!state) return;
  
  const config = operationMessages[state.operation as keyof typeof operationMessages];
  const phaseMessage = customMessage || config.phases[phase] || "Processing...";
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  
  const progressBar = generateProgressBar(phase, config.phases.length);
  const frame = processingFrames[Math.floor(Date.now() / 500) % processingFrames.length];
  
  const message = `🚀 **${state.operation.replace('_', ' ').toUpperCase()}**\n\n${frame} ${phaseMessage}\n\n${progressBar}\n\n⏱️ Elapsed: ${elapsed}s`;
  
  try {
    await bot.api.editMessageText(state.chatId, state.messageId, message, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    // Message might be too old to edit, ignore
    console.warn("Failed to update loading message:", error);
  }
}

/**
 * Complete loading state with success message
 */
export async function completeLoadingState(
  loadingKey: string,
  customSuccessMessage?: string,
  additionalInfo?: string
): Promise<void> {
  const state = activeLoadingStates.get(loadingKey);
  if (!state) return;
  
  const config = operationMessages[state.operation as keyof typeof operationMessages];
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  
  let message = customSuccessMessage || config.success;
  if (additionalInfo) {
    message += `\n\n${additionalInfo}`;
  }
  message += `\n\n⏱️ Completed in ${elapsed}s`;
  
  try {
    await bot.api.editMessageText(state.chatId, state.messageId, message, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    // If editing fails, send a new message
    await bot.api.sendMessage(state.chatId, message, { parse_mode: "Markdown" });
  }
  
  activeLoadingStates.delete(loadingKey);
}

/**
 * Fail loading state with error message
 */
export async function failLoadingState(
  loadingKey: string,
  errorMessage?: string,
  customFailMessage?: string
): Promise<void> {
  const state = activeLoadingStates.get(loadingKey);
  if (!state) return;
  
  const config = operationMessages[state.operation as keyof typeof operationMessages];
  const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
  
  let message = customFailMessage || config.error;
  if (errorMessage) {
    message += `\n\n📝 **Details:** ${errorMessage}`;
  }
  message += `\n\n⏱️ Failed after ${elapsed}s`;
  
  try {
    await bot.api.editMessageText(state.chatId, state.messageId, message, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    // If editing fails, send a new message
    await bot.api.sendMessage(state.chatId, message, { parse_mode: "Markdown" });
  }
  
  activeLoadingStates.delete(loadingKey);
}

/**
 * Start loading animation for a state
 */
function startLoadingAnimation(loadingKey: string): void {
  const animationInterval = setInterval(async () => {
    const state = activeLoadingStates.get(loadingKey);
    if (!state) {
      clearInterval(animationInterval);
      return;
    }
    
    const config = operationMessages[state.operation as keyof typeof operationMessages];
    const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    const frame = loadingFrames[Math.floor(Date.now() / 800) % loadingFrames.length];
    
    // Only show mixing message for token launch operations
    let message = `🚀 **${state.operation.replace('_', ' ').toUpperCase()}**\n\n${frame} Preparing launch sequence...\n\n⏱️ Elapsed: ${elapsed}s`;
    
    if (state.operation === 'token_launch') {
      message += `\n\n💡 *May take up to a minute dependent on your buy amount, we're trying to mix the funds and ensure it is untraceable*`;
    }
    
    try {
      await bot.api.editMessageText(state.chatId, state.messageId, message, {
        parse_mode: "Markdown",
      });
    } catch (error) {
      // Stop animation if we can't edit the message
      clearInterval(animationInterval);
    }
  }, 800);
  
  // Stop animation after 30 seconds to prevent infinite loops
  setTimeout(() => {
    clearInterval(animationInterval);
  }, 30000);
}

/**
 * Generate a progress bar
 */
function generateProgressBar(current: number, total: number): string {
  const percentage = Math.floor((current / total) * 100);
  const filled = Math.floor(percentage / 10);
  const empty = 10 - filled;
  
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `▓${bar}▓ ${percentage}%`;
}

/**
 * Send a simple loading message that auto-updates
 */
export async function sendLoadingMessage(
  ctx: Context,
  initialMessage: string,
  operation: string = "processing"
): Promise<{ messageId: number; update: (message: string) => Promise<void> }> {
  const sent = await ctx.reply(initialMessage, { parse_mode: "Markdown" });
  
  const update = async (message: string) => {
    try {
      await bot.api.editMessageText(ctx.chat!.id, sent.message_id, message, {
        parse_mode: "Markdown",
      });
    } catch (error) {
      console.warn("Failed to update loading message:", error);
    }
  };
  
  return { messageId: sent.message_id, update };
}

/**
 * Clean up any stale loading states
 */
export function cleanupStaleLoadingStates(): void {
  const now = Date.now();
  const staleThreshold = 10 * 60 * 1000; // 10 minutes
  
  for (const [key, state] of activeLoadingStates.entries()) {
    if (now - state.startTime > staleThreshold) {
      activeLoadingStates.delete(key);
    }
  }
}

// Clean up stale states every 5 minutes
setInterval(cleanupStaleLoadingStates, 5 * 60 * 1000); 