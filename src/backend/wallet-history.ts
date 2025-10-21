import { Connection, PublicKey } from "@solana/web3.js";
import { getAllBuyerWallets, getWalletBalance } from "./functions";

const PUMPFUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

interface WalletWarmingStatus {
  id: string;
  publicKey: string;
  balance: number;
  hasSwapHistory: boolean;
  needsWarming: boolean;
}

/**
 * Check if a wallet has any PumpFun swap transaction history
 */
export async function hasSwapHistory(
  walletAddress: string,
  rpcUrl?: string
): Promise<boolean> {
  try {
    const connection = new Connection(
      rpcUrl || process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com"
    );

    const publicKey = new PublicKey(walletAddress);

    // Get signatures for transactions involving this wallet
    const signatures = await connection.getSignaturesForAddress(publicKey, {
      limit: 100, // Check last 100 transactions
    });

    if (signatures.length === 0) {
      return false;
    }

    // Check if any transactions involve PumpFun program
    for (const sig of signatures) {
      try {
        const tx = await connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx || !tx.transaction) continue;

        // Check if transaction involves PumpFun program
        const accountKeys = tx.transaction.message.accountKeys;
        const hasPumpFun = accountKeys.some(
          (key) => key.pubkey.toString() === PUMPFUN_PROGRAM_ID
        );

        if (hasPumpFun) {
          return true; // Found at least one PumpFun transaction
        }
      } catch (txError) {
        console.warn(`Failed to parse transaction ${sig.signature}:`, txError);
        continue;
      }
    }

    return false;
  } catch (error) {
    console.error(`Error checking swap history for ${walletAddress}:`, error);
    // On error, assume wallet needs warming (safer approach)
    return false;
  }
}

/**
 * Get warming status for all buyer wallets of a user
 */
export async function getBuyerWalletsWarmingStatus(
  userId: string
): Promise<{
  total: number;
  fresh: number;
  warmed: number;
  wallets: WalletWarmingStatus[];
}> {
  try {
    const buyerWallets = await getAllBuyerWallets(userId);

    if (buyerWallets.length === 0) {
      return {
        total: 0,
        fresh: 0,
        warmed: 0,
        wallets: [],
      };
    }

    console.log(
      `[wallet-history]: Checking warming status for ${buyerWallets.length} buyer wallets`
    );

    // Check history for all wallets in parallel (with rate limiting)
    const batchSize = 10; // Process 10 at a time to avoid rate limits
    const warmingStatus: WalletWarmingStatus[] = [];

    for (let i = 0; i < buyerWallets.length; i += batchSize) {
      const batch = buyerWallets.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (wallet) => {
          try {
            const [balance, hasHistory] = await Promise.all([
              getWalletBalance(wallet.publicKey),
              hasSwapHistory(wallet.publicKey),
            ]);

            return {
              id: wallet.id,
              publicKey: wallet.publicKey,
              balance,
              hasSwapHistory: hasHistory,
              needsWarming: !hasHistory && balance < 0.1, // Fresh and not already funded
            };
          } catch (error) {
            console.error(
              `Failed to check status for wallet ${wallet.publicKey}:`,
              error
            );
            // On error, mark as needing warming (safer)
            return {
              id: wallet.id,
              publicKey: wallet.publicKey,
              balance: 0,
              hasSwapHistory: false,
              needsWarming: true,
            };
          }
        })
      );

      warmingStatus.push(...batchResults);

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < buyerWallets.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const fresh = warmingStatus.filter((w) => !w.hasSwapHistory).length;
    const warmed = warmingStatus.filter((w) => w.hasSwapHistory).length;

    console.log(
      `[wallet-history]: Status - Total: ${buyerWallets.length}, Fresh: ${fresh}, Warmed: ${warmed}`
    );

    return {
      total: buyerWallets.length,
      fresh,
      warmed,
      wallets: warmingStatus,
    };
  } catch (error) {
    console.error("Error getting buyer wallets warming status:", error);
    throw error;
  }
}

/**
 * Check if specific wallets need warming (batch check)
 */
export async function checkWalletsNeedWarming(
  walletAddresses: string[]
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  const batchSize = 10;
  for (let i = 0; i < walletAddresses.length; i += batchSize) {
    const batch = walletAddresses.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (address) => {
        const hasHistory = await hasSwapHistory(address);
        return { address, needsWarming: !hasHistory };
      })
    );

    batchResults.forEach(({ address, needsWarming }) => {
      results.set(address, needsWarming);
    });

    if (i + batchSize < walletAddresses.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

