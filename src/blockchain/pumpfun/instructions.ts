import {
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  type AccountMeta,
  type Keypair,
  type PublicKey,
} from "@solana/web3.js";
import { getBondingCurve, getCreatorVault, getMetadataPDA } from "./utils";
import {
  BUY_DISCRIMINATOR,
  CREATE_DISCRIMINATOR,
  PUMPFUN_EVENT_AUTHORITY,
  PUMPFUN_FEE_ACCOUNT,
  PUMPFUN_GLOBAL_SETTINGS,
  PUMPFUN_MINT_AUTHORITY,
  PUMPFUN_PROGRAM,
  SELL_DISCRIMINATOR,
  TOKEN_METADATA_PROGRAM,
} from "./constants";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BuyCodec, CreateCodec, SellCodec } from "./codecs";

export const tokenCreateInstruction = (
  mint: Keypair,
  dev: Keypair,
  name: string,
  symbol: string,
  uri: string,
) => {
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(
    mint.publicKey,
  );
  const metadata = getMetadataPDA(mint.publicKey);
  const keys: AccountMeta[] = [
    { pubkey: mint.publicKey, isWritable: true, isSigner: true },
    { pubkey: PUMPFUN_MINT_AUTHORITY, isWritable: false, isSigner: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
    { pubkey: PUMPFUN_GLOBAL_SETTINGS, isSigner: false, isWritable: false },
    { pubkey: TOKEN_METADATA_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: metadata, isSigner: false, isWritable: true },
    { pubkey: dev.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_PROGRAM, isSigner: false, isWritable: false },
  ];
  const data = CreateCodec.encode({
    name,
    symbol,
    uri,
    creator: dev.publicKey.toBase58(),
    instruction: Buffer.from(CREATE_DISCRIMINATOR).readBigUInt64LE(),
  });
  return new TransactionInstruction({
    data: Buffer.from(data),
    keys,
    programId: PUMPFUN_PROGRAM,
  });
};

export const buyInstruction = (
  mint: PublicKey,
  tokenCreator: PublicKey,
  buyer: PublicKey,
  amount: bigint,
  maxSolCost: bigint,
) => {
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint);
  const buyerAta = getAssociatedTokenAddressSync(mint, buyer);
  const creatorVault = getCreatorVault(tokenCreator);
  const keys: AccountMeta[] = [
    { pubkey: PUMPFUN_GLOBAL_SETTINGS, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_FEE_ACCOUNT, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
    { pubkey: buyerAta, isSigner: false, isWritable: true },
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: creatorVault, isSigner: false, isWritable: true },
    { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_PROGRAM, isSigner: false, isWritable: false },
  ];
  const data = BuyCodec.encode({
    instruction: Buffer.from(BUY_DISCRIMINATOR).readBigUint64LE(),
    amount,
    maxSolCost,
  });
  return new TransactionInstruction({
    data: Buffer.from(data),
    keys,
    programId: PUMPFUN_PROGRAM,
  });
};

export const marketOrderBuyInstruction = (
  mint: PublicKey,
  tokenCreator: PublicKey,
  buyer: PublicKey,
  exactSolAmount: bigint,
) => {
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint);
  const buyerAta = getAssociatedTokenAddressSync(mint, buyer);
  const creatorVault = getCreatorVault(tokenCreator);
  const keys: AccountMeta[] = [
    { pubkey: PUMPFUN_GLOBAL_SETTINGS, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_FEE_ACCOUNT, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
    { pubkey: buyerAta, isSigner: false, isWritable: true },
    { pubkey: buyer, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: creatorVault, isSigner: false, isWritable: true },
    { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_PROGRAM, isSigner: false, isWritable: false },
  ];
  
  // Market order: buy maximum possible tokens with exact SOL amount
  const maxTokenAmount = BigInt("18446744073709551615"); // Max uint64 - buy as many tokens as possible
  
  const data = BuyCodec.encode({
    instruction: Buffer.from(BUY_DISCRIMINATOR).readBigUint64LE(),
    amount: maxTokenAmount,
    maxSolCost: exactSolAmount,
  });
  return new TransactionInstruction({
    data: Buffer.from(data),
    keys,
    programId: PUMPFUN_PROGRAM,
  });
};

export const sellInstruction = (
  mint: PublicKey,
  tokenCreator: PublicKey,
  seller: PublicKey,
  amount: bigint,
  minSolOutput: bigint,
) => {
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint);
  const sellerAta = getAssociatedTokenAddressSync(mint, seller);
  const creatorVault = getCreatorVault(tokenCreator);
  const keys: AccountMeta[] = [
    { pubkey: PUMPFUN_GLOBAL_SETTINGS, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_FEE_ACCOUNT, isSigner: false, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
    { pubkey: sellerAta, isSigner: false, isWritable: true },
    { pubkey: seller, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: creatorVault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
    { pubkey: PUMPFUN_PROGRAM, isSigner: false, isWritable: false },
  ];
  const data = SellCodec.encode({
    instruction: Buffer.from(SELL_DISCRIMINATOR).readBigUint64LE(),
    amount,
    minSolOutput,
  });
  return new TransactionInstruction({
    data: Buffer.from(data),
    keys,
    programId: PUMPFUN_PROGRAM,
  });
};
