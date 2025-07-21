import {
  ComputeBudgetProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getBondingCurve, getBondingCurveData } from "../pumpfun/utils";
import { sellInstruction } from "../pumpfun";
import { WalletModel } from "../../backend/models";
import { decryptPrivateKey, getTokenBalance } from "../../backend/utils";
import base58 from "bs58";
import { connection } from "../../service/config";
import { sendAndConfirmTransactionWithRetry } from "./utils";
import { getCachedPlatform, markTokenAsPumpFun } from "../../service/token-detection-service";
import PumpswapService from "../../service/pumpswap-service";
import { executeExternalSell } from "../pumpfun/externalSell";
import { Context } from "grammy";

/**
 * Enhanced single sell using external sell mechanism with platform detection
 * This provides better reliability and platform detection compared to the old method
 */
export const handleSingleSell = async (
  mintPublicKey: PublicKey,
  sellerAddress: string,
  selltype: "percent" | "all",
  sellPercent?: number
) => {
  const logIdentifier = `single-sell-${mintPublicKey.toBase58().slice(0, 8)}`;
  
  try {
    // Get wallet data from database
    const wallet = await WalletModel.findOne({ publicKey: sellerAddress });
    if (!wallet || !wallet.privateKey) {
      throw new Error("Wallet not found or private key missing");
    }
    
    const privateKey = decryptPrivateKey(wallet.privateKey);
    const sellerKeypair = Keypair.fromSecretKey(base58.decode(privateKey));
    
    // Get current token balance
    const tokenBalance = await getTokenBalance(mintPublicKey.toBase58(), sellerAddress);
    if (tokenBalance <= 0) {
      throw new Error("No tokens to sell");
    }
    
    // Calculate amount to sell
    let amountToSell: number;
    if (selltype === "all") {
      amountToSell = tokenBalance;
    } else {
      if (!sellPercent || sellPercent <= 0 || sellPercent > 100) {
        throw new Error("Invalid sell percentage");
      }
      amountToSell = Math.floor(tokenBalance * (sellPercent / 100));
    }
    
    console.log(`[${logIdentifier}] Selling ${selltype === "all" ? "ALL" : sellPercent + "%"} of ${tokenBalance} tokens = ${amountToSell} tokens`);
    
    // Use enhanced external sell mechanism for better platform detection
    const result = await executeExternalSell(
      mintPublicKey.toBase58(),
      sellerKeypair,
      amountToSell,
      {} as Context // No context available in this function
    );
    
    if (!result.success) {
      throw new Error(`External sell failed: ${result.error}`);
    }
    
    console.log(`[${logIdentifier}] Single sell successful via ${result.platform}: ${result.signature}`);
    
    return {
      success: true,
      signature: result.signature,
      platform: result.platform,
      solReceived: result.solReceived,
    };
    
  } catch (error) {
    console.log(`[${logIdentifier}] Enhanced single sell failed:`, error);
    throw error;
  }
};
