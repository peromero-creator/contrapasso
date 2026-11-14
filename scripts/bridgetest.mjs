import {
  openRound,
  marketAction,
  marketView,
  prize,
  pendingNative,
} from "../contracts/market.js";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, verify } from "node:crypto";
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
  let capabilities = [];
  const owners = new Map(),
    store = {
      champions: new Map(),
      duels: new Map(),
      used: new Map(),
      market: new Map(),
      rounds: new Map(),
      reservations: new Map(),
      owner: (id) => owners.get(id),
      pendingTransfer: (id) => !!pendingNative(store, id),
      prize: (id) => prize(store, id),
      marketAction: (c, ctx, a) => marketAction(store, ctx, c, a),
      mint: (c, owner) => owners.set(c.id, owner),
      recordKills: () => {},
      upgradeGear: () => {},
      transfer: (c, receiver) => owners.set(c.id, receiver),
    };
  const clone = (value) => (value == null ? null : structuredClone(value));
  near.provider = {
    viewNodeStatus: async () => ({ chain_id: "testnet" }),
    viewAccount: async () => ({ amount: "0", locked: "0", storage_usage: 0 }),
    experimental_protocolConfig: async () => ({ runtime_config: { storage_amount_per_byte: "10000000000000000000" } }),
    viewGasPrice: async () => ({ gas_price: "100000000" }),
    callFunction: async ({ method, args }) => {
      if (method === "game_config")
        return {
          referee_public_key: referee.publicKeyHex,
          features: capabilities,
        };
      if (method === "market_view")
        return { ...marketView(store, args.champion_id) };
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
    calls = 0,
    terminal = false;
  near.account = {
    callFunctionRaw: async ({ args }) => {
      if (fail) throw new Error("Simulated RPC outage");
      if (terminal)
        throw Object.assign(new Error("Final testnet rejection"), {
          txHash: "known-failed-transaction",
          transactionResult: { status: { Failure: {} } },
        });
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
        {
          contractId,
          nowMs: now,
          validAccount: () => true,
          entropy: Array(32).fill(7),
          blockHeight: 123,
        },
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
  // A pending write for one guest must not suppress another guest's chain refresh.
  const blockedGuest = referee.createSession().owner;
  await service.profile(blockedGuest);
  await earn(blockedGuest);
  const blockedId = referee.profile(blockedGuest).id;
  const sendNormally = near.account.callFunctionRaw;
  near.account.callFunctionRaw = async (request) => {
    if (JSON.parse(request.args.payload).championId === blockedId)
      throw new Error("Isolated relay timeout");
    return sendNormally(request);
  };
  const blockedTraining = await service.perform(blockedGuest, "/api/train", { skill: "haste" });
  assert.equal(blockedTraining.chain.pending, true);
  const refreshedId = referee.profile(bob).id;
  const confirmedBefore = referee.profile(bob).coins;
  store.champions.get(refreshedId).coins += 7;
  store.champions.get(refreshedId).revision++;
  assert.equal((await service.profile(bob)).coins, confirmedBefore + 7,
    "an unrelated pending relay cannot leave this profile stale");
  const priorOwner = owners.get(refreshedId);
  owners.set(refreshedId, "external-wallet.testnet");
  await assert.rejects(service.profile(bob),
    (error) => error.status === 409 && /another owner/.test(error.message),
    "known ownership loss must not be returned as a confirmed guest profile");
  owners.set(refreshedId, priorOwner);
  near.account.callFunctionRaw = sendNormally;
  await service.retryPending();
  assert.equal((await service.profile(blockedGuest)).chain.pending, false);
  assert.equal(referee.pendingChainOperations().length, 0);
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
  // Capability discovery comes from the contract, never an optimistic local flag.
  await assert.rejects(
    service.perform(alice, "/api/upgrade", { slot: "weapon" }),
    /updated/,
  );
  capabilities = ["upgrade", "claim"];
  near.checked = false;
  // Upgrades change both the vault and equipped combat build.
  const oldCoins = referee.profile(alice).coins;
  const upgradeRequest = { slot: "weapon", id: randomUUID() };
  fail = true;
  const queuedUpgrade = await service.perform(alice, "/api/upgrade", upgradeRequest);
  assert.equal(queuedUpgrade.champion.chain.pending, true);
  assert.equal(queuedUpgrade.champion.coins, oldCoins - 15);
  fail = false;
  const improved = await service.perform(alice, "/api/upgrade", upgradeRequest);
  const callsAfterUpgrade = calls;
  const repeatedUpgrade = await service.perform(alice, "/api/upgrade", upgradeRequest);
  assert.deepEqual(repeatedUpgrade, improved, "lost HTTP response retries the original upgrade");
  assert.equal(calls, callsAfterUpgrade, "retry sends no second upgrade transaction");
  await assert.rejects(service.perform(alice, "/api/upgrade", {...upgradeRequest, slot:"armor"}), /different choices/);
  assert.equal(improved.champion.build.weaponLevel, 1);
  assert.equal(improved.champion.coins, oldCoins - 15);
  const rejectedUpgradeRequest = { slot: "armor", id: randomUUID() };
  fail = true;
  assert.equal((await service.perform(alice, "/api/upgrade", rejectedUpgradeRequest)).champion.chain.pending, true);
  fail = false;
  terminal = true;
  const rejectedUpgrade = await service.perform(alice, "/api/upgrade", rejectedUpgradeRequest);
  assert.ok(rejectedUpgrade.upgrade.error, "a final rejection is not reported as a successful upgrade");
  assert.equal(rejectedUpgrade.champion.chain.pending, false);
  assert.equal(rejectedUpgrade.champion.coins, oldCoins - 15, "failed upgrade restores the confirmed vault");
  terminal = false;
  assert.ok((await service.perform(alice, "/api/upgrade", rejectedUpgradeRequest)).upgrade.error);
  const source = referee.profile(alice).id;
  // A wallet lookup outage is not evidence that the recipient does not exist.
  const claimAccountView = near.provider.viewAccount;
  let claimLookups = 0;
  const missingRecipient = Object.assign(new Error("Account does not exist"), {
    name: "UnknownAccountError",
  });
  let recipientError = missingRecipient;
  near.provider.viewAccount = async () => {
    claimLookups++;
    throw recipientError;
  };
  const claimRequest = { championId: source, receiver: "wallet.testnet" };
  await assert.rejects(
    service.perform(alice, "/api/claim", { ...claimRequest, receiver: "bad address" }),
    (error) => error.status === 400 && /testnet account/.test(error.message),
  );
  assert.equal(claimLookups, 0, "invalid recipient is rejected before its wallet lookup");
  await assert.rejects(
    service.perform(alice, "/api/claim", claimRequest),
    (error) => error.status === 404 && /does not exist/.test(error.message),
  );
  recipientError = Object.assign(new Error("Providers exhausted"), {
    name: "FailoverRpcError",
    errors: [missingRecipient, missingRecipient],
  });
  assert.equal(await near.accountExists("wallet.testnet"), false);
  for (const failure of [
    new Error("RPC timeout"),
    Object.assign(new Error("Providers exhausted"), {
      name: "FailoverRpcError",
      errors: [missingRecipient, new Error("RPC timeout")],
    }),
  ]) {
    recipientError = failure;
    await assert.rejects(
      service.perform(alice, "/api/claim", claimRequest),
      (error) => error.status === 503 && /Unable to verify/.test(error.message),
    );
    assert.equal(referee.profile(alice).id, source);
    assert.equal(referee.pendingClaim(source), undefined, "unverified wallet never queues a transfer");
  }
  near.provider.viewAccount = claimAccountView;
  // Do not rotate the guest or claim success until an outgoing transfer is final.
  fail = true;
  const waiting = await service.perform(alice, "/api/claim", {
    championId: source,
    receiver: "wallet.testnet",
  });
  assert.equal(waiting.claimed.pending, true);
  assert.equal(waiting.champion.id, source);
  assert.throws(() => referee.begin(alice), /pending transfer/);
  fail = false;
  const claimed = await service.perform(alice, "/api/claim", {
    championId: source,
    receiver: "wallet.testnet",
  });
  assert.equal(claimed.claimed.pending, false);
  assert.notEqual(claimed.champion.id, source);
  assert.equal(owners.get(source), "wallet.testnet");
  assert.equal(referee.chainProfile(source).coins, oldCoins - 15);
  assert.equal(claimed.champion.chain.pending, false);
  assert.ok(claimed.claimed.transaction);
  const minted = store.champions.size;
  await service.perform(alice, "/api/claim", {
    championId: source,
    receiver: "wallet.testnet",
  });
  assert.equal(
    store.champions.size,
    minted,
    "a retried claim must not rotate a second guest",
  );
  await assert.rejects(
    service.perform(bob, "/api/claim", {
      championId: source,
      receiver: "wallet.testnet",
    }),
    /already moved/,
  );
  // Market intents debit only after confirmation and survive an uncertain relay response.
  capabilities.push("market");
  near.checked = false;
  store.market.set("config", {
    currentRound: null,
    roundIds: [],
    sponsored: 0,
    liabilityYocto: "0",
    carryYocto: "0",
    mode: "raffle",
  });
  openRound(store, { nowMs: now }, { id: "bridge-round", durationSeconds: 30 });
  const originalAccountView = near.provider.viewAccount;
  near.provider.viewAccount = async () => ({ amount: "30000000000000000000000", locked: "0", storage_usage: 1000 });
  const quote = await near.market(referee.profile(bob));
  assert.equal(quote.nativeBalanceYocto, "20000000000000000000000", "UI balance excludes locked storage");
  assert.equal(quote.nativeGasReserveYocto, "15000000000000000000000", "UI receives the relay gas reserve");
  near.provider.viewAccount = async () => { throw new Error("RPC unavailable"); };
  await assert.rejects(near.market(referee.profile(bob)), /RPC unavailable/, "RPC failure is not an empty wallet");
  const absent = Object.assign(new Error("Account does not exist"), { name: "AccountDoesNotExistError" });
  const failover = Object.assign(new Error("Providers exhausted"), { name: "FailoverRpcError", errors: [absent, absent] });
  near.provider.viewAccount = async () => { throw failover; };
  assert.equal((await near.market(referee.profile(bob))).nativeBalanceYocto, "0", "unfunded implicit account opens the market through fallback providers");
  failover.errors = [absent, new Error("Timeout")];
  await assert.rejects(near.market(referee.profile(bob)), /Providers exhausted/, "mixed unknown account and RPC errors remain errors");
  near.provider.viewAccount = originalAccountView;
  const marketCoins = referee.profile(bob).coins;
  const reserveId = randomUUID(),
    reserveBody = {
      id: reserveId,
      operation: "reserve_mint",
      data: { roundId: "bridge-round" },
    };
  fail = true;
  const marketPending = await service.perform(bob, "/api/market", reserveBody);
  assert.equal(marketPending.intent.complete, false);
  assert.equal(
    marketPending.champion.coins,
    marketCoins,
    "no optimistic coin debit",
  );
  assert.throws(() => referee.begin(bob), /pending transfer/);
  fail = false;
  const reserved = await service.perform(bob, "/api/market", reserveBody);
  assert.equal(reserved.intent.complete, true);
  assert.equal(reserved.champion.coins, marketCoins - 10);
  assert.equal(
    (await service.perform(bob, "/api/market", reserveBody)).champion.coins,
    marketCoins - 10,
  );
  await assert.rejects(
    service.perform(bob, "/api/market", {
      ...reserveBody,
      data: { roundId: "different" },
    }),
    /different choices/,
  );
  near.provider.viewAccount = async () => {
    throw Object.assign(new Error("Guest account not activated"), {
      name: "AccountDoesNotExistError",
    });
  };
  const unfundedMint = await service.perform(bob, "/api/market", {
    id: randomUUID(),
    operation: "mint",
    data: { roundId: "bridge-round" },
  });
  assert.equal(unfundedMint.intent.complete, true);
  assert.match(unfundedMint.intent.error, /Get demo test NEAR/);
  assert.equal(unfundedMint.champion.coins, marketCoins - 10);
  assert.equal(referee.pendingChainOperations().length, 0);
  near.provider.viewAccount = async () => ({ amount: "0", locked: "0", storage_usage: 0 });
  loseAck = true;
  referee.acknowledgeChain = (...args) => {
    if (loseAck) {
      loseAck = false;
      throw new Error("Market acknowledgement crash");
    }
    return ack(...args);
  };
  const ticketsBody = {
    id: randomUUID(),
    operation: "tickets",
    data: { roundId: "bridge-round", count: 1 },
  };
  const ticketsPending = await service.perform(bob, "/api/market", ticketsBody);
  assert.equal(ticketsPending.intent.complete, false);
  const ticketCalls = calls;
  const ticketSaved = await service.perform(bob, "/api/market", ticketsBody);
  assert.equal(ticketSaved.intent.complete, true);
  assert.equal(ticketSaved.champion.coins, marketCoins - 15);
  assert.equal(
    calls,
    ticketCalls,
    "lost acknowledgement never buys another ticket",
  );
  terminal = true;
  const failedAction = await service.perform(bob, "/api/market", {
    id: randomUUID(),
    operation: "tickets",
    data: { roundId: "bridge-round", count: 1 },
  });
  terminal = false;
  assert.equal(failedAction.intent.complete, true);
  assert.ok(failedAction.intent.error);
  assert.equal(failedAction.champion.coins, marketCoins - 15);
  assert.equal(
    referee.pendingChainOperations().length,
    0,
    "known failure releases pending intent",
  );
  now += 30001;
  const drawn = await service.perform(bob, "/api/market", {
    id: randomUUID(),
    operation: "draw_round",
    data: { roundId: "bridge-round" },
  });
  assert.equal(drawn.intent.complete, true);
  assert.equal(
    drawn.champion.coins,
    marketCoins - 5,
    "unpaid reservation refunded to the draw caller",
  );
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
  // A second tab can replace the equipped NFT before the first tab submits its quoted upgrade.
  const staleGearId = referee.profile(blockedGuest).equipped.weapon;
  const changedEquipment = store.champions.get(blockedId);
  changedEquipment.equipped.weapon = "replacement-weapon";
  changedEquipment.revision++;
  const upgradeCoins = changedEquipment.coins;
  const upgradeCalls = calls;
  await assert.rejects(service.perform(blockedGuest, "/api/upgrade", {
    slot: "weapon", id: randomUUID(), expectedGearId: staleGearId, expectedLevel: 0,
  }), (error) => error.status === 409 && /changed/i.test(error.message),
  "a stale tab must not upgrade a replacement NFT");
  assert.equal(calls, upgradeCalls);
  assert.equal(referee.profile(blockedGuest).coins, upgradeCoins);
  assert.equal(referee.pendingChainOperations().length, 0);
  const parallelUpgrade = {
    slot: "weapon", id: randomUUID(), expectedGearId: "replacement-weapon", expectedLevel: 0,
  };
  const parallelResults = await Promise.all([
    service.perform(blockedGuest, "/api/upgrade", parallelUpgrade),
    service.perform(blockedGuest, "/api/upgrade", parallelUpgrade),
  ]);
  assert.deepEqual(parallelResults[0].upgrade, parallelResults[1].upgrade);
  assert.equal(calls, upgradeCalls + 1, "two concurrent copies of one intent send one transaction");
  assert.equal(referee.profile(blockedGuest).coins, upgradeCoins - 15);
  await assert.rejects(service.perform(blockedGuest, "/api/upgrade", {
    ...parallelUpgrade, id: randomUUID(),
  }), (error) => error.status === 409 && /Equipment changed/.test(error.message),
  "a fresh stale-level intent cannot silently buy the more expensive next upgrade");
  await assert.rejects(service.perform(blockedGuest, "/api/upgrade", {
    ...parallelUpgrade, expectedLevel: 1,
  }), /different choices/, "a retry must retain its original quote");
  assert.equal(referee.profile(blockedGuest).coins, upgradeCoins - 15);

  // The chain can accept a write even though its HTTP response never reaches the relay.
  const uncertainUpgrade = { ...parallelUpgrade, id: randomUUID(), expectedLevel: 1 };
  const deliverNormally = near.account.callFunctionRaw;
  near.account.callFunctionRaw = async (request) => {
    const result = await deliverNormally(request);
    if (JSON.parse(request.args.payload).id === `upgrade:${uncertainUpgrade.id}`)
      throw new Error("Response lost after chain acceptance");
    return result;
  };
  const uncertain = await service.perform(blockedGuest, "/api/upgrade", uncertainUpgrade);
  assert.equal(uncertain.champion.chain.pending, true);
  assert.equal(store.champions.get(blockedId).build.weaponLevel, 2);
  near.account.callFunctionRaw = deliverNormally;
  const recovered = await Promise.all([
    service.perform(blockedGuest, "/api/upgrade", uncertainUpgrade),
    service.perform(blockedGuest, "/api/upgrade", uncertainUpgrade),
  ]);
  assert.equal(calls, upgradeCalls + 2, "an applied receipt is recovered without resubmission");
  assert.equal(recovered[0].champion.chain.pending, false);
  assert.equal(recovered[0].champion.coins, upgradeCoins - 40);
  assert.deepEqual(recovered[0].upgrade, recovered[1].upgrade);

  // An uncertain but unapplied write must roll back if its NFT changes before retry.
  const changedWhilePending = { ...parallelUpgrade, id: randomUUID(), expectedLevel: 2 };
  fail = true;
  assert.equal((await service.perform(blockedGuest, "/api/upgrade", changedWhilePending)).champion.chain.pending, true);
  store.champions.get(blockedId).equipped.weapon = "another-replacement";
  store.champions.get(blockedId).build.weaponLevel = 0;
  store.champions.get(blockedId).revision++;
  fail = false;
  const abandonedUpgrade = await service.perform(blockedGuest, "/api/upgrade", changedWhilePending);
  assert.match(abandonedUpgrade.upgrade.error, /gear changed/i);
  assert.equal(abandonedUpgrade.champion.chain.pending, false);
  assert.equal(abandonedUpgrade.champion.coins, upgradeCoins - 40, "no charge for an unapplied stale NFT upgrade");
  assert.equal(abandonedUpgrade.champion.equipped.weapon, "another-replacement");
  assert.equal(calls, upgradeCalls + 2);
  // One supported 1,000-piece edition plus the champion and starter gear is 1,003 NFTs.
  // The final owned items must remain selectable instead of disappearing at an arbitrary cap.
  const inventoryView = near.provider.callFunction;
  const fullInventory = Array.from({ length: 1003 }, (_, index) => ({
    token_id: `owned:${index}`,
    owner_id: "inventory-owner.testnet",
    metadata: { title: `Owned relic ${index}`, extra: JSON.stringify({ kind: "weapon", level: index === 1002 ? 9 : 0 }) },
  }));
  const inventoryOffsets = [];
  near.provider.callFunction = async (request) => {
    if (request.method !== "nft_tokens_for_owner") return inventoryView(request);
    const offset = Number(request.args.from_index);
    inventoryOffsets.push(offset);
    return fullInventory.slice(offset, offset + request.args.limit);
  };
  const owned = await near.tokens(referee.profile(alice));
  assert.equal(owned.tokens.length, 1003, "all legal edition items and starter NFTs are returned");
  assert.equal(owned.tokens.at(-1).tokenId, "owned:1002");
  assert.equal(owned.tokens.at(-1).extra.level, 9, "last-page metadata is preserved");
  assert.equal(inventoryOffsets.at(-1), 1000, "pagination reaches the short final page");
  near.provider.callFunction = inventoryView;
  console.log(
    "Bridge: PASS (signed relays, serialized requests, lost acknowledgement, durable retry, expired unopened Duel refund, ownership and coin conservation)",
  );
} finally {
  Date.now = realNow;
  rmSync(directory, { recursive: true, force: true });
}
