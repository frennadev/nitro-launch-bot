import {
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { connection } from "../common/connection";
import {
  chunkArray,
  formatMilliseconds,
  randomizeDistribution,
  randomizedSleep,
  secretKeyToKeypair,
  sendAndConfirmTransactionWithRetry,
} from "../common/utils";
import { buyInstruction, tokenCreateInstruction } from "./instructions";
import {
  applySlippage,
  getBondingCurve,
  getBondingCurveData,
  getGlobalSetting,
  quoteBuy,
} from "./utils";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PumpLaunchStage, type TransactionSetup } from "../common/types";
import {
  updateBuyDistribution,
  updateLaunchStage,
} from "../../backend/functions";
import { logger } from "../common/logger";

export const executeTokenLaunch = async (
  mint: string,
  funderWallet: string,
  devWallet: string,
  buyWallets: string[],
  buyDistribution: number[],
  tokenName: string,
  symbol: string,
  metadataUri: string,
  buyAmount: number,
  devBuy: number,
  launchStage: number,
) => {
  const start = performance.now();

  const mintKeypair = secretKeyToKeypair(mint);
  const buyKeypairs = buyWallets.map((w) => secretKeyToKeypair(w));
  const funderKeypair = secretKeyToKeypair(funderWallet);
  const devKeypair = secretKeyToKeypair(devWallet);
  if (buyDistribution.length == 0) {
    buyDistribution = randomizeDistribution(buyAmount, buyKeypairs.length);
    await updateBuyDistribution(
      mintKeypair.publicKey.toBase58(),
      buyDistribution,
    );
  }
  const { bondingCurve } = getBondingCurve(mintKeypair.publicKey);
  const globalSetting = await getGlobalSetting();
  const logIdentifier = `launch-${mintKeypair.publicKey.toBase58()}`;

  logger.info(`$[${logIdentifier}]: Token Launch Data`, {
    buyDistribution,
    wallets: buyKeypairs.map((kp) => kp.publicKey.toBase58()),
    funder: funderKeypair.publicKey.toBase58(),
    token: mintKeypair.publicKey.toBase58(),
  });

  if (launchStage == PumpLaunchStage.START) {
    await updateLaunchStage(
      mintKeypair.publicKey.toBase58(),
      PumpLaunchStage.FUNDING,
    );
    launchStage = PumpLaunchStage.FUNDING;
  }

  // ------- WALLET FUNDING STAGE -------
  if (launchStage === PumpLaunchStage.FUNDING) {
    logger.info(`[${logIdentifier}]: Starting wallet funding stage`);
    const start = performance.now()
    const fundInstructions = (
      await Promise.all(
        buyKeypairs.map(async (keypair, idx) => {
          const solBalance = await connection
            .getBalance(keypair.publicKey)
            .then(BigInt);
          // amount for swap + extra for gas fees
          const targetBalance = BigInt(
            Math.floor(buyDistribution[idx] * LAMPORTS_PER_SOL) +
              0.02 * LAMPORTS_PER_SOL,
          );
          const needsSol = solBalance < targetBalance;
          if (needsSol) {
            return SystemProgram.transfer({
              fromPubkey: funderKeypair.publicKey,
              toPubkey: keypair.publicKey,
              lamports: targetBalance - solBalance,
            });
          }
          return null;
        }),
      )
    ).filter((ix) => ix != null);
    const blockHash = await connection.getLatestBlockhash("processed");
    const fundTransactions = fundInstructions.map((ix) => {
      const message = new TransactionMessage({
        instructions: [ix],
        payerKey: funderKeypair.publicKey,
        recentBlockhash: blockHash.blockhash,
      }).compileToV0Message();
      const txn = new VersionedTransaction(message);
      txn.sign([funderKeypair]);
      return {
        signedTx: txn,
        setup: {
          payer: funderKeypair.publicKey,
          instructions: [ix],
          signers: [funderKeypair],
        },
      };
    });
    const txnChunks = chunkArray(fundTransactions, 4);
    let results: { success: boolean; signature: string | null }[] = [];
    for (const chunk of txnChunks) {
      const res = await Promise.all(
        chunk.map((data) =>
          sendAndConfirmTransactionWithRetry(
            data.signedTx,
            data.setup,
            10_000,
            3,
            1_000,
            logIdentifier,
          ),
        ),
      );
      results.push(...res);
      await randomizedSleep(1000, 1500);
    }
    logger.info(`[${logIdentifier}]: Wallet funding results`, results)
    if (results.filter((res) => !res.success).length > 0) {
      throw new Error("Buy Wallet Funding Failed");
    }
    await updateLaunchStage(
      mintKeypair.publicKey.toBase58(),
      PumpLaunchStage.LAUNCH,
    );
    launchStage = PumpLaunchStage.LAUNCH;
    logger.info(`[${logIdentifier}]: Wallet funding completed in ${formatMilliseconds(performance.now() - start)}`);
  }

  // ------- TOKEN CREATION + DEV BUY STAGE ------
  if (launchStage === PumpLaunchStage.LAUNCH) {
    const start = performance.now()
    const launchInstructions: TransactionInstruction[] = [];
    const createIx = tokenCreateInstruction(
      mintKeypair,
      devKeypair,
      tokenName,
      symbol,
      metadataUri,
    );
    launchInstructions.push(createIx);
    if (devBuy > 0) {
      const devAta = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        devKeypair.publicKey,
      );
      const createDevAtaIx = createAssociatedTokenAccountInstruction(
        devKeypair.publicKey,
        devAta,
        devKeypair.publicKey,
        mintKeypair.publicKey,
      );
      const devBuyLamports = BigInt(Math.floor(devBuy * LAMPORTS_PER_SOL));
      const { tokenOut } = quoteBuy(
        devBuyLamports,
        globalSetting.initialVirtualTokenReserves,
        globalSetting.initialVirtualSolReserves,
        globalSetting.initialRealTokenReserves,
      );
      const tokenOutWithSlippage = applySlippage(tokenOut, 2);
      const devBuyIx = buyInstruction(
        mintKeypair.publicKey,
        devKeypair.publicKey,
        devKeypair.publicKey,
        tokenOutWithSlippage,
        devBuyLamports,
      );
      launchInstructions.push(...[createDevAtaIx, devBuyIx]);
    }
    const blockHash = await connection.getLatestBlockhash("processed");
    const launchTx = new VersionedTransaction(
      new TransactionMessage({
        instructions: launchInstructions,
        payerKey: devKeypair.publicKey,
        recentBlockhash: blockHash.blockhash,
      }).compileToV0Message(),
    );
    launchTx.sign([devKeypair]);
    const result = await sendAndConfirmTransactionWithRetry(
      launchTx,
      {
        instructions: launchInstructions,
        payer: devKeypair.publicKey,
        signers: [devKeypair],
      },
      10_000,
      3,
      1000,
      logIdentifier,
    );
    logger.info(`[${logIdentifier}]: Token launch result`, result);
    if (!result.success) {
      throw new Error("Token launch failed");
    }
    await updateLaunchStage(
      mintKeypair.publicKey.toBase58(),
      PumpLaunchStage.SNIPE,
    );
    launchStage = PumpLaunchStage.SNIPE;
    logger.info(`[${logIdentifier}]: Token launch completed in ${formatMilliseconds(performance.now() - start)}`)
  }

  // ------- SNIPING STAGE -------
  if (launchStage === PumpLaunchStage.SNIPE) {
    const start = performance.now()
    const blockHash = await connection.getLatestBlockhash("processed");
    const baseComputeUnitPrice = 1_000_000;
    const maxComputeUnitPrice = 4_000_000;
    const computeUnitPriceDecrement = Math.round(
      (maxComputeUnitPrice - baseComputeUnitPrice) / buyKeypairs.length,
    );
    let currentComputeUnitPrice = maxComputeUnitPrice;
    const curveData = await getBondingCurveData(bondingCurve);
    let virtualTokenReserve = curveData.virtualTokenReserves;
    let virtualSolReserve = curveData.virtualSolReserves;
    let realTokenReserve = curveData.realTokenReserves;
    const snipeSetups: {
      signedTx: VersionedTransaction;
      setup: TransactionSetup;
    }[] = [];
    for (let i = 0; i < buyKeypairs.length; i++) {
      const keypair = buyKeypairs[i];
      const swapAmount = BigInt(
        Math.floor(buyDistribution[i] * LAMPORTS_PER_SOL),
      );
      const ata = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        keypair.publicKey,
      );
      const ataIx = createAssociatedTokenAccountIdempotentInstruction(
        keypair.publicKey,
        ata,
        keypair.publicKey,
        mintKeypair.publicKey,
      );
      const { tokenOut } = quoteBuy(
        swapAmount,
        virtualTokenReserve,
        virtualSolReserve,
        realTokenReserve,
      );
      const tokenOutWithSlippage = applySlippage(tokenOut, 3);
      const buyIx = buyInstruction(
        mintKeypair.publicKey,
        devKeypair.publicKey,
        keypair.publicKey,
        tokenOutWithSlippage,
        swapAmount,
      );
      const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: currentComputeUnitPrice,
      });
      const buyTx = new VersionedTransaction(
        new TransactionMessage({
          instructions: [addPriorityFee, ataIx, buyIx],
          payerKey: keypair.publicKey,
          recentBlockhash: blockHash.blockhash,
        }).compileToV0Message(),
      );
      buyTx.sign([keypair]);
      snipeSetups.push({
        signedTx: buyTx,
        setup: {
          instructions: [ataIx, buyIx],
          signers: [devKeypair],
          payer: devKeypair.publicKey,
        },
      });
      currentComputeUnitPrice -= computeUnitPriceDecrement;
    }
    const tasks = snipeSetups.map((setup) =>
      sendAndConfirmTransactionWithRetry(
        setup.signedTx,
        setup.setup,
        10_000,
        3,
        1000,
        logIdentifier,
      ),
    );
    const results = await Promise.all(tasks);
    const success = results.filter((res) => res.success);
    const failed = results.filter((res) => !res.success);
    logger.info(`[${logIdentifier}]: Snipe Results`, {
      success,
      failed,
    });
    if (success.length == 0) {
      throw new Error("Snipe Failed");
    }
    await updateLaunchStage(
      mintKeypair.publicKey.toBase58(),
      PumpLaunchStage.COMPLETE,
    );
    logger.info(`[${logIdentifier}]: Snipe completed in ${formatMilliseconds(performance.now() - start)}`)
  }

  logger.info(
    `[${logIdentifier}]: Token Launch completed in ${formatMilliseconds(performance.now() - start)}`,
  );
};
