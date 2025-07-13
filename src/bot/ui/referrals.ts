import { InlineKeyboard } from "grammy";

// Callback queries for referral system
export enum ReferralCallbacks {
  VIEW_REFERRALS = "view_referrals",
  REFRESH_REFERRALS = "refresh_referrals",
  SHARE_REFERRAL = "share_referral",
  BACK = "back",
}

// Mock referral data
export const mockReferralData = {
  userStats: {
    referralCount: 7,
    affiliateCode: "NITRO123",
    totalEarnings: 0.0,
    pendingRewards: 0.0
  },
  referralLink: "https://t.me/nitro_launch_bot?start=REF_NITRO123",
  recentReferrals: [
    { username: "@user1", joinedAt: "2024-01-15", status: "active" },
    { username: "@user2", joinedAt: "2024-01-14", status: "active" },
    { username: "@user3", joinedAt: "2024-01-13", status: "pending" },
    { username: "@user4", joinedAt: "2024-01-12", status: "active" },
    { username: "@user5", joinedAt: "2024-01-11", status: "active" }
  ],
  rewards: {
    perReferral: 0.01,
    minimumPayout: 0.1,
    nextPayout: 0.07
  }
};

// Main referral screen
export function generateReferralMainMessage(): string {
  const { userStats, referralLink, rewards } = mockReferralData;
  
  return `🔗 **Your Referral Program**

**Your Referral Link:**
\`${referralLink}\`

**Statistics:**
👥 **Total Referrals:** ${userStats.referralCount}
🆔 **Your Code:** \`${userStats.affiliateCode}\`
💰 **Total Earnings:** ${userStats.totalEarnings.toFixed(4)} SOL
⏳ **Pending Rewards:** ${userStats.pendingRewards.toFixed(4)} SOL

**Rewards System:**
• ${rewards.perReferral} SOL per successful referral
• Minimum payout: ${rewards.minimumPayout} SOL
• Next payout: ${rewards.nextPayout} SOL

**How it works:**
• Share your unique referral link with friends
• When someone joins using your link, they become your referral
• Track your progress and build your network

**Coming Soon:**
💰 Earn rewards for successful referrals
📊 Advanced analytics and insights`;
}

export function generateReferralMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔄 Refresh Stats", ReferralCallbacks.REFRESH_REFERRALS)
    .row()
    .text("📤 Share Link", ReferralCallbacks.SHARE_REFERRAL)
    .row()
    .text("📊 View Details", "view_referral_details")
    .row()
    .text("🔙 Back", ReferralCallbacks.BACK);
}

// Referral details screen
export function generateReferralDetailsMessage(): string {
  const { recentReferrals, rewards } = mockReferralData;
  
  let message = `📊 **Referral Details**

**Recent Referrals:**\n`;

  recentReferrals.forEach((referral, index) => {
    const statusEmoji = referral.status === "active" ? "✅" : "⏳";
    message += `${index + 1}. ${referral.username} ${statusEmoji}\n`;
    message += `   Joined: ${referral.joinedAt}\n`;
  });

  message += `\n**Rewards Progress:**
💰 Earned: ${rewards.perReferral * recentReferrals.filter(r => r.status === "active").length} SOL
🎯 Next Payout: ${rewards.nextPayout} SOL
📈 Progress: ${((rewards.nextPayout / rewards.minimumPayout) * 100).toFixed(1)}%

**Reward Tiers:**
🥉 5 referrals: 0.05 SOL bonus
🥈 10 referrals: 0.1 SOL bonus  
🥇 20 referrals: 0.25 SOL bonus`;

  return message;
}

export function generateReferralDetailsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔄 Refresh", ReferralCallbacks.REFRESH_REFERRALS)
    .row()
    .text("📤 Share Link", ReferralCallbacks.SHARE_REFERRAL)
    .row()
    .text("🔙 Back", ReferralCallbacks.BACK);
}

// Share referral screen
export function generateShareReferralMessage(): string {
  const { referralLink, userStats } = mockReferralData;
  
  return `📤 **Share Your Referral Link**

**Your Link:**
\`${referralLink}\`

**Quick Share Options:**
• Copy the link above
• Share via Telegram
• Share on social media

**Your Stats:**
👥 ${userStats.referralCount} friends joined
💰 ${userStats.totalEarnings.toFixed(4)} SOL earned

**Share Message Template:**
🚀 Join Nitro Bot and launch your own tokens on Pump.fun!

🔗 Use my referral link: ${referralLink}

✨ Features:
• Create tokens in minutes
• Untraceable trading
• No coding required

Start your token journey today! 🌟`;
}

export function generateShareReferralKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📋 Copy Link", "copy_referral_link")
    .row()
    .text("📤 Share on Telegram", "share_telegram")
    .row()
    .text("📱 Share on Social", "share_social")
    .row()
    .text("🔙 Back", ReferralCallbacks.BACK);
}

// Referral success screen
export function generateReferralSuccessMessage(): string {
  return `✅ **Referral Link Shared!**

Your referral link has been shared successfully.

**Next Steps:**
• Track your referrals in real-time
• Earn rewards when friends join
• Build your network

**Tips for Success:**
• Share on relevant communities
• Explain the benefits clearly
• Follow up with interested users

Keep sharing to grow your network! 🚀`;
}

export function generateReferralSuccessKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 View Stats", ReferralCallbacks.VIEW_REFERRALS)
    .row()
    .text("📤 Share Again", ReferralCallbacks.SHARE_REFERRAL)
    .row()
    .text("🔙 Back to Menu", ReferralCallbacks.BACK);
}

// Referral rewards screen
export function generateReferralRewardsMessage(): string {
  const { rewards, userStats } = mockReferralData;
  
  return `💰 **Referral Rewards**

**Current Earnings:**
💰 Total Earned: ${userStats.totalEarnings.toFixed(4)} SOL
⏳ Pending: ${userStats.pendingRewards.toFixed(4)} SOL
🎯 Next Payout: ${rewards.nextPayout} SOL

**Reward Structure:**
• ${rewards.perReferral} SOL per active referral
• Minimum payout: ${rewards.minimumPayout} SOL
• Automatic payouts every 24 hours

**Achievement Tiers:**
🥉 **Bronze (5 referrals):** 0.05 SOL bonus
🥈 **Silver (10 referrals):** 0.1 SOL bonus
🥇 **Gold (20 referrals):** 0.25 SOL bonus
💎 **Diamond (50 referrals):** 1.0 SOL bonus

**Progress to Next Tier:**
${userStats.referralCount}/10 referrals (Silver tier)
${((userStats.referralCount / 10) * 100).toFixed(1)}% complete

Keep referring friends to unlock more rewards! 🚀`;
}

export function generateReferralRewardsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📤 Share Link", ReferralCallbacks.SHARE_REFERRAL)
    .row()
    .text("📊 View Details", "view_referral_details")
    .row()
    .text("🔙 Back", ReferralCallbacks.BACK);
}

// Referral leaderboard screen
export function generateReferralLeaderboardMessage(): string {
  const leaderboard = [
    { rank: 1, username: "@top_referrer", referrals: 45, earnings: 0.45 },
    { rank: 2, username: "@crypto_king", referrals: 32, earnings: 0.32 },
    { rank: 3, username: "@token_master", referrals: 28, earnings: 0.28 },
    { rank: 4, username: "@solana_pro", referrals: 25, earnings: 0.25 },
    { rank: 5, username: "@nitro_user", referrals: 22, earnings: 0.22 }
  ];
  
  let message = `🏆 **Referral Leaderboard**

**Top Referrers This Month:**\n`;

  leaderboard.forEach((user) => {
    const medal = user.rank === 1 ? "🥇" : user.rank === 2 ? "🥈" : user.rank === 3 ? "🥉" : `${user.rank}.`;
    message += `${medal} ${user.username}\n`;
    message += `   👥 ${user.referrals} referrals | 💰 ${user.earnings} SOL\n`;
  });

  message += `\n**Your Position:** #15 (${mockReferralData.userStats.referralCount} referrals)

**Leaderboard Rewards:**
🥇 1st Place: 1.0 SOL bonus
🥈 2nd Place: 0.5 SOL bonus  
🥉 3rd Place: 0.25 SOL bonus

Keep referring to climb the leaderboard! 🚀`;

  return message;
}

export function generateReferralLeaderboardKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📤 Share Link", ReferralCallbacks.SHARE_REFERRAL)
    .row()
    .text("📊 My Stats", ReferralCallbacks.VIEW_REFERRALS)
    .row()
    .text("🔙 Back", ReferralCallbacks.BACK);
}

// Error handling
export function generateReferralErrorMessage(error: string): string {
  return `❌ **Referral Error**

**Error:** ${error}

**Possible Solutions:**
• Try refreshing the page
• Check your internet connection
• Contact support if the issue persists

Would you like to try again?`;
}

export function generateReferralErrorKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔄 Try Again", ReferralCallbacks.REFRESH_REFERRALS)
    .row()
    .text("🔙 Back", ReferralCallbacks.BACK);
} 