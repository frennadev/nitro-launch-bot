import {
  type Codec,
  getStructCodec,
  getU64Codec,
  getBase58Codec,
  getBooleanCodec,
  fixCodecSize,
} from "@solana/codecs";

// Instruction types
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

type Create = {
  instruction: bigint;
  name: string;
  symbol: string;
  uri: string;
  creator: string;
};

// Bonding curve data structure
type BondingCurve = {
  discriminator: bigint;
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: string;
};

// Global settings structure
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

// Codec for bonding curve data
export const BondingCurveCodec: Codec<BondingCurve> = getStructCodec([
  ["discriminator", getU64Codec()],
  ["virtualTokenReserves", getU64Codec()],
  ["virtualSolReserves", getU64Codec()],
  ["realTokenReserves", getU64Codec()],
  ["realSolReserves", getU64Codec()],
  ["tokenTotalSupply", getU64Codec()],
  ["complete", getBooleanCodec()],
  ["creator", fixCodecSize(getBase58Codec(), 32)],
]);

// Codec for global settings
export const GlobalSettingCodec: Codec<GlobalSetting> = getStructCodec([
  ["discriminator", getU64Codec()],
  ["initialized", getBooleanCodec()],
  ["authority", fixCodecSize(getBase58Codec(), 32)],
  ["feeRecipient", fixCodecSize(getBase58Codec(), 32)],
  ["initialVirtualTokenReserves", getU64Codec()],
  ["initialVirtualSolReserves", getU64Codec()],
  ["initialRealTokenReserves", getU64Codec()],
  ["tokenTotalSupply", getU64Codec()],
  ["feeBasisPoints", getU64Codec()],
  ["withdrawAuthority", fixCodecSize(getBase58Codec(), 32)],
  ["enableMigrate", getBooleanCodec()],
  ["poolMigrationFee", getU64Codec()],
  ["creatorFeeBasisPoints", getU64Codec()],
]);

// Instruction codecs
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

export const CreateCodec: Codec<Create> = getStructCodec([
  ["instruction", getU64Codec()],
  ["name", fixCodecSize(getBase58Codec(), 32)],
  ["symbol", fixCodecSize(getBase58Codec(), 10)],
  ["uri", fixCodecSize(getBase58Codec(), 200)],
  ["creator", fixCodecSize(getBase58Codec(), 32)],
]); 