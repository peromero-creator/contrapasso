import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Referee } from "../server/referee.ts";
import assert from "node:assert/strict";
import { applyAction } from "../contracts/engine.js";
import {
  openRound,
  marketAction,
  marketView,
  economy,
  resolveNative,
  prize,
  pendingNative,
  selectWinners,
  retireRaffles,
  closeTreasuryRound,
  beginTreasuryTransfer,
  resolveTreasuryTransfer,
} from "../contracts/market.js";
import { MINT_PRICE_YOCTO } from "../src/shared/market.ts";
const names = [
  "champions",
  "duels",
  "used",
  "market",
  "rounds",
  "reservations",
  "owners",
  "gear",
];
let maps = Object.fromEntries(names.map((n) => [n, new Map()]));
const map = (name) => ({
  get: (k) => structuredClone(maps[name].get(k)),
  set: (k, v) => maps[name].set(k, structuredClone(v)),
  remove: (k) => maps[name].delete(k),
});
const store = {
  ...Object.fromEntries(names.map((n) => [n, map(n)])),
  owner: (id) => maps.owners.get(id),
  pendingTransfer: (id) => !!pendingNative(store, id),
  prize: (id) => prize(store, id),
  mint: (c, owner) => maps.owners.set(c.id, owner),
  recordKills: () => {},
  mintGear: (c, id, owner) => maps.gear.set(id, { owner }),
  marketAction: (c, ctx, a) => marketAction(store, ctx, c, a),
};
store.market.set("config", {
  currentRound: null,
  roundIds: [],
  sponsored: 0,
  liabilityYocto: "0",
  carryYocto: "0",
  mode: "raffle",
});
let now = 100000,
  seq = 0;
const ctx = {
  contractId: "game.testnet",
  get nowMs() {
    return now;
  },
  validAccount: () => true,
  entropy: Array.from({ length: 32 }, (_, i) => i),
  blockHeight: 123,
  depositYocto: "0",
  predecessor: "a".repeat(64),
};
const action = (id, op, data = {}) => ({
  domain: "contrapasso:testnet:v1",
  contractId: ctx.contractId,
  id: `market-test-${++seq}`,
  championId: id,
  ownerId: maps.owners.get(id) ?? "a".repeat(64),
  revision: maps.champions.get(id)?.revision ?? 0,
  expiresAt: now + 1000,
  operation: op,
  data,
});
function apply(a) {
  const before = structuredClone(maps);
  try {
    return applyAction(store, ctx, a);
  } catch (e) {
    maps = before;
    throw e;
  }
}
for (let i = 0; i < 14; i++)
  apply(
    action(`p${i}`, "register", {
      coins: 100,
      runs: 1,
      victories: 0,
      earnedToday: 100,
      day: 0,
      skills: [],
    }),
  );
openRound(store, ctx, { id: "first", durationSeconds: 30 });
for (let i = 0; i < 12; i++)
  apply(action(`p${i}`, "reserve_mint", { roundId: "first" }));
assert.throws(
  () => apply(action("p12", "reserve_mint", { roundId: "first" })),
  /reserved/,
);
assert.equal(
  maps.champions.get("p12").coins,
  100,
  "sold-out access never charges coin",
);
const cancel = action("p0", "cancel_mint", { roundId: "first" });
apply(cancel);
apply(cancel);
assert.equal(maps.champions.get("p0").coins, 100, "cancel refunds only once");
apply(action("p12", "reserve_mint", { roundId: "first" }));
assert.throws(
  () => apply(action("p1", "mint", { roundId: "first" })),
  /payment/,
);
ctx.depositYocto = MINT_PRICE_YOCTO;
const paid = action("p1", "mint", { roundId: "first" });
apply(paid);
assert.equal(maps.gear.size, 1);
assert.throws(
  () => apply(paid),
  /Duplicate/,
  "duplicate paid receipt rejects its entire deposit",
);
assert.throws(
  () => apply(action("p0", "tickets", { roundId: "first", count: 1 })),
  /Unexpected/,
);
ctx.depositYocto = "0";
assert.equal(apply(paid).duplicate, true);
for (const id of ["p1", "p2", "p3", "p4"])
  apply(action(id, "tickets", { roundId: "first", count: 2 }));
assert.throws(
  () => apply(action("p1", "tickets", { roundId: "first", count: 9 })),
  /limit/,
);
const fund = action("p1", "fund_guest");
apply(fund);
assert.throws(
  () => apply(action("p1", "tickets", { roundId: "first", count: 1 })),
  /pending/,
);
assert.equal(apply(fund).duplicate, true);
resolveNative(store, "p1", false);
assert.equal(economy(store).sponsored, 0);
apply(action("p1", "fund_guest"));
resolveNative(store, "p1", true);
assert.equal(marketView(store, "p1").sponsored, true);
assert.throws(() => apply(action("p1", "fund_guest")), /already/);
now += 30001;
assert.throws(
  () => apply(action("p0", "reserve_mint", { roundId: "first" })),
  /closed/,
);
const beforeCaller = maps.champions.get("p2").coins;
apply(action("p2", "draw_round", { roundId: "first" }));
assert.equal(
  maps.champions.get("p2").coins,
  beforeCaller + 10,
  "draw caller also receives its reservation refund",
);
assert.equal(maps.champions.get("p12").coins, 100);
const round = maps.rounds.get("first");
assert.equal(round.reserved, 0);
assert.equal(new Set(round.winners.map((w) => w.championId)).size, 3);
assert.equal(
  round.winners.reduce((n, w) => n + BigInt(w.amountYocto), 0n),
  BigInt(MINT_PRICE_YOCTO),
);
assert.deepEqual(
  round.winners.map((w) => w.championId),
  selectWinners(round.tickets, ctx.entropy),
);
assert.throws(
  () => apply(action("p0", "draw_round", { roundId: "first" })),
  /ready/,
);
const winner = round.winners[0].championId,
  amount = prize(store, winner);
apply(action(winner, "withdraw_prize"));
assert.equal(prize(store, winner), "0");
resolveNative(store, winner, false);
assert.equal(prize(store, winner), amount, "failed payout restores the prize");
maps.owners.set(winner, "new-owner.testnet");
apply(action(winner, "withdraw_prize"));
assert.equal(
  pendingNative(store, winner).receiver,
  "new-owner.testnet",
  "prize belongs to the current NFT owner",
);
resolveNative(store, winner, true);
assert.equal(
  economy(store).liabilityYocto,
  (BigInt(MINT_PRICE_YOCTO) - BigInt(amount)).toString(),
);
openRound(store, ctx, { id: "no-tickets", durationSeconds: 30 });
apply(action("p0", "reserve_mint", { roundId: "no-tickets" }));
ctx.depositYocto = MINT_PRICE_YOCTO;
ctx.predecessor = maps.owners.get("p0");
apply(action("p0", "mint", { roundId: "no-tickets" }));
ctx.depositYocto = "0";
now += 30001;
apply(action("p0", "draw_round", { roundId: "no-tickets" }));
assert.equal(economy(store).carryYocto, MINT_PRICE_YOCTO);
assert.equal(
  openRound(store, ctx, { id: "carry", durationSeconds: 30 }).poolYocto,
  MINT_PRICE_YOCTO,
);
// A process restart must retain an uncertain intent and its original id.
const directory = mkdtempSync(join(tmpdir(), "contrapasso-market-"));
try {
  const key = generateKeyPairSync("ed25519").privateKey;
  let referee = new Referee({ directory, key });
  const session = referee.createSession(),
    profile = referee.profile(session.owner);
  const status = {
    network: "testnet",
    contractId: "game.testnet",
    accountId: "a".repeat(64),
    tokenId: `champion:${profile.id}`,
    pending: false,
    revision: 0,
  };
  const registration = referee.pendingChainOperations()[0];
  referee.acknowledgeChain(registration.id, { [profile.id]: status });
  const id = randomUUID(),
    data = { roundId: "saved-round", count: 1 };
  referee.queueMarket(session.owner, id, "tickets", data);
  referee = new Referee({ directory, key });
  assert.equal(referee.marketIntent(session.owner, id).complete, false);
  assert.equal(referee.queueMarket(session.owner, id, "tickets", data).id, id);
  assert.equal(referee.pendingChainOperations().length, 1);
  assert.throws(() => referee.begin(session.owner), /pending transfer/);
  referee.rejectChainOperation(`market:${id}`, {}, "Known final failure");
  referee = new Referee({ directory, key });
  assert.equal(referee.pendingChainOperations().length, 0);
  assert.equal(
    referee.marketIntent(session.owner, id).error,
    "Known final failure",
  );
  assert.equal(referee.profile(session.owner).coins, 0);
  const saleId = randomUUID(), quote = {tokenId:"relic:edition:1",priceYocto:"015000000000000000000000"};
  const listing = referee.queueMarket(session.owner,saleId,"list_gear",quote);
  assert.equal(listing.data.priceYocto,"15000000000000000000000","native prices are canonical before signing");
  assert.equal(referee.queueMarket(session.owner,saleId,"list_gear",{...quote,priceYocto:"15000000000000000000000"}).id,saleId);

} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log(
  "Market rules: PASS (limited reservations, refunds, paid mint replay protection, tickets, draw conservation, transfer locks, failed payouts, NFT-owned prizes, carry)",
);

// Retire a no-ticket legacy round without losing unpaid access or prize liabilities.
apply(action("p1", "reserve_mint", { roundId: "carry" }));
const refundBalance = maps.champions.get("p1").coins;
retireRaffles(store);
assert.equal(maps.champions.get("p1").coins, refundBalance + 10);
assert.equal(economy(store).treasuryYocto, MINT_PRICE_YOCTO);
const liability = BigInt(economy(store).liabilityYocto);
beginTreasuryTransfer(store, "game.testnet", "7");
assert.throws(
  () => beginTreasuryTransfer(store, "game.testnet", "1"),
  /pending/,
);
resolveTreasuryTransfer(store, false);
assert.equal(economy(store).treasuryYocto, MINT_PRICE_YOCTO);
beginTreasuryTransfer(store, "game.testnet", "7");
resolveTreasuryTransfer(store, true);
assert.equal(BigInt(economy(store).liabilityYocto), liability - 7n);
assert.throws(
  () => beginTreasuryTransfer(store, "game.testnet", MINT_PRICE_YOCTO),
  /Insufficient/,
);
openRound(store, ctx, { id: "arsenal", durationSeconds: 30 });
assert.throws(
  () => apply(action("p0", "tickets", { roundId: "arsenal", count: 1 })),
  /retired/,
);
apply(
  action("p0", "reserve_mint", { roundId: "arsenal", weaponId: "tollkeeper" }),
);
assert.equal(store.reservations.get("arsenal:p0").weaponId, "tollkeeper");
console.log(
  "Treasury: PASS (retirement refunds, liabilities isolated, failure restoration, duplicate payout lock, no tickets, reserved weapon identity)",
);

const beforeClosing = maps.champions.get("p0").coins;
closeTreasuryRound(store);
assert.equal(maps.champions.get("p0").coins, beforeClosing + 10);
closeTreasuryRound(store);
assert.equal(maps.champions.get("p0").coins, beforeClosing + 10, "closing twice never refunds twice");
