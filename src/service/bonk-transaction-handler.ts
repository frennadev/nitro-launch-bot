import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BonkService from "./bonk-service";
import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes";
import { connection } from "./config";
import { logger } from "../jobs/logger";

const CONFIG_MODE = "default";

const getConfigForMode = (mode: string) => {
  switch (mode.toLowerCase()) {
    case "conservative":
      return {
        baseSlippage: 40,
        maxSlippage: 60,
        maxRetries: 2,
        retrySlippageBonus: 5,
        lowLiquidityThreshold: 8,
        mediumLiquidityThreshold: 25,
      };
    case "aggressive":
      return {
        baseSlippage: 50,
        maxSlippage: 80,
        maxRetries: 5,
        retrySlippageBonus: 15,
        lowLiquidityThreshold: 3,
        mediumLiquidityThreshold: 15,
      };
    case "maximum":
      return {
        baseSlippage: 60,
        maxSlippage: 90,
        maxRetries: 3,
        retrySlippageBonus: 20,
        lowLiquidityThreshold: 1,
        mediumLiquidityThreshold: 10,
      };
    case "ultra":
      return {
        baseSlippage: 70,
        maxSlippage: 95,
        maxRetries: 4,
        retrySlippageBonus: 25,
        lowLiquidityThreshold: 0.5,
        mediumLiquidityThreshold: 5,
      };
    case "default":
    default:
      return {
        baseSlippage: 35,
        maxSlippage: 70,
        maxRetries: 3,
        retrySlippageBonus: 10,
        lowLiquidityThreshold: 5,
        mediumLiquidityThreshold: 20,
      };
  }
};

export async function executeBonkBuy(
  privateKey: string,
  tokenMint: string,
  buyAmountInSol: number = 0.001,
  configMode: string = CONFIG_MODE
) {
  const logId = `bonk-buy-${tokenMint.substring(0, 8)}`;
  logger.info(`[${logId}]: 🚀 Starting BONK buy test...`);
  logger.info(`[${logId}]: 🪙 Token mint: ${tokenMint}`);
  logger.info(`[${logId}]: ⚙️  Config mode: ${configMode}`);

  // Create wallet from private key (base58 format)
  const privateKeyBytes = bs58.decode(privateKey);
  const wallet = Keypair.fromSecretKey(privateKeyBytes);

  logger.info(`[${logId}]: 👛 Wallet address: ${wallet.publicKey.toBase58()}`);

  try {
    // Check balance
    const balance = await connection.getBalance(wallet.publicKey);
    logger.info(`[${logId}]: 💰 SOL balance: ${balance / LAMPORTS_PER_SOL} SOL`);

    if (balance < 0.01 * LAMPORTS_PER_SOL) {
      logger.error(`[${logId}]: ❌ Insufficient SOL balance (need at least 0.01 SOL)`);
      throw new Error("Insufficient SOL balance. Please top up your wallet.");
    }

    // Get configuration for the specified mode
    const config = getConfigForMode(configMode);
    logger.info(`[${logId}]: 🔧 Using configuration: ${configMode} mode`);

    // Create BonkService instance with the selected configuration
    const bonkService = new BonkService(config);
    const buyAmount = BigInt(buyAmountInSol * LAMPORTS_PER_SOL); // 0.001 SOL

    logger.info(
      `[${logId}]: [bonkhandler] ${buyAmount} SOL for ${privateKey.substring(0, 8)}..., ${tokenMint}`
    );

    // Set timeout for pool discovery
    const poolDiscoveryPromise = new Promise((resolve, reject) => {
      (async () => {
        try {
          const tx = await bonkService.buyTx({
            mint: new PublicKey(tokenMint),
            amount: buyAmount,
            privateKey: privateKey,
          });

          // Send the transaction
          const signature = await connection.sendTransaction(tx);
          logger.info(`[${logId}]: 📡 Transaction sent, waiting for confirmation...`);

          const confirmation = await connection.confirmTransaction(
            signature,
            "confirmed"
          );
          if (confirmation.value.err) {
            reject(
              new Error(
                `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
              )
            );
          } else {
            resolve(signature);
          }
        } catch (error) {
          reject(error);
        }
      })();
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            "⏰ Pool discovery timed out after 5 minutes. The pool might not exist or be in a different position."
          )
        );
      }, 300000); // 5 minute timeout
    });

    const result = await Promise.race([poolDiscoveryPromise, timeoutPromise]);
    if (!result) {
      throw new Error("Buy transaction failed to complete");
    }

    logger.info(`[${logId}]: ✅ Transaction successful!`);
    logger.info(`[${logId}]: 📝 Signature: ${result}`);
    logger.info(`[${logId}]: 🔗 Explorer: https://solscan.io/tx/${result}`);
    
    return {
      success: true,
      signature: result as string,
      explorerUrl: "https://solscan.io/tx/" + result,
      message: "Buy transaction executed successfully",
    };
  } catch (error: any) {
    logger.error(`[${logId}]: ❌ Test failed: ${error.message}`);

    if (error.message.includes("timeout")) {
      logger.info(`[${logId}]: 💡 Suggestions:`);
      logger.info(`[${logId}]:    - Try using a different RPC endpoint`);
      logger.info(`[${logId}]:    - Check your internet connection`);
      logger.info(`[${logId}]:    - Try again in a few minutes`);
      return {
        error: "Timeout",
        message:
          "Transaction timed out. Try using a different RPC endpoint or try again later",
      };
    } else if (error.message.includes("429")) {
      logger.info(`[${logId}]: 💡 RPC rate limit exceeded - try again later`);
      return {
        error: "RateLimit",
        message: "RPC rate limit exceeded - try again later",
      };
    } else if (error.message.includes("pool not found")) {
      logger.info(`[${logId}]: 💡 Token may not have a BONK pool or pool is inactive`);
      return {
        error: "PoolNotFound",
        message: "Token may not have a BONK pool or pool is inactive",
      };
    } else if (error.message.includes("ExceededSlippage")) {
      logger.info(`[${logId}]: 💡 Try using a more aggressive config mode:`);
      logger.info(`[${logId}]:    - 'aggressive' for volatile tokens`);
      logger.info(`[${logId}]:    - 'maximum' for extremely volatile tokens`);
      return {
        error: "ExceededSlippage",
        message:
          "Slippage exceeded the maximum allowed. Try a different config mode.",
      };
    }

    return {
      error: "TransactionFailed",
      message:
        error.message || "An unknown error occurred during the transaction",
    };
  }
}

export async function executeBonkSell(
  percentage: number,
  privateKey: string,
  tokenMint: string,
  tokenAmount?: number,
  configMode: string = CONFIG_MODE
) {
  const logId = `bonk-sell-${tokenMint.substring(0, 8)}`;
  logger.info(`[${logId}]: 🚀 Starting BONK sell test...`);
  logger.info(`[${logId}]: 🪙 Token mint: ${tokenMint}`);
  logger.info(`[${logId}]: ⚙️  Config mode: ${configMode}`);

  const privateKeyBytes = bs58.decode(privateKey);
  const wallet = Keypair.fromSecretKey(privateKeyBytes);

  try {
    const balance = await connection.getBalance(wallet.publicKey);
    logger.info(`[${logId}]: 💰 SOL balance: ${balance / LAMPORTS_PER_SOL} SOL`);

    const config = getConfigForMode(configMode);
    logger.info(`[${logId}]: 🔧 Using configuration: ${configMode} mode`);

    const bonkService = new BonkService(config);
    
    // Set timeout for pool discovery
    const poolDiscoveryPromise = new Promise((resolve, reject) => {
      (async () => {
        try {
          const tx = await bonkService.sellTx({
            mint: new PublicKey(tokenMint),
            amount: BigInt(tokenAmount || 0), // Will be calculated from percentage
            privateKey: privateKey,
            percentage: percentage,
          });

          const signature = await connection.sendTransaction(tx);
          logger.info(`[${logId}]: 📡 Sell transaction sent, waiting for confirmation...`);

          const confirmation = await connection.confirmTransaction(
            signature,
            "confirmed"
          );
          if (confirmation.value.err) {
            reject(
              new Error(
                `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
              )
            );
          } else {
            resolve(signature);
          }
        } catch (error) {
          reject(error);
        }
      })();
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("⏰ Sell transaction timed out after 5 minutes."));
      }, 300000);
    });

    const result = await Promise.race([poolDiscoveryPromise, timeoutPromise]);

    if (!result) {
      throw new Error("Sell transaction failed to complete");
    }

    logger.info(`[${logId}]: ✅ Sell transaction successful!`);
    logger.info(`[${logId}]: 📝 Signature: ${result}`);
    logger.info(`[${logId}]: 🔗 Explorer: https://solscan.io/tx/${result}`);

    return {
      success: true,
      signature: result,
      explorerUrl: "https://solscan.io/tx/" + result,
      message: "Sell transaction executed successfully",
    };
  } catch (error: any) {
    logger.error(`[${logId}]: ❌ Sell test failed: ${error.message}`);

    if (error.message.includes("No token balance found")) {
      return {
        error: "NoTokenBalance",
        message: "You don't have any tokens to sell",
      };
    } else if (error.message.includes("timeout")) {
      return {
        error: "Timeout",
        message:
          "Transaction timed out. Try using a different RPC endpoint or try again later",
      };
    } else if (error.message.includes("429")) {
      return {
        error: "RateLimit",
        message: "RPC rate limit exceeded - try again later",
      };
    } else if (error.message.includes("pool not found")) {
      return {
        error: "PoolNotFound",
        message: "Token may not have a BONK pool or pool is inactive",
      };
    } else if (error.message.includes("ExceededSlippage")) {
      return {
        error: "ExceededSlippage",
        message:
          "Slippage exceeded the maximum allowed. Try a different config mode.",
      };
    }

    return {
      error: "TransactionFailed",
      message:
        error.message || "An unknown error occurred during the transaction",
    };
  }
}

/**
 * Get available configuration modes
 */
export function getAvailableConfigModes() {
  return [
    {
      name: "conservative",
      description: "Lower slippage, fewer retries - safer but may fail more often",
      settings: getConfigForMode("conservative"),
    },
    {
      name: "default",
      description: "Balanced settings for most tokens",
      settings: getConfigForMode("default"),
    },
    {
      name: "aggressive",
      description: "Higher slippage, more retries - better success rate for volatile tokens",
      settings: getConfigForMode("aggressive"),
    },
    {
      name: "maximum",
      description: "Very high slippage for extremely volatile tokens",
      settings: getConfigForMode("maximum"),
    },
    {
      name: "ultra",
      description: "Maximum settings for the most volatile tokens",
      settings: getConfigForMode("ultra"),
    },
  ];
}

/**
 * Validate token mint address
 */
export function validateTokenMint(mintAddress: string): boolean {
  try {
    new PublicKey(mintAddress);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate private key format
 */
export function validatePrivateKey(privateKey: string): boolean {
  try {
    bs58.decode(privateKey);
    return true;
  } catch {
    return false;
  }
} 