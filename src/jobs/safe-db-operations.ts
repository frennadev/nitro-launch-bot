/**
 * Database operation utilities to ensure connection before operations
 * This prevents "bufferCommands = false" errors
 */

import { ensureDBConnection, isDBConnected } from "./db";
import { logger } from "./logger";

/**
 * Wrapper for database operations that ensures connection is ready
 * Use this for any Mongoose operations when bufferCommands = false
 */
export async function safeDBOperation<T>(
  operation: () => Promise<T>,
  operationName: string = "database operation"
): Promise<T> {
  try {
    // Ensure database connection is ready
    if (!isDBConnected()) {
      logger.info(
        `Database not connected, connecting before ${operationName}...`
      );
      await ensureDBConnection();
    }

    // Perform the operation
    return await operation();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if it's a connection error
    if (
      errorMessage.includes("bufferCommands = false") ||
      errorMessage.includes("before initial connection")
    ) {
      logger.warn(`Connection issue during ${operationName}, retrying...`);

      // Retry with fresh connection
      await ensureDBConnection();
      return await operation();
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Specific wrapper for Token model operations
 */
export async function safeTokenOperation<T>(
  operation: () => Promise<T>
): Promise<T> {
  return safeDBOperation(operation, "token operation");
}

/**
 * Specific wrapper for User model operations
 */
export async function safeUserOperation<T>(
  operation: () => Promise<T>
): Promise<T> {
  return safeDBOperation(operation, "user operation");
}

/**
 * Specific wrapper for Wallet model operations
 */
export async function safeWalletOperation<T>(
  operation: () => Promise<T>
): Promise<T> {
  return safeDBOperation(operation, "wallet operation");
}
