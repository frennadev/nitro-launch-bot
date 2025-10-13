import { decryptPrivateKey } from "./utils";
import { logger } from "../jobs/logger";

export interface WalletDecryptionResult {
  success: boolean;
  privateKey?: string;
  error?: string;
}

/**
 * Safely decrypt a wallet private key with retry logic
 * Handles transient errors that might occur during high load
 */
export async function safeDecryptPrivateKey(
  encryptedPrivateKey: string,
  walletId: string,
  maxRetries = 3,
  retryDelay = 100
): Promise<WalletDecryptionResult> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const decryptedKey = decryptPrivateKey(encryptedPrivateKey);
      return {
        success: true,
        privateKey: decryptedKey,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (attempt === maxRetries) {
        logger.error(
          `Failed to decrypt wallet ${walletId} after ${maxRetries} attempts: ${errorMsg}`
        );
        return {
          success: false,
          error: `Decryption failed after ${maxRetries} attempts: ${errorMsg}`,
        };
      }

      logger.warn(
        `Decrypt attempt ${attempt}/${maxRetries} failed for wallet ${walletId}: ${errorMsg}. Retrying...`
      );

      // Add exponential backoff delay
      await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
    }
  }

  // Should never reach here, but TypeScript requires it
  return {
    success: false,
    error: "Unexpected error in decryption retry logic",
  };
}

/**
 * Decrypt multiple wallet private keys with individual error handling
 * Continues processing even if some wallets fail
 */
export async function safeDecryptWalletBatch(
  wallets: Array<{ _id: string; privateKey: string }>,
  walletType: string = "wallet"
): Promise<{
  success: boolean;
  privateKeys: string[];
  errors: Array<{ walletId: string; error: string }>;
}> {
  const privateKeys: string[] = [];
  const errors: Array<{ walletId: string; error: string }> = [];

  logger.info(`Decrypting ${wallets.length} ${walletType} private keys...`);

  for (const wallet of wallets) {
    if (!wallet.privateKey) {
      const error = `${walletType} ${wallet._id} has no privateKey field`;
      logger.error(error);
      errors.push({ walletId: wallet._id.toString(), error });
      continue;
    }

    const result = await safeDecryptPrivateKey(
      wallet.privateKey,
      wallet._id.toString()
    );

    if (result.success && result.privateKey) {
      privateKeys.push(result.privateKey);
    } else {
      errors.push({
        walletId: wallet._id.toString(),
        error: result.error || "Unknown decryption error",
      });
    }
  }

  const success = errors.length === 0;
  if (success) {
    logger.info(
      `✅ Successfully decrypted all ${wallets.length} ${walletType}s`
    );
  } else {
    logger.warn(
      `⚠️  Decrypted ${privateKeys.length}/${wallets.length} ${walletType}s. ${errors.length} failed.`
    );
  }

  return {
    success,
    privateKeys,
    errors,
  };
}
