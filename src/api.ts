import type {
  MarketView,
  MarketOperation,
  MarketIntent,
} from "./shared/market";
import type {
  Champion,
  Receipt,
  RunChallenge,
  DuelOpponent,
  UpgradeOutcome,
  NftView,
  ClaimOutcome,
} from "./shared/protocol";
import type { SkillId } from "./sim/skills";

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response
    .json()
    .catch(() => ({ error: "Connection lost. Please try again." }));
  if (!response.ok)
    throw new ApiError(result.error ?? "Something went wrong. Please try again.", response.status);
  return result;
}
export const api = {
  profile: () => request<Champion>("profile"),
  begin: (retry?: string, abandon?: string) =>
    request<RunChallenge>("runs", { retry, abandon }),
  submit: (id: string, inputs: number[]) =>
    request<{ receipt: Receipt; champion: Champion }>("results", {
      id,
      inputs,
    }),
  selectSpell: (spell: import("./sim/abilities").SpellId) => request<Champion>("attune", { slot: "spell", spell }),
  attune: (core: import("./sim/abilities").CoreId) =>
    request<Champion>("attune", { core }),
  train: (skill: SkillId) => request<Champion>("train", { skill }),
  upgrade: (slot: "weapon" | "armor", id: string) =>
    request<{ champion: Champion; upgrade: UpgradeOutcome }>("upgrade", {
      slot, id,
    }),
  nft: () => request<NftView>("nft"),
  market: () => request<MarketView>("market"),
  marketAction: (
    id: string,
    operation: MarketOperation,
    data: Record<string, unknown>,
  ) =>
    request<{ intent: MarketIntent; champion: Champion; market: MarketView }>(
      "market",
      { id, operation, data },
    ),
  claim: (receiver: string, championId: string) =>
    request<{ champion: Champion; claimed: ClaimOutcome }>("claim", {
      receiver,
      championId,
    }),
  opponents: () => request<DuelOpponent[]>("opponents"),
  duel: (opponentId: string) => request<RunChallenge>("duels", { opponentId }),
  defense: (enabled: boolean) => request<Champion>("defense", { enabled }),
  forfeit: (id: string) => request<Champion>("forfeit", { id }),
  currentDuel: () => request<RunChallenge | null>("duel-current"),
  lobby: () =>
    request<{
      champion: Champion;
      opponents: DuelOpponent[];
      active: RunChallenge | null;
      stake: number;
    }>("duel-lobby"),
  progress: (id: string, inputs: number[]) =>
    request<{ ticks: number }>("duel-progress", { id, inputs }),
};
