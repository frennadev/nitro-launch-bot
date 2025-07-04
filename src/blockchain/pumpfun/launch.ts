import {
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Connection,
  PublicKey,
  Keypair,
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
import { initializeMixer, initializeMixerWithProgress, initializeFastMixer } from "../mixer/init-mixer";
import bs58 from "bs58";
import { getSolBalance, getTokenBalance } from "../../backend/utils";
import { BondingCurveTracker, globalLaunchManager } from "./real-time-curve-tracker";

/**
 * Calculate optimal wallet count for a given buy amount
 * This matches the logic used in the mixer to ensure consistency
 */
function calculateOptimalWalletCount(buyAmountSol: number, maxAvailableWallets: number): number {
  const totalLamports = Math.floor(buyAmountSol * 1e9);
  
  // Incremental sequence in SOL: 0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5...
  const incrementalSequence = [0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1];
  const incrementalLamports = incrementalSequence.map(sol => Math.floor(sol * 1e9));
  
  // Calculate the optimal number of wallets needed for this amount
  let cumulativeTotal = 0;
  for (let i = 0; i < incrementalSequence.length; i++) {
    cumulativeTotal += incrementalLamports[i];
    if (totalLamports <= cumulativeTotal) {
      return Math.min(i + 1, maxAvailableWallets); // Return 1-based wallet count, capped by available wallets
    }
  }
  
  // For amounts larger than our sequence, use more wallets proportionally
  const baseTotal = incrementalLamports.reduce((sum, amt) => sum + amt, 0);
  const extraWallets = Math.ceil((totalLamports - baseTotal) / (Math.floor(2.5 * 1e9))); // 2.5 SOL per extra wallet
  const optimalCount = incrementalSequence.length + extraWallets;
  
  return Math.min(optimalCount, maxAvailableWallets);
}

/**
 * Calculate buy amounts dynamically - wallets will buy until balance drops below 0.05 SOL
 * This ensures maximum token acquisition with all available funds
 */
function calculateDynamicBuyAmounts(
  walletCount: number
): { walletAmounts: number[], totalExpected: number } {
  // Each wallet will use their full balance minus 0.05 SOL buffer
  // We can't know exact amounts until we check balances, so we'll calculate dynamically
  const walletAmounts: number[] = [];
  
  // For now, we'll use a conservative estimate based on typical mixer funding
  // The actual amounts will be calculated dynamically during execution
  const estimatedAmounts = [0.5, 0.7, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1];
  
  for (let i = 0; i < Math.min(walletCount, estimatedAmounts.length); i++) {
    walletAmounts.push(estimatedAmounts[i]);
  }
  
  const totalExpected = walletAmounts.reduce((sum, amount) => sum + amount, 0);
  
  return { walletAmounts, totalExpected };
}

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
  
  // Calculate optimal number of wallets needed for this buy amount
  const optimalWalletCount = calculateOptimalWalletCount(buyAmount, buyKeypairs.length);
  
  // Only use the wallets that are actually needed based on buy amount
  const selectedBuyKeypairs = buyKeypairs.slice(0, optimalWalletCount);
  const destinationAddresses = selectedBuyKeypairs.map(w => w.publicKey.toString());
  
  logger.info(`[${logIdentifier}]: Wallet allocation - Buy Amount: ${buyAmount} SOL → Using ${optimalWalletCount}/${buyKeypairs.length} wallets (optimized from potential ${buyKeypairs.length})`);
  
  // Calculate total amount needed: buy amount + fees for each selected wallet
  // Each wallet needs 0.005 SOL for transaction fees (increased from 0.003 for safety buffer)
  const feePerWallet = 0.005;
  const totalFeesNeeded = destinationAddresses.length * feePerWallet;
  const totalAmountToMix = buyAmount + totalFeesNeeded;
  
  logger.info(`[${logIdentifier}]: Funding calculation - Buy: ${buyAmount} SOL, Fees: ${totalFeesNeeded} SOL (${feePerWallet} × ${destinationAddresses.length}), Total: ${totalAmountToMix} SOL`);

  // Use fast mixer for optimal speed with dedicated endpoint
  // Fallback chain: Fast Mixer → Progress Mixer → Standard Mixer
  if (loadingKey) {
    try {
      await initializeFastMixer(funderPrivateKey, funderPrivateKey, totalAmountToMix, destinationAddresses, loadingKey);
    } catch (error: any) {
      logger.warn(`[${logIdentifier}]: Fast mixer failed, falling back to progress mixer:`, error.message);
      try {
        await initializeMixerWithProgress(funderPrivateKey, funderPrivateKey, totalAmountToMix, destinationAddresses, loadingKey);
      } catch (error2: any) {
        logger.warn(`[${logIdentifier}]: Progress mixer failed, falling back to standard mixer:`, error2.message);
        // Final fallback to standard mixer to ensure system stability
        await initializeMixer(funderPrivateKey, funderPrivateKey, totalAmountToMix, destinationAddresses);
      }
    }
  } else {
    // For non-tracked operations, use fast mixer directly
    try {
      await initializeFastMixer(funderPrivateKey, funderPrivateKey, totalAmountToMix, destinationAddresses);
    } catch (error: any) {
      logger.warn(`[${logIdentifier}]: Fast mixer failed, falling back to standard mixer:`, error.message);
      await initializeMixer(funderPrivateKey, funderPrivateKey, totalAmountToMix, destinationAddresses);
    }
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
  const allBuyKeypairs = buyWallets.map((w) => secretKeyToKeypair(w));
  
  // Calculate optimal number of wallets needed for this buy amount (same logic as in prepareTokenLaunch)
  const optimalWalletCount = calculateOptimalWalletCount(buyAmount, allBuyKeypairs.length);
  
  // Only use the wallets that are actually needed based on buy amount
  const buyKeypairs = allBuyKeypairs.slice(0, optimalWalletCount);
  
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
  
  logger.info(`[${logIdentifier}]: Wallet optimization - Buy Amount: ${buyAmount} SOL → Using ${optimalWalletCount}/${allBuyKeypairs.length} wallets for execution`);

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
      
      // Optimized parallel curve data fetching for maximum speed
      logger.info(`[${logIdentifier}]: Fetching bonding curve data with parallel strategy...`);
      const curveDataStart = performance.now();
      
      let curveData = null;
      
      try {
        // Strategy 1: Parallel fetch with different commitment levels (fastest)
        const parallelFetchPromises = [
          // Most likely to succeed quickly
          (async () => {
            try {
              const accountInfo = await connection.getAccountInfo(bondingCurve, "processed");
              if (accountInfo?.data) {
                const data = await getBondingCurveData(bondingCurve);
                if (data) {
                  logger.info(`[${logIdentifier}]: Fast curve data fetch successful with 'processed' commitment`);
                  return { data, commitment: "processed" };
                }
              }
            } catch (error) {
              return null;
            }
            return null;
          })(),
          
          // Backup with confirmed
          (async () => {
            await new Promise(resolve => setTimeout(resolve, 500)); // Small delay to prefer processed
            try {
              const accountInfo = await connection.getAccountInfo(bondingCurve, "confirmed");
              if (accountInfo?.data) {
                const data = await getBondingCurveData(bondingCurve);
                if (data) {
                  logger.info(`[${logIdentifier}]: Curve data fetch successful with 'confirmed' commitment`);
                  return { data, commitment: "confirmed" };
                }
              }
            } catch (error) {
              return null;
            }
            return null;
          })(),
          
          // Final fallback with finalized
          (async () => {
            await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to prefer faster options
            try {
              const accountInfo = await connection.getAccountInfo(bondingCurve, "finalized");
              if (accountInfo?.data) {
                const data = await getBondingCurveData(bondingCurve);
                if (data) {
                  logger.info(`[${logIdentifier}]: Curve data fetch successful with 'finalized' commitment`);
                  return { data, commitment: "finalized" };
                }
              }
            } catch (error) {
              return null;
            }
            return null;
          })()
        ];
        
        // Race to get the first successful result
        const results = await Promise.allSettled(parallelFetchPromises);
        const successfulResult = results.find(result => 
          result.status === 'fulfilled' && result.value !== null
        );
        
        if (successfulResult && successfulResult.status === 'fulfilled' && successfulResult.value) {
          curveData = successfulResult.value.data;
          const fetchTime = performance.now() - curveDataStart;
          logger.info(`[${logIdentifier}]: Parallel curve data fetch completed in ${Math.round(fetchTime)}ms using ${successfulResult.value.commitment} commitment`);
        }
        
      } catch (error: any) {
        logger.warn(`[${logIdentifier}]: Parallel curve data fetch failed: ${error.message}`);
      }
      
      // Fallback to sequential retry logic if parallel fetch failed
      if (!curveData) {
        logger.info(`[${logIdentifier}]: Parallel fetch failed, falling back to sequential retry logic...`);
        
        let retries = 0;
        const maxRetries = 8; // Reduced from 15 since we already tried parallel
        const baseDelay = 1000;
        
        while (!curveData && retries < maxRetries) {
          try {
            const commitmentLevel = retries < 3 ? "processed" : retries < 6 ? "confirmed" : "finalized";
            
            const accountInfo = await connection.getAccountInfo(bondingCurve, commitmentLevel);
            if (accountInfo && accountInfo.data) {
              curveData = await getBondingCurveData(bondingCurve);
              if (curveData) {
                logger.info(`[${logIdentifier}]: Sequential fallback successful on attempt ${retries + 1} with ${commitmentLevel} commitment`);
                break;
              }
            }
          } catch (error: any) {
            logger.warn(`[${logIdentifier}]: Sequential fallback attempt ${retries + 1} failed: ${error.message}`);
          }
          
          retries += 1;
          if (!curveData && retries < maxRetries) {
            const delay = Math.min(baseDelay * Math.pow(1.5, retries), 3000) + Math.random() * 500;
            logger.info(`[${logIdentifier}]: Retrying in ${Math.round(delay)}ms (attempt ${retries}/${maxRetries})`);
            await randomizedSleep(delay, delay + 200);
          }
        }
      }
      
      if (!curveData) {
        logger.error(`[${logIdentifier}]: Failed to fetch curve data after all attempts`);
        
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

      // NEW: Initialize real-time curve tracker (optional enhancement)
      let curveTracker: BondingCurveTracker | undefined;
      try {
        curveTracker = await globalLaunchManager.initializeLaunch(tokenAddress, bondingCurve);
        logger.info(`[${logIdentifier}]: Real-time curve tracking enabled`);
      } catch (error: any) {
        logger.warn(`[${logIdentifier}]: Could not initialize curve tracker, using fallback: ${error.message}`);
        // Continue with existing logic - curve tracker is optional
      }
      
      // Calculate fixed buy amounts for each wallet based on bonding curve state
      const { walletAmounts, totalExpected } = calculateDynamicBuyAmounts(
        walletsToProcess.length
      );
      
      logger.info(`[${logIdentifier}]: Dynamic buy amounts calculated`, {
        targetAmount: buyAmount,
        totalExpected: totalExpected.toFixed(6),
        walletCount: walletsToProcess.length,
        amounts: walletAmounts.map((amt, i) => `Wallet ${i + 1}: ${amt.toFixed(6)} SOL`),
        efficiency: `${((totalExpected / buyAmount) * 100).toFixed(1)}%`
      });

      // Enhanced buy transaction with retry logic and optional real-time curve tracking
      const executeBuyWithRetry = async (
        keypair: any,
        fixedBuyAmount: number | null, // This will be ignored in favor of dynamic calculation
        currentComputeUnitPrice: number,
        blockHash: any,
        maxRetries: number = 3,
        curveTracker?: BondingCurveTracker // Optional real-time curve tracker
      ) => {
        let baseSlippage = 50; // Start with 50% slippage (fallback)
        const maxSlippage = 90; // Maximum slippage cap
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            // NEW: Enhanced slippage and quote calculation logic
            let currentSlippage, tokenOut, swapAmountLamports;
            
            // Always use dynamic calculation based on current wallet balance
            const walletSolBalance = await getSolBalance(keypair.publicKey.toBase58());
            
            // Keep buying until balance drops below 0.05 SOL
            const minBalanceThreshold = 0.05;
            const availableForSpend = walletSolBalance - minBalanceThreshold;
            
            // Check if wallet has enough balance to buy
            if (availableForSpend <= 0.01) { // Need at least 0.01 SOL to attempt a buy
              logger.info(`[${logIdentifier}]: Wallet ${keypair.publicKey.toBase58().slice(0, 8)} has insufficient balance: ${walletSolBalance.toFixed(6)} SOL (need > ${minBalanceThreshold + 0.01} SOL)`);
              return { success: true, message: "Insufficient balance for further buys" }; // Mark as success to avoid retries
            }
            
            // Use the full available amount for the swap
            const swapAmountSOL = availableForSpend;
            swapAmountLamports = BigInt(Math.floor(swapAmountSOL * LAMPORTS_PER_SOL));
            
            // Ensure swap amount is positive and properly converted
            if (swapAmountLamports <= 0) {
              throw new Error(`Calculated swap amount is non-positive: ${swapAmountSOL} SOL`);
            }
            
            // Ensure the amount is a valid integer for the buy instruction
            if (swapAmountLamports > BigInt(Number.MAX_SAFE_INTEGER)) {
              throw new Error(`Swap amount too large: ${swapAmountLamports} lamports`);
            }

            if (curveTracker) {
              // NEW: Enhanced path with real-time curve tracking
              currentSlippage = 20; // Fixed 20% slippage with accurate data
              const currentQuote = curveTracker.quoteCurrentBuy(swapAmountLamports);
              tokenOut = currentQuote.tokenOut;
              
              logger.info(`[${logIdentifier}]: Real-time curve buy for ${keypair.publicKey.toBase58().slice(0, 8)} with ${currentSlippage}% slippage (attempt ${attempt + 1}/${maxRetries + 1})`);
              logger.info(`[${logIdentifier}]: Real-time calculation - SOL: ${swapAmountSOL.toFixed(6)}, Tokens: ${tokenOut.toString()}, Balance: ${walletSolBalance.toFixed(6)} SOL`);
            } else {
              // FALLBACK: Existing logic with escalating slippage
              currentSlippage = Math.min(baseSlippage + (attempt * 20), maxSlippage); // Increase by 20% each retry, capped at 90%
              const fallbackQuote = quoteBuy(
                swapAmountLamports,
                virtualTokenReserve,
                virtualSolReserve,
                realTokenReserve,
              );
              tokenOut = fallbackQuote.tokenOut;
              
              logger.info(`[${logIdentifier}]: Fallback buy for ${keypair.publicKey.toBase58().slice(0, 8)} with ${currentSlippage}% slippage (attempt ${attempt + 1}/${maxRetries + 1})`);
              logger.info(`[${logIdentifier}]: Fallback calculation - SOL: ${swapAmountSOL.toFixed(6)}, Tokens: ${tokenOut.toString()}, Balance: ${walletSolBalance.toFixed(6)} SOL`);
            }
            
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
            
            const tokenOutWithSlippage = applySlippage(tokenOut, currentSlippage);
            
            // Validate token amount is a valid integer
            if (tokenOutWithSlippage <= 0) {
              throw new Error(`Invalid token amount after slippage: ${tokenOutWithSlippage.toString()}`);
            }
            
            if (tokenOutWithSlippage > BigInt(Number.MAX_SAFE_INTEGER)) {
              throw new Error(`Token amount too large: ${tokenOutWithSlippage.toString()}`);
            }
            
            logger.info(`[${logIdentifier}]: Token calculation for ${keypair.publicKey.toBase58().slice(0, 8)} - SOL: ${swapAmountSOL.toFixed(6)}, Tokens: ${tokenOut.toString()}, With Slippage: ${tokenOutWithSlippage.toString()}`);
            
            // Use ultra-fast priority fees for maximum speed
            const { getTransactionTypePriorityConfig } = await import("../common/priority-fees");
            const ultraFastConfig = getTransactionTypePriorityConfig("ultra_fast_buy");
            const ultraFastFee = ultraFastConfig.baseFee * Math.pow(ultraFastConfig.retryMultiplier, attempt);
            const boundedUltraFastFee = Math.max(ultraFastConfig.minFee, Math.min(ultraFastFee, ultraFastConfig.maxFee));
            
            // Use Maestro-style buy instructions to mimic Maestro Bot transactions
            const maestroBuyIxs = maestroBuyInstructions(
              mintKeypair.publicKey,
              devKeypair.publicKey,
              keypair.publicKey,
              tokenOutWithSlippage,
              swapAmountLamports,
              BigInt(1000000), // 0.001 SOL Maestro fee
            );
            
            const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: boundedUltraFastFee, // Use ultra-fast priority fee
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
              3000, // Balanced timeout: 3 seconds
              3,
              200, // Balanced retry delay: 200ms
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
                amountSol: swapAmountSOL, // Use the actual amount we attempted
                amountTokens: tokenOut.toString(), // Fallback estimated amount
                errorMessage: result.success ? undefined : `Buy failed on attempt ${attempt + 1}`,
                retryAttempt: attempt,
              },
              true // Enable actual amount parsing
            );
            
            if (result.success) {
              // NEW: Update curve tracker after successful buy
              if (curveTracker) {
                curveTracker.updateAfterSuccessfulBuy(swapAmountLamports, tokenOut);
                logger.info(`[${logIdentifier}]: Curve tracker updated after successful buy`);
              }
              
              logger.info(`[${logIdentifier}]: Buy successful for ${keypair.publicKey.toBase58()} with ${currentSlippage}% slippage on attempt ${attempt + 1} (Priority fee: ${boundedUltraFastFee} microLamports)`);
              return result;
            } else {
              logger.warn(`[${logIdentifier}]: Buy attempt ${attempt + 1} failed for ${keypair.publicKey.toBase58()}: ${result.signature || 'No signature'}`);
              if (attempt === maxRetries) {
                logger.error(`[${logIdentifier}]: All buy attempts failed for ${keypair.publicKey.toBase58()}`);
                return result;
              }
              // Ultra-fast retry delay
              await randomizedSleep(50, 50);
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
                amountSol: 0, // We don't know the amount for failed attempts
                errorMessage: error.message,
                retryAttempt: attempt,
              }
            );
            
            if (attempt === maxRetries) {
              return { success: false, error: error.message };
            }
            await randomizedSleep(50, 50);
          }
        }
        
        return { success: false, error: "Max retries exceeded" };
      };
      
      // Execute buy transactions continuously until wallets are depleted
      const results = [];
      let roundNumber = 1;
      const maxRounds = 10; // Safety limit to prevent infinite loops
      
      while (roundNumber <= maxRounds) {
        logger.info(`[${logIdentifier}]: Starting buy round ${roundNumber}`);
        
        // Check which wallets still have sufficient balance
        const walletsWithBalance = [];
        for (const keypair of walletsToProcess) {
          const balance = await getSolBalance(keypair.publicKey.toBase58());
          if (balance > 0.06) { // Need more than 0.05 SOL + 0.01 SOL buffer
            walletsWithBalance.push(keypair);
          }
        }
        
        if (walletsWithBalance.length === 0) {
          logger.info(`[${logIdentifier}]: All wallets depleted, stopping buy rounds`);
          break;
        }
        
        logger.info(`[${logIdentifier}]: Round ${roundNumber} - Processing ${walletsWithBalance.length} wallets with sufficient balance`);
        
        // Execute buy transactions for this round in parallel (ultra-fast)
        const roundPromises = walletsWithBalance.map(async (keypair, i) => {
          const walletComputeUnitPrice = maxComputeUnitPrice - (computeUnitPriceDecrement * i);
          
          return await executeBuyWithRetry(
            keypair,
            null, // Use dynamic calculation
            walletComputeUnitPrice,
            blockHash,
            3, // Max 3 retries
            curveTracker // Pass curve tracker for real-time updates
          );
        });
        
        const roundResults = await Promise.all(roundPromises);
        
        const roundSuccess = roundResults.filter((res) => res.success);
        const roundFailed = roundResults.filter((res) => !res.success);
        
        results.push(...roundResults);
        
        logger.info(`[${logIdentifier}]: Round ${roundNumber} Results`, {
          success: roundSuccess.length,
          failed: roundFailed.length,
          totalWallets: walletsWithBalance.length,
        });
        
        // If no successful transactions this round, stop
        if (roundSuccess.length === 0) {
          logger.info(`[${logIdentifier}]: No successful transactions in round ${roundNumber}, stopping`);
          break;
        }
        
        roundNumber++;
        
        // Balanced delay between rounds
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const success = results.filter((res) => res.success);
      const failed = results.filter((res) => !res.success);
      
      // Get updated transaction stats
      const transactionStats = await getTransactionStats(tokenAddress, currentLaunchAttempt);
      
      logger.info(`[${logIdentifier}]: Continuous Buy Results`, {
        totalRounds: roundNumber - 1,
        currentAttempt: {
          success: success.length,
          failed: failed.length,
        },
        overallStats: transactionStats,
      });
      
      if (success.length == 0 && successfulSnipeWallets.length == 0) {
        throw new Error("Snipe Failed - No successful transactions");
      }

      // ------- COLLECT TRANSACTION FEES FROM SUCCESSFUL BUYS -------
      logger.info(`[${logIdentifier}]: Collecting transaction fees from successful buys`);
      try {
        // Get all successful snipe transactions (not just wallets) for this launch attempt
        const { TransactionRecordModel } = await import("../../backend/models");
        const allSuccessfulTransactions = await TransactionRecordModel.find({
          tokenAddress,
          transactionType: "snipe_buy",
          success: true,
          launchAttempt: currentLaunchAttempt
        }).sort({ createdAt: 1 }); // Sort by creation time to process in order
        
        // Collect transaction fees from each successful transaction
        const feeCollectionPromises = [];
        const processedWallets = new Set(); // Track wallets we've already processed fees for
        
        for (const record of allSuccessfulTransactions) {
          const walletPublicKey = record.walletPublicKey;
          
          // Find the corresponding private key
          const walletIndex = buyKeypairs.findIndex(kp => kp.publicKey.toBase58() === walletPublicKey);
          if (walletIndex !== -1) {
            const walletPrivateKey = buyWallets[walletIndex];
            const transactionAmount = record.amountSol || 0;
            
            // Create a unique key for this specific transaction
            const transactionKey = `${walletPublicKey}-${record.signature}`;
            
            if (transactionAmount > 0 && !processedWallets.has(transactionKey)) {
              processedWallets.add(transactionKey);
              feeCollectionPromises.push(
                collectTransactionFee(walletPrivateKey, transactionAmount, "buy")
              );
            }
          }
        }

        logger.info(`[${logIdentifier}]: Prepared ${feeCollectionPromises.length} fee collection transactions from ${allSuccessfulTransactions.length} successful buy transactions`);

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
            logger.warn(`[${logIdentifier}]: Some transaction fees failed to collect`, failedFees.map((result: any, index: number) => ({
              index,
              success: result.success,
              error: result.error,
              feeAmount: result.feeAmount
            })));
          }
        } else {
          logger.info(`[${logIdentifier}]: No transaction fees to collect`);
        }
      } catch (error: any) {
        logger.error(`[${logIdentifier}]: Error collecting transaction fees:`, error);
        // Don't throw error here - transaction fees are secondary to main launch success
      }

      // NEW: Clean up curve tracker
      if (curveTracker) {
        globalLaunchManager.completeLaunch(tokenAddress);
        logger.info(`[${logIdentifier}]: Curve tracker cleaned up`);
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
  }
};
