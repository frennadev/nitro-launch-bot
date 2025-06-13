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
  collectPlatformFee,
  collectTransactionFee,
} from "../../backend/functions-main";
import { logger } from "../common/logger";
import { initializeMixer } from "../mixer/init-mixer";
import bs58 from "bs58";
import { getSolBalance, getTokenBalance } from "../../backend/utils";

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
  // if (buyDistribution.length == 0) {
  //   buyDistribution = randomizeDistribution(buyAmount, buyKeypairs.length);
  //   await updateBuyDistribution(
  //     mintKeypair.publicKey.toBase58(),
  //     buyDistribution,
  //   );
  // }
  const { bondingCurve } = getBondingCurve(mintKeypair.publicKey);
  const globalSetting = await getGlobalSetting();
  const logIdentifier = `launch-${mintKeypair.publicKey.toBase58()}`;

  logger.info(`$[${logIdentifier}]: Token Launch Data`, {
    // buyDistribution,
    wallets: buyKeypairs.map((kp) => kp.publicKey.toBase58()),
    funder: funderKeypair.publicKey.toBase58(),
    token: mintKeypair.publicKey.toBase58(),
  });

  // ------- PLATFORM FEE COLLECTION -------
  if (launchStage == PumpLaunchStage.START) {
    logger.info(`[${logIdentifier}]: Collecting platform fee`);
    
    const feeResult = await collectPlatformFee(devWallet);
    if (!feeResult.success) {
      logger.error(`[${logIdentifier}]: Platform fee collection failed: ${feeResult.error}`);
      throw new Error(`Platform fee collection failed: ${feeResult.error}`);
    }
    
    if (feeResult.signature) {
      logger.info(`[${logIdentifier}]: Platform fee collected successfully. Signature: ${feeResult.signature}`);
    }

    await updateLaunchStage(
      mintKeypair.publicKey.toBase58(),
      PumpLaunchStage.FUNDING,
    );
    console.log('LAUNCHING')
    launchStage = PumpLaunchStage.FUNDING;
  }

  // ------- WALLET FUNDING STAGE -------
  if (launchStage === PumpLaunchStage.FUNDING) {
    logger.info(`[${logIdentifier}]: Starting wallet funding stage`);
    const start = performance.now();
    // const fundInstructions = (
    //   await Promise.all(
    //     buyKeypairs.map(async (keypair, idx) => {
    //       const solBalance = await connection
    //         .getBalance(keypair.publicKey)
    //         .then(BigInt);
    //       // amount for swap + extra for gas fees
    //       const targetBalance = BigInt(
    //         Math.floor(buyDistribution[idx] * LAMPORTS_PER_SOL) +
    //           0.02 * LAMPORTS_PER_SOL,
    //       );
    //       const needsSol = solBalance < targetBalance;
    //       if (needsSol) {
    //         return SystemProgram.transfer({
    //           fromPubkey: funderKeypair.publicKey,
    //           toPubkey: keypair.publicKey,
    //           lamports: targetBalance - solBalance,
    //         });
    //       }
    //       return null;
    //     }),
    //   )
    // ).filter((ix) => ix != null);
    // const blockHash = await connection.getLatestBlockhash("confirmed");
    // const fundTransactions = fundInstructions.map((ix) => {
    //   const message = new TransactionMessage({
    //     instructions: [ix],
    //     payerKey: funderKeypair.publicKey,
    //     recentBlockhash: blockHash.blockhash,
    //   }).compileToV0Message();
    //   const txn = new VersionedTransaction(message);
    //   txn.sign([funderKeypair]);
    //   return {
    //     signedTx: txn,
    //     setup: {
    //       payer: funderKeypair.publicKey,
    //       instructions: [ix],
    //       signers: [funderKeypair],
    //     },
    //   };
    // });
    // const txnChunks = chunkArray(fundTransactions, 4);
    // let results: { success: boolean; signature: string | null }[] = [];
    // for (const chunk of txnChunks) {
    //   const res = await Promise.all(
    //     chunk.map((data) =>
    //       sendAndConfirmTransactionWithRetry(
    //         data.signedTx,
    //         data.setup,
    //         10_000,
    //         3,
    //         1_000,
    //         logIdentifier,
    //       ),
    //     ),
    //   );
    //   results.push(...res);
    //   await randomizedSleep(1000, 1500);
    // }
    // logger.info(`[${logIdentifier}]: Wallet funding results`, results);
    // if (results.filter((res) => !res.success).length > 0) {
    //   throw new Error("Buy Wallet Funding Failed");
    // }

    const funderPrivateKey = bs58.encode(funderKeypair.secretKey)
    const destinationAddresses = buyKeypairs.map(w => {return w.publicKey.toString()})
    await initializeMixer(funderPrivateKey, funderPrivateKey, buyAmount, destinationAddresses )


    // I'll be using mixer to fund the buyers wallet 
    // ################# STARTing Mixer Here ##############
    await updateLaunchStage(
      mintKeypair.publicKey.toBase58(),
      PumpLaunchStage.LAUNCH,
    );
    launchStage = PumpLaunchStage.LAUNCH;
    logger.info(
      `[${logIdentifier}]: Wallet funding completed in ${formatMilliseconds(performance.now() - start)}`,
    );
  }

  // ------- TOKEN CREATION + DEV BUY STAGE ------
  if (launchStage === PumpLaunchStage.LAUNCH) {
    logger.info(`[${logIdentifier}]: Starting token launch stage`);
    const start = performance.now();
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
    const blockHash = await connection.getLatestBlockhash("confirmed");
    const launchTx = new VersionedTransaction(
      new TransactionMessage({
        instructions: launchInstructions,
        payerKey: devKeypair.publicKey,
        recentBlockhash: blockHash.blockhash,
      }).compileToV0Message(),
    );
    launchTx.sign([devKeypair, mintKeypair]);
    const result = await sendAndConfirmTransactionWithRetry(
      launchTx,
      {
        instructions: launchInstructions,
        payer: devKeypair.publicKey,
        signers: [devKeypair, mintKeypair],
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
    logger.info(
      `[${logIdentifier}]: Token launch completed in ${formatMilliseconds(performance.now() - start)}`,
    );
  }

  // ------- SNIPING STAGE -------
  if (launchStage === PumpLaunchStage.SNIPE) {
    await randomizedSleep(1000, 1500);
    logger.info(`[${logIdentifier}]: Starting token snipe stage`);
    const start = performance.now();
    const blockHash = await connection.getLatestBlockhash("processed");
    const baseComputeUnitPrice = 1_000_000;
    const maxComputeUnitPrice = 4_000_000;
    const computeUnitPriceDecrement = Math.round(
      (maxComputeUnitPrice - baseComputeUnitPrice) / buyKeypairs.length,
    );
    let currentComputeUnitPrice = maxComputeUnitPrice;
    let curveData = await getBondingCurveData(bondingCurve);
    let retries = 0;
    while (!curveData && retries < 5) {
      curveData = await getBondingCurveData(bondingCurve);
      retries += 1;
      if (!curveData) {
        await randomizedSleep(500, 1000);
      }
    }
    if (!curveData) {
      throw new Error("Unable to fetch curve data");
    }
    let virtualTokenReserve = curveData.virtualTokenReserves;
    let virtualSolReserve = curveData.virtualSolReserves;
    let realTokenReserve = curveData.realTokenReserves;
    const snipeSetups: {
      signedTx: VersionedTransaction;
      setup: TransactionSetup;
    }[] = [];
    for (let i = 0; i < buyKeypairs.length; i++) {
      const keypair = buyKeypairs[i];
      const walletSolBalance = await getSolBalance(keypair.publicKey.toBase58())

      console.log("SOL balance", {walletSolBalance, keypair: keypair.publicKey.toBase58()})
      const swapAmount = BigInt(
        Math.floor((walletSolBalance - 0.01) * LAMPORTS_PER_SOL),
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

    // ------- COLLECT TRANSACTION FEES FROM SUCCESSFUL BUYS -------
    logger.info(`[${logIdentifier}]: Collecting transaction fees from successful buys`);
    try {
      // Collect transaction fees from successful buy wallets
      const feeCollectionPromises = [];
      
      for (let i = 0; i < results.length; i++) {
        if (results[i].success) {
          const walletPrivateKey = buyWallets[i];
          const keypair = buyKeypairs[i];
          const walletSolBalance = await getSolBalance(keypair.publicKey.toBase58());
          const transactionAmount = Math.max(0, walletSolBalance - 0.01); // Amount used for buying (minus buffer)
          
          if (transactionAmount > 0) {
            feeCollectionPromises.push(
              collectTransactionFee(walletPrivateKey, transactionAmount, "buy")
            );
          }
        }
      }

      if (feeCollectionPromises.length > 0) {
        const feeResults = await Promise.all(feeCollectionPromises);
        const successfulFees = feeResults.filter((result: any) => result.success);
        const failedFees = feeResults.filter((result: any) => !result.success);
        
        const totalFeesCollected = successfulFees.reduce((sum: number, result: any) => {
          return sum + (result.feeAmount || 0);
        }, 0);
        
        logger.info(`[${logIdentifier}]: Transaction fee collection results`, {
          successful: successfulFees.length,
          failed: failedFees.length,
          totalFeesCollected
        });

        if (failedFees.length > 0) {
          logger.warn(`[${logIdentifier}]: Some transaction fees failed to collect`, failedFees);
        }
      } else {
        logger.info(`[${logIdentifier}]: No transaction fees to collect (no successful buys with sufficient balance)`);
      }
    } catch (error: any) {
      logger.error(`[${logIdentifier}]: Error collecting transaction fees:`, error);
      // Don't throw error here - transaction fees are secondary to main launch success
    }

    await updateLaunchStage(
      mintKeypair.publicKey.toBase58(),
      PumpLaunchStage.COMPLETE,
    );
    logger.info(
      `[${logIdentifier}]: Snipe completed in ${formatMilliseconds(performance.now() - start)}`,
    );
  }

  logger.info(
    `[${logIdentifier}]: Token Launch completed in ${formatMilliseconds(performance.now() - start)}`,
  );
};
