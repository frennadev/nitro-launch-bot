import { Context } from "grammy";
import { type ConversationFlavor } from "@grammyjs/conversations";

// ==== Your Custom Types ==== //
// import {
//   BoostMode,
//   BoostPackage,
//   Chain,
//   Dex,
//   PoolInfo,
//   TokenInfo,
//   WalletInfo,
// } from "../scenes/boost/types";

// ===== Session structure ===== //
export interface UserData {
  id: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BoostWizardData {
  currentStep: number;
  messageIds: number[];
  boostId?: string;
  data: {
    [key: string]: number | string | object | null;
    chain: Chain | null;
    // wallet: WalletInfo | null;
    // mode: BoostMode | string | null;
    // token: TokenInfo | null;
    // dex: Dex | null;
    // pool: PoolInfo | null;
    // package: BoostPackage | null;
    value: number;
    targetVolume: number;
    currentVolume: number;
    estimatedVolumeData: any;
    deadline: number;
  };
}

export interface SessionData {
  tokenInfo?: string;
  lastMenuMessageId: number;
  lastMessageText?: string;
  currentScene?: string;
  previousScene?: string;
  lastActivity: Date;
  inputData?: Record<string, any>;
  settings?: Record<string, any>;
  messageIds: number[];
  //   currentChain: Chain | null;
  sessionData: {
    id: number;
    chain: string;
  };
  BoostWizardData: BoostWizardData;
}

// ===== Final Context Type ===== //
export type MyContext = Context &
  ConversationFlavor<Context> & { session: SessionData };
