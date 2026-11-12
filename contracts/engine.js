// Shared contract rules. No network, filesystem, clock or randomness.
import { SKILLS, SKILL_IDS } from "../src/sim/skills.ts";
import {
  fairMatch,
  copyBuild,
  DUEL_STAKE,
  MAX_GEAR_LEVEL,
  upgradeCost,
  upgradeChance,
} from "../src/sim/build.ts";

import { MARKET_OPERATIONS } from "../src/shared/market.ts";
export const CHAIN_DOMAIN = "contrapasso:testnet:v1";
export const CAP = 300;
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};
const number = (n, max = 1_000_000) =>
  Number.isSafeInteger(n) && n >= 0 && n <= max;
const clone = (value) => JSON.parse(JSON.stringify(value));
export function powers(value) {
  requireThat(
    value && typeof value === "object" && !Array.isArray(value),
    "Invalid powers",
  );
  for (const id of Object.keys(value))
    requireThat(
      SKILL_IDS.includes(id) && number(value[id], 3),
      "Invalid power rank",
    );
  const result = {};
  for (const id of SKILL_IDS) if (value[id]) result[id] = value[id];
  return result;
}
export function build(value) {
  requireThat(
    value && number(value.weaponLevel, 9) && number(value.armorLevel, 9),
    "Invalid gear",
  );
  return {
    skills: powers(value.skills),
    weaponLevel: value.weaponLevel,
    armorLevel: value.armorLevel,
  };
}
export function readChampion(store, id, nowMs) {
  const c = store.champions.get(id);
  if (!c) return null;
  const result = clone(c);
  result.ownerId = store.owner(id);
  if (store.prize) result.prizeYocto = store.prize(id);
  if (result.day !== Math.floor(nowMs / 86400000)) result.earnedToday = 0;
  return result;
}
function owned(store, id, owner, revision) {
  const c = store.champions.get(id);
  requireThat(c && store.owner(id) === owner, "Champion ownership changed");
  requireThat(c.revision === revision, "Champion changed; refresh");
  requireThat(!store.pendingTransfer(id), "NFT transfer is pending");
  return c;
}
function unlocked(c) {
  requireThat(!c.lockedBy, "Champion is in a duel");
}
function increment(store, c) {
  c.revision++;
  store.champions.set(c.id, c);
}

/** Caller authenticates the raw signed payload before entering this function. */
export function applyAction(store, context, action) {
  requireThat(
    action.domain === CHAIN_DOMAIN && action.contractId === context.contractId,
    "Wrong receipt domain",
  );
  requireThat(
    typeof action.id === "string" &&
      action.id.length >= 8 &&
      action.id.length <= 160,
    "Invalid receipt id",
  );
  requireThat(
    typeof action.championId === "string" &&
      /^[a-zA-Z0-9-]{1,80}$/.test(action.championId),
    "Invalid champion id",
  );
  const old = store.used.get(action.id);
  if (old) {
    requireThat(
      !context.depositYocto || context.depositYocto === "0",
      "Duplicate receipt cannot accept payment",
    );
    return { ...old, duplicate: true };
  }
  requireThat(
    action.operation === "mint" ||
      !context.depositYocto ||
      context.depositYocto === "0",
    "Unexpected native payment",
  );
  requireThat(
    number(action.expiresAt, Number.MAX_SAFE_INTEGER) &&
      action.expiresAt >= context.nowMs &&
      action.expiresAt <= context.nowMs + 86400000,
    "Receipt expired",
  );
  const data = action.data;
  requireThat(data && typeof data === "object", "Invalid receipt data");
  let c;
  if (action.operation === "register") {
    requireThat(
      !store.champions.get(action.championId),
      "Champion already exists",
    );
    requireThat(context.validAccount(action.ownerId), "Invalid owner");
    requireThat(
      number(data.coins) &&
        number(data.runs) &&
        number(data.victories) &&
        number(data.earnedToday, CAP),
      "Invalid checkpoint",
    );
    requireThat(
      Array.isArray(data.skills) &&
        new Set(data.skills).size === data.skills.length &&
        data.skills.every((id) => SKILL_IDS.includes(id)),
      "Invalid training",
    );
    const trained = {};
    for (const id of data.skills) trained[id] = 1;
    c = {
      id: action.championId,
      coins: data.coins,
      skills: [...data.skills],
      runs: data.runs,
      victories: data.victories,
      earnedToday: data.earnedToday,
      day: data.day,
      build: build(
        data.build ?? { skills: trained, weaponLevel: 0, armorLevel: 0 },
      ),
      bestFloor: data.bestFloor ?? 0,
      duelWins: 0,
      duelLosses: 0,
      defending: false,
      lockedBy: null,
      revision: 0,
      equipped: {
        weapon: `weapon:${action.championId}`,
        armor: `armor:${action.championId}`,
      },
    };
    store.champions.set(c.id, c);
    store.mint(c, action.ownerId);
  } else if (
    action.operation === "duel_settle" ||
    action.operation === "duel_expire"
  ) {
    const duel = store.duels.get(data.duelId);
    requireThat(duel && duel.challenger === action.championId, "Unknown duel");
    requireThat(!duel.settled, "Duel already settled");
    c = store.champions.get(duel.challenger);
    const defender = store.champions.get(duel.defender);
    requireThat(
      c.lockedBy === duel.id && defender.lockedBy === duel.id,
      "Duel lock missing",
    );
    requireThat(
      store.owner(c.id) === action.ownerId,
      "Champion ownership changed",
    );
    if (action.operation === "duel_expire") {
      requireThat(context.nowMs >= duel.expiresAt, "Duel is still active");
      defender.coins += duel.stake * 2;
      c.duelLosses++;
      defender.duelWins++;
    } else {
      requireThat(context.nowMs <= duel.expiresAt, "Duel expired");
      requireThat(data.won === true || data.won === false, "Invalid outcome");
      if (data.won) {
        c.coins += duel.stake * 2;
        c.duelWins++;
        defender.duelLosses++;
      } else {
        defender.coins += duel.stake * 2;
        c.duelLosses++;
        defender.duelWins++;
      }
    }
    c.lockedBy = defender.lockedBy = null;
    duel.settled = true;
    duel.outcome =
      action.operation === "duel_expire"
        ? "expired"
        : data.won
          ? "challenger"
          : "defender";
    increment(store, c);
    increment(store, defender);
    store.duels.set(duel.id, duel);
  } else {
    c = owned(store, action.championId, action.ownerId, action.revision);
    unlocked(c);
    if (MARKET_OPERATIONS.includes(action.operation)) {
      requireThat(store.marketAction, "Market is unavailable");
      store.marketAction(c, context, action);
    } else if (action.operation === "solo") {
      requireThat(
        number(data.earnedCoins, 100000) &&
          number(data.floor, 5) &&
          data.floor >= 1 &&
          number(data.kills, 100000),
        "Invalid run",
      );
      requireThat(data.won === true || data.won === false, "Invalid outcome");
      const day = Math.floor(context.nowMs / 86400000);
      if (c.day !== day) {
        c.day = day;
        c.earnedToday = 0;
      }
      const award = Math.min(data.earnedCoins, CAP - c.earnedToday);
      c.coins += award;
      c.earnedToday += award;
      c.runs++;
      if (data.won) c.victories++;
      if (data.floor >= c.bestFloor) {
        c.bestFloor = data.floor;
        c.build = { ...c.build, skills: powers(data.powers) };
      }
      for (const id of c.skills)
        c.build.skills[id] = Math.max(c.build.skills[id] ?? 0, 1);
      store.recordKills(c, data.kills);
    } else if (action.operation === "train") {
      requireThat(
        SKILL_IDS.includes(data.skill) && !c.skills.includes(data.skill),
        "Invalid training",
      );
      const cost = SKILLS[data.skill].cost;
      requireThat(c.coins >= cost, "Not enough coin");
      c.coins -= cost;
      c.skills.push(data.skill);
      c.build.skills[data.skill] = Math.max(c.build.skills[data.skill] ?? 0, 1);
    } else if (action.operation === "upgrade") {
      // "+" on equipped gear. The referee draws the roll and signs it into the
      // receipt; cost, odds and the level cap are enforced here.
      requireThat(
        data.slot === "weapon" || data.slot === "armor",
        "Invalid gear slot",
      );
      requireThat(number(data.roll, 99), "Invalid roll");
      requireThat(c.equipped?.[data.slot], "Nothing equipped in that slot");
      const key = data.slot === "weapon" ? "weaponLevel" : "armorLevel";
      const level = c.build[key];
      requireThat(level < MAX_GEAR_LEVEL, "Gear is already at its limit");
      requireThat(
        data.fromLevel === level && data.gearId === c.equipped[data.slot],
        "Equipped gear changed; refresh",
      );
      const cost = upgradeCost(level);
      requireThat(c.coins >= cost, "Not enough coin");
      c.coins -= cost;
      if (data.roll < upgradeChance(level)) {
        c.build[key] = level + 1;
        store.upgradeGear(c, data.slot, level + 1);
      }
    } else if (action.operation === "claim") {
      // Hand the champion, its equipped gear and its vault to a wallet the player names.
      requireThat(
        typeof data.receiver === "string" &&
          context.validAccount(data.receiver) &&
          data.receiver !== action.ownerId,
        "Invalid receiver",
      );
      c.defending = false;
      store.transfer(c, data.receiver);
    } else if (action.operation === "defense") {
      requireThat(typeof data.enabled === "boolean", "Invalid defense setting");
      if (data.enabled)
        requireThat(
          c.coins >= DUEL_STAKE && c.runs > 0,
          "Play Solo and fund your vault first",
        );
      c.defending = data.enabled;
    } else if (action.operation === "duel_open") {
      requireThat(
        typeof data.duelId === "string" && !store.duels.get(data.duelId),
        "Invalid duel",
      );
      const defender = store.champions.get(data.opponentId);
      requireThat(
        defender &&
          defender.id !== c.id &&
          defender.defending &&
          !defender.lockedBy,
        "Defender unavailable",
      );
      requireThat(
        !store.pendingTransfer(defender.id) &&
          defender.revision === data.opponentRevision,
        "Defender changed",
      );
      requireThat(
        c.coins >= DUEL_STAKE && defender.coins >= DUEL_STAKE,
        "Vault cannot cover stake",
      );
      requireThat(
        fairMatch(c.build, defender.build),
        "Champion power mismatch",
      );
      requireThat(
        number(data.expiresAt, Number.MAX_SAFE_INTEGER) &&
          data.expiresAt > context.nowMs &&
          data.expiresAt <= context.nowMs + 30 * 60000,
        "Invalid duel deadline",
      );
      c.coins -= DUEL_STAKE;
      defender.coins -= DUEL_STAKE;
      c.lockedBy = defender.lockedBy = data.duelId;
      store.duels.set(data.duelId, {
        id: data.duelId,
        challenger: c.id,
        defender: defender.id,
        stake: DUEL_STAKE,
        expiresAt: data.expiresAt,
        challengerBuild: copyBuild(c.build),
        defenderBuild: copyBuild(defender.build),
        settled: false,
      });
      increment(store, defender);
    } else throw new Error("Unknown receipt operation");
    increment(store, c);
  }
  const result = {
    id: action.id,
    championId: c.id,
    revision: c.revision,
    operation: action.operation,
  };
  store.used.set(action.id, result);
  return result;
}
