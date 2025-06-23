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
import { markTokenAsPumpswap } from "../../bot";

export const handleSingleSell = async (
  mintPublicKey: PublicKey,
  sellerAddress: string,
  selltype: "percent" | "all",
  sellPercent?: number
) => {
  const wallet = await WalletModel.findOne({ publicKey: sellerAddress });
  const privateKey = decryptPrivateKey(wallet?.privateKey!);
  const sellerKeypair = Keypair.fromSecretKey(base58.decode(privateKey));
  const cachedPlatform = getCachedPlatform(mintPublicKey.toBase58());
  const pumpswapService = new PumpswapService();

  if (cachedPlatform === "pumpswap") {
    try {
      let amt: bigint;

      if (selltype === "all") {
        const tokenBalance = await getTokenBalance(mintPublicKey.toBase58(), sellerAddress);
        amt = BigInt(Math.floor(tokenBalance * LAMPORTS_PER_SOL));
      } else {
        const tokenBalance = await getTokenBalance(mintPublicKey.toBase58(), sellerAddress);
        const percentAmt = sellPercent! * tokenBalance;
        amt = BigInt(Math.floor(percentAmt * LAMPORTS_PER_SOL));
      }

      const sellTx = await pumpswapService.sellTx({
        mint: mintPublicKey,
        privateKey: base58.encode(sellerKeypair.secretKey),
        amount: amt
      });

      const signature = await connection.sendTransaction(sellTx, {
        skipPreflight: false,
        preflightCommitment: "processed",
      });

      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: sellTx.message.recentBlockhash!,
          lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
        },
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(`Pumpswap transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      markTokenAsPumpswap(mintPublicKey.toBase58());
      return {
        success: true,
        signature,
        platform: "pumpswap",
        solReceived: "Success",
      };
    } catch (pumpswapError: any) {}
  }

  try {
    const { bondingCurve } = getBondingCurve(mintPublicKey);
    const bondingCurveData = await getBondingCurveData(bondingCurve);

    if (!bondingCurveData) {
      throw new Error("Token bonding curve not found - cached data may be incorrect");
    }

    let amt: bigint;

    if (selltype === "all") {
      const tokenBalance = await getTokenBalance(mintPublicKey.toBase58(), sellerAddress);
      amt = BigInt(Math.floor(tokenBalance * LAMPORTS_PER_SOL));
    } else {
      const tokenBalance = await getTokenBalance(mintPublicKey.toBase58(), sellerAddress);
      const percentAmt = sellPercent! * tokenBalance;
      amt = BigInt(Math.floor(percentAmt * LAMPORTS_PER_SOL));
    }

    const sellIx = sellInstruction(
      mintPublicKey,
      new PublicKey(bondingCurveData.creator),
      sellerKeypair.publicKey,
      amt,
      BigInt(0)
    );

    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 151595,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1_000_000,
    });

    const blockHash = await connection.getLatestBlockhash("processed");
    const sellTx = new VersionedTransaction(
      new TransactionMessage({
        instructions: [modifyComputeUnits, addPriorityFee, sellIx],
        payerKey: sellerKeypair.publicKey,
        recentBlockhash: blockHash.blockhash,
      }).compileToV0Message()
    );

    sellTx.sign([sellerKeypair]);

    const result = await sendAndConfirmTransactionWithRetry(
      sellTx,
      {
        payer: sellerKeypair.publicKey,
        signers: [sellerKeypair],
        instructions: [modifyComputeUnits, addPriorityFee, sellIx],
      },
      10_000,
      3,
      1000,
      `single-sell`
    );

    if (!result.success) {
      throw new Error("PumpFun sell transaction failed");
    }

    markTokenAsPumpFun(mintPublicKey.toBase58());

    return {
      success: true,
      signature: result.signature!,
      platform: "pumpfun",
      solReceived: "Success",
    };
  } catch (error) {
    console.log("Error selling single token", error);
  }
};
