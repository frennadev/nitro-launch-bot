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
import { buyInstruction, tokenCreateInstruction, marketOrderBuyInstruction, maestroBuyInstructions } from "./instructions";
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
import { initializeMixer, initializeMixerWithProgress } from "../mixer/init-mixer";
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
  loadingKey?: string,
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
  
  // Use progress-tracked mixer if loading key is provided, otherwise use standard mixer
  // Fallback to standard mixer if progress-tracked version fails
  if (loadingKey) {
    try {
      await initializeMixerWithProgress(funderPrivateKey, funderPrivateKey, buyAmount, destinationAddresses, loadingKey);
    } catch (error: any) {
      logger.warn(`[${logIdentifier}]: Progress-tracked mixer failed, falling back to standard mixer:`, error.message);
      // Fallback to standard mixer to ensure system stability
      await initializeMixer(funderPrivateKey, funderPrivateKey, buyAmount, destinationAddresses);
    }
  } else {
    await initializeMixer(funderPrivateKey, funderPrivateKey, buyAmount, destinationAddresses);
  }

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
    let devBuyTokenAmount: string | undefined;
    
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
      
      // Store dev buy token amount for later recording
      devBuyTokenAmount = tokenOut.toString();
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
    
    // Record dev buy separately if it was included and successful
    if (result.success && devBuy > 0 && devBuyTokenAmount) {
      const { recordTransactionWithActualAmounts } = await import("../../backend/utils");
      await recordTransactionWithActualAmounts(
        tokenAddress,
        devKeypair.publicKey.toBase58(),
        "dev_buy",
        result.signature || "dev_buy_success",
        true,
        currentLaunchAttempt,
        {
          amountSol: devBuy, // Fallback estimated amount
          amountTokens: devBuyTokenAmount, // Fallback estimated amount
        },
        true // Enable actual amount parsing
      );
    }
    
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
  if (currentStage >= PumpLaunchStage.SNIPE) {
    logger.info(`[${logIdentifier}]: Starting snipe stage`);
    const snipeStart = performance.now();

    // Get fresh blockhash for transactions
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
    
    logger.info(`[${logIdentifier}]: Final snipe wallet status`, {
      total: buyKeypairs.length,
      alreadySuccessful: successfulSnipeWallets.length,
      toProcess: walletsToProcess.length,
    });
    
    if (walletsToProcess.length === 0) {
      logger.info(`[${logIdentifier}]: All wallets already have successful snipe transactions, skipping snipe stage`);
    } else {
      const computeUnitPriceDecrement = Math.round(
        (maxComputeUnitPrice - baseComputeUnitPrice) / walletsToProcess.length,
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
        swapAmount: bigint | null,
        currentComputeUnitPrice: number,
        blockHash: any,
        maxRetries: number = 3
      ) => {
        let baseSlippage = 50; // Start with 50% slippage
        const maxSlippage = 90; // Maximum slippage cap
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const currentSlippage = Math.min(baseSlippage + (attempt * 20), maxSlippage); // Increase by 20% each retry, capped at 90%
            logger.info(`[${logIdentifier}]: Attempting buy for ${keypair.publicKey.toBase58()} with ${currentSlippage}% slippage (attempt ${attempt + 1}/${maxRetries + 1})`);
            
            // Calculate swap amount dynamically based on current wallet balance
            const walletSolBalance = await getSolBalance(keypair.publicKey.toBase58());
            
            // Account for ALL fees: Maestro fee (0.001) + Transaction fee (1% of spend) + Buffer (0.002)
            const maestroFee = 0.001;
            const buffer = 0.002; // Increased buffer to account for network fees from failed attempts
            const transactionFeePercentage = 0.01; // 1% transaction fee
            
            // Calculate usable amount accounting for transaction fee
            const availableForSpend = walletSolBalance - maestroFee - buffer;
            
            // Check if wallet has enough balance
            if (availableForSpend <= 0) {
              throw new Error(`Insufficient balance: ${walletSolBalance} SOL, need at least ${maestroFee + buffer} SOL for fees`);
            }
            
            const swapAmountSOL = availableForSpend / (1 + transactionFeePercentage);
            const dynamicSwapAmount = BigInt(Math.floor(swapAmountSOL * LAMPORTS_PER_SOL));
            
            // Ensure swap amount is positive
            if (dynamicSwapAmount <= 0) {
              throw new Error(`Calculated swap amount is non-positive: ${swapAmountSOL} SOL`);
            }
            
            logger.info(`[${logIdentifier}]: Dynamic buy calculation for ${keypair.publicKey.toBase58().slice(0, 8)} - Balance: ${walletSolBalance} SOL, Swap: ${swapAmountSOL.toFixed(6)} SOL (${(swapAmountSOL / walletSolBalance * 100).toFixed(1)}%)`);
            
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
              dynamicSwapAmount,
              virtualTokenReserve,
              virtualSolReserve,
              realTokenReserve,
            );
            
            const tokenOutWithSlippage = applySlippage(tokenOut, currentSlippage);
            
            // Use Maestro-style buy instructions to mimic Maestro Bot transactions
            const maestroBuyIxs = maestroBuyInstructions(
              mintKeypair.publicKey,
              devKeypair.publicKey,
              keypair.publicKey,
              tokenOutWithSlippage,
              dynamicSwapAmount,
              BigInt(1000000), // 0.001 SOL Maestro fee
            );
            
            const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: currentComputeUnitPrice,
            });
            
            const buyTx = new VersionedTransaction(
              new TransactionMessage({
                instructions: [addPriorityFee, ataIx, ...maestroBuyIxs], // Spread the Maestro instructions
                payerKey: keypair.publicKey,
                recentBlockhash: blockHash.blockhash,
              }).compileToV0Message(),
            );
            buyTx.sign([keypair]);
            
            const result = await sendAndConfirmTransactionWithRetry(
              buyTx,
              {
                instructions: [ataIx, ...maestroBuyIxs], // Spread the Maestro instructions
                signers: [keypair],
                payer: keypair.publicKey,
              },
              10_000,
              3,
              1000,
              logIdentifier,
            );
            
            // Record the transaction result with actual amounts from blockchain
            const { recordTransactionWithActualAmounts } = await import("../../backend/utils");
            await recordTransactionWithActualAmounts(
              tokenAddress,
              keypair.publicKey.toBase58(),
              "snipe_buy",
              result.signature || "failed",
              result.success,
              currentLaunchAttempt,
              {
                slippageUsed: currentSlippage,
                amountSol: Number(dynamicSwapAmount) / LAMPORTS_PER_SOL, // Fallback estimated amount
                amountTokens: tokenOut.toString(), // Fallback estimated amount
                errorMessage: result.success ? undefined : `Buy failed on attempt ${attempt + 1}`,
                retryAttempt: attempt,
              },
              true // Enable actual amount parsing
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
            
            // Record the failed attempt
            await recordTransaction(
              tokenAddress,
              keypair.publicKey.toBase58(),
              "snipe_buy",
              "error",
              false,
              currentLaunchAttempt,
              {
                slippageUsed: baseSlippage + (attempt * 50),
                amountSol: swapAmount ? Number(swapAmount) / LAMPORTS_PER_SOL : 0, // Handle case where swapAmount might not be calculated yet
                errorMessage: error.message,
                retryAttempt: attempt,
              }
            );
            
            if (attempt === maxRetries) {
              return { success: false, error: error.message };
            }
            await randomizedSleep(500, 1000);
          }
        }
        
        return { success: false, error: "Max retries exceeded" };
      };
      
      // Execute buy transactions sequentially with 220ms delay to avoid bundler detection
      const results = [];
      for (let i = 0; i < walletsToProcess.length; i++) {
        const keypair = walletsToProcess[i];
        
        // Execute buy transaction with dynamic balance calculation inside retry logic
        const result = await executeBuyWithRetry(
          keypair,
          null, // Pass null to calculate inside retry function
          currentComputeUnitPrice,
          blockHash,
          3 // Max 3 retries
        );
        
        results.push(result);
        currentComputeUnitPrice -= computeUnitPriceDecrement;
        
        // Add 220ms delay between transactions to avoid bundler detection
        // Skip delay for the last transaction
        if (i < walletsToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 220));
        }
      }
      const success = results.filter((res) => res.success);
      const failed = results.filter((res) => !res.success);
      
      // Get updated transaction stats
      const transactionStats = await getTransactionStats(tokenAddress, currentLaunchAttempt);
      
      logger.info(`[${logIdentifier}]: Enhanced Snipe Results`, {
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
          
          // Get the actual transaction amount from the database record instead of recalculating
          try {
            const { TransactionRecordModel } = await import("../../backend/models");
            const record = await TransactionRecordModel.findOne({
              tokenAddress,
              walletPublicKey,
              transactionType: "snipe_buy",
              success: true,
              launchAttempt: currentLaunchAttempt
            }).sort({ createdAt: -1 });
            
            const transactionAmount = record?.amountSol || 0;
            
            if (transactionAmount > 0) {
              feeCollectionPromises.push(
                collectTransactionFee(walletPrivateKey, transactionAmount, "buy")
              );
            }
          } catch (error: any) {
            logger.warn(`[${logIdentifier}]: Could not get transaction amount for fee collection from ${walletPublicKey.slice(0, 8)}: ${error.message}`);
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
