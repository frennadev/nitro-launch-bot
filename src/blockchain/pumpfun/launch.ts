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
import { buyInstruction, tokenCreateInstruction, marketOrderBuyInstruction } from "./instructions";
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
  recordTransaction,
  getSuccessfulTransactions,
  isTransactionAlreadySuccessful,
  getTransactionStats,
} from "../../backend/functions";
import { collectTransactionFee } from "../../backend/functions-main";
import { logger } from "../common/logger";
import { initializeMixer } from "../mixer/init-mixer";
import bs58 from "bs58";
import { getSolBalance, getTokenBalance } from "../../backend/utils";
import { 
  createSmartPriorityFeeInstruction, 
  getTransactionTypePriorityConfig,
  logPriorityFeeInfo 
} from "../common/priority-fees";

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
  const tokenAddress = mintKeypair.publicKey.toBase58();

  logger.info(`[${logIdentifier}]: Token Launch Execution Data`, {
    wallets: buyKeypairs.map((kp) => kp.publicKey.toBase58()),
    funder: funderKeypair?.publicKey.toBase58() || null,
    token: tokenAddress,
    launchStage,
  });

  // Get current launch attempt from token data
  const { TokenModel } = await import("../../backend/models");
  const tokenDoc = await TokenModel.findOne({ tokenAddress }).lean();
  const currentLaunchAttempt = tokenDoc?.launchData?.launchAttempt || 1;

  // Track current stage for proper flow control
  let currentStage = launchStage;
  let tokenCreated = false;

  // Check if token creation was already successful in previous attempts
  const tokenCreationAlreadySuccessful = await isTransactionAlreadySuccessful(
    tokenAddress,
    devKeypair.publicKey.toBase58(),
    "token_creation"
  );

  // Skip preparation phases if launchStage >= LAUNCH (3)
  // This assumes preparation was already completed by prepareTokenLaunch

  // ------- TOKEN CREATION + DEV BUY STAGE ------
  if (currentStage >= PumpLaunchStage.LAUNCH && !tokenCreationAlreadySuccessful) {
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
      {
        useSmartPriorityFees: true,
        transactionType: "token_creation",
      }
    );
    logger.info(`[${logIdentifier}]: Token creation result`, result);
    
    // Record the transaction result
    await recordTransaction(
      tokenAddress,
      devKeypair.publicKey.toBase58(),
      "token_creation",
      result.signature || "failed",
      result.success,
      currentLaunchAttempt,
      {
        amountSol: devBuy,
        errorMessage: result.success ? undefined : "Token creation failed",
      }
    );
    
    // Check if token creation failed due to token already existing
    if (!result.success) {
      // For failed transactions, we need to check the signature status to get error details
      let isTokenAlreadyExists = false;
      
      if (result.signature) {
        try {
          const { value: statuses } = await connection.getSignatureStatuses([result.signature]);
          if (statuses && statuses[0] && statuses[0].err) {
            const errorStr = JSON.stringify(statuses[0].err);
            isTokenAlreadyExists = errorStr.includes('{"InstructionError":[0,{"Custom":0}]}') || 
                                   errorStr.includes('Custom:0');
          }
        } catch (statusError: any) {
          logger.warn(`[${logIdentifier}]: Could not get transaction status: ${statusError.message}`);
        }
      }
      
      if (isTokenAlreadyExists) {
        logger.info(`[${logIdentifier}]: Token already exists, skipping creation and proceeding to snipe stage`);
        // Update the record to show success since token exists
        await recordTransaction(
          tokenAddress,
          devKeypair.publicKey.toBase58(),
          "token_creation",
          result.signature || "token_exists",
          true,
          currentLaunchAttempt,
          {
            amountSol: devBuy,
            errorMessage: "Token already exists - proceeding to snipe",
          }
        );
        // Token already exists, proceed to snipe stage
        await updateLaunchStage(
          mintKeypair.publicKey.toBase58(),
          PumpLaunchStage.SNIPE,
        );
        currentStage = PumpLaunchStage.SNIPE;
        tokenCreated = true; // Set to true to proceed with sniping
      } else {
        // Other error, fail the launch
        throw new Error("Token creation failed");
      }
    } else {
      // Token creation successful
      await updateLaunchStage(
        mintKeypair.publicKey.toBase58(),
        PumpLaunchStage.SNIPE,
      );
      currentStage = PumpLaunchStage.SNIPE;
      tokenCreated = true;
    }
    
    logger.info(
      `[${logIdentifier}]: Token creation completed in ${formatMilliseconds(performance.now() - tokenStart)}`,
    );
  } else if (tokenCreationAlreadySuccessful) {
    logger.info(`[${logIdentifier}]: Token creation already successful in previous attempt, skipping to snipe stage`);
    currentStage = PumpLaunchStage.SNIPE;
    tokenCreated = true;
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
    
    // Get wallets that already have successful snipe transactions
    const successfulSnipeWallets = await getSuccessfulTransactions(
      tokenAddress,
      "snipe_buy"
    );
    
    // Filter out wallets that already succeeded
    const walletsToProcess = buyKeypairs.filter(
      keypair => !successfulSnipeWallets.includes(keypair.publicKey.toBase58())
    );
    
    logger.info(`[${logIdentifier}]: Snipe wallet status`, {
      total: buyKeypairs.length,
      alreadySuccessful: successfulSnipeWallets.length,
      toProcess: walletsToProcess.length,
      successfulWallets: successfulSnipeWallets,
    });
    
    if (walletsToProcess.length === 0) {
      logger.info(`[${logIdentifier}]: All wallets already have successful snipe transactions, skipping snipe stage`);
    } else {
      // Enhanced buy transaction with market order approach (no slippage failures)
      const executeMarketOrderBuy = async (
        keypair: any,
        swapAmount: bigint,
        blockHash: any
      ) => {
        try {
          // Use smart priority fees
          const priorityConfig = getTransactionTypePriorityConfig("buy");
          const smartPriorityFeeIx = createSmartPriorityFeeInstruction(0, priorityConfig);
          const currentPriorityFee = smartPriorityFeeIx.data.readUInt32LE(4);
          
          logPriorityFeeInfo("buy", 0, currentPriorityFee, logIdentifier);
          
          logger.info(`[${logIdentifier}]: Market order buy for ${keypair.publicKey.toBase58()} spending ${(Number(swapAmount) / LAMPORTS_PER_SOL).toFixed(4)} SOL with ${(currentPriorityFee / 1_000_000).toFixed(3)} SOL priority fee`);
          
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
          
          // Market order: spend exact SOL amount, get whatever tokens possible
          const marketBuyIx = marketOrderBuyInstruction(
            mintKeypair.publicKey,
            devKeypair.publicKey,
            keypair.publicKey,
            swapAmount,
          );
          
          const buyTx = new VersionedTransaction(
            new TransactionMessage({
              instructions: [smartPriorityFeeIx, ataIx, marketBuyIx],
              payerKey: keypair.publicKey,
              recentBlockhash: blockHash.blockhash,
            }).compileToV0Message(),
          );
          buyTx.sign([keypair]);
          
          const result = await sendAndConfirmTransactionWithRetry(
            buyTx,
            {
              instructions: [ataIx, marketBuyIx],
              signers: [keypair],
              payer: keypair.publicKey,
            },
            10_000,
            3,
            1000,
            logIdentifier,
            {
              useSmartPriorityFees: true,
              transactionType: "buy",
            }
          );
          
          // Record the transaction result
          await recordTransaction(
            tokenAddress,
            keypair.publicKey.toBase58(),
            "snipe_buy",
            result.signature || "failed",
            result.success,
            currentLaunchAttempt,
            {
              slippageUsed: 0, // Market orders don't use slippage
              amountSol: Number(swapAmount) / LAMPORTS_PER_SOL,
              amountTokens: "market_order", // Variable amount based on current price
              errorMessage: result.success ? undefined : "Market order buy failed",
              retryAttempt: 0,
            }
          );
          
          if (result.success) {
            logger.info(`[${logIdentifier}]: Market order buy successful for ${keypair.publicKey.toBase58()}`);
          } else {
            logger.warn(`[${logIdentifier}]: Market order buy failed for ${keypair.publicKey.toBase58()}: ${result.signature || 'No signature'}`);
          }
          
          return result;
        } catch (error: any) {
          logger.error(`[${logIdentifier}]: Market order buy error for ${keypair.publicKey.toBase58()}: ${error.message}`);
          
          // Record the failed attempt
          await recordTransaction(
            tokenAddress,
            keypair.publicKey.toBase58(),
            "snipe_buy",
            "error",
            false,
            currentLaunchAttempt,
            {
              slippageUsed: 0,
              amountSol: Number(swapAmount) / LAMPORTS_PER_SOL,
              errorMessage: error.message,
              retryAttempt: 0,
            }
          );
          
          return { success: false, error: error.message };
        }
      };
      
      // Execute all buy transactions in parallel with market orders
      logger.info(`[${logIdentifier}]: Starting parallel market order execution for ${walletsToProcess.length} wallets`);
      const buyTasks = [];
      
      for (let i = 0; i < walletsToProcess.length; i++) {
        const keypair = walletsToProcess[i];
        const walletSolBalance = await getSolBalance(keypair.publicKey.toBase58());

        console.log("SOL balance", {walletSolBalance, keypair: keypair.publicKey.toBase58()});
        const swapAmount = BigInt(
          Math.floor((walletSolBalance - 0.01) * LAMPORTS_PER_SOL),
        );
        
        buyTasks.push(
          executeMarketOrderBuy(
            keypair,
            swapAmount,
            blockHash
          )
        );
      }
      
      // Execute all market orders in parallel
      const results = await Promise.all(buyTasks);
      const success = results.filter((res) => res.success);
      const failed = results.filter((res) => !res.success);
      
      // Get updated transaction stats
      const transactionStats = await getTransactionStats(tokenAddress, currentLaunchAttempt);
      
      logger.info(`[${logIdentifier}]: Market Order Snipe Results`, {
        currentAttempt: {
          success: success.length,
          failed: failed.length,
        },
        overallStats: transactionStats,
      });
      
      if (success.length == 0 && successfulSnipeWallets.length == 0) {
        throw new Error("Snipe Failed - No successful transactions");
      }
    }

    // ------- COLLECT TRANSACTION FEES FROM SUCCESSFUL BUYS -------
    logger.info(`[${logIdentifier}]: Collecting transaction fees from successful buys`);
    try {
      // Get all successful snipe wallets (including previous attempts)
      const allSuccessfulSnipeWallets = await getSuccessfulTransactions(
        tokenAddress,
        "snipe_buy"
      );
      
      // Collect transaction fees from successful buy wallets
      const feeCollectionPromises = [];
      
      for (const walletPublicKey of allSuccessfulSnipeWallets) {
        // Find the corresponding private key
        const walletIndex = buyKeypairs.findIndex(kp => kp.publicKey.toBase58() === walletPublicKey);
        if (walletIndex !== -1) {
          const walletPrivateKey = buyWallets[walletIndex];
          const keypair = buyKeypairs[walletIndex];
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
