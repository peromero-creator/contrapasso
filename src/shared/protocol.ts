import type { SkillId, Skills } from "../sim/skills.ts";
import type { CombatBuild } from "../sim/build.ts";

export interface ChainStatus {
  network: "testnet";
  contractId: string;
  accountId: string;
  tokenId: string;
  pending: boolean;
  lastTransaction?: string;
  revision: number;
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
  id: string;
  operation:
    | "register"
    | "solo"
    | "train"
    | "defense"
    | "duel_open"
    | "duel_settle"
    | "duel_expire";
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
  chain?: ChainStatus;
}
export interface RunChallenge {
  id: string;
  version: string;
  seed: number;
  skills: SkillId[];
  expiresAt: number;
  mode: "solo" | "duel";
  equipment: { weaponLevel: number; armorLevel: number };
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
