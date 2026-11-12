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
  gearLevels: new Map(),
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
  transfer: (c, receiver) => maps.owners.set(c.id, receiver),
  upgradeGear: (c, slot, level) =>
    maps.gearLevels.set(`${slot}:${c.id}`, level),
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
  () => apply(action("alice", "train", { skill: "ember" })),
  /ownership/,
);
const owned = readChampion(store, "alice", now);
assert.equal(owned.ownerId, "buyer.testnet");
assert.equal(owned.coins, maps.champions.get("alice").coins);
apply(
  action("alice", "train", { skill: "ember" }, { ownerId: "buyer.testnet" }),
);
assert.ok(maps.champions.get("alice").skills.includes("ember"));
now += 86400000;
assert.equal(readChampion(store, "alice", now).earnedToday, 0);
// "+" upgrades: cost, odds, cap, and a failure that burns only the coin
{
  const buyer = { ownerId: "buyer.testnet" };
  const champion = () => maps.champions.get("alice");
  const up = (roll, slot = "weapon") =>
    apply(
      action(
        "alice",
        "upgrade",
        {
          slot,
          roll,
          fromLevel:
            champion().build[slot === "weapon" ? "weaponLevel" : "armorLevel"],
          gearId: champion().equipped[slot],
        },
        buyer,
      ),
    );
  Object.assign(champion(), { coins: 500, lockedBy: null });
  champion().build.weaponLevel = 0;
  up(99);
  assert.equal(champion().build.weaponLevel, 1, "+1 to +3 always succeed");
  assert.equal(champion().coins, 485);
  assert.equal(maps.gearLevels.get("weapon:alice"), 1);
  champion().build.weaponLevel = 3;
  up(85);
  assert.equal(
    champion().build.weaponLevel,
    3,
    "a failed roll keeps the level",
  );
  assert.equal(champion().coins, 440, "a failed roll still burns the coin");
  up(84);
  assert.equal(champion().build.weaponLevel, 4);
  champion().build.weaponLevel = 6;
  up(70);
  assert.equal(champion().build.weaponLevel, 6);
  up(69, "weapon");
  assert.equal(champion().build.weaponLevel, 7);
  up(0, "armor");
  assert.equal(champion().build.armorLevel, 1);
  assert.throws(() => up(100), /roll/);
  assert.throws(() => up(0, "ring"), /slot/);
  champion().build.weaponLevel = 9;
  assert.throws(() => up(0), /limit/);
  champion().build.weaponLevel = 2;
  champion().coins = 10;
  assert.throws(() => up(0), /coin/);
  assert.equal(champion().coins, 10);
}
// claim to a wallet: the champion and its vault leave the guest account
{
  const buyer = { ownerId: "buyer.testnet" };
  const coins = maps.champions.get("alice").coins;
  assert.throws(
    () =>
      apply(action("alice", "claim", { receiver: "not-an-account" }, buyer)),
    /receiver/,
  );
  assert.throws(
    () => apply(action("alice", "claim", { receiver: "buyer.testnet" }, buyer)),
    /receiver/,
  );
  apply(action("alice", "claim", { receiver: "wallet.testnet" }, buyer));
  assert.equal(maps.owners.get("alice"), "wallet.testnet");
  assert.equal(maps.champions.get("alice").coins, coins, "the vault travels");
  assert.equal(maps.champions.get("alice").defending, false);
  assert.throws(
    () => apply(action("alice", "train", { skill: "ash" }, buyer)),
    /ownership/,
  );
}
console.log(
  "Contract rules: PASS (Ed25519, nonce/domain/expiry/revision, daily cap, training, gear upgrades, wallet claim, escrow, timeout, NFT ownership and vault)",
);
