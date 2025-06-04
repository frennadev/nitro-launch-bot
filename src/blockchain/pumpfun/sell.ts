import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  formatMilliseconds,
  secretKeyToKeypair,
  sendAndConfirmTransactionWithRetry,
} from "../common/utils";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { logger } from "../common/logger";
import { sellInstruction } from "./instructions";
import { connection } from "../common/connection";

export const executeDevSell = async (
  tokenAddress: string,
  devWallet: string,
  sellPercent: number,
) => {
  if (sellPercent < 1 || sellPercent > 100) {
    throw new Error("Sell % cannot be less than 1 or greater than 100");
  }
  const logIdentifier = `sell-dev-${tokenAddress}`;
  logger.info("Starting dev sell");
  const start = performance.now();

  const mintPublicKey = new PublicKey(tokenAddress);
  const devKeypair = secretKeyToKeypair(devWallet);
  const ata = getAssociatedTokenAddressSync(
    mintPublicKey,
    devKeypair.publicKey,
  );
  const devBalance = BigInt(
    (await connection.getTokenAccountBalance(ata)).value.amount,
  );
  const tokensToSell =
    sellPercent === 100
      ? devBalance
      : (BigInt(sellPercent) * BigInt(100) * devBalance) / BigInt(10_000);
  const sellIx = sellInstruction(
    mintPublicKey,
    devKeypair.publicKey,
    devKeypair.publicKey,
    tokensToSell,
    BigInt(0),
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
      payerKey: devKeypair.publicKey,
      recentBlockhash: blockHash.blockhash,
    }).compileToV0Message(),
  );
  sellTx.sign([devKeypair]);
  const result = await sendAndConfirmTransactionWithRetry(
    sellTx,
    {
      payer: devKeypair.publicKey,
      signers: [devKeypair],
      instructions: [modifyComputeUnits, addPriorityFee, sellIx],
    },
    10_000,
    3,
    1000,
    logIdentifier,
  );
  logger.info(`[${logIdentifier}]: Dev Sell result`, result);
  if (!result.success) {
    throw new Error("Dev sell failed");
  }
  logger.info(
    `[${logIdentifier}]: Dev Sell completed in ${formatMilliseconds(performance.now() - start)}`,
  );
};

export const executeWalletSell = async (
  tokenAddress: string,
  buyWallets: string[],
  devWallet: string,
  sellPercent: number,
) => {
  if (sellPercent < 1 || sellPercent > 100) {
    throw new Error("Sell % cannot be less than 1 or greater than 100");
  }
  const logIdentifier = `sell-${tokenAddress}`;
  logger.info("Starting wallets sell");
  const start = performance.now();

  const mintPublicKey = new PublicKey(tokenAddress);
  const buyKeypairs = buyWallets.map((w) => secretKeyToKeypair(w));
  const devKeypair = secretKeyToKeypair(devWallet);

  const walletBalances = (
    await Promise.all(
      buyKeypairs.map(async (kp) => {
        const ata = getAssociatedTokenAddressSync(mintPublicKey, kp.publicKey);
        let balance = 0;
        try {
          balance = Number(
            (await connection.getTokenAccountBalance(ata)).value.amount,
          );
        } catch (error) {
          logger.error(
            `[${logIdentifier}] Error fetching token balance for: ${kp.publicKey.toBase58()} with ATA: ${ata.toBase58()}`,
          );
        }
        return {
          wallet: kp,
          ata,
          balance,
        };
      }),
    )
  ).filter(({ balance }) => BigInt(balance) > 0n);
  if (walletBalances.length == 0) {
    throw new Error("No wallet has tokens");
  }
  walletBalances.sort((a, b) => a.balance - b.balance);

  const totalTokens = walletBalances.reduce(
    (acc, { balance }) => acc + BigInt(balance),
    0n,
  );
  let tokensToSell =
    sellPercent === 100
      ? totalTokens
      : (BigInt(sellPercent) * BigInt(100) * totalTokens) / BigInt(10_000);

  const sellSetups: { wallet: Keypair; ata: PublicKey; amount: bigint }[] = [];
  for (const walletInfo of walletBalances) {
    if (tokensToSell <= 0n) {
      break;
    }
    if (tokensToSell <= BigInt(walletInfo.balance)) {
      sellSetups.push({
        wallet: walletInfo.wallet,
        ata: walletInfo.ata,
        amount: tokensToSell,
      });
      break;
    }
    tokensToSell -= BigInt(walletInfo.balance);
    sellSetups.push({
      wallet: walletInfo.wallet,
      ata: walletInfo.ata,
      amount: BigInt(walletInfo.balance),
    });
  }
  const blockHash = await connection.getLatestBlockhash("processed");
  const tasks = sellSetups.map(async ({ wallet, amount }) => {
    const sellIx = sellInstruction(
      mintPublicKey,
      devKeypair.publicKey,
      wallet.publicKey,
      amount,
      BigInt(0),
    );
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 151595,
    });
    const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1_000_000,
    });
    const sellTx = new VersionedTransaction(
      new TransactionMessage({
        instructions: [modifyComputeUnits, addPriorityFee, sellIx],
        payerKey: wallet.publicKey,
        recentBlockhash: blockHash.blockhash,
      }).compileToV0Message(),
    );
    sellTx.sign([wallet]);
    return await sendAndConfirmTransactionWithRetry(
      sellTx,
      {
        payer: devKeypair.publicKey,
        signers: [devKeypair],
        instructions: [modifyComputeUnits, addPriorityFee, sellIx],
      },
      10_000,
      3,
      1000,
      logIdentifier,
    );
  });
  const results = await Promise.all(tasks);
  logger.info(`[${logIdentifier}]: Wallet Sell results`, results);
  const success = results.filter((res) => res.success);
  if (success.length == 0) {
    throw new Error("Wallet sells failed");
  }
  logger.info(
    `[${logIdentifier}]: Wallet Sells completed in ${formatMilliseconds(performance.now() - start)}`,
  );
};
