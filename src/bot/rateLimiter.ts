import { Context, type MiddlewareFn } from "grammy";
import { logger } from "../blockchain/common/logger";

// Rate limit configuration
interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  message?: string; // Custom message for rate limit exceeded
  skipSuccessfulRequests?: boolean; // Skip counting successful requests
  skipFailedRequests?: boolean; // Skip counting failed requests
}

// Default rate limit configurations - ALL LIMITS REMOVED
const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  // General commands (start, menu, etc.)
  general: {
    windowMs: 1000, // 1 second window
    maxRequests: 999999, // Effectively unlimited
    message: "⚠️ Too many requests. Please wait a moment before trying again.",
  },
  
  // Token creation and launching (resource intensive)
  token_operations: {
    windowMs: 1000, // 1 second window
    maxRequests: 999999, // Effectively unlimited
    message: "⚠️ Token operations are rate limited. Please wait 1 minute between launches.",
  },
  
  // Wallet operations (sensitive operations)
  wallet_operations: {
    windowMs: 1000, // 1 second window
    maxRequests: 999999, // Effectively unlimited
    message: "⚠️ Wallet operations are rate limited. Please wait 5 seconds between operations.",
  },
  
  // Trading operations (high frequency potential)
  trading_operations: {
    windowMs: 1000, // 1 second window
    maxRequests: 999999, // Effectively unlimited
    message: "⚠️ Trading operations are rate limited. Please wait 10 seconds between trades.",
  },
  
  // Admin commands (very sensitive)
  admin_operations: {
    windowMs: 1000, // 1 second window
    maxRequests: 999999, // Effectively unlimited
    message: "⚠️ Admin operations are rate limited. Please wait 10 seconds between commands.",
  },
  
  // Message handling (token addresses, etc.)
  message_handling: {
    windowMs: 1000, // 1 second window
    maxRequests: 999999, // Effectively unlimited
    message: "⚠️ Too many messages. Please wait 10 seconds before sending another.",
  },
  
  // Callback queries (button clicks)
  callback_queries: {
    windowMs: 1000, // 1 second window
    maxRequests: 999999, // Effectively unlimited
    message: "⚠️ Too many button clicks. Please wait 5 seconds before trying again.",
  },
};

// In-memory storage for rate limiting (in production, use Redis)
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Create a rate limiting middleware
 */
export function createRateLimiter(config: RateLimitConfig): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return next();
    }

    const key = `rate_limit:${userId}`;
    const now = Date.now();
    
    // Get or create rate limit entry
    let entry = rateLimitStore.get(key);
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + config.windowMs,
      };
      rateLimitStore.set(key, entry);
    }

    // Check if rate limit exceeded
    if (entry.count >= config.maxRequests) {
      const remainingTime = Math.ceil((entry.resetTime - now) / 1000);
      const message = config.message || `⚠️ Rate limit exceeded. Please wait ${remainingTime} seconds.`;
      
      logger.warn("Rate limit exceeded", {
        userId,
        username: ctx.from?.username,
        count: entry.count,
        maxRequests: config.maxRequests,
        remainingTime,
        command: ctx.message?.text || ctx.callbackQuery?.data,
      });

      try {
        await ctx.reply(message);
      } catch (error) {
        logger.error("Failed to send rate limit message:", error);
      }
      
      return; // Stop execution
    }

    // Increment counter
    entry.count++;

    // Continue to next middleware
    return next();
  };
}

/**
 * Rate limiting middleware for specific command types
 */
export function rateLimitByType(type: keyof typeof DEFAULT_RATE_LIMITS): MiddlewareFn<Context> {
  const config = DEFAULT_RATE_LIMITS[type];
  if (!config) {
    logger.warn(`Unknown rate limit type: ${type}`);
    return (ctx, next) => next();
  }
  
  return createRateLimiter(config);
}

/**
 * Rate limiting middleware for commands
 */
export function rateLimitCommands(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const command = ctx.message?.text?.split(' ')[0];
    
    if (!command) {
      return next();
    }

    // Determine rate limit type based on command
    let rateLimitType: keyof typeof DEFAULT_RATE_LIMITS = 'general';
    
    if (command.startsWith('/admin') || command.startsWith('/markused') || command.startsWith('/removetoken')) {
      rateLimitType = 'admin_operations';
    } else if (command.startsWith('/start') || command.startsWith('/menu')) {
      rateLimitType = 'general';
    } else if (command.startsWith('/directlaunch') || command.startsWith('/reset') || command.startsWith('/forcefix')) {
      rateLimitType = 'token_operations';
    }

    const config = DEFAULT_RATE_LIMITS[rateLimitType];
    const rateLimiter = createRateLimiter(config);
    
    return rateLimiter(ctx, next);
  };
}

/**
 * Rate limiting middleware for callback queries
 */
export function rateLimitCallbacks(): MiddlewareFn<Context> {
  return rateLimitByType('callback_queries');
}

/**
 * Rate limiting middleware for messages (token addresses, etc.)
 */
export function rateLimitMessages(): MiddlewareFn<Context> {
  return rateLimitByType('message_handling');
}

/**
 * Rate limiting middleware for token operations
 */
export function rateLimitTokenOperations(): MiddlewareFn<Context> {
  return rateLimitByType('token_operations');
}

/**
 * Rate limiting middleware for wallet operations
 */
export function rateLimitWalletOperations(): MiddlewareFn<Context> {
  return rateLimitByType('wallet_operations');
}

/**
 * Rate limiting middleware for trading operations
 */
export function rateLimitTradingOperations(): MiddlewareFn<Context> {
  return rateLimitByType('trading_operations');
}

/**
 * Get rate limit status for a user (for debugging)
 */
export function getRateLimitStatus(userId: number): {
  general: { count: number; remaining: number; resetTime: number };
  token_operations: { count: number; remaining: number; resetTime: number };
  wallet_operations: { count: number; remaining: number; resetTime: number };
  trading_operations: { count: number; remaining: number; resetTime: number };
  admin_operations: { count: number; remaining: number; resetTime: number };
} {
  const now = Date.now();
  const result: any = {};

  for (const [type, config] of Object.entries(DEFAULT_RATE_LIMITS)) {
    const key = `rate_limit:${userId}`;
    const entry = rateLimitStore.get(key);
    
    if (entry && now <= entry.resetTime) {
      result[type] = {
        count: entry.count,
        remaining: Math.max(0, config.maxRequests - entry.count),
        resetTime: entry.resetTime,
      };
    } else {
      result[type] = {
        count: 0,
        remaining: config.maxRequests,
        resetTime: now + config.windowMs,
      };
    }
  }

  return result;
}

/**
 * Reset rate limits for a user (admin function)
 */
export function resetRateLimits(userId: number): boolean {
  const key = `rate_limit:${userId}`;
  return rateLimitStore.delete(key);
}

/**
 * Get rate limit statistics (admin function)
 */
export function getRateLimitStats(): {
  totalEntries: number;
  activeUsers: number;
  memoryUsage: number;
} {
  const now = Date.now();
  let activeUsers = 0;
  
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now <= entry.resetTime) {
      activeUsers++;
    }
  }

  return {
    totalEntries: rateLimitStore.size,
    activeUsers,
    memoryUsage: process.memoryUsage().heapUsed,
  };
} 