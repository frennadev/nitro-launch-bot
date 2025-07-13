import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { BUY_DISCRIMINATOR, SELL_DISCRIMINATOR, CREATE_DISCRIMINATOR } from "./constants";
import { getBondingCurve, getCreatorVault, getMetadataPDA } from "./utils";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PUMPFUN_EVENT_AUTHORITY,
  PUMPFUN_FEE_ACCOUNT,
  PUMPFUN_GLOBAL_SETTINGS,
  PUMPFUN_PROGRAM,
} from "./constants";
import { BuyCodec, SellCodec } from "./codecs";

/**
 * Create buy instruction for PumpFun
 */
export const buyInstruction = (
  mint: PublicKey,
  tokenCreator: PublicKey,
  buyer: PublicKey,
  amount: bigint,
  maxSolCost: bigint,
): TransactionInstruction => {
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
  // Encode the instruction data using BuyCodec
  const data = BuyCodec.encode({
    instruction: Buffer.from(BUY_DISCRIMINATOR).readBigUint64LE(),
    amount: amount,
    maxSolCost: maxSolCost,
  });
  return new TransactionInstruction({
    data: Buffer.from(data),
    keys,
    programId: PUMPFUN_PROGRAM,
  });
};

/**
 * Create sell instruction for PumpFun
 */
export const sellInstruction = (
  mint: PublicKey,
  creator: PublicKey,
  seller: PublicKey,
  tokenAmount: bigint,
  minSolOut: bigint
): TransactionInstruction => {
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint);
  const creatorVault = getCreatorVault(creator);
  const sellerAta = getAssociatedTokenAddressSync(mint, seller);

  const keys = [
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
    amount: tokenAmount,
    minSolOutput: minSolOut,
  });

  return new TransactionInstruction({
    keys,
    programId: PUMPFUN_PROGRAM,
    data: Buffer.from(data),
  });
};

/**
 * Create token creation instruction for PumpFun
 */
export const tokenCreateInstruction = (
  mint: PublicKey,
  creator: PublicKey,
  metadataUri: string,
  name: string,
  symbol: string
): TransactionInstruction => {
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint);
  const creatorVault = getCreatorVault(creator);
  const metadata = getMetadataPDA(mint);

  const keys = [
    { pubkey: mint, isSigner: true, isWritable: true },
    { pubkey: bondingCurve, isSigner: false, isWritable: true },
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
    { pubkey: creator, isSigner: true, isWritable: true },
    { pubkey: creatorVault, isSigner: false, isWritable: true },
    { pubkey: metadata, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  // Encode metadata
  const metadataBuffer = Buffer.from(metadataUri, 'utf8');
  const nameBuffer = Buffer.from(name, 'utf8');
  const symbolBuffer = Buffer.from(symbol, 'utf8');

  const data = Buffer.concat([
    Buffer.from(CREATE_DISCRIMINATOR),
    Buffer.from([metadataBuffer.length]),
    metadataBuffer,
    Buffer.from([nameBuffer.length]),
    nameBuffer,
    Buffer.from([symbolBuffer.length]),
    symbolBuffer,
  ]);

  return new TransactionInstruction({
    keys,
    programId: new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
    data,
  });
}; 