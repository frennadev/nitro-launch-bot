import { PublicKey } from "@solana/web3.js";
import { connection } from "../config";
import { logger } from "../../utils/logger";

// Known Heaven DEX tokens - add new tokens here as discovered
const KNOWN_HEAVEN_TOKENS = new Set([
  "E5MiyFHovnBAAhTU33BuBHAcqHUViGDycanq2tB1Z777", // Working token 1
  "4AqQwqAgG2wfsktsFopd6y6U593ptyLGbwgBK4Tjf777", // Working token 2
  "EWjrBdbkJrRHnwjfHi2W2Bf33juXAstcE4EhCR7EL777", // Successfully tested with dynamic discovery
  "EGCzaAELA2PuyjhMa3jRUFdda4SfNNF59aNrQtkJG777", // Successfully tested with dynamic discovery
  "DzKxMTFopuan4CJ78fcxNhhtCSCPB1qQje7Yebx3m777", // Successfully tested with dynamic discovery
  "9axRtbnACbzbWtNMGSLebJfLn6F8uZvCTC3V9Y4W7777", // Successfully tested with dynamic discovery
  "bFv5CEv5mEc711etroveLRSbBDk8zpjgLQ8P5coW777", // Successfully tested with dynamic discovery
]);

/**
 * Check if a token is supported by Heaven DEX
 * Uses known token list for fast detection
 */
export async function isHeavenSupportedToken(
  tokenAddress: string
): Promise<boolean> {
  const logId = `heaven-detect-${tokenAddress.substring(0, 8)}`;

  // Fast lookup for known tokens
  if (KNOWN_HEAVEN_TOKENS.has(tokenAddress)) {
    logger.info(`[${logId}] Token found in known Heaven tokens list`);
    return true;
  }

  // For unknown tokens, attempt pool discovery using the new working function
  try {
    logger.info(
      `[${logId}] Attempting Heaven pool discovery for unknown token`
    );
    const { discoverHeavenPool } = await import("./heaven-pool-discovery");
    const poolInfo = await discoverHeavenPool(tokenAddress, logId);

    if (poolInfo) {
      logger.info(`[${logId}] Heaven pool discovered - adding to known tokens`);
      // Add to known tokens for future fast lookup
      KNOWN_HEAVEN_TOKENS.add(tokenAddress);
      return true;
    }

    return false;
  } catch (error: any) {
    logger.debug(`[${logId}] Heaven detection failed: ${error.message}`);
    return false;
  }
}

const HEAVEN_PROGRAM_ID = new PublicKey(
  "HEAVENoP2qxoeuF8Dj2oT1GHEnu49U5mJYkdeC8BAX2o"
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const SYSVAR_INSTRUCTIONS = new PublicKey(
  "Sysvar1nstructions1111111111111111111111111"
);
const HEAVEN_EVENT_AUTHORITY = new PublicKey(
  "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny"
);

export interface HeavenDiscoveredPool {
  poolConfig: PublicKey;
  tokenVault: PublicKey; // token-2022 token account (source)
  tokenRecipient?: PublicKey; // token-2022 recipient (destination)
  wsolVault: PublicKey; // SPL token account for NATIVE_MINT
  extraConfig?: PublicKey;
  programDerived?: PublicKey;
}

function extractPubkeysFromData(data: Buffer): PublicKey[] {
  const keys: PublicKey[] = [];
  for (let i = 0; i + 32 <= data.length; i += 1) {
    try {
      const pk = new PublicKey(data.subarray(i, i + 32));
      keys.push(pk);
    } catch {}
  }
  // de-dup
  const seen = new Set<string>();
  return keys.filter((k) => {
    const s = k.toBase58();
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

async function safeGetAccountInfo(pk: PublicKey) {
  try {
    return await connection.getAccountInfo(pk, "confirmed");
  } catch {
    return null;
  }
}

export async function discoverHeavenPoolForMint(
  tokenMint: PublicKey,
  nativeMint: PublicKey,
  excludeOwner?: PublicKey,
  userTokenAtaHint?: PublicKey,
  userOwner?: PublicKey
): Promise<HeavenDiscoveredPool | null> {
  const mintBytes = tokenMint.toBytes();
  const candidates = await connection.getProgramAccounts(HEAVEN_PROGRAM_ID, {
    filters: [{ dataSize: 2304 }],
    commitment: "confirmed",
  });

  for (const c of candidates) {
    const data = c.account.data as Buffer;
    // quick contains check
    let contains = false;
    for (let i = 0; i + 32 <= data.length; i++) {
      let match = true;
      for (let j = 0; j < 32; j++) {
        if (data[i + j] !== mintBytes[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        contains = true;
        break;
      }
    }
    if (!contains) continue;

    const keys = extractPubkeysFromData(data);

    let tokenVault: PublicKey | undefined;
    let tokenRecipient: PublicKey | undefined;
    let wsolVault: PublicKey | undefined;
    let extraConfig: PublicKey | undefined;
    let programDerived: PublicKey | undefined;

    const token2022Candidates: PublicKey[] = [];
    for (const k of keys) {
      const info = await safeGetAccountInfo(k);
      if (!info) continue;
      // token-2022 token account likely size ~182 and owned by token-2022 program
      if (info.owner.equals(TOKEN_2022_PROGRAM_ID) && info.data.length >= 165) {
        const accMint = new PublicKey(info.data.subarray(0, 32));
        if (accMint.equals(tokenMint)) token2022Candidates.push(k);
      }
      // SPL Token WSOL token account owned by token program and mint == native
      if (
        !wsolVault &&
        info.owner.equals(TOKEN_PROGRAM_ID) &&
        info.data.length >= 165
      ) {
        const accMint = new PublicKey(info.data.subarray(0, 32));
        if (accMint.equals(nativeMint)) {
          wsolVault = k;
          // console.log("[heaven] found wsol vault:", k.toBase58());
        }
      }
      // extra config: owned by HEAVEN program but not the poolConfig itself
      if (
        !extraConfig &&
        info.owner.equals(HEAVEN_PROGRAM_ID) &&
        !k.equals(c.pubkey)
      ) {
        extraConfig = k;
      }
      // program derived: owned by event authority program
      if (info.owner.equals(HEAVEN_EVENT_AUTHORITY)) {
        programDerived = k;
      }
    }

    // Refine vault selection: prefer accounts whose token account OWNER equals extraConfig (pool authority)
    if (extraConfig) {
      // Prefer pool configs where one token-2022 account matches the user's ATA
      if (
        userTokenAtaHint &&
        token2022Candidates.some((c) => c.equals(userTokenAtaHint))
      ) {
        const other = token2022Candidates.find(
          (c) => !c.equals(userTokenAtaHint)
        );
        if (other) {
          tokenRecipient = userTokenAtaHint;
          tokenVault = other;
        }
      }
      // If not set yet, find tokenRecipient where inner owner equals userOwner (the payer)
      if (!tokenRecipient && userOwner) {
        for (const k of token2022Candidates) {
          const info = await safeGetAccountInfo(k);
          if (!info) continue;
          const accMint = new PublicKey(info.data.subarray(0, 32));
          if (!accMint.equals(tokenMint)) continue;
          const innerOwner = new PublicKey(info.data.subarray(32, 64));
          if (innerOwner.equals(userOwner)) {
            tokenRecipient = k;
            break;
          }
        }
      }
      // Token-2022 vault/recipient (program-owned token accounts for this mint)
      for (const k of token2022Candidates) {
        if (tokenVault && tokenRecipient) break;
        const info = await safeGetAccountInfo(k);
        if (!info) continue;
        const accMint = new PublicKey(info.data.subarray(0, 32));
        if (!accMint.equals(tokenMint)) continue;
        const accOwner = new PublicKey(info.data.subarray(32, 64));
        if (
          !accOwner.equals(extraConfig) ||
          (excludeOwner && accOwner.equals(excludeOwner))
        )
          continue;
        // classify later using balances
      }
      // 🔥 OPTIMIZED: Search for Heaven token vaults using memcmp filters (like Meteora/Bonk/Pumpfun)
      const filtered: PublicKey[] = [];
      try {
        console.log(
          `[heaven] Searching for token vaults containing mint ${tokenMint.toBase58()}`
        );

        // Search Token-2022 program for vaults with our mint (these will be owned by extraConfig)
        const token2022Accounts = await connection.getProgramAccounts(
          TOKEN_2022_PROGRAM_ID,
          {
            commitment: "confirmed",
            filters: [
              { dataSize: 165 }, // Standard Token-2022 account size
              {
                memcmp: {
                  offset: 0, // Token mint is at offset 0
                  bytes: tokenMint.toBase58(),
                },
              },
            ],
          }
        );

        console.log(
          `[heaven] Found ${token2022Accounts.length} Token-2022 accounts for this mint`
        );

        // Filter for accounts owned by extraConfig (pool vaults)
        for (const { pubkey, account } of token2022Accounts) {
          const data = account.data as Buffer;
          if (data.length >= 64) {
            const owner = new PublicKey(data.subarray(32, 64));
            if (owner.equals(extraConfig)) {
              filtered.push(pubkey);
              console.log(
                `[heaven] Found extraConfig-owned token vault: ${pubkey.toBase58()}`
              );
            }
          }
        }

        // Also search regular Token program for WSOL vaults owned by extraConfig
        const wsolAccounts = await connection.getProgramAccounts(
          TOKEN_PROGRAM_ID,
          {
            commitment: "confirmed",
            filters: [
              { dataSize: 165 }, // Standard token account size
              {
                memcmp: {
                  offset: 0, // Token mint is at offset 0
                  bytes: nativeMint.toBase58(), // WSOL mint
                },
              },
              {
                memcmp: {
                  offset: 32, // Owner is at offset 32
                  bytes: extraConfig.toBase58(), // Only extraConfig-owned accounts
                },
              },
            ],
          }
        );

        console.log(
          `[heaven] Found ${wsolAccounts.length} extraConfig-owned WSOL accounts`
        );

        // Set wsolVault from the filtered results
        if (wsolAccounts.length > 0 && !wsolVault) {
          wsolVault = wsolAccounts[0].pubkey;
          console.log(
            `[heaven] Found extraConfig-owned WSOL vault: ${wsolVault.toBase58()}`
          );
        }
      } catch (e) {
        console.log("[heaven] Failed to search with memcmp filters:", e);
      }

      // Handle pools with exactly 1 token vault (most common case)
      if (filtered.length === 1) {
        tokenVault = filtered[0];
        tokenRecipient = undefined; // Will be set to user ATA later
        console.log(
          `[heaven] only one token2022 account found: ${tokenVault.toBase58()}`
        );
      } else if (filtered.length >= 2) {
        const balances: { k: PublicKey; amount: bigint }[] = [];
        for (const k of filtered) {
          try {
            const b = await connection.getTokenAccountBalance(k, "confirmed");
            balances.push({ k, amount: BigInt(b.value.amount) });
          } catch {
            balances.push({ k, amount: 0n }); // Include even if balance fetch fails
          }
        }
        balances.sort((a, b) => (a.amount < b.amount ? 1 : -1));

        // Vault = highest balance, recipient = second highest (or lowest if only 2)
        if (!tokenVault && balances[0]) tokenVault = balances[0].k;
        if (!tokenRecipient && balances[1]) tokenRecipient = balances[1].k;

        console.log("[heaven] token2022 accounts for mint:", {
          filtered: filtered.map((k) => k.toBase58()),
          balances: balances.map((b) => ({
            account: b.k.toBase58(),
            amount: b.amount.toString(),
          })),
          selectedVault: tokenVault?.toBase58(),
          selectedRecipient: tokenRecipient?.toBase58(),
        });
      } else if (filtered.length === 1) {
        // Only one account found - use it as vault, recipient will be undefined
        tokenVault = filtered[0];
        console.log(
          "[heaven] only one token2022 account found:",
          filtered[0].toBase58()
        );
      }
      // WSOL SPL vault
      for (const k of keys) {
        if (wsolVault) break;
        const info = await safeGetAccountInfo(k);
        if (!info) continue;
        if (info.owner.equals(TOKEN_PROGRAM_ID) && info.data.length >= 165) {
          const accMint = new PublicKey(info.data.subarray(0, 32));
          if (accMint.equals(nativeMint)) {
            const accOwner = new PublicKey(info.data.subarray(32, 64));
            if (
              accOwner.equals(extraConfig) &&
              (!excludeOwner || !accOwner.equals(excludeOwner))
            ) {
              wsolVault = k;
              break;
            }
          }
        }
      }
    }

    if (tokenVault && wsolVault) {
      return {
        poolConfig: c.pubkey,
        tokenVault,
        tokenRecipient,
        wsolVault,
        extraConfig,
        programDerived,
      };
    }
  }

  return null;
}
