import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verify } from "node:crypto";
import { KeyPair } from "near-api-js";
import { Referee } from "../server/referee.ts";
import { NearBridge } from "../server/near.ts";
import { testnetProvider } from "../server/rpc.ts";
import { GameService } from "../server/service.ts";
import { applyAction } from "../contracts/engine.js";
import { createWorld, step } from "../src/sim/world.ts";
import { packInput } from "../src/sim/input.ts";
import { bot } from "../src/dev/bot.ts";

assert.throws(
  () => testnetProvider("https://free.rpc.fastnear.com"),
  /Unsupported testnet/,
);
const fallback = testnetProvider();
let switched = 0;
fallback.providers[0].viewNodeStatus = async () => {
  throw new Error("Simulated rate limit");
};
fallback.providers[1].viewNodeStatus = async () => {
  switched++;
  return { chain_id: "testnet" };
};
const oldConsoleError = console.error;
let fallbackErrors = 0;
try {
  console.error = () => fallbackErrors++;
  assert.equal((await fallback.viewNodeStatus()).chain_id, "testnet");
} finally {
  console.error = oldConsoleError;
}
assert.equal(switched, 1);
assert.equal(fallbackErrors, 1);

const directory = mkdtempSync(join(tmpdir(), "contrapasso-bridge-"));
const realNow = Date.now;
let now = realNow();
Date.now = () => now;
try {
  const referee = new Referee({ seed: () => 42 });
  const contractId = "game.testnet";
  writeFileSync(
    join(directory, "near.json"),
    JSON.stringify({
      network: "testnet",
      rpcUrl: "https://rpc.testnet.near.org",
      accountId: contractId,
      contractId,
      secretKey: KeyPair.fromRandom("ed25519").toString(),
    }),
    { mode: 0o600 },
  );
  const near = new NearBridge(directory, referee),
    service = new GameService(referee, near);
  const owners = new Map(),
    store = {
      champions: new Map(),
      duels: new Map(),
      used: new Map(),
      owner: (id) => owners.get(id),
      pendingTransfer: () => false,
      mint: (c, owner) => owners.set(c.id, owner),
      recordKills: () => {},
    };
  const clone = (value) => (value == null ? null : structuredClone(value));
  near.provider = {
    viewNodeStatus: async () => ({ chain_id: "testnet" }),
    callFunction: async ({ method, args }) => {
      if (method === "game_config")
        return { referee_public_key: referee.publicKeyHex };
      if (method === "receipt_applied")
        return clone(store.used.get(args.receipt_id));
      if (method === "get_duel") return clone(store.duels.get(args.duel_id));
      if (method === "get_champion") {
        const c = clone(store.champions.get(args.champion_id));
        if (c) c.ownerId = owners.get(c.id);
        return c;
      }
      throw new Error(`Unexpected view ${method}`);
    },
  };
  let fail = false,
    calls = 0;
  near.account = {
    callFunctionRaw: async ({ args }) => {
      if (fail) throw new Error("Simulated RPC outage");
      assert.ok(
        verify(
          null,
          Buffer.from(args.payload),
          referee.publicKey,
          Buffer.from(args.signature, "hex"),
        ),
      );
      const result = applyAction(
        store,
        { contractId, nowMs: now, validAccount: () => true },
        JSON.parse(args.payload),
      );
      calls++;
      return { transaction: { hash: `test-transaction-${calls}` }, result };
    },
  };
  const alice = referee.createSession().owner,
    bob = referee.createSession().owner;
  await Promise.all([service.profile(alice), service.profile(bob)]);
  assert.equal(store.champions.size, 2);
  assert.equal(referee.pendingChainOperations().length, 0);
  const earn = async (owner) => {
    const run = await service.perform(owner, "/api/runs", {}),
      world = createWorld(run.seed, run.skills, run.equipment),
      inputs = [];
    while (world.phase !== "dead" && world.phase !== "won") {
      const input = bot(world);
      inputs.push(packInput(input));
      step(world, input);
      world.events.length = 0;
    }
    now += Math.ceil((world.tick * 1000) / 60);
    return service.perform(owner, "/api/results", { id: run.id, inputs });
  };
  await earn(alice);
  await earn(bob);
  // A response can disappear after chain success. A durable retry must not award twice.
  const ack = referee.acknowledgeChain.bind(referee);
  let loseAck = true;
  referee.acknowledgeChain = (...args) => {
    if (loseAck) {
      loseAck = false;
      throw new Error("Simulated acknowledgement crash");
    }
    return ack(...args);
  };
  const before = referee.profile(alice).coins;
  const pending = await service.perform(alice, "/api/train", { skill: "iron" });
  assert.equal(pending.chain.pending, true);
  const submitted = calls;
  await service.retryPending();
  assert.equal(calls, submitted);
  assert.equal(referee.profile(alice).coins, before - 60);
  referee.acknowledgeChain = ack;
  await service.perform(bob, "/api/defense", { enabled: true });
  const target = referee.profile(bob).id;
  const total = () => referee.profile(alice).coins + referee.profile(bob).coins;
  // A failed open remains reserved while its fate is uncertain; expiry reconciles only when no chain Duel exists.
  const full = total();
  fail = true;
  await assert.rejects(
    service.perform(alice, "/api/duels", { opponentId: target }),
    /outage/,
  );
  assert.equal(total(), full - 20);
  fail = false;
  now += 11 * 60000;
  await assert.rejects(service.retryPending(), /deadline/);
  assert.equal(total(), full);
  assert.equal(referee.profile(alice).lockedBy, null);
  assert.equal(referee.profile(alice).duelLosses, 0);
  assert.equal(referee.pendingChainOperations().length, 0);
  const duel = await service.perform(alice, "/api/duels", {
    opponentId: target,
  });
  assert.equal(
    (await service.perform(alice, "/api/duels", { opponentId: target })).id,
    duel.id,
  );
  await service.perform(alice, "/api/forfeit", { id: duel.id });
  assert.equal(total(), full);
  assert.equal(store.champions.get(referee.profile(alice).id).duelLosses, 1);
  // A transferred opponent cannot receive a new guest challenge or poison unrelated saves.
  const bobId = referee.profile(bob).id;
  owners.set(bobId, "different-owner.testnet");
  store.champions.get(bobId).defending = false;
  store.champions.get(bobId).revision++;
  await assert.rejects(
    service.perform(alice, "/api/duels", { opponentId: target }),
    /owners/,
  );
  await service.perform(alice, "/api/runs", {});
  console.log(
    "Bridge: PASS (signed relays, serialized requests, lost acknowledgement, durable retry, expired unopened Duel refund, ownership and coin conservation)",
  );
} finally {
  Date.now = realNow;
  rmSync(directory, { recursive: true, force: true });
}
