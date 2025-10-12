import { Context } from 'grammy';
import HeliusPumpFunService from './helius-pumpfun-service';
import { formatMarketCap, formatPrice } from './pumpfun-marketcap-service';

/**
 * 🚀 PUMPFUN MARKET CAP INTEGRATION EXAMPLES
 * 
 * Shows how to integrate the PumpFun market cap service into your existing bot:
 * - Token analysis commands
 * - Market cap monitoring
 * - Trending token discovery
 * - Portfolio tracking
 */

export class PumpFunBotIntegration {
  private heliusService: HeliusPumpFunService;

  constructor(heliusRpcUrl: string, heliusApiKey?: string) {
    this.heliusService = new HeliusPumpFunService(heliusRpcUrl, heliusApiKey);
  }

  /**
   * 📊 Bot command: /analyze <token_address>
   * Provides comprehensive token analysis
   */
  async handleAnalyzeCommand(ctx: Context, tokenAddress: string) {
    try {
      await ctx.reply('🔍 Analyzing token... Please wait...');

      const result = await this.heliusService.getEnhancedTokenData(tokenAddress);

      if (!result.success || !result.data) {
        await ctx.reply(`❌ Analysis failed: ${result.error || 'Token not found or not a PumpFun token'}`);
        return;
      }

      const token = result.data;
      
      const message = `
🎯 **TOKEN ANALYSIS**

📛 **${token.name || 'Unknown'}** (${token.symbol || 'N/A'})
📍 \`${token.mint}\`

💎 **Market Data:**
• Market Cap: ${formatMarketCap(token.marketCap)}
• Price: ${formatPrice(token.price)}
• 24h Change: ${token.priceChange24h ? `${token.priceChange24h > 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}%` : 'N/A'}

📊 **Supply Info:**
• Total Supply: ${token.totalSupply.toLocaleString()} tokens
• Circulating: ${token.circulatingSupply.toLocaleString()} tokens
• Holders: ${token.holders || 'N/A'}

🏊 **Liquidity:**
• SOL Reserves: ${token.solReserves.toFixed(4)} SOL
• Token Reserves: ${token.tokenReserves.toLocaleString()} tokens

📈 **Activity:**
• 24h Volume: ${token.volume24h ? formatMarketCap(token.volume24h) : 'N/A'}
• 24h Transactions: ${token.transactions24h || 'N/A'}

🎯 **Status:**
• ${token.isComplete ? '✅ Graduated (On Raydium)' : '🔄 Bonding Curve Active'}
• ${token.isMigrated ? '🚀 Migrated' : '📈 On PumpFun'}

👤 **Creator:** \`${token.creator}\`
${token.description ? `\n📝 **Description:** ${token.description}` : ''}
      `.trim();

      await ctx.reply(message, { parse_mode: 'Markdown' });

      // Send image if available
      if (token.image) {
        try {
          await ctx.replyWithPhoto(token.image);
        } catch (error) {
          console.warn('Failed to send token image:', error);
        }
      }

    } catch (error) {
      console.error('Token analysis error:', error);
      await ctx.reply('❌ An error occurred during token analysis. Please try again later.');
    }
  }

  /**
   * 🔥 Bot command: /trending
   * Shows trending PumpFun tokens
   */
  async handleTrendingCommand(ctx: Context, limit: number = 10) {
    try {
      await ctx.reply('🔥 Finding trending PumpFun tokens...');

      const result = await this.heliusService.getTrendingTokens(limit);

      if (!result.success || !result.data || result.data.length === 0) {
        await ctx.reply('❌ No trending tokens found at the moment.');
        return;
      }

      let message = '🔥 **TRENDING PUMPFUN TOKENS**\n\n';
      
      result.data.slice(0, limit).forEach((token, index) => {
        const rank = index + 1;
        const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🔸';
        
        message += `${emoji} **${rank}. ${token.name || 'Unknown'}** (${token.symbol || 'N/A'})\n`;
        message += `💎 ${formatMarketCap(token.marketCap)} | ${formatPrice(token.price)}\n`;
        message += `📊 Volume: ${token.volume24h ? formatMarketCap(token.volume24h) : 'N/A'}\n`;
        message += `🎯 ${token.isComplete ? 'Graduated' : 'On Curve'}\n`;
        message += `📍 \`${token.mint}\`\n\n`;
      });

      message += '💡 Use /analyze <address> for detailed analysis';

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      console.error('Trending tokens error:', error);
      await ctx.reply('❌ Failed to fetch trending tokens. Please try again later.');
    }
  }

  /**
   * 👥 Bot command: /holders <token_address>
   * Shows top token holders
   */
  async handleHoldersCommand(ctx: Context, tokenAddress: string, limit: number = 10) {
    try {
      await ctx.reply('👥 Fetching token holders...');

      const result = await this.heliusService.getTokenHolders(tokenAddress, limit);

      if (!result.success || !result.data) {
        await ctx.reply(`❌ Failed to fetch holders: ${result.error}`);
        return;
      }

      if (result.data.length === 0) {
        await ctx.reply('❌ No holders found for this token.');
        return;
      }

      let message = `👥 **TOP ${limit} HOLDERS**\n`;
      message += `📊 Total Holders: ${result.totalHolders}\n\n`;

      result.data.forEach((holder, index) => {
        const rank = index + 1;
        const emoji = rank === 1 ? '🐋' : rank <= 5 ? '🦈' : '🐟';
        
        message += `${emoji} **${rank}.** \`${holder.owner.slice(0, 8)}...${holder.owner.slice(-8)}\`\n`;
        message += `💰 ${holder.amount.toLocaleString()} tokens (${holder.percentage.toFixed(2)}%)\n\n`;
      });

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      console.error('Holders command error:', error);
      await ctx.reply('❌ Failed to fetch token holders. Please try again later.');
    }
  }

  /**
   * 📈 Bot command: /price <token_address>
   * Quick price check
   */
  async handlePriceCommand(ctx: Context, tokenAddress: string) {
    try {
      const result = await this.heliusService.getEnhancedTokenData(tokenAddress);

      if (!result.success || !result.data) {
        await ctx.reply(`❌ Price check failed: ${result.error || 'Token not found'}`);
        return;
      }

      const token = result.data;
      const changeEmoji = !token.priceChange24h ? '➖' : token.priceChange24h > 0 ? '📈' : '📉';
      const changeColor = !token.priceChange24h ? '' : token.priceChange24h > 0 ? '🟢' : '🔴';

      const message = `
💰 **PRICE CHECK**

📛 **${token.name || 'Unknown'}** (${token.symbol || 'N/A'})

💎 **Price:** ${formatPrice(token.price)}
📊 **Market Cap:** ${formatMarketCap(token.marketCap)}
${changeEmoji} **24h Change:** ${changeColor} ${token.priceChange24h ? `${token.priceChange24h > 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}%` : 'N/A'}

🏊 **Liquidity:** ${token.solReserves.toFixed(4)} SOL
🎯 **Status:** ${token.isComplete ? 'Graduated' : 'On Curve'}
      `.trim();

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      console.error('Price command error:', error);
      await ctx.reply('❌ Price check failed. Please try again later.');
    }
  }

  /**
   * 🔍 Bot command: /search <query>
   * Search for tokens by name/symbol
   */
  async handleSearchCommand(ctx: Context, query: string) {
    try {
      await ctx.reply(`🔍 Searching for "${query}"...`);

      // This would implement token search functionality
      // For now, just show a placeholder message
      await ctx.reply(`🔍 Token search for "${query}" is not yet implemented. Use /analyze <address> for specific token analysis.`);

    } catch (error) {
      console.error('Search command error:', error);
      await ctx.reply('❌ Search failed. Please try again later.');
    }
  }

  /**
   * 📊 Portfolio tracking integration example
   */
  async trackPortfolioToken(userId: string, tokenAddress: string): Promise<{
    success: boolean;
    data?: {
      currentValue: number;
      priceChange: number;
      percentChange: number;
    };
    error?: string;
  }> {
    try {
      const result = await this.heliusService.getEnhancedTokenData(tokenAddress);

      if (!result.success || !result.data) {
        return {
          success: false,
          error: result.error || 'Token not found'
        };
      }

      // This would integrate with your portfolio tracking system
      // For example, calculate P&L based on entry price vs current price
      
      return {
        success: true,
        data: {
          currentValue: result.data.price,
          priceChange: result.data.priceChange24h || 0,
          percentChange: result.data.priceChange24h || 0
        }
      };

    } catch (error) {
      return {
        success: false,
        error: `Portfolio tracking failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * 🚨 Market cap alerts integration example
   */
  async checkMarketCapAlert(tokenAddress: string, targetMarketCap: number): Promise<{
    triggered: boolean;
    currentMarketCap: number;
    targetMarketCap: number;
    percentOfTarget: number;
  }> {
    try {
      const result = await this.heliusService.getEnhancedTokenData(tokenAddress);

      if (!result.success || !result.data) {
        throw new Error('Token data unavailable');
      }

      const currentMarketCap = result.data.marketCap;
      const percentOfTarget = (currentMarketCap / targetMarketCap) * 100;

      return {
        triggered: currentMarketCap >= targetMarketCap,
        currentMarketCap,
        targetMarketCap,
        percentOfTarget
      };

    } catch (error) {
      console.error('Market cap alert check failed:', error);
      return {
        triggered: false,
        currentMarketCap: 0,
        targetMarketCap,
        percentOfTarget: 0
      };
    }
  }
}

/**
 * 🔧 UTILITY FUNCTIONS FOR BOT INTEGRATION
 */

/**
 * Validate token address format
 */
export function isValidTokenAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract token address from message
 */
export function extractTokenAddress(text: string): string | null {
  // Look for Solana address pattern (base58, 32-44 characters)
  const addressRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
  const match = text.match(addressRegex);
  
  if (match && isValidTokenAddress(match[0])) {
    return match[0];
  }
  
  return null;
}

/**
 * Format large numbers for display
 */
export function formatNumber(num: number): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}

export default PumpFunBotIntegration;
import HeliusPumpFunService from './helius-pumpfun-service';
import { formatMarketCap, formatPrice } from './pumpfun-marketcap-service';

/**
 * 🚀 PUMPFUN MARKET CAP INTEGRATION EXAMPLES
 * 
 * Shows how to integrate the PumpFun market cap service into your existing bot:
 * - Token analysis commands
 * - Market cap monitoring
 * - Trending token discovery
 * - Portfolio tracking
 */

export class PumpFunBotIntegration {
  private heliusService: HeliusPumpFunService;

  constructor(heliusRpcUrl: string, heliusApiKey?: string) {
    this.heliusService = new HeliusPumpFunService(heliusRpcUrl, heliusApiKey);
  }

  /**
   * 📊 Bot command: /analyze <token_address>
   * Provides comprehensive token analysis
   */
  async handleAnalyzeCommand(ctx: Context, tokenAddress: string) {
    try {
      await ctx.reply('🔍 Analyzing token... Please wait...');

      const result = await this.heliusService.getEnhancedTokenData(tokenAddress);

      if (!result.success || !result.data) {
        await ctx.reply(`❌ Analysis failed: ${result.error || 'Token not found or not a PumpFun token'}`);
        return;
      }

      const token = result.data;
      
      const message = `
🎯 **TOKEN ANALYSIS**

📛 **${token.name || 'Unknown'}** (${token.symbol || 'N/A'})
📍 \`${token.mint}\`

💎 **Market Data:**
• Market Cap: ${formatMarketCap(token.marketCap)}
• Price: ${formatPrice(token.price)}
• 24h Change: ${token.priceChange24h ? `${token.priceChange24h > 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}%` : 'N/A'}

📊 **Supply Info:**
• Total Supply: ${token.totalSupply.toLocaleString()} tokens
• Circulating: ${token.circulatingSupply.toLocaleString()} tokens
• Holders: ${token.holders || 'N/A'}

🏊 **Liquidity:**
• SOL Reserves: ${token.solReserves.toFixed(4)} SOL
• Token Reserves: ${token.tokenReserves.toLocaleString()} tokens

📈 **Activity:**
• 24h Volume: ${token.volume24h ? formatMarketCap(token.volume24h) : 'N/A'}
• 24h Transactions: ${token.transactions24h || 'N/A'}

🎯 **Status:**
• ${token.isComplete ? '✅ Graduated (On Raydium)' : '🔄 Bonding Curve Active'}
• ${token.isMigrated ? '🚀 Migrated' : '📈 On PumpFun'}

👤 **Creator:** \`${token.creator}\`
${token.description ? `\n📝 **Description:** ${token.description}` : ''}
      `.trim();

      await ctx.reply(message, { parse_mode: 'Markdown' });

      // Send image if available
      if (token.image) {
        try {
          await ctx.replyWithPhoto(token.image);
        } catch (error) {
          console.warn('Failed to send token image:', error);
        }
      }

    } catch (error) {
      console.error('Token analysis error:', error);
      await ctx.reply('❌ An error occurred during token analysis. Please try again later.');
    }
  }

  /**
   * 🔥 Bot command: /trending
   * Shows trending PumpFun tokens
   */
  async handleTrendingCommand(ctx: Context, limit: number = 10) {
    try {
      await ctx.reply('🔥 Finding trending PumpFun tokens...');

      const result = await this.heliusService.getTrendingTokens(limit);

      if (!result.success || !result.data || result.data.length === 0) {
        await ctx.reply('❌ No trending tokens found at the moment.');
        return;
      }

      let message = '🔥 **TRENDING PUMPFUN TOKENS**\n\n';
      
      result.data.slice(0, limit).forEach((token, index) => {
        const rank = index + 1;
        const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🔸';
        
        message += `${emoji} **${rank}. ${token.name || 'Unknown'}** (${token.symbol || 'N/A'})\n`;
        message += `💎 ${formatMarketCap(token.marketCap)} | ${formatPrice(token.price)}\n`;
        message += `📊 Volume: ${token.volume24h ? formatMarketCap(token.volume24h) : 'N/A'}\n`;
        message += `🎯 ${token.isComplete ? 'Graduated' : 'On Curve'}\n`;
        message += `📍 \`${token.mint}\`\n\n`;
      });

      message += '💡 Use /analyze <address> for detailed analysis';

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      console.error('Trending tokens error:', error);
      await ctx.reply('❌ Failed to fetch trending tokens. Please try again later.');
    }
  }

  /**
   * 👥 Bot command: /holders <token_address>
   * Shows top token holders
   */
  async handleHoldersCommand(ctx: Context, tokenAddress: string, limit: number = 10) {
    try {
      await ctx.reply('👥 Fetching token holders...');

      const result = await this.heliusService.getTokenHolders(tokenAddress, limit);

      if (!result.success || !result.data) {
        await ctx.reply(`❌ Failed to fetch holders: ${result.error}`);
        return;
      }

      if (result.data.length === 0) {
        await ctx.reply('❌ No holders found for this token.');
        return;
      }

      let message = `👥 **TOP ${limit} HOLDERS**\n`;
      message += `📊 Total Holders: ${result.totalHolders}\n\n`;

      result.data.forEach((holder, index) => {
        const rank = index + 1;
        const emoji = rank === 1 ? '🐋' : rank <= 5 ? '🦈' : '🐟';
        
        message += `${emoji} **${rank}.** \`${holder.owner.slice(0, 8)}...${holder.owner.slice(-8)}\`\n`;
        message += `💰 ${holder.amount.toLocaleString()} tokens (${holder.percentage.toFixed(2)}%)\n\n`;
      });

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      console.error('Holders command error:', error);
      await ctx.reply('❌ Failed to fetch token holders. Please try again later.');
    }
  }

  /**
   * 📈 Bot command: /price <token_address>
   * Quick price check
   */
  async handlePriceCommand(ctx: Context, tokenAddress: string) {
    try {
      const result = await this.heliusService.getEnhancedTokenData(tokenAddress);

      if (!result.success || !result.data) {
        await ctx.reply(`❌ Price check failed: ${result.error || 'Token not found'}`);
        return;
      }

      const token = result.data;
      const changeEmoji = !token.priceChange24h ? '➖' : token.priceChange24h > 0 ? '📈' : '📉';
      const changeColor = !token.priceChange24h ? '' : token.priceChange24h > 0 ? '🟢' : '🔴';

      const message = `
💰 **PRICE CHECK**

📛 **${token.name || 'Unknown'}** (${token.symbol || 'N/A'})

💎 **Price:** ${formatPrice(token.price)}
📊 **Market Cap:** ${formatMarketCap(token.marketCap)}
${changeEmoji} **24h Change:** ${changeColor} ${token.priceChange24h ? `${token.priceChange24h > 0 ? '+' : ''}${token.priceChange24h.toFixed(2)}%` : 'N/A'}

🏊 **Liquidity:** ${token.solReserves.toFixed(4)} SOL
🎯 **Status:** ${token.isComplete ? 'Graduated' : 'On Curve'}
      `.trim();

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      console.error('Price command error:', error);
      await ctx.reply('❌ Price check failed. Please try again later.');
    }
  }

  /**
   * 🔍 Bot command: /search <query>
   * Search for tokens by name/symbol
   */
  async handleSearchCommand(ctx: Context, query: string) {
    try {
      await ctx.reply(`🔍 Searching for "${query}"...`);

      // This would implement token search functionality
      // For now, just show a placeholder message
      await ctx.reply(`🔍 Token search for "${query}" is not yet implemented. Use /analyze <address> for specific token analysis.`);

    } catch (error) {
      console.error('Search command error:', error);
      await ctx.reply('❌ Search failed. Please try again later.');
    }
  }

  /**
   * 📊 Portfolio tracking integration example
   */
  async trackPortfolioToken(userId: string, tokenAddress: string): Promise<{
    success: boolean;
    data?: {
      currentValue: number;
      priceChange: number;
      percentChange: number;
    };
    error?: string;
  }> {
    try {
      const result = await this.heliusService.getEnhancedTokenData(tokenAddress);

      if (!result.success || !result.data) {
        return {
          success: false,
          error: result.error || 'Token not found'
        };
      }

      // This would integrate with your portfolio tracking system
      // For example, calculate P&L based on entry price vs current price
      
      return {
        success: true,
        data: {
          currentValue: result.data.price,
          priceChange: result.data.priceChange24h || 0,
          percentChange: result.data.priceChange24h || 0
        }
      };

    } catch (error) {
      return {
        success: false,
        error: `Portfolio tracking failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * 🚨 Market cap alerts integration example
   */
  async checkMarketCapAlert(tokenAddress: string, targetMarketCap: number): Promise<{
    triggered: boolean;
    currentMarketCap: number;
    targetMarketCap: number;
    percentOfTarget: number;
  }> {
    try {
      const result = await this.heliusService.getEnhancedTokenData(tokenAddress);

      if (!result.success || !result.data) {
        throw new Error('Token data unavailable');
      }

      const currentMarketCap = result.data.marketCap;
      const percentOfTarget = (currentMarketCap / targetMarketCap) * 100;

      return {
        triggered: currentMarketCap >= targetMarketCap,
        currentMarketCap,
        targetMarketCap,
        percentOfTarget
      };

    } catch (error) {
      console.error('Market cap alert check failed:', error);
      return {
        triggered: false,
        currentMarketCap: 0,
        targetMarketCap,
        percentOfTarget: 0
      };
    }
  }
}

/**
 * 🔧 UTILITY FUNCTIONS FOR BOT INTEGRATION
 */

/**
 * Validate token address format
 */
export function isValidTokenAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract token address from message
 */
export function extractTokenAddress(text: string): string | null {
  // Look for Solana address pattern (base58, 32-44 characters)
  const addressRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
  const match = text.match(addressRegex);
  
  if (match && isValidTokenAddress(match[0])) {
    return match[0];
  }
  
  return null;
}

/**
 * Format large numbers for display
 */
export function formatNumber(num: number): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}

export default PumpFunBotIntegration;