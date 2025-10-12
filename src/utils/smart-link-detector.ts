/**
 * Smart Link Detection and Auto-Fixing Utility
 * Automatically detects and categorizes social media links for token creation
 */

export interface DetectedLinks {
  twitter: string;
  telegram: string;
  website: string;
  errors: string[];
}

export interface LinkDetectionResult {
  success: boolean;
  links: DetectedLinks;
  message: string;
}

/**
 * Smart link detector that automatically categorizes and fixes common link issues
 */
export class SmartLinkDetector {
  
  /**
   * Detect and categorize links from user input
   * @param input - User input containing one or more links
   * @returns LinkDetectionResult with categorized links
   */
  static detectAndCategorizeLinks(input: string): LinkDetectionResult {
    const result: DetectedLinks = {
      twitter: '',
      telegram: '',
      website: '',
      errors: []
    };

    if (!input || input.trim().toLowerCase() === 'skip') {
      return {
        success: true,
        links: result,
        message: 'All links skipped'
      };
    }

    // Split input by common separators and clean up
    const rawLinks = input
      .split(/[,\n\r\s]+/)
      .map(link => link.trim())
      .filter(link => link.length > 0 && link.toLowerCase() !== 'skip');

    for (const rawLink of rawLinks) {
      const detectedType = this.detectLinkType(rawLink);
      const fixedLink = this.fixLink(rawLink, detectedType);

      if (detectedType === 'invalid') {
        result.errors.push(`Invalid link: ${rawLink}`);
        continue;
      }

      // Place link in appropriate field
      if (detectedType === 'twitter' || detectedType === 'x') {
        if (result.twitter) {
          result.errors.push(`Multiple Twitter/X links detected. Using: ${fixedLink}, ignoring: ${result.twitter}`);
        }
        result.twitter = fixedLink;
      } else if (detectedType === 'telegram') {
        if (result.telegram) {
          result.errors.push(`Multiple Telegram links detected. Using: ${fixedLink}, ignoring: ${result.telegram}`);
        }
        result.telegram = fixedLink;
      } else if (detectedType === 'website') {
        if (result.website) {
          result.errors.push(`Multiple website links detected. Using: ${fixedLink}, ignoring: ${result.website}`);
        }
        result.website = fixedLink;
      }
    }

    const hasValidLinks = result.twitter || result.telegram || result.website;
    const hasErrors = result.errors.length > 0;

    let message = '';
    if (hasValidLinks && !hasErrors) {
      message = this.formatSuccessMessage(result);
    } else if (hasValidLinks && hasErrors) {
      message = this.formatWarningMessage(result);
    } else {
      message = `❌ No valid links detected. Errors: ${result.errors.join(', ')}`;
    }

    return {
      success: hasValidLinks,
      links: result,
      message
    };
  }

  /**
   * Detect the type of link
   */
  private static detectLinkType(link: string): 'twitter' | 'x' | 'telegram' | 'website' | 'invalid' {
    const cleanLink = link.toLowerCase().trim();

    // Skip detection
    if (cleanLink === 'skip' || cleanLink === '') {
      return 'invalid';
    }

    // Telegram detection (check first to handle @telegram properly)
    if (
      cleanLink.includes('t.me') ||
      cleanLink.includes('telegram.me') ||
      cleanLink.match(/^https?:\/\/(www\.)?(t|telegram)\.me\/\w+/i)
    ) {
      return 'telegram';
    }

    // Special case: @username - need context clues
    if (cleanLink.match(/^@\w+$/)) {
      // If it contains "telegram", "tg", "channel", "group" -> telegram
      if (cleanLink.includes('telegram') || cleanLink.includes('tg') || cleanLink.includes('channel') || cleanLink.includes('group')) {
        return 'telegram';
      }
      // Otherwise assume Twitter/X (more common)
      return 'twitter';
    }

    // Twitter/X detection
    if (
      cleanLink.includes('twitter.com') ||
      cleanLink.includes('x.com') ||
      cleanLink.match(/^https?:\/\/(www\.)?(twitter|x)\.com\/\w+/i)
    ) {
      return cleanLink.includes('x.com') ? 'x' : 'twitter';
    }

    // Plain username without @ (assume Twitter/X)
    if (cleanLink.match(/^\w+$/) && !cleanLink.includes('.')) {
      return 'twitter';
    }

    // Website detection (must have domain structure)
    if (
      cleanLink.match(/^https?:\/\/.+\..+/i) ||
      cleanLink.match(/^\w+\.\w{2,}(\/.*)?$/i) // domain.com or domain.com/path
    ) {
      return 'website';
    }

    return 'invalid';
  }

  /**
   * Fix and normalize links
   */
  private static fixLink(link: string, type: 'twitter' | 'x' | 'telegram' | 'website' | 'invalid'): string {
    const cleanLink = link.trim();

    switch (type) {
      case 'twitter':
      case 'x':
        return this.fixTwitterLink(cleanLink);
      
      case 'telegram':
        return this.fixTelegramLink(cleanLink);
      
      case 'website':
        return this.fixWebsiteLink(cleanLink);
      
      default:
        return cleanLink;
    }
  }

  /**
   * Fix Twitter/X links
   */
  private static fixTwitterLink(link: string): string {
    const cleanLink = link.trim();

    // Handle @username or username
    if (cleanLink.match(/^@?\w+$/)) {
      const username = cleanLink.replace(/^@/, '');
      return `https://x.com/${username}`;
    }

    // Fix twitter.com -> x.com
    if (cleanLink.includes('twitter.com')) {
      return cleanLink.replace('twitter.com', 'x.com');
    }

    // Add https if missing
    if (cleanLink.includes('x.com') && !cleanLink.startsWith('http')) {
      return `https://${cleanLink}`;
    }

    return cleanLink;
  }

  /**
   * Fix Telegram links
   */
  private static fixTelegramLink(link: string): string {
    const cleanLink = link.trim();

    // Handle @channel
    if (cleanLink.match(/^@\w+$/)) {
      const channel = cleanLink.replace(/^@/, '');
      return `https://t.me/${channel}`;
    }

    // Fix telegram.me -> t.me
    if (cleanLink.includes('telegram.me')) {
      return cleanLink.replace('telegram.me', 't.me');
    }

    // Add https if missing
    if (cleanLink.includes('t.me') && !cleanLink.startsWith('http')) {
      return `https://${cleanLink}`;
    }

    return cleanLink;
  }

  /**
   * Fix website links
   */
  private static fixWebsiteLink(link: string): string {
    const cleanLink = link.trim();

    // Add https if missing
    if (!cleanLink.startsWith('http') && cleanLink.match(/^\w+\.\w{2,}/)) {
      return `https://${cleanLink}`;
    }

    return cleanLink;
  }

  /**
   * Format success message
   */
  private static formatSuccessMessage(result: DetectedLinks): string {
    const links = [];
    if (result.twitter) links.push(`🐦 Twitter/X: ${result.twitter}`);
    if (result.telegram) links.push(`💬 Telegram: ${result.telegram}`);
    if (result.website) links.push(`🌐 Website: ${result.website}`);

    return `✅ **Links Auto-Detected & Fixed:**\n${links.join('\n')}`;
  }

  /**
   * Format warning message
   */
  private static formatWarningMessage(result: DetectedLinks): string {
    const links = [];
    if (result.twitter) links.push(`🐦 Twitter/X: ${result.twitter}`);
    if (result.telegram) links.push(`💬 Telegram: ${result.telegram}`);
    if (result.website) links.push(`🌐 Website: ${result.website}`);

    const warnings = result.errors.join('\n⚠️ ');

    return `⚠️ **Links Detected with Warnings:**\n${links.join('\n')}\n\n⚠️ ${warnings}`;
  }

  /**
   * Validate final links before token creation
   */
  static validateFinalLinks(links: DetectedLinks): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate Twitter/X
    if (links.twitter && !/^https?:\/\/(www\.)?(twitter|x)\.com\/\w+/i.test(links.twitter)) {
      errors.push('Invalid Twitter/X URL format');
    }

    // Validate Telegram
    if (links.telegram && !/^https?:\/\/(www\.)?t\.me\/\w+/i.test(links.telegram)) {
      errors.push('Invalid Telegram URL format');
    }

    // Validate Website
    if (links.website && !/^https?:\/\/.+\..+/i.test(links.website)) {
      errors.push('Invalid website URL format');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}