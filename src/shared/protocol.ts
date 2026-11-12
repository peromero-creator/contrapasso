import type { SkillId, Skills } from "../sim/skills.ts";
import type { MarketOperation } from "./market.ts";
import type { CombatBuild } from "../sim/build.ts";

export interface ChainStatus {
  network: "testnet";
  contractId: string;
  accountId: string;
  tokenId: string;
  pending: boolean;
  lastTransaction?: string;
  revision: number;
  features?: string[];
}
export interface DuelOpponent {
  id: string;
  name: string;
  build: CombatBuild;
  wins: number;
  losses: number;
  coins: number;
}
export interface ChainOperation {
  transactionHash?: string;
  id: string;
  operation:
    | "register"
    | "solo"
    | "train"
    | "attune"
    | "upgrade"
    | "claim"
    | "defense"
    | "duel_open"
    | "duel_settle"
    | "duel_expire"
    | MarketOperation;
  championId: string;
  opponentId?: string;
  data: Record<string, unknown>;
}

export interface Champion {
  id: string;
  coins: number;
  skills: SkillId[];
  runs: number;
  victories: number;
  earnedToday: number;
  dailyCap: number;
  build: CombatBuild;
  bestFloor: number;
  duelWins: number;
  duelLosses: number;
  defending: boolean;
  lockedBy: string | null;
  equipped?: { weapon: string | null; armor: string | null };
  prizeYocto?: string;
  pendingClaim?: { receiver: string; operationId: string };
  chain?: ChainStatus;
}
/** One NFT as the chain (or, in local preview, the save) reports it. */
export interface NftToken {
  tokenId: string;
  ownerId: string;
  title: string;
  extra: Record<string, unknown>;
}
export interface NftView {
  onChain: boolean;
  features?: string[];
  contractId?: string;
  tokens: NftToken[];
}
export interface ClaimOutcome {
  pending: boolean;
  tokenId: string;
  receiver: string;
  transaction?: string;
}
export interface UpgradeOutcome {
  slot: "weapon" | "armor";
  success: boolean;
  level: number;
  cost: number;
}
export interface RunChallenge {
  id: string;
  version: string;
  seed: number;
  skills: SkillId[];
  expiresAt: number;
  mode: "solo" | "duel";
  equipment: {
    spell?: import("../sim/abilities.ts").SpellId;
    core?: import("../sim/abilities.ts").CoreId | null;
    weaponLevel: number;
    armorLevel: number;
    weaponId?: import("../sim/weapons.ts").WeaponId;
  };
  challengerBuild?: CombatBuild;
  opponent?: DuelOpponent;
  duelId?: string;
  resumeInputs?: number[];
}
export interface RunResult {
  version: string;
  runId: string;
  championId: string;
  seed: number;
  outcome: "dead" | "won";
  floor: number;
  ticks: number;
  kills: number;
  earnedCoins: number;
  awardedCoins: number;
  powers: Skills;
  mode: "solo" | "duel";
  coinDelta: number;
  opponentId?: string;
  duelId?: string;
}
export interface Receipt {
  result: RunResult;
  signature: string;
}
