import { PublicKey } from "@solana/web3.js";
import { PUMPFUN_PROGRAM, TOKEN_METADATA_PROGRAM } from "./constants.ts";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection } from "../common/connection.ts";
import { BondingCurveCodec, GlobalSettingCodec } from "./codecs.ts";

export const getBondingCurve = (mint: PublicKey) => {
  const [bondingCurve, _] = PublicKey.findProgramAddressSync(
    [
      Buffer.from([
        98, 111, 110, 100, 105, 110, 103, 45, 99, 117, 114, 118, 101,
      ]),
      mint.toBuffer(),
    ],
    PUMPFUN_PROGRAM
  );
  const associatedBondingCurve = getAssociatedTokenAddressSync(
    mint,
    bondingCurve,
    true
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
    TOKEN_METADATA_PROGRAM
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
    PUMPFUN_PROGRAM
  );
  return vault;
};

export const getGlobalSetting = async () => {
  const [setting] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    PUMPFUN_PROGRAM
  );
  const info = await connection.getAccountInfo(setting);
  if (!info) throw new Error("Empty global settings data!!");
  return GlobalSettingCodec.decode(Uint8Array.from(info.data));
};

export const getBondingCurveData = async (curve: PublicKey) => {
  const info = await connection.getAccountInfo(curve, "processed");
  if (!info) return null;
  return BondingCurveCodec.decode(info.data);
};

export const quoteBuy = (
  amountIn: bigint,
  virtualTokenReserve: bigint,
  virtualSolReserve: bigint,
  realTokenReserve: bigint
) => {
  // Validate inputs to prevent edge cases
  if (amountIn <= BigInt(0)) {
    console.warn(`[quoteBuy] Invalid amountIn: ${amountIn}`);
    return {
      tokenOut: BigInt(0),
      newVirtualTokenReserve: virtualTokenReserve,
      newVirtualSOLReserve: virtualSolReserve,
      newRealTokenReserve: realTokenReserve,
    };
  }

  if (
    virtualTokenReserve <= BigInt(0) ||
    virtualSolReserve <= BigInt(0) ||
    realTokenReserve <= BigInt(0)
  ) {
    console.warn(
      `[quoteBuy] Invalid reserves - virtualToken: ${virtualTokenReserve}, virtualSol: ${virtualSolReserve}, realToken: ${realTokenReserve}`
    );
    return {
      tokenOut: BigInt(0),
      newVirtualTokenReserve: virtualTokenReserve,
      newVirtualSOLReserve: virtualSolReserve,
      newRealTokenReserve: realTokenReserve,
    };
  }

  try {
    // Use the standard bonding curve formula: x * y = k
    const k = virtualSolReserve * virtualTokenReserve;
    const newVirtualSOLReserve = virtualSolReserve + amountIn;

    // Calculate new virtual token reserve from constant product formula
    const newVirtualTokenReserve = k / newVirtualSOLReserve;

    // Token output is the difference in virtual reserves
    let tokenOut = virtualTokenReserve - newVirtualTokenReserve;

    // Ensure we don't exceed real token reserves
    if (tokenOut > realTokenReserve) {
      tokenOut = realTokenReserve;
    }

    // Ensure tokenOut is positive
    if (tokenOut <= BigInt(0)) {
      console.warn(
        `[quoteBuy] Calculated tokenOut is not positive: ${tokenOut}`
      );
      return {
        tokenOut: BigInt(0),
        newVirtualTokenReserve: virtualTokenReserve,
        newVirtualSOLReserve: virtualSolReserve,
        newRealTokenReserve: realTokenReserve,
      };
    }

    const finalNewRealTokenReserve = realTokenReserve - tokenOut;
    const finalNewVirtualTokenReserve = virtualTokenReserve - tokenOut;

    return {
      tokenOut,
      newVirtualTokenReserve: finalNewVirtualTokenReserve,
      newVirtualSOLReserve: newVirtualSOLReserve,
      newRealTokenReserve: finalNewRealTokenReserve,
    };
  } catch (error) {
    console.error(`[quoteBuy] Error in calculation:`, error);
    return {
      tokenOut: BigInt(0),
      newVirtualTokenReserve: virtualTokenReserve,
      newVirtualSOLReserve: virtualSolReserve,
      newRealTokenReserve: realTokenReserve,
    };
  }
};

export const quoteSell = (
  tokenAmountIn: bigint,
  virtualTokenReserves: bigint,
  virtualSolReserves: bigint,
  realTokenReserves: bigint
) => {
  if (tokenAmountIn > realTokenReserves) {
    tokenAmountIn = realTokenReserves;
  }

  const virtualTokenAmount = virtualSolReserves * virtualTokenReserves;
  const newVirtualTokenReserves = virtualTokenReserves + tokenAmountIn;
  const newVirtualSolReserves =
    virtualTokenAmount / newVirtualTokenReserves + BigInt(1);
  const solOut = virtualSolReserves - newVirtualSolReserves;

  return {
    solOut,
    newVirtualTokenReserves,
    newVirtualSolReserves,
    newRealTokenReserves: realTokenReserves - tokenAmountIn,
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

export const getFeeConfig = () => {
  // Use the actual fee config address from successful transactions
  return new PublicKey("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt");
};
