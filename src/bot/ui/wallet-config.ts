import { InlineKeyboard } from "grammy";

// Callback queries for wallet configuration
export enum WalletConfigCallbacks {
  CHANGE_DEV_WALLET = "change_dev_wallet",
  GENERATE_FUNDING_WALLET = "generate_funding_wallet",
  MANAGE_BUYER_WALLETS = "manage_buyer_wallets",
  WITHDRAW_DEV_WALLET = "withdraw_dev_wallet",
  WITHDRAW_FUNDING_WALLET = "withdraw_funding_wallet",
  WITHDRAW_BUYER_WALLETS = "withdraw_buyer_wallets",
  BACK = "back",
}

// Mock wallet data
export const mockWalletData = {
  devWallet: {
    address: "H497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF",
    balance: 2.4567,
    isDefault: true
  },
  fundingWallet: {
    address: "8xK8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP",
    balance: 1.2345
  },
  buyerWallets: [
    { address: "7xK8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP", balance: 0.5 },
    { address: "6xK8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP", balance: 0.3 },
    { address: "5xK8DxXxDnxJ63Fc8DGja8xQnG1fgLshtKyLn9nkpUMP", balance: 0.2 }
  ]
};

// Main wallet configuration screen
export function generateWalletConfigMessage(): string {
  const { devWallet, fundingWallet, buyerWallets } = mockWalletData;
  
  return `💼 **Wallet Configuration**

Configure and manage your wallets for token operations

**🔧 Developer Wallet:**
\`${devWallet.address}\`
💰 ${devWallet.balance.toFixed(4)} SOL ${devWallet.isDefault ? "⭐" : ""}

**💳 Funding Wallet:**
\`${fundingWallet.address}\`
💰 ${fundingWallet.balance.toFixed(4)} SOL

**👥 Buyer Wallets:** ${buyerWallets.length}/20 wallets
${buyerWallets.length > 0 ? "✅ Ready for launches" : "⚠️ No buyer wallets configured"}

💡 **Tip:** Ensure your funding wallet has sufficient SOL for token launches!`;
}

export function generateWalletConfigKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🛠️ Change Developer Wallet", WalletConfigCallbacks.CHANGE_DEV_WALLET)
    .row()
    .text("💰 Generate New Funding Wallet", WalletConfigCallbacks.GENERATE_FUNDING_WALLET)
    .row()
    .text("👥 Manage Buyer Wallets", WalletConfigCallbacks.MANAGE_BUYER_WALLETS)
    .row()
    .text("💸 Withdraw from Dev Wallet", WalletConfigCallbacks.WITHDRAW_DEV_WALLET)
    .row()
    .text("💸 Withdraw from Funding Wallet", WalletConfigCallbacks.WITHDRAW_FUNDING_WALLET)
    .row()
    .text("💸 Withdraw from Buyer Wallets", WalletConfigCallbacks.WITHDRAW_BUYER_WALLETS)
    .row()
    .text("🔙 Back", WalletConfigCallbacks.BACK);
}

// Dev wallet management
export function generateDevWalletManagementMessage(): string {
  const devWallets = [
    { address: "H497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF", isDefault: true, balance: 2.4567 },
    { address: "G497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF", isDefault: false, balance: 1.2345 },
    { address: "F497XdK28Tn5gvL859qmvLtm4qU9GLtgtnzAXiypcTWF", isDefault: false, balance: 0.8765 }
  ];

  let message = `**Developer Wallet Management**
You have **${devWallets.length}/5** dev wallets.

`;

  devWallets.forEach((wallet, index) => {
    const short = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
    const defaultIndicator = wallet.isDefault ? " ⭐" : "";
    message += `${index + 1}. \`${short}\`${defaultIndicator}\n`;
  });

  message += "\nSelect an action:";
  return message;
}

export function generateDevWalletManagementKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⭐ Set Default", "set_default_dev_1")
    .text("🗑️ Delete", "delete_dev_1")
    .row()
    .text("⭐ Set Default", "set_default_dev_2")
    .text("🗑️ Delete", "delete_dev_2")
    .row()
    .text("⭐ Set Default", "set_default_dev_3")
    .text("🗑️ Delete", "delete_dev_3")
    .row()
    .text("➕ Generate New Wallet", "generate_dev_wallet")
    .text("📥 Import Wallet", "import_dev_wallet")
    .row()
    .text("🔙 Back", WalletConfigCallbacks.BACK);
}

// Buyer wallet management
export function generateBuyerWalletManagementMessage(): string {
  const { buyerWallets } = mockWalletData;
  
  let message = `**👥 Buyer Wallet Management**
You have **${buyerWallets.length}/20** buyer wallets.

`;

  buyerWallets.forEach((wallet, index) => {
    const short = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
    message += `${index + 1}. \`${short}\`\n`;
  });

  if (buyerWallets.length === 0) {
    message += "*No buyer wallets configured*\n";
  }

  message += "\nSelect an action:";
  return message;
}

export function generateBuyerWalletManagementKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📤 Export", "export_buyer_1")
    .text("🗑️ Delete", "delete_buyer_1")
    .row()
    .text("📤 Export", "export_buyer_2")
    .text("🗑️ Delete", "delete_buyer_2")
    .row()
    .text("📤 Export", "export_buyer_3")
    .text("🗑️ Delete", "delete_buyer_3")
    .row()
    .text("➕ Generate New Wallet", "generate_buyer_wallet")
    .text("📥 Import Wallet", "import_buyer_wallet")
    .row()
    .text("🔙 Back", WalletConfigCallbacks.BACK);
}

// Withdrawal screens
export function generateWithdrawalPromptMessage(walletType: string, balance: number): string {
  return `💸 **Withdraw from ${walletType}**

**Current Balance:** ${balance.toFixed(4)} SOL

**Available Options:**
• Withdraw to external wallet
• Transfer to funding wallet
• Transfer to another wallet

Enter the amount to withdraw (in SOL):`;
}

export function generateWithdrawalKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("💸 Withdraw to External", "withdraw_external")
    .text("💳 Transfer to Funding", "transfer_funding")
    .row()
    .text("❌ Cancel", WalletConfigCallbacks.BACK);
}

// Export wallet screen
export function generateExportWalletMessage(walletAddress: string, privateKey: string): string {
  return `🔑 **Export Wallet**

**Wallet Address:**
\`${walletAddress}\`

**Private Key:**
\`${privateKey}\`

⚠️ **Security Warning:**
• Keep your private key safe and secret
• Never share it with anyone
• Store it securely offline

This wallet is now exported.`;
}

export function generateExportWalletKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Got it", WalletConfigCallbacks.BACK);
} 