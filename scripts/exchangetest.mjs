import assert from "node:assert/strict";
import {
  listGear,
  cancelSale,
  buyGear,
  listings,
  saleBalance,
  beginSaleWithdrawal,
  resolveSaleWithdrawal,
} from "../contracts/exchange.js";
const data = new Map(),
  gear = new Map(),
  owners = new Map();
const s = {
  market: {
    get: (k) => structuredClone(data.get(k)),
    set: (k, v) => data.set(k, structuredClone(v)),
    remove: (k) => data.delete(k),
  },
  gearInfo: (id) => gear.get(id),
  gearOwner: (id) => owners.get(id),
  gearPending: () => false,
  transferGear: (id, from, to) => {
    owners.set(id, to);
    const g = gear.get(id);
    g.pastOwners.push(from);
  },
};
s.market.set("config", {
  mode: "treasury",
  treasuryYocto: "0",
  liabilityYocto: "0",
});
const id = "relic:test:1",
  price = "15000000000000000000000";
gear.set(id, {
  weaponId: "gravewhisper",
  level: 4,
  kills: 71,
  pastOwners: ["first.testnet"],
  bound: false,
  equippedTo: "hero",
});
owners.set(id, "alice");
const ctx = { nowMs: 123, predecessor: "bob", depositYocto: price };
const offer = { tokenId: id, priceYocto: price };
assert.throws(() => listGear(s, ctx, "alice", offer), /Unequip/);
gear.get(id).equippedTo = null;
assert.throws(() => listGear(s, ctx, "bob", offer), /own/);
for (const priceYocto of ["-1", "1", "1e24", "1000000000000000000000001"])
  assert.throws(
    () => listGear(s, ctx, "alice", { ...offer, priceYocto }),
    /price/,
  );
let l = listGear(s, ctx, "alice", offer);
const quote = () => ({ ...offer, listingId: l.id });
assert.throws(() => listGear(s, ctx, "alice", offer), /already/);
assert.throws(() => cancelSale(s, "bob", quote()), /seller/);
assert.throws(() => buyGear(s, ctx, "alice", quote()), /own NFT/);
assert.throws(
  () => buyGear(s, { ...ctx, depositYocto: "0" }, "bob", quote()),
  /exact/,
);
assert.throws(
  () => buyGear(s, { ...ctx, predecessor: "alice" }, "bob", quote()),
  /buyer/,
);
const old = quote();
cancelSale(s, "alice", old);
l = listGear(s, ctx, "alice", offer);
assert.throws(() => buyGear(s, ctx, "bob", old), /changed/);
buyGear(s, ctx, "bob", quote());
assert.equal(owners.get(id), "bob");
assert.deepEqual(gear.get(id), {
  weaponId: "gravewhisper",
  level: 4,
  kills: 71,
  pastOwners: ["first.testnet", "alice"],
  bound: false,
  equippedTo: null,
});
assert.equal(listings(s).length, 0);
assert.equal(saleBalance(s, "alice"), "13500000000000000000000");
assert.equal(data.get("config").treasuryYocto, "1500000000000000000000");
assert.equal(data.get("config").liabilityYocto, price);
assert.throws(() => buyGear(s, ctx, "bob", quote()), /changed/);
const amount = beginSaleWithdrawal(s, "alice");
assert.throws(() => beginSaleWithdrawal(s, "alice"), /pending/);
s.market.set("sales:balance:alice", "123"); // another purchase while payout is pending
resolveSaleWithdrawal(s, "alice", false);
assert.equal(saleBalance(s, "alice"), (BigInt(amount) + 123n).toString());
// Account for that concurrent purchase before paying it out.
const config = data.get("config");
config.liabilityYocto = (BigInt(config.liabilityYocto) + 123n).toString();
beginSaleWithdrawal(s, "alice");
resolveSaleWithdrawal(s, "alice", true);
assert.equal(saleBalance(s, "alice"), "0");
assert.equal(
  data.get("config").liabilityYocto,
  data.get("config").treasuryYocto,
);
assert.throws(() => resolveSaleWithdrawal(s, "alice", true), /pending/);
console.log(
  "Exchange: PASS (ownership, stale quotes, exact payment, NFT history, 90/10 conservation, failed/concurrent withdrawals)",
);
