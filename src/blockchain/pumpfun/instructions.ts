import {
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  PublicKey,
  type AccountMeta,
  type Keypair,
} from "@solana/web3.js";
import { getBondingCurve, getCreatorVault, getMetadataPDA, getFeeConfig } from "./utils";
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
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BuyCodec, CreateCodec, SellCodec } from "./codecs";

// Maestro Bot constants
const MAESTRO_BOT_PROGRAM = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");
const MAESTRO_FEE_ACCOUNT = new PublicKey("5L2QKqDn5ukJSWGyqR4RPvFvwnBabKWqAqMzH4heaQNB");

export const tokenCreateInstruction = (mint: Keypair, dev: Keypair, name: string, symbol: string, uri: string) => {
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint.publicKey);
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
  maxSolCost: bigint
) => {
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint);
  const buyerAta = getAssociatedTokenAddressSync(mint, buyer);
  const creatorVault = getCreatorVault(tokenCreator);
  const feeConfig = getFeeConfig();

  const global_volume_accumulator = globalVolumeAccumulator();
  const user_volume_accumulator = userVolumeAccumulator(buyer);

  // Fee program from successful transaction
  const feeProgram = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

  const keys: AccountMeta[] = [
    { pubkey: PUMPFUN_GLOBAL_SETTINGS, isSigner: false, isWritable: false }, // #1: Global
    { pubkey: PUMPFUN_FEE_ACCOUNT, isSigner: false, isWritable: true }, // #2: Fee Recipient
    { pubkey: mint, isSigner: false, isWritable: false }, // #3: Mint (moved to match successful tx)
    { pubkey: bondingCurve, isSigner: false, isWritable: true }, // #4: Bonding Curve
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true }, // #5: Associated Bonding Curve
    { pubkey: buyerAta, isSigner: false, isWritable: true }, // #6: Associated User
    { pubkey: buyer, isSigner: true, isWritable: true }, // #7: User
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // #8: System Program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // #9: Token Program
    { pubkey: creatorVault, isSigner: false, isWritable: true }, // #10: Creator Vault
    { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false }, // #11: Event Authority
    { pubkey: PUMPFUN_PROGRAM, isSigner: false, isWritable: false }, // #12: Program
    { pubkey: global_volume_accumulator, isWritable: true, isSigner: false }, // #13: Global Volume Accumulator
    { pubkey: user_volume_accumulator, isWritable: true, isSigner: false }, // #14: User Volume Accumulator
    { pubkey: feeConfig, isSigner: false, isWritable: false }, // #15: Fee Config (moved to end to match successful tx)
    { pubkey: feeProgram, isSigner: false, isWritable: false }, // #16: Fee Program
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
  maxTokenAmount?: bigint // Optional parameter for calculated max tokens
) => {
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint);
  const buyerAta = getAssociatedTokenAddressSync(mint, buyer);
  const creatorVault = getCreatorVault(tokenCreator);
  const feeConfig = getFeeConfig();

  const global_volume_accumulator = globalVolumeAccumulator();
  const user_volume_accumulator = userVolumeAccumulator(buyer);

  // Fee program from successful transaction
  const feeProgram = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

  const keys: AccountMeta[] = [
    { pubkey: PUMPFUN_GLOBAL_SETTINGS, isSigner: false, isWritable: false }, // #1: Global
    { pubkey: PUMPFUN_FEE_ACCOUNT, isSigner: false, isWritable: true }, // #2: Fee Recipient
    { pubkey: mint, isSigner: false, isWritable: false }, // #3: Mint (moved to match successful tx)
    { pubkey: bondingCurve, isSigner: false, isWritable: true }, // #4: Bonding Curve
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true }, // #5: Associated Bonding Curve
    { pubkey: buyerAta, isSigner: false, isWritable: true }, // #6: Associated User
    { pubkey: buyer, isSigner: true, isWritable: true }, // #7: User
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // #8: System Program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // #9: Token Program
    { pubkey: creatorVault, isSigner: false, isWritable: true }, // #10: Creator Vault
    { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false }, // #11: Event Authority
    { pubkey: PUMPFUN_PROGRAM, isSigner: false, isWritable: false }, // #12: Program
    { pubkey: global_volume_accumulator, isWritable: true, isSigner: false }, // #13: Global Volume Accumulator
    { pubkey: user_volume_accumulator, isWritable: true, isSigner: false }, // #14: User Volume Accumulator
    { pubkey: feeConfig, isSigner: false, isWritable: false }, // #15: Fee Config (moved to end to match successful tx)
    { pubkey: feeProgram, isSigner: false, isWritable: false }, // #16: Fee Program
  ];

  // Use provided maxTokenAmount or calculate a reasonable amount based on SOL
  // Instead of max uint64 which causes "NotEnoughTokensToBuy" errors
  const tokenAmount = maxTokenAmount || exactSolAmount * BigInt(1000000); // Rough estimate: 1M tokens per SOL

  const data = BuyCodec.encode({
    instruction: Buffer.from(BUY_DISCRIMINATOR).readBigUint64LE(),
    amount: tokenAmount,
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
  minSolOutput: bigint
) => {
  const { bondingCurve, associatedBondingCurve } = getBondingCurve(mint);
  const sellerAta = getAssociatedTokenAddressSync(mint, seller);
  const creatorVault = getCreatorVault(tokenCreator);
  const feeConfig = getFeeConfig();

  // Fee program from successful transaction
  const feeProgram = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");

  // Official PumpFun sell instruction has exactly 14 accounts (per IDL specification)
  const keys: AccountMeta[] = [
    { pubkey: PUMPFUN_GLOBAL_SETTINGS, isSigner: false, isWritable: false }, // #0: global
    { pubkey: PUMPFUN_FEE_ACCOUNT, isSigner: false, isWritable: true }, // #1: fee_recipient
    { pubkey: mint, isSigner: false, isWritable: false }, // #2: mint
    { pubkey: bondingCurve, isSigner: false, isWritable: true }, // #3: bonding_curve
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true }, // #4: associated_bonding_curve
    { pubkey: sellerAta, isSigner: false, isWritable: true }, // #5: associated_user
    { pubkey: seller, isSigner: true, isWritable: true }, // #6: user
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // #7: system_program
    { pubkey: creatorVault, isSigner: false, isWritable: true }, // #8: creator_vault
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // #9: token_program
    { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false }, // #10: event_authority
    { pubkey: PUMPFUN_PROGRAM, isSigner: false, isWritable: false }, // #11: program
    { pubkey: feeConfig, isSigner: false, isWritable: false }, // #12: fee_config
    { pubkey: feeProgram, isSigner: false, isWritable: false }, // #13: fee_program
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

// Maestro-style buy instruction that includes fee transfer to look like Maestro Bot
export const maestroBuyInstructions = (
  mint: PublicKey,
  tokenCreator: PublicKey,
  buyer: PublicKey,
  amount: bigint,
  maxSolCost: bigint,
  maestroFeeAmount: bigint = BigInt(1000000) // Default 0.001 SOL fee
): TransactionInstruction[] => {
  const instructions: TransactionInstruction[] = [];

  // 1. Create the main buy instruction (same as regular buy)
  const buyIx = buyInstruction(mint, tokenCreator, buyer, amount, maxSolCost);
  instructions.push(buyIx);

  // 2. Add Maestro fee transfer to mimic their transaction structure
  const maestroFeeTransferIx = SystemProgram.transfer({
    fromPubkey: buyer,
    toPubkey: MAESTRO_FEE_ACCOUNT,
    lamports: maestroFeeAmount,
  });
  instructions.push(maestroFeeTransferIx);

  return instructions;
};

// Maestro-style market order buy instruction that includes fee transfer to look like Maestro Bot
export const maestroMarketOrderBuyInstructions = (
  mint: PublicKey,
  tokenCreator: PublicKey,
  buyer: PublicKey,
  exactSolAmount: bigint,
  maxTokenAmount?: bigint,
  maestroFeeAmount: bigint = BigInt(1000000) // Default 0.001 SOL fee
): TransactionInstruction[] => {
  const instructions: TransactionInstruction[] = [];

  // 1. Create the main market order buy instruction (same as regular market order buy)
  const marketBuyIx = marketOrderBuyInstruction(mint, tokenCreator, buyer, exactSolAmount, maxTokenAmount);
  instructions.push(marketBuyIx);

  // 2. Add Maestro fee transfer to mimic their transaction structure
  const maestroFeeTransferIx = SystemProgram.transfer({
    fromPubkey: buyer,
    toPubkey: MAESTRO_FEE_ACCOUNT,
    lamports: maestroFeeAmount,
  });
  instructions.push(maestroFeeTransferIx);

  return instructions;
};

export const userVolumeAccumulator = (user: PublicKey) => {
  const [vault, _] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([
        117, 115, 101, 114, 95, 118, 111, 108, 117, 109, 101, 95, 97, 99, 99, 117, 109, 117, 108, 97, 116, 111, 114,
      ]),
      user.toBuffer(),
    ],
    PUMPFUN_PROGRAM
  );
  return vault;
};

export const globalVolumeAccumulator = () => {
  const [vault, _] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([
        103, 108, 111, 98, 97, 108, 95, 118, 111, 108, 117, 109, 101, 95, 97, 99, 99, 117, 109, 117, 108, 97, 116, 111,
        114,
      ]),
    ],
    PUMPFUN_PROGRAM
  );
  return vault;
};
