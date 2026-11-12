import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createPublicKey } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  applyAction,
  readChampion,
  CHAIN_DOMAIN,
} from "../contracts/engine.js";

const maps = {
  champions: new Map(),
  duels: new Map(),
  used: new Map(),
  owners: new Map(),
};
const store = {
  champions: {
    get: (id) => structuredClone(maps.champions.get(id)),
    set: (id, v) => maps.champions.set(id, structuredClone(v)),
  },
  duels: {
    get: (id) => structuredClone(maps.duels.get(id)),
    set: (id, v) => maps.duels.set(id, structuredClone(v)),
  },
  used: {
    get: (id) => structuredClone(maps.used.get(id)),
    set: (id, v) => maps.used.set(id, structuredClone(v)),
  },
  owner: (id) => maps.owners.get(id),
  pendingTransfer: () => false,
  mint: (c, owner) => maps.owners.set(c.id, owner),
  recordKills: () => {},
};
let now = Date.UTC(2026, 10, 12, 12),
  seq = 0;
const ctx = {
  contractId: "contrapasso.testnet",
  get nowMs() {
    return now;
  },
  validAccount: (id) => typeof id === "string" && id.endsWith(".testnet"),
};
const { privateKey } = generateKeyPairSync("ed25519");
const publicKey = Buffer.from(
  createPublicKey(privateKey).export({ format: "jwk" }).x,
  "base64url",
);
function action(id, op, data, extra = {}) {
  return {
    domain: CHAIN_DOMAIN,
    contractId: ctx.contractId,
    id: `action-${++seq}`,
    championId: id,
    ownerId: `${id}.testnet`,
    revision: maps.champions.get(id)?.revision ?? 0,
    expiresAt: now + 60000,
    operation: op,
    data,
    ...extra,
  };
}
function apply(a, alter = false) {
  const raw = Buffer.from(JSON.stringify(a)),
    signature = sign(null, raw, privateKey);
  assert.equal(
    ed25519.verify(
      signature,
      alter ? Buffer.from(JSON.stringify({ ...a, operation: "forged" })) : raw,
      publicKey,
      { zip215: false },
    ),
    !alter,
  );
  if (alter) throw new Error("Invalid referee signature");
  const saved = structuredClone(maps);
  try {
    return applyAction(store, ctx, a);
  } catch (e) {
    for (const key of Object.keys(maps)) maps[key] = saved[key];
    throw e;
  }
}
const checkpoint = {
  coins: 100,
  skills: [],
  runs: 1,
  victories: 0,
  earnedToday: 100,
  day: Math.floor(now / 86400000),
};
apply(action("alice", "register", checkpoint));
apply(action("bob", "register", checkpoint));
const solo = action("alice", "solo", {
  earnedCoins: 500,
  floor: 3,
  kills: 37,
  won: false,
  powers: { ash: 1, iron: 1 },
});
apply(solo);
assert.equal(maps.champions.get("alice").coins, 300);
assert.equal(maps.champions.get("alice").earnedToday, 300);
assert.equal(apply(solo).duplicate, true);
assert.equal(maps.champions.get("alice").coins, 300);
assert.throws(
  () => apply(action("alice", "train", { skill: "iron" }), true),
  /signature/,
);
assert.throws(
  () =>
    apply(
      action(
        "alice",
        "train",
        { skill: "iron" },
        { contractId: "other.testnet" },
      ),
    ),
  /domain/,
);
assert.throws(
  () =>
    apply(action("alice", "train", { skill: "iron" }, { expiresAt: now - 1 })),
  /expired/,
);
apply(action("alice", "train", { skill: "iron" }));
assert.equal(maps.champions.get("alice").coins, 240);
assert.throws(
  () => apply(action("alice", "train", { skill: "iron" })),
  /training/,
);
assert.throws(
  () => apply(action("alice", "defense", { enabled: true }, { revision: 0 })),
  /changed/,
);
apply(action("bob", "defense", { enabled: true }));
const total = () =>
  maps.champions.get("alice").coins + maps.champions.get("bob").coins;
let before = total();
apply(
  action("alice", "duel_open", {
    duelId: "duel-1",
    opponentId: "bob",
    opponentRevision: maps.champions.get("bob").revision,
    expiresAt: now + 60000,
  }),
);
assert.equal(total(), before - 20);
assert.throws(
  () => apply(action("alice", "train", { skill: "blood" })),
  /duel/,
);
apply(action("alice", "duel_settle", { duelId: "duel-1", won: true }));
assert.equal(total(), before);
assert.equal(maps.champions.get("alice").duelWins, 1);
assert.throws(
  () => apply(action("alice", "duel_settle", { duelId: "duel-1", won: true })),
  /settled/,
);
apply(
  action("alice", "duel_open", {
    duelId: "duel-2",
    opponentId: "bob",
    opponentRevision: maps.champions.get("bob").revision,
    expiresAt: now + 60000,
  }),
);
assert.throws(
  () => apply(action("alice", "duel_expire", { duelId: "duel-2" })),
  /active/,
);
now += 60001;
apply(action("alice", "duel_expire", { duelId: "duel-2" }));
assert.equal(total(), before);
assert.equal(maps.champions.get("alice").duelLosses, 1);
maps.owners.set("alice", "buyer.testnet");
assert.throws(
  () => apply(action("alice", "train", { skill: "reach" })),
  /ownership/,
);
const owned = readChampion(store, "alice", now);
assert.equal(owned.ownerId, "buyer.testnet");
assert.equal(owned.coins, maps.champions.get("alice").coins);
apply(
  action("alice", "train", { skill: "reach" }, { ownerId: "buyer.testnet" }),
);
assert.ok(maps.champions.get("alice").skills.includes("reach"));
now += 86400000;
assert.equal(readChampion(store, "alice", now).earnedToday, 0);
console.log(
  "Contract rules: PASS (Ed25519, nonce/domain/expiry/revision, daily cap, training, escrow, timeout, NFT ownership and vault)",
);
