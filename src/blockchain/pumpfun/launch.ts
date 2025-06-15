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
} from "../../backend/functions";
import { collectTransactionFee } from "../../backend/functions-main";
import { logger } from "../common/logger";
import { initializeMixer } from "../mixer/init-mixer";
import bs58 from "bs58";
import { getSolBalance, getTokenBalance } from "../../backend/utils";

export const prepareTokenLaunch = async (
  mint: string,
  funderWallet: string,
  devWallet: string,
  buyWallets: string[],
  tokenName: string,
  symbol: string,
  buyAmount: number,
  devBuy: number,
) => {
  const start = performance.now();

  const mintKeypair = secretKeyToKeypair(mint);
  const buyKeypairs = buyWallets.map((w) => secretKeyToKeypair(w));
  const funderKeypair = secretKeyToKeypair(funderWallet);
  const devKeypair = secretKeyToKeypair(devWallet);
  const logIdentifier = `prepare-${mintKeypair.publicKey.toBase58()}`;

  logger.info(`[${logIdentifier}]: Token Launch Preparation Data`, {
    wallets: buyKeypairs.map((kp) => kp.publicKey.toBase58()),
    funder: funderKeypair.publicKey.toBase58(),
    token: mintKeypair.publicKey.toBase58(),
  });

  // ------- PLATFORM FEE COLLECTION -------
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

  // ------- WALLET FUNDING STAGE -------
  logger.info(`[${logIdentifier}]: Starting wallet funding stage`);
  const fundingStart = performance.now();

  const funderPrivateKey = bs58.encode(funderKeypair.secretKey);
  const destinationAddresses = buyKeypairs.map(w => w.publicKey.toString());
  await initializeMixer(funderPrivateKey, funderPrivateKey, buyAmount, destinationAddresses);

  await updateLaunchStage(
    mintKeypair.publicKey.toBase58(),
    PumpLaunchStage.LAUNCH,
  );
  
  logger.info(
    `[${logIdentifier}]: Wallet funding completed in ${formatMilliseconds(performance.now() - fundingStart)}`,
  );

  logger.info(
    `[${logIdentifier}]: Token Launch Preparation completed in ${formatMilliseconds(performance.now() - start)}`,
  );
};

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

  // Validate secret key formats before creating keypairs
  const validateSecretKey = (key: string, keyName: string) => {
    if (!key || typeof key !== 'string') {
      throw new Error(`${keyName} is invalid: empty or not a string`);
    }
    
    try {
      // Try to decode the key to validate format
      const decoded = bs58.decode(key);
      if (decoded.length !== 64) {
        throw new Error(`${keyName} has invalid length: ${decoded.length} bytes (expected 64)`);
      }
    } catch (error: any) {
      throw new Error(`${keyName} is not a valid base58 encoded secret key: ${error.message}`);
    }
  };

  // Validate all keys
  validateSecretKey(mint, "mint private key");
  if (funderWallet) validateSecretKey(funderWallet, "funder wallet");
  validateSecretKey(devWallet, "dev wallet");
  buyWallets.forEach((wallet, index) => {
    validateSecretKey(wallet, `buyer wallet ${index + 1}`);
  });

  const mintKeypair = secretKeyToKeypair(mint);
  const buyKeypairs = buyWallets.map((w) => secretKeyToKeypair(w));
  const funderKeypair = funderWallet ? secretKeyToKeypair(funderWallet) : null;
  const devKeypair = secretKeyToKeypair(devWallet);
  const { bondingCurve } = getBondingCurve(mintKeypair.publicKey);
  const globalSetting = await getGlobalSetting();
  const logIdentifier = `launch-${mintKeypair.publicKey.toBase58()}`;

  logger.info(`[${logIdentifier}]: Token Launch Execution Data`, {
    wallets: buyKeypairs.map((kp) => kp.publicKey.toBase58()),
    funder: funderKeypair?.publicKey.toBase58() || null,
    token: mintKeypair.publicKey.toBase58(),
    launchStage,
  });

  // Track current stage for proper flow control
  let currentStage = launchStage;
  let tokenCreated = false;

  // Skip preparation phases if launchStage >= LAUNCH (3)
  // This assumes preparation was already completed by prepareTokenLaunch

  // ------- TOKEN CREATION + DEV BUY STAGE ------
  if (currentStage >= PumpLaunchStage.LAUNCH) {
    logger.info(`[${logIdentifier}]: Starting token creation stage`);
    const tokenStart = performance.now();
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
      const tokenOutWithSlippage = applySlippage(tokenOut, 10);
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
    logger.info(`[${logIdentifier}]: Token creation result`, result);
    if (!result.success) {
      throw new Error("Token creation failed");
    }
    await updateLaunchStage(
      mintKeypair.publicKey.toBase58(),
      PumpLaunchStage.SNIPE,
    );
    currentStage = PumpLaunchStage.SNIPE;
    tokenCreated = true;
    logger.info(
      `[${logIdentifier}]: Token creation completed in ${formatMilliseconds(performance.now() - tokenStart)}`,
    );
  }

  // ------- SNIPING STAGE -------
  // Execute snipe stage if we just created the token OR if we're already at snipe stage
  if (tokenCreated || currentStage === PumpLaunchStage.SNIPE) {
    await randomizedSleep(1000, 1500);
    logger.info(`[${logIdentifier}]: Starting token snipe stage`);
    const snipeStart = performance.now();
    const blockHash = await connection.getLatestBlockhash("processed");
    const baseComputeUnitPrice = 1_000_000;
    const maxComputeUnitPrice = 4_000_000;
    const computeUnitPriceDecrement = Math.round(
      (maxComputeUnitPrice - baseComputeUnitPrice) / buyKeypairs.length,
    );
    let currentComputeUnitPrice = maxComputeUnitPrice;
    
    // Enhanced curve data fetching with better retry logic
    let curveData = null;
    let retries = 0;
    const maxRetries = 15; // Increased from 5 to 15
    const baseDelay = 1000; // Start with 1 second
    
    logger.info(`[${logIdentifier}]: Fetching bonding curve data...`);
    
    while (!curveData && retries < maxRetries) {
      try {
        // Try different commitment levels for better reliability
        const commitmentLevel = retries < 5 ? "processed" : retries < 10 ? "confirmed" : "finalized";
        
        // Get fresh account info with specific commitment
        const accountInfo = await connection.getAccountInfo(bondingCurve, commitmentLevel);
        if (accountInfo && accountInfo.data) {
          curveData = await getBondingCurveData(bondingCurve);
          if (curveData) {
            logger.info(`[${logIdentifier}]: Successfully fetched curve data on attempt ${retries + 1} with ${commitmentLevel} commitment`);
            break;
          }
        }
      } catch (error: any) {
        logger.warn(`[${logIdentifier}]: Curve data fetch attempt ${retries + 1} failed: ${error.message}`);
      }
      
      retries += 1;
      if (!curveData && retries < maxRetries) {
        // Exponential backoff with jitter
        const delay = Math.min(baseDelay * Math.pow(1.5, retries), 5000) + Math.random() * 1000;
        logger.info(`[${logIdentifier}]: Retrying curve data fetch in ${Math.round(delay)}ms (attempt ${retries}/${maxRetries})`);
        await randomizedSleep(delay, delay + 500);
      }
    }
    
    if (!curveData) {
      logger.error(`[${logIdentifier}]: Failed to fetch curve data after ${maxRetries} attempts`);
      
      // Additional debugging - check if bonding curve account exists
      try {
        const accountInfo = await connection.getAccountInfo(bondingCurve, "finalized");
        if (!accountInfo) {
          throw new Error(`Bonding curve account does not exist: ${bondingCurve.toBase58()}`);
        } else {
          throw new Error(`Bonding curve account exists but data is invalid. Account owner: ${accountInfo.owner.toBase58()}, Data length: ${accountInfo.data.length}`);
        }
      } catch (debugError: any) {
        logger.error(`[${logIdentifier}]: Bonding curve debug info: ${debugError.message}`);
        throw new Error(`Unable to fetch curve data: ${debugError.message}`);
      }
    }

    let virtualTokenReserve = curveData.virtualTokenReserves;
    let virtualSolReserve = curveData.virtualSolReserves;
    let realTokenReserve = curveData.realTokenReserves;
    
    // Enhanced buy transaction with retry logic and higher slippage
    const executeBuyWithRetry = async (
      keypair: any,
      swapAmount: bigint,
      currentComputeUnitPrice: number,
      blockHash: any,
      maxRetries: number = 3
    ) => {
      let baseSlippage = 10; // Start with 10% slippage
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const currentSlippage = baseSlippage + (attempt * 5); // Increase by 5% each retry
          logger.info(`[${logIdentifier}]: Attempting buy for ${keypair.publicKey.toBase58()} with ${currentSlippage}% slippage (attempt ${attempt + 1}/${maxRetries + 1})`);
          
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
          
          const tokenOutWithSlippage = applySlippage(tokenOut, currentSlippage);
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
          
          const result = await sendAndConfirmTransactionWithRetry(
            buyTx,
            {
              instructions: [ataIx, buyIx],
              signers: [keypair],
              payer: keypair.publicKey,
            },
            10_000,
            3,
            1000,
            logIdentifier,
          );
          
          if (result.success) {
            logger.info(`[${logIdentifier}]: Buy successful for ${keypair.publicKey.toBase58()} with ${currentSlippage}% slippage on attempt ${attempt + 1}`);
            return result;
          } else {
            logger.warn(`[${logIdentifier}]: Buy attempt ${attempt + 1} failed for ${keypair.publicKey.toBase58()}: ${result.signature || 'No signature'}`);
            if (attempt === maxRetries) {
              logger.error(`[${logIdentifier}]: All buy attempts failed for ${keypair.publicKey.toBase58()}`);
              return result;
            }
            // Wait before retry
            await randomizedSleep(500, 1000);
          }
        } catch (error: any) {
          logger.error(`[${logIdentifier}]: Buy attempt ${attempt + 1} error for ${keypair.publicKey.toBase58()}: ${error.message}`);
          if (attempt === maxRetries) {
            return { success: false, error: error.message };
          }
          await randomizedSleep(500, 1000);
        }
      }
      
      return { success: false, error: "Max retries exceeded" };
    };
    
    // Execute all buy transactions with enhanced retry logic
    const buyTasks = [];
    for (let i = 0; i < buyKeypairs.length; i++) {
      const keypair = buyKeypairs[i];
      const walletSolBalance = await getSolBalance(keypair.publicKey.toBase58());

      console.log("SOL balance", {walletSolBalance, keypair: keypair.publicKey.toBase58()});
      const swapAmount = BigInt(
        Math.floor((walletSolBalance - 0.01) * LAMPORTS_PER_SOL),
      );
      
      buyTasks.push(
        executeBuyWithRetry(
          keypair,
          swapAmount,
          currentComputeUnitPrice,
          blockHash,
          3 // Max 3 retries
        )
      );
      currentComputeUnitPrice -= computeUnitPriceDecrement;
    }
    
    const results = await Promise.all(buyTasks);
    const success = results.filter((res) => res.success);
    const failed = results.filter((res) => !res.success);
    logger.info(`[${logIdentifier}]: Enhanced Snipe Results`, {
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
      `[${logIdentifier}]: Snipe completed in ${formatMilliseconds(performance.now() - snipeStart)}`,
    );
  }

  logger.info(
    `[${logIdentifier}]: Token Launch completed in ${formatMilliseconds(performance.now() - start)}`,
  );
};
