import { MyContext } from "../types/context";
import { logger } from "../blockchain/common/logger";

export class MessageCleaner {
  static async deleteMessage(ctx: MyContext, messageId: number): Promise<void> {
    try {
      await ctx.telegram.deleteMessage(ctx?.from?.id!, messageId);
    } catch (error) {
      // console.log('error deleting message', error);
      logger.warn("Failed to delete message:", { messageId, error });
    }
  }

  /**
   * Sends a temporary message and returns the message_id.
   * The message will be deleted after the specified duration.
   * @param ctx The context object for the Telegram bot.
   * @param text The text message to send.
   * @param duration The duration in milliseconds before the message is deleted.
   * @returns A promise that resolves to the message_id of the sent message.
   */
  static async sendTemporaryMessage(
    ctx: MyContext,
    text: string,
    duration: number = 5000
  ): Promise<number> {
    try {
      const message = await ctx.reply(text, { parse_mode: "HTML" });

      setTimeout(() => {
        this.deleteMessage(ctx, message.message_id);
      }, duration);

      // Return the message_id as a promise resolution
      return message.message_id;
    } catch (error) {
      logger.error("Failed to send temporary message:", { error });
      return 0; // If failed, return undefined
    }
  }

  static async cleanupMessages(
    ctx: MyContext,
    messageIds: number[]
  ): Promise<void> {
    for (const messageId of messageIds) {
      await this.deleteMessage(ctx, messageId);
    }
  }
}

// Cleanup messages from the session
export async function cleanupMessages(
  ctx: MyContext,
  duration?: number
): Promise<void> {
  const sessionKeys = ["data", "BoostWizardData"];

  setTimeout(async () => {
    for (const key of sessionKeys) {
      const messageIds =
        ctx.session[key]?.messageIds ||
        ctx.session[key]?.wizardMessageIds ||
        [];
      // console.log('messageIds', messageIds);
      for (const msgId of messageIds) {
        try {
          // console.log('deleting message', msgId);
          // await MessageCleaner.deleteMessage(ctx, msgId);
          await ctx.telegram.deleteMessage(ctx?.from?.id!, msgId);
        } catch (error) {
          // Ignore deletion errors
        }
      }

      if (ctx.session[key]) {
        ctx.session[key].messageIds = [];
      }
    }
  }, duration);

  // Clear the message IDs for TokenWizardData
  if (ctx.session.TokenWizardData?.messageIds) {
    ctx.session.TokenWizardData.messageIds = [];
  }
}

// Cleanup sessions
export const STATEFUL_SESSIONS = ["referral", "BoostWizardData"] as const;

type SceneStates = {
  profile: { currentState: string; lastMenuMessageId: number };
  referral: {
    currentScene: string;
    previousScene?: string;
    inputData?: Record<string, any>;
  };
  // Add other scene state types
};

export const SCENE_STATES: Record<string, keyof SceneStates> = {
  referral: "referral",
  // Map commands to their state keys
  "/referral": "referral",
};

export function cleanupSessions(ctx: MyContext, command?: string): void {
  // General cleanup
  STATEFUL_SESSIONS.forEach((key) => {
    if (ctx.session[key]) {
      delete ctx.session[key];
    }
  });

  // Scene-specific cleanup
  if (command && SCENE_STATES[command]) {
    const stateKey = SCENE_STATES[command];
    ctx.session[stateKey] = {};
  }
}
