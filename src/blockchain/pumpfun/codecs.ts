import {
  type Codec,
  getStructCodec,
  addCodecSizePrefix,
  getUtf8Codec,
  getU32Codec,
  getU64Codec,
  getBase58Codec,
  getBooleanCodec,
} from "@solana/codecs";

type CreateToken = {
  instruction: bigint;
  name: string;
  symbol: string;
  uri: string;
  creator: string;
};

type Buy = {
  instruction: bigint;
  amount: bigint;
  maxSolCost: bigint;
};

type Sell = {
  instruction: bigint;
  amount: bigint;
  minSolOutput: bigint;
};

type GlobalSetting = {
  discriminator: bigint;
  initialized: boolean;
  authority: string;
  feeRecipient: string;
  initialVirtualTokenReserves: bigint;
  initialVirtualSolReserves: bigint;
  initialRealTokenReserves: bigint;
  tokenTotalSupply: bigint;
  feeBasisPoints: bigint;
  withdrawAuthority: string;
  enableMigrate: boolean;
  poolMigrationFee: bigint;
  creatorFeeBasisPoints: bigint;
};

type BondingCurve = {
  discriminator: bigint;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
};

export const CreateCodec: Codec<CreateToken> = getStructCodec([
  ["instruction", getU64Codec()],
  ["name", addCodecSizePrefix(getUtf8Codec(), getU32Codec())],
  ["symbol", addCodecSizePrefix(getUtf8Codec(), getU32Codec())],
  ["uri", addCodecSizePrefix(getUtf8Codec(), getU32Codec())],
  ["creator", getBase58Codec()],
]);

export const BuyCodec: Codec<Buy> = getStructCodec([
  ["instruction", getU64Codec()],
  ["amount", getU64Codec()],
  ["maxSolCost", getU64Codec()],
]);

export const SellCodec: Codec<Sell> = getStructCodec([
  ["instruction", getU64Codec()],
  ["amount", getU64Codec()],
  ["minSolOutput", getU64Codec()],
]);

export const GlobalSettingCodec: Codec<GlobalSetting> = getStructCodec([
  ["discriminator", getU64Codec()],
  ["initialized", getBooleanCodec()],
  ["authority", getBase58Codec()],
  ["feeRecipient", getBase58Codec()],
  ["initialVirtualTokenReserves", getU64Codec()],
  ["initialVirtualSolReserves", getU64Codec()],
  ["initialRealTokenReserves", getU64Codec()],
  ["tokenTotalSupply", getU64Codec()],
  ["feeBasisPoints", getU64Codec()],
  ["withdrawAuthority", getBase58Codec()],
  ["enableMigrate", getBooleanCodec()],
  ["poolMigrationFee", getU64Codec()],
  ["creatorFeeBasisPoints", getU64Codec()],
]);

export const BondingCurveCodec: Codec<BondingCurve> = getStructCodec([
  ["discriminator", getU64Codec()],
  ["virtualTokenReserves", getU64Codec()],
  ["virtualSolReserves", getU64Codec()],
  ["realTokenReserves", getU64Codec()],
  ["realSolReserves", getU64Codec()],
  ["tokenTotalSupply", getU64Codec()],
  ["complete", getBooleanCodec()],
]);
