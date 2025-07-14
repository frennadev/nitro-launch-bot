import { createLogger, format, transports, Logger } from "winston";
import { env } from "../config";

const { combine, timestamp, errors, json, printf, colorize } = format;

// Base log format with consistent structure
const baseFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  errors({ stack: true }),
  json()
);

// Console format for development
const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss.SSS' }),
  printf(({ timestamp, level, message, service, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${service}] ${level}: ${message}${metaStr}`;
  })
);

// Performance tracking helper
export class PerformanceTimer {
  private startTime: number;
  private logger: Logger;
  private context: string;

  constructor(logger: Logger, context: string) {
    this.logger = logger;
    this.context = context;
    this.startTime = performance.now();
  }

  end(message?: string): number {
    const duration = performance.now() - this.startTime;
    this.logger.info(message || `${this.context} completed`, {
      duration: `${duration.toFixed(2)}ms`,
      context: this.context
    });
    return duration;
  }

  checkpoint(step: string): number {
    const duration = performance.now() - this.startTime;
    this.logger.debug(`${this.context} - ${step}`, {
      duration: `${duration.toFixed(2)}ms`,
      step,
      context: this.context
    });
    return duration;
  }
}

// Create separate loggers for different services
const createServiceLogger = (serviceName: string): Logger => {
  const isDevelopment = env.NODE_ENV === 'development';
  
  const logger = createLogger({
    level: isDevelopment ? 'debug' : 'info',
    format: baseFormat,
    defaultMeta: { service: serviceName },
    transports: [
      // Console transport for all environments
      new transports.Console({
        format: isDevelopment ? consoleFormat : baseFormat,
        level: isDevelopment ? 'debug' : 'info'
      })
    ],
    exitOnError: false,
    // Prevent duplicate logs
    silent: false
  });

  // Add performance timer helper
  (logger as any).timer = (context: string) => new PerformanceTimer(logger, context);

  // Add structured logging helpers
  (logger as any).user = (userId: string, message: string, meta: any = {}) => {
    logger.info(message, { userId, ...meta });
  };

  (logger as any).transaction = (txId: string, message: string, meta: any = {}) => {
    logger.info(message, { transactionId: txId, ...meta });
  };

  (logger as any).token = (tokenAddress: string, message: string, meta: any = {}) => {
    logger.info(message, { tokenAddress, ...meta });
  };

  return logger;
};

// Export service-specific loggers
export const botLogger = createServiceLogger('bot');
export const jobLogger = createServiceLogger('job');
export const blockchainLogger = createServiceLogger('blockchain');
export const dbLogger = createServiceLogger('database');
export const apiLogger = createServiceLogger('api');

// Convenience exports for backwards compatibility
export const logger = botLogger; // Default to bot logger

// Helper function to clean up console.log statements
export const replaceConsoleLog = () => {
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  console.log = (...args: any[]) => {
    botLogger.debug('Console log (should be replaced)', { args });
  };

  console.warn = (...args: any[]) => {
    botLogger.warn('Console warn (should be replaced)', { args });
  };

  console.error = (...args: any[]) => {
    botLogger.error('Console error (should be replaced)', { args });
  };

  // Return function to restore original console methods
  return () => {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  };
};

// Log system health check
export const logSystemHealth = () => {
  botLogger.info('🚀 Logging system initialized', {
    environment: env.NODE_ENV,
    services: ['bot', 'job', 'blockchain', 'database', 'api'],
    features: ['performance_timing', 'structured_logging', 'service_separation']
  });
}; 