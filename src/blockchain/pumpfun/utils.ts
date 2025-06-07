import { PublicKey } from "@solana/web3.js";
import { PUMPFUN_PROGRAM, TOKEN_METADATA_PROGRAM } from "./constants";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection } from "../common/connection";
import { BondingCurveCodec, GlobalSettingCodec } from "./codecs";

export const getBondingCurve = (mint: PublicKey) => {
  const [bondingCurve, _] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([
        98, 111, 110, 100, 105, 110, 103, 45, 99, 117, 114, 118, 101,
      ]),
      mint.toBuffer(),
    ],
    PUMPFUN_PROGRAM,
  );
  const associatedBondingCurve = getAssociatedTokenAddressSync(
    mint,
    bondingCurve,
    true,
  );
  return {
    bondingCurve,
    associatedBondingCurve,
  };
};

export const getMetadataPDA = (mint: PublicKey) => {
  const [pda, _] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([109, 101, 116, 97, 100, 97, 116, 97]),
      Buffer.from([
        11, 112, 101, 177, 227, 209, 124, 69, 56, 157, 82, 127, 107, 4, 195,
        205, 88, 184, 108, 115, 26, 160, 253, 181, 73, 182, 209, 188, 3, 248,
        41, 70,
      ]),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM,
  );
  return pda;
};

export const getCreatorVault = (creator: PublicKey) => {
  const [vault, _] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([
        99, 114, 101, 97, 116, 111, 114, 45, 118, 97, 117, 108, 116,
      ]),
      creator.toBuffer(),
    ],
    PUMPFUN_PROGRAM,
  );
  return vault;
};

export const getGlobalSetting = async () => {
  const [setting] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMPFUN_PROGRAM,
  );
  const info = await connection.getAccountInfo(setting);
  if (!info) throw new Error("Empty global settings data!!");
  return GlobalSettingCodec.decode(Uint8Array.from(info.data));
};

export const getBondingCurveData = async (curve: PublicKey) => {
  const info = await connection.getAccountInfo(curve);
  if (!info) return null;
  return BondingCurveCodec.decode(info.data);
};

export const quoteBuy = (
  amountIn: bigint,
  virtualTokenReserve: bigint,
  virtualSolReserve: bigint,
  realTokenReserve: bigint,
) => {
  const virtualTokenAmount = virtualSolReserve * virtualTokenReserve;
  const totalSolPlusAmount = virtualSolReserve + amountIn;
  const currentTokenAmount =
    virtualTokenAmount / totalSolPlusAmount + BigInt(1);
  const tokenAmountLeft = virtualTokenReserve - currentTokenAmount;

  let tokenOut = tokenAmountLeft;
  if (tokenAmountLeft > realTokenReserve) {
    tokenOut = realTokenReserve;
  }

  const newVirtualSOLReserve = virtualSolReserve + amountIn;
  const newRealTokenReserve = realTokenReserve - tokenOut;
  const newVirtualTokenReserve = virtualTokenReserve - tokenOut;

  return {
    tokenOut,
    newVirtualTokenReserve,
    newVirtualSOLReserve,
    newRealTokenReserve,
  };
};

export const applySlippage = (amount: bigint, slippage: number) => {
  const SlippageAdjustment = BigInt(1);
  const Big10000 = BigInt(10000);

  let slippageBP =
    (BigInt(Math.floor(100 * slippage)) + BigInt(25)) * SlippageAdjustment;
  const maxSlippage = Big10000 * SlippageAdjustment;

  if (slippageBP > maxSlippage) {
    slippageBP = Big10000;
  }

  const slippageBPBN = slippageBP;

  const slippageNumeratorMul = maxSlippage - slippageBPBN;
  const slippageNumerator = amount * slippageNumeratorMul;

  return slippageNumerator / maxSlippage;
};
