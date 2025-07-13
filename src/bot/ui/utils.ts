// Common UI utility functions

// Format SOL amounts with proper decimal places
export function formatSOL(amount: number): string {
  return amount.toFixed(4);
}

// Format USD amounts with proper formatting
export function formatUSD(amount: number): string {
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// Format percentages
export function formatPercentage(percentage: number): string {
  return `${percentage.toFixed(1)}%`;
}

// Shorten wallet addresses for display
export function shortenAddress(address: string, startLength: number = 6, endLength: number = 4): string {
  if (address.length <= startLength + endLength) {
    return address;
  }
  return `${address.slice(0, startLength)}…${address.slice(-endLength)}`;
}

// Generate loading messages with dots animation
export function generateLoadingMessage(baseMessage: string, step: number = 1): string {
  const dots = ".".repeat(step);
  return `${baseMessage}${dots}`;
}

// Generate progress bar
export function generateProgressBar(current: number, total: number, length: number = 10): string {
  const progress = Math.round((current / total) * length);
  const filled = "█".repeat(progress);
  const empty = "░".repeat(length - progress);
  return `${filled}${empty} ${Math.round((current / total) * 100)}%`;
}

// Generate status emoji based on status string
export function getStatusEmoji(status: string): string {
  switch (status.toLowerCase()) {
    case "active":
    case "success":
    case "completed":
      return "✅";
    case "pending":
    case "processing":
      return "⏳";
    case "error":
    case "failed":
      return "❌";
    case "warning":
      return "⚠️";
    default:
      return "ℹ️";
  }
}

// Generate timestamp for display
export function formatTimestamp(timestamp: Date | string): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + " " + date.toLocaleTimeString();
}

// Generate relative time (e.g., "2 hours ago")
export function getRelativeTime(timestamp: Date | string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return "just now";
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  } else {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }
}

// Generate error message with context
export function generateErrorMessage(error: string, context?: string): string {
  let message = `❌ **Error**\n\n**Details:** ${error}`;
  
  if (context) {
    message += `\n\n**Context:** ${context}`;
  }
  
  message += `\n\n**Possible Solutions:**
• Try again in a few minutes
• Check your internet connection
• Verify your input is correct
• Contact support if the issue persists`;
  
  return message;
}

// Generate success message with next steps
export function generateSuccessMessage(title: string, details: string, nextSteps?: string[]): string {
  let message = `✅ **${title}**\n\n${details}`;
  
  if (nextSteps && nextSteps.length > 0) {
    message += `\n\n**Next Steps:**`;
    nextSteps.forEach((step, index) => {
      message += `\n${index + 1}. ${step}`;
    });
  }
  
  return message;
}

// Generate confirmation message
export function generateConfirmationMessage(title: string, details: string, warning?: string): string {
  let message = `❓ **${title}**\n\n${details}`;
  
  if (warning) {
    message += `\n\n⚠️ **Warning:** ${warning}`;
  }
  
  message += `\n\nAre you sure you want to proceed?`;
  
  return message;
}

// Generate info message with tips
export function generateInfoMessage(title: string, details: string, tips?: string[]): string {
  let message = `ℹ️ **${title}**\n\n${details}`;
  
  if (tips && tips.length > 0) {
    message += `\n\n💡 **Tips:**`;
    tips.forEach((tip, index) => {
      message += `\n• ${tip}`;
    });
  }
  
  return message;
}

// Generate help message
export function generateHelpMessage(command: string, description: string, usage?: string, examples?: string[]): string {
  let message = `🆘 **Help: ${command}**\n\n${description}`;
  
  if (usage) {
    message += `\n\n**Usage:**\n\`${usage}\``;
  }
  
  if (examples && examples.length > 0) {
    message += `\n\n**Examples:**`;
    examples.forEach((example, index) => {
      message += `\n${index + 1}. \`${example}\``;
    });
  }
  
  return message;
}

// Generate stats message
export function generateStatsMessage(title: string, stats: Record<string, any>): string {
  let message = `📊 **${title}**\n\n`;
  
  Object.entries(stats).forEach(([key, value]) => {
    const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    const formattedValue = typeof value === 'number' ? value.toLocaleString() : value;
    message += `**${formattedKey}:** ${formattedValue}\n`;
  });
  
  return message;
} 