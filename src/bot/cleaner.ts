import { Context } from "grammy";

export class MessageCleaner {
  private ctx: Context;
  private editableMessageId: number | null = null;

  constructor(ctx: Context) {
    this.ctx = ctx;
  }

  /** Deletes the user's last message */
  async deleteUserMessage(messageId?: number) {
    try {
      const msgId = messageId || this.ctx.message?.message_id;
      if (msgId && this.ctx.chat) {
        await this.ctx.api.deleteMessage(this.ctx.chat.id, msgId);
      }
    } catch (err) {
      console.warn("Failed to delete user message:", err);
    }
  }

  /** Sends a single editable message (used across conversation steps) */
  async sendOrEdit(text: string) {
    try {
      if (this.editableMessageId && this.ctx.chat) {
        await this.ctx.api.editMessageText(
          this.ctx.chat.id,
          this.editableMessageId,
          text
        );
      } else {
        const sent = await this.ctx.reply(text);
        this.editableMessageId = sent.message_id;
      }
    } catch (err) {
      console.warn("Failed to send or edit message:", err);
    }
  }

  /** Sends a temporary message that deletes itself after N ms */
  async sendTemporary(text: string, timeout = 5000) {
    const sent = await this.ctx.reply(text);
    setTimeout(() => {
      if (this.ctx.chat) {
        this.ctx.api
          .deleteMessage(this.ctx.chat.id, sent.message_id)
          .catch(() => {});
      }
    }, timeout);
  }

  /** Resets internal state (e.g., if conversation ends) */
  reset() {
    this.editableMessageId = null;
  }

  async deleteMessage(msgId: number) {
    try {
      if (this.ctx.chat) {
        await this.ctx.api.deleteMessage(this.ctx.chat.id, msgId);
      }
    } catch (error) {
      // Silently ignore deletion errors (message might already be deleted)
    }
  }

  async deleteMessages(msgIds: number[]) {
    for (const msgId of msgIds) {
      try {
        if (this.ctx.chat) {
          await this.ctx.api.deleteMessage(this.ctx.chat.id, msgId);
        }
      } catch (error) {
        // Silently ignore deletion errors
      }
    }
  }

  async deleteMessageAfterDelay(msgId: number, delayMs: number = 10000) {
    setTimeout(async () => {
      try {
        if (this.ctx.chat) {
          await this.ctx.api.deleteMessage(this.ctx.chat.id, msgId);
        }
      } catch (error) {
        // Silently ignore deletion errors
      }
    }, delayMs);
  }
}
