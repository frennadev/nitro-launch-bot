import mongoose, { ClientSession } from 'mongoose';
import { logger } from '../jobs/logger';

export interface SessionOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeoutMs?: number;
}

export class SessionManager {
  private static defaultOptions: Required<SessionOptions> = {
    maxRetries: 3,
    retryDelay: 1000,
    timeoutMs: 30000,
  };

  /**
   * Execute a function within a MongoDB transaction with proper session management
   */
  static async withTransaction<T>(
    operation: (session: ClientSession) => Promise<T>,
    options: SessionOptions = {}
  ): Promise<T> {
    const config = { ...this.defaultOptions, ...options };
    let session: ClientSession | null = null;
    let lastError: Error;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        session = await mongoose.startSession();
        
        // Set session timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Session timeout')), config.timeoutMs);
        });

        const operationPromise = session.withTransaction(async () => {
          return await operation(session!);
        });

        const result = await Promise.race([operationPromise, timeoutPromise]);
        return result;

      } catch (error: any) {
        lastError = error;
        
        // Log the error
        logger.error(`Session transaction failed (attempt ${attempt}/${config.maxRetries}):`, error);

        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          break;
        }

        // Wait before retry (except on last attempt)
        if (attempt < config.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, config.retryDelay * attempt));
        }

      } finally {
        // Always ensure session is closed
        if (session) {
          try {
            await session.endSession();
          } catch (closeError) {
            logger.error('Error closing session:', closeError);
          }
          session = null;
        }
      }
    }

    // If we get here, all retries failed
    logger.error(`Session transaction failed after ${config.maxRetries} attempts`);
    throw lastError!;
  }

  /**
   * Execute a function with a MongoDB session (without transaction)
   */
  static async withSession<T>(
    operation: (session: ClientSession) => Promise<T>,
    options: SessionOptions = {}
  ): Promise<T> {
    const config = { ...this.defaultOptions, ...options };
    let session: ClientSession | null = null;

    try {
      session = await mongoose.startSession();
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Session timeout')), config.timeoutMs);
      });

      const operationPromise = operation(session);
      const result = await Promise.race([operationPromise, timeoutPromise]);
      return result;

    } finally {
      if (session) {
        try {
          await session.endSession();
        } catch (closeError) {
          logger.error('Error closing session:', closeError);
        }
      }
    }
  }

  /**
   * Check if an error should not be retried
   */
  private static isNonRetryableError(error: any): boolean {
    const nonRetryableMessages = [
      'duplicate key error',
      'validation failed',
      'cast error',
      'document not found',
      'unauthorized',
      'forbidden',
    ];

    const errorMessage = error.message?.toLowerCase() || '';
    return nonRetryableMessages.some(msg => errorMessage.includes(msg));
  }

  /**
   * Get current session statistics
   */
  static getSessionStats() {
    return {
      activeConnections: mongoose.connection.readyState,
      connectionName: mongoose.connection.name,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
    };
  }
}

/**
 * Convenience function for transaction operations
 */
export const withTransaction = SessionManager.withTransaction.bind(SessionManager);

/**
 * Convenience function for session operations
 */
export const withSession = SessionManager.withSession.bind(SessionManager); 