/**
 * Smart priority fee configuration interface
 */
export interface SmartPriorityFeeConfig {
  /** Base priority fee in microLamports */
  baseFee: number;
  /** Multiplier for each retry (1.5 = 50% increase) */
  retryMultiplier: number;
  /** Maximum priority fee in microLamports */
  maxFee: number;
  /** Minimum priority fee in microLamports */
  minFee: number;
}

/**
 * Unified configuration interface for all blockchain operations
 * This ensures consistent behavior across all platforms
 */
export interface UnifiedConfig {
  // Slippage Configuration
  slippage: {
    /** Base slippage percentage (default: 35%) */
    base: number;
    /** Maximum slippage cap (default: 70%) */
    max: number;
    /** Extra slippage per retry attempt (default: 10%) */
    retryBonus: number;
    /** User's custom slippage override (optional) */
    userOverride?: number;
  };

  // Priority Fee Configuration
  priorityFees: {
    /** Base priority fee in microLamports (default: 1,500,000 = 0.0015 SOL) */
    base: number;
    /** Multiplier for each retry (default: 1.5 = 50% increase) */
    retryMultiplier: number;
    /** Maximum priority fee in microLamports (default: 12,000,000 = 0.012 SOL) */
    max: number;
    /** Minimum priority fee in microLamports (default: 300,000 = 0.0003 SOL) */
    min: number;
  };

  // Retry Configuration
  retry: {
    /** Maximum retry attempts (default: 3) */
    maxAttempts: number;
    /** Base delay between retries in ms (default: 1000) */
    delayMs: number;
  };

  // Fee Configuration
  fees: {
    /** Platform fee percentage (default: 1.0%) */
    platformPercentage: number;
    /** Maestro fee percentage (default: 0.25%) */
    maestroPercentage: number;
    /** Fixed Maestro fee in lamports (default: 1,000,000 = 0.001 SOL) */
    maestroFixed: number;
  };

  // Liquidity Configuration
  liquidity: {
    /** SOL threshold for low liquidity warning (default: 5 SOL) */
    lowThreshold: number;
    /** SOL threshold for medium liquidity (default: 20 SOL) */
    mediumThreshold: number;
  };

  // Platform-specific overrides
  platformOverrides?: {
    pumpfun?: Partial<UnifiedConfig>;
    pumpswap?: Partial<UnifiedConfig>;
    bonk?: Partial<UnifiedConfig>;
    cpmm?: Partial<UnifiedConfig>;
  };
}

/**
 * Default unified configuration
 */
export const DEFAULT_UNIFIED_CONFIG: UnifiedConfig = {
  slippage: {
    base: 35,
    max: 70,
    retryBonus: 10,
  },
  priorityFees: {
    base: 1_500_000, // 1.5M microLamports (0.0015 SOL)
    retryMultiplier: 1.5, // 50% increase per retry
    max: 12_000_000, // 12M microLamports (0.012 SOL)
    min: 300_000, // 300K microLamports (0.0003 SOL)
  },
  retry: {
    maxAttempts: 3,
    delayMs: 1000,
  },
  fees: {
    platformPercentage: 1.0,
    maestroPercentage: 0.25,
    maestroFixed: 1_000_000, // 1M lamports (0.001 SOL)
  },
  liquidity: {
    lowThreshold: 5,
    mediumThreshold: 20,
  },
};

/**
 * Predefined configuration presets
 */
export const CONFIG_PRESETS = {
  conservative: {
    slippage: { base: 20, max: 40, retryBonus: 5 },
    priorityFees: { base: 1_000_000, retryMultiplier: 1.5, max: 8_000_000, min: 200_000 },
    retry: { maxAttempts: 2, delayMs: 1500 },
  },
  balanced: DEFAULT_UNIFIED_CONFIG,
  aggressive: {
    slippage: { base: 50, max: 80, retryBonus: 15 },
    priorityFees: { base: 2_000_000, retryMultiplier: 1.5, max: 15_000_000, min: 500_000 },
    retry: { maxAttempts: 4, delayMs: 800 },
  },
  ultra: {
    slippage: { base: 70, max: 95, retryBonus: 20 },
    priorityFees: { base: 3_000_000, retryMultiplier: 1.5, max: 25_000_000, min: 1_000_000 },
    retry: { maxAttempts: 5, delayMs: 500 },
  },
} as const;

/**
 * Create a unified configuration by merging defaults with user overrides
 */
export function createUnifiedConfig(
  userConfig?: Partial<UnifiedConfig>,
  preset?: keyof typeof CONFIG_PRESETS
): UnifiedConfig {
  let config = { ...DEFAULT_UNIFIED_CONFIG };

  // Apply preset if specified
  if (preset && preset in CONFIG_PRESETS) {
    config = deepMerge(config, CONFIG_PRESETS[preset]);
  }

  // Apply user overrides
  if (userConfig) {
    config = deepMerge(config, userConfig);
  }

  return config;
}

/**
 * Get platform-specific configuration
 */
export function getPlatformConfig(
  config: UnifiedConfig,
  platform: keyof UnifiedConfig['platformOverrides']
): UnifiedConfig {
  const platformOverride = config.platformOverrides?.[platform];
  if (platformOverride) {
    return deepMerge(config, platformOverride);
  }
  return config;
}

/**
 * Convert unified config to platform-specific format
 */
export function toPlatformConfig(config: UnifiedConfig, platform: string) {
  switch (platform.toLowerCase()) {
    case 'pumpfun':
    case 'pumpswap':
      return {
        platformFeePercentage: config.fees.platformPercentage,
        slippagePercentage: config.slippage.userOverride || config.slippage.base,
        maxRetries: config.retry.maxAttempts,
      };
    case 'bonk':
      return {
        baseSlippage: config.slippage.base,
        maxSlippage: config.slippage.max,
        maxRetries: config.retry.maxAttempts,
        retrySlippageBonus: config.slippage.retryBonus,
        platformFeePercentage: config.fees.platformPercentage,
        maestroFeePercentage: config.fees.maestroPercentage,
        lowLiquidityThreshold: config.liquidity.lowThreshold,
        mediumLiquidityThreshold: config.liquidity.mediumThreshold,
        retryDelayMs: config.retry.delayMs,
      };
    case 'cpmm':
      return {
        baseSlippage: config.slippage.base,
        maxSlippage: config.slippage.max,
        maxRetries: config.retry.maxAttempts,
        retrySlippageBonus: config.slippage.retryBonus,
        platformFeePercentage: config.fees.platformPercentage,
        maestroFeePercentage: config.fees.maestroPercentage,
        lowLiquidityThreshold: config.liquidity.lowThreshold,
        mediumLiquidityThreshold: config.liquidity.mediumThreshold,
        retryDelayMs: config.retry.delayMs,
      };
    default:
      return config;
  }
}

/**
 * Convert unified config to SmartPriorityFeeConfig
 */
export function toPriorityFeeConfig(config: UnifiedConfig): SmartPriorityFeeConfig {
  return {
    baseFee: config.priorityFees.base,
    retryMultiplier: config.priorityFees.retryMultiplier,
    maxFee: config.priorityFees.max,
    minFee: config.priorityFees.min,
  };
}

/**
 * Deep merge utility function
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key], source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  
  return result;
}

/**
 * Validate configuration
 */
export function validateConfig(config: UnifiedConfig): string[] {
  const errors: string[] = [];

  // Validate slippage
  if (config.slippage.base < 0 || config.slippage.base > 100) {
    errors.push('Base slippage must be between 0 and 100');
  }
  if (config.slippage.max < config.slippage.base) {
    errors.push('Max slippage must be greater than or equal to base slippage');
  }
  if (config.slippage.userOverride !== undefined && (config.slippage.userOverride < 0 || config.slippage.userOverride > 100)) {
    errors.push('User slippage override must be between 0 and 100');
  }

  // Validate priority fees
  if (config.priorityFees.base < 0) {
    errors.push('Base priority fee must be non-negative');
  }
  if (config.priorityFees.max < config.priorityFees.base) {
    errors.push('Max priority fee must be greater than or equal to base priority fee');
  }
  if (config.priorityFees.min > config.priorityFees.base) {
    errors.push('Min priority fee must be less than or equal to base priority fee');
  }

  // Validate retry settings
  if (config.retry.maxAttempts < 0) {
    errors.push('Max retry attempts must be non-negative');
  }
  if (config.retry.delayMs < 0) {
    errors.push('Retry delay must be non-negative');
  }

  // Validate fees
  if (config.fees.platformPercentage < 0 || config.fees.platformPercentage > 100) {
    errors.push('Platform fee percentage must be between 0 and 100');
  }
  if (config.fees.maestroPercentage < 0 || config.fees.maestroPercentage > 100) {
    errors.push('Maestro fee percentage must be between 0 and 100');
  }

  return errors;
} 