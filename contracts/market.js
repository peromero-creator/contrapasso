import { listGear, cancelSale, buyGear, beginSaleWithdrawal, resolveSaleWithdrawal } from "./exchange.js";
import { WEAPONS } from "../src/sim/weapons.ts";
import {
  MINT_ENTRY_COIN,
  TICKET_COIN,
  MINT_PRICE_YOCTO,
  SPONSOR_YOCTO,
  SPONSOR_LIMIT,
  MINT_CAP,
  TICKET_LIMIT,
} from "../src/shared/market.ts";
const check = (ok, message) => {
  if (!ok) throw new Error(message);
};
const integer = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const add = (a, b) => (BigInt(a ?? "0") + BigInt(b)).toString();
export const economy = (store) =>
  store.market.get("config") ?? {
    currentRound: null,
    roundIds: [],
    sponsored: 0,
    liabilityYocto: "0",
    carryYocto: "0",
    mode: "treasury",
    treasuryYocto: "0",
  };
export const prize = (store, id) => store.market.get(`prize:${id}`) ?? "0";
export const pendingNative = (store, id) => store.market.get(`native:${id}`);
export const reservation = (store, round, id) =>
  store.reservations.get(`${round}:${id}`);
export function openRound(store, ctx, { id, durationSeconds = 120, cap = MINT_CAP }) {
  const config = economy(store),
    old = config.currentRound ? store.rounds.get(config.currentRound) : null;
  check(!old || old.drawn, "Draw the previous round first");
  check(
    typeof id === "string" &&
      /^[a-z0-9-]{1,40}$/.test(id) &&
      !store.rounds.get(id),
    "Invalid or existing round",
  );
  check(
    integer(durationSeconds, 604800) && durationSeconds >= 30,
    "Invalid round duration",
  );
  check(integer(cap, 1000) && cap >= 1, "Invalid edition supply");
  const round = {
    id,
    title: (config.mode ?? "raffle") === "treasury" ? "Arsenal of the Descent" : "Cinder Requiem",
    revenueMode: config.mode ?? "raffle",
    startsAt: ctx.nowMs,
    endsAt: ctx.nowMs + durationSeconds * 1000,
    cap,
    minted: 0,
    reserved: 0,
    poolYocto: config.carryYocto,
    entryCoin: MINT_ENTRY_COIN,
    ticketCoin: TICKET_COIN,
    priceYocto: MINT_PRICE_YOCTO,
    tickets: {},
    reservationIds: [],
    drawn: false,
    winners: [],
  };
  config.currentRound = id;
  config.roundIds = [...config.roundIds, id];
  config.carryYocto = "0";
  store.rounds.set(id, round);
  store.market.set("config", config);
  return round;
}
function active(store, ctx, id) {
  const round = store.rounds.get(id);
  check(
    round && !round.drawn && ctx.nowMs < round.endsAt,
    "This mint round is closed",
  );
  return round;
}
function saveChampion(store, c) {
  c.revision++;
  store.champions.set(c.id, c);
}
function refund(store, round, r, caller) {
  if (r.status !== "reserved") return;
  const c =
    caller?.id === r.championId ? caller : store.champions.get(r.championId);
  c.coins += round.entryCoin;
  if (c !== caller) saveChampion(store, c);
  r.status = "cancelled";
  round.reserved--;
  store.reservations.set(`${round.id}:${c.id}`, r);
}
/** Deterministic weighted sampling without replacement; the on-chain entropy is published in the round. */
export function selectWinners(tickets, entropy) {
  check(
    Array.isArray(entropy) &&
      entropy.length === 32 &&
      entropy.every((n) => integer(n, 255)),
    "Invalid draw entropy",
  );
  let seed = 0x9e3779b9;
  for (const byte of entropy) seed = Math.imul(seed ^ byte, 16777619) >>> 0;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  const entries = Object.entries(tickets)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    winners = [];
  while (entries.length && winners.length < 3) {
    const total = entries.reduce((n, [, count]) => n + count, 0),
      limit = 0x100000000 - (0x100000000 % total);
    let random;
    do {
      random = next();
    } while (random >= limit);
    let pick = random % total,
      index = 0;
    while (pick >= entries[index][1]) {
      pick -= entries[index][1];
      index++;
    }
    winners.push(entries.splice(index, 1)[0][0]);
  }
  return winners;
}
export function marketAction(store, ctx, c, action) {
  const data = action.data,
    config = economy(store),
    key = `${data.roundId}:${c.id}`;
  if (action.operation === "list_gear") return listGear(store, ctx, action.ownerId, data);
  if (action.operation === "cancel_sale") return cancelSale(store, action.ownerId, data);
  if (action.operation === "buy_gear") return buyGear(store, ctx, action.ownerId, data);
  if (action.operation === "withdraw_sales") {
    const amount = beginSaleWithdrawal(store, action.ownerId);
    store.market.set(`native:${c.id}`, { kind: "sale", receiptId: action.id, championId: c.id, receiver: action.ownerId, amountYocto: amount });
    return;
  }
  if (action.operation === "fund_guest") {
    check(c.runs > 0, "Finish Solo before using demo funds");
    check(
      /^[a-f0-9]{64}$/.test(action.ownerId),
      "Demo funding is for guest accounts",
    );
    check(
      !store.market.get(`funded:${c.id}`) && !pendingNative(store, c.id),
      "Guest already funded or pending",
    );
    check(config.sponsored < SPONSOR_LIMIT, "Demo funding slots are full");
    const pending = {
      kind: "fund",
      receiptId: action.id,
      championId: c.id,
      receiver: action.ownerId,
      amountYocto: SPONSOR_YOCTO,
    };
    store.market.set(`native:${c.id}`, pending);
    config.sponsored++;
    store.market.set("config", config);
    return;
  }
  if (action.operation === "withdraw_prize") {
    const amount = prize(store, c.id);
    check(BigInt(amount) > 0n, "No prize to withdraw");
    check(!pendingNative(store, c.id), "A payout is pending");
    store.market.set(`prize:${c.id}`, "0");
    store.market.set(`native:${c.id}`, {
      kind: "withdraw",
      receiptId: action.id,
      championId: c.id,
      receiver: action.ownerId,
      amountYocto: amount,
    });
    return;
  }
  if (
    action.operation === "equip_gear" ||
    action.operation === "unequip_gear"
  ) {
    store.equipGear(
      c,
      data,
      action.ownerId,
      action.operation === "unequip_gear",
    );
    return;
  }
  if (action.operation === "draw_round") {
    const round = store.rounds.get(data.roundId);
    check(
      round && !round.drawn && ctx.nowMs >= round.endsAt,
      "The draw is not ready",
    );
    // Expired/unpaid reservations return their earned coin, even if their owners left the page.
    for (const id of round.reservationIds) {
      const r = reservation(store, round.id, id);
      if (r?.status === "reserved") refund(store, round, r, c);
    }
    if (round.revenueMode === "treasury") {
      round.drawn = true;
      store.rounds.set(round.id, round);
      return;
    }
    const ids = selectWinners(round.tickets, ctx.entropy),
      pool = BigInt(round.poolYocto);
    round.entropy = ctx.entropy
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    round.drawBlock = ctx.blockHeight;
    round.drawn = true;
    if (ids.length) {
      const each = pool / BigInt(ids.length),
        extra = pool % BigInt(ids.length);
      round.winners = ids.map((id, i) => ({
        championId: id,
        amountYocto: (each + (i === 0 ? extra : 0n)).toString(),
      }));
      for (const winner of round.winners)
        store.market.set(
          `prize:${winner.championId}`,
          add(prize(store, winner.championId), winner.amountYocto),
        );
    } else {
      config.carryYocto = add(config.carryYocto, pool);
      round.carriedYocto = pool.toString();
    }
    store.rounds.set(round.id, round);
    store.market.set("config", config);
    return;
  }
  if (action.operation === "cancel_mint") {
    const round = store.rounds.get(data.roundId),
      r = reservation(store, data.roundId, c.id);
    check(round && r?.status === "reserved", "No unpaid reservation");
    // Caller c is saved by the common receipt engine; avoid a second, stale copy overwriting this refund.
    c.coins += round.entryCoin;
    r.status = "cancelled";
    round.reserved--;
    store.reservations.set(key, r);
    store.rounds.set(round.id, round);
    return;
  }
  const round = active(store, ctx, data.roundId);
  if (action.operation === "reserve_mint") {
    check(c.runs > 0, "Earn mint access in Solo");
    const choice = data.weaponId ?? "cinder-requiem";
    check(choice !== "starter" && Object.prototype.hasOwnProperty.call(WEAPONS, choice), "Unknown relic");
    check(round.revenueMode === "treasury" || choice === "cinder-requiem", "Legacy edition is Cinder Requiem only");
    const old = reservation(store, round.id, c.id);
    check(
      !old || old.status === "cancelled" || (round.revenueMode === "treasury" && old.status === "minted"),
      "This champion already reserved or minted",
    );
    check(
      round.minted + round.reserved < round.cap,
      "All editions are reserved",
    );
    check(c.coins >= round.entryCoin, "Not enough coin");
    check(
      round.reservationIds.includes(c.id) || round.reservationIds.length < 50,
      "Round participant limit reached",
    );
    c.coins -= round.entryCoin;
    round.reserved++;
    store.reservations.set(key, {
      id: action.id,
      championId: c.id,
      expiresAt: round.endsAt,
      status: "reserved",
      weaponId: choice,
    });
    if (!round.reservationIds.includes(c.id)) round.reservationIds.push(c.id);
  } else if (action.operation === "mint") {
    const r = reservation(store, round.id, c.id);
    check(
      r?.status === "reserved" && r.expiresAt > ctx.nowMs,
      "Reserve an edition first",
    );
    check(
      ctx.predecessor === action.ownerId &&
        ctx.depositYocto === round.priceYocto,
      "Mint requires the owner and exact native testnet payment",
    );
    round.minted++;
    round.reserved--;
    r.status = "minted";
    r.tokenId = `relic:${round.id}:${round.minted}`;
    store.reservations.set(key, r);
    store.mintGear(c, r.tokenId, action.ownerId, r.weaponId ?? "cinder-requiem");
    round.poolYocto = add(round.poolYocto, round.priceYocto);
    if (round.revenueMode === "treasury") config.treasuryYocto = add(config.treasuryYocto, round.priceYocto);
    config.liabilityYocto = add(config.liabilityYocto, round.priceYocto);
    store.market.set("config", config);
  } else if (action.operation === "tickets") {
    check(round.revenueMode !== "treasury", "Raffles are retired");
    check(
      c.runs > 0 && integer(data.count, TICKET_LIMIT) && data.count > 0,
      "Invalid ticket count",
    );
    const held = round.tickets[c.id] ?? 0;
    check(held + data.count <= TICKET_LIMIT, "Ticket limit reached");
    check(
      Object.values(round.tickets).reduce((n, count) => n + count, 0) +
        data.count <=
        200,
      "Round ticket capacity reached",
    );
    const cost = data.count * round.ticketCoin;
    check(c.coins >= cost, "Not enough coin");
    c.coins -= cost;
    round.tickets[c.id] = held + data.count;
  } else throw new Error("Unknown market action");
  store.rounds.set(round.id, round);
}
export function resolveNative(store, championId, success) {
  const p = pendingNative(store, championId);
  check(p, "No pending native transfer");
  const config = economy(store);
  if (p.kind === "sale") {
    resolveSaleWithdrawal(store, p.receiver, success);
    store.market.remove(`native:${championId}`);
    const receipt = store.used.get(p.receiptId);
    if (receipt) store.used.set(p.receiptId, { ...receipt, nativeComplete: true, nativeSuccess: success });
    return p;
  }
  if (p.kind === "fund") {
    if (success) store.market.set(`funded:${championId}`, true);
    else config.sponsored--;
  } else if (success)
    config.liabilityYocto = (
      BigInt(config.liabilityYocto) - BigInt(p.amountYocto)
    ).toString();
  else
    store.market.set(
      `prize:${championId}`,
      add(prize(store, championId), p.amountYocto),
    );
  store.market.remove(`native:${championId}`);
  store.market.set("config", config);
  const receipt = store.used.get(p.receiptId);
  if (receipt)
    store.used.set(p.receiptId, {
      ...receipt,
      nativeComplete: true,
      nativeSuccess: success,
    });
  return p;
}
export function marketView(store, championId) {
  const config = economy(store),
    round = config.currentRound ? store.rounds.get(config.currentRound) : null;
  return {
    round,
    revenueMode: config.mode ?? "raffle",
    treasuryYocto: config.treasuryYocto ?? "0",
    treasuryPending: !!store.market.get("treasury:pending"),
    reservation: round ? reservation(store, round.id, championId) : null,
    prizeYocto: prize(store, championId),
    sponsored: !!store.market.get(`funded:${championId}`),
    fundingAvailable: config.sponsored < SPONSOR_LIMIT,
    pendingNative: !!pendingNative(store, championId),
    history: config.roundIds.slice(-5).map((id) => store.rounds.get(id)),
  };
}

/** Retire ticket sales without confiscating outstanding entries or native prizes. */
export function retireRaffles(store) {
  const config = economy(store);
  if (config.mode === "treasury") return config;
  const round = config.currentRound ? store.rounds.get(config.currentRound) : null;
  if (round && !round.drawn) {
    check(Object.values(round.tickets).every(n => n === 0), "Settle existing ticket holders first");
    for (const id of round.reservationIds) {
      const r = reservation(store, round.id, id);
      if (r?.status === "reserved") refund(store, round, r);
    }
    config.treasuryYocto = add(config.treasuryYocto, round.poolYocto);
    round.drawn = true;
    round.retired = true;
    store.rounds.set(round.id, round);
  }
  config.treasuryYocto = add(config.treasuryYocto, config.carryYocto);
  config.carryYocto = "0";
  config.mode = "treasury";
  store.market.set("config", config);
  return config;
}
export function beginTreasuryTransfer(store, receiver, amount) {
  const config = economy(store);
  check(typeof amount === "string" && /^[0-9]{1,39}$/.test(amount) && BigInt(amount) > 0n, "Invalid treasury amount");
  check(!store.market.get("treasury:pending"), "Treasury transfer pending");
  check(BigInt(config.treasuryYocto ?? "0") >= BigInt(amount), "Insufficient treasury funds");
  config.treasuryYocto = (BigInt(config.treasuryYocto) - BigInt(amount)).toString();
  store.market.set("treasury:pending", { receiver, amount });
  store.market.set("config", config);
}
export function resolveTreasuryTransfer(store, success) {
  const pending = store.market.get("treasury:pending"), config = economy(store);
  check(pending, "No treasury transfer");
  if (success) config.liabilityYocto = (BigInt(config.liabilityYocto) - BigInt(pending.amount)).toString();
  else config.treasuryYocto = add(config.treasuryYocto, pending.amount);
  store.market.remove("treasury:pending");
  store.market.set("config", config);
  return { ...pending, success };
}

export function closeTreasuryRound(store) {
  const config = economy(store), round = config.currentRound ? store.rounds.get(config.currentRound) : null;
  check(config.mode === "treasury" && round?.revenueMode === "treasury", "Treasury edition required");
  if (round.drawn) return round;
  for (const id of round.reservationIds) { const r = reservation(store, round.id, id); if (r?.status === "reserved") refund(store, round, r); }
  round.drawn = true;
  store.rounds.set(round.id, round);
  return round;
}
