import {
  type Codec,
  getStructCodec,
  addCodecSizePrefix,
  getUtf8Codec,
  getU32Codec,
  getU64Codec,
  getBase58Codec,
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
