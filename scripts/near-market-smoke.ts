import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { testnetProvider } from "../server/rpc.ts";
import { createWorld, step } from "../src/sim/world.ts";
import { packInput } from "../src/sim/input.ts";
import { bot } from "../src/dev/bot.ts";
if (!process.argv.includes("--execute"))
  throw new Error("Authorized testnet smoke requires --execute");
const cookies = JSON.parse(
  readFileSync(".data/near-smoke-sessions.json", "utf8"),
).cookies;
const file = ".data/near-market-session.json";
let session: any;
try {
  session = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  session = { intents: {}, checks: [] };
}
const save = () =>
  writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
const api =
  (name: string) =>
  async (path: string, body?: Record<string, unknown>): Promise<any> => {
    const response = await fetch(`http://127.0.0.1:5173/api/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Cookie: cookies[name],
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(90000),
    });
    const result: any = await response.json();
    if (!response.ok) throw new Error(`${name} ${path}: ${result.error}`);
    return result;
  };
const alice = api("alice"),
  bobGuest = api("bob");
const p = testnetProvider();
assert.equal((await p.viewNodeStatus()).chain_id, "testnet");
const config = JSON.parse(readFileSync(".data/near.json", "utf8"));
const view = (method: string, args: Record<string, unknown>) =>
  p.callFunction<any>({ contractId: config.contractId, method, args });
const pause = (ms: number) =>
  new Promise((r) => setTimeout(r, Math.min(ms, 10000)));
let a = await alice("profile"),
  b = await bobGuest("profile");
assert.ok(a.chain.features.includes("market"));
assert.ok(b.chain.features.includes("market"));
if (!a.runs) {
  if (!session.run) {
    const run = await alice("runs", {}),
      world = createWorld(run.seed, run.skills, run.equipment),
      inputs: number[] = [];
    while (world.phase !== "dead" && world.phase !== "won") {
      const input = bot(world);
      inputs.push(packInput(input));
      step(world, input);
      world.events.length = 0;
    }
    session.run = { run, inputs, started: Date.now() };
    save();
  }
  const deadline =
    session.run.started + Math.ceil((session.run.inputs.length * 1000) / 60);
  while (Date.now() < deadline) {
    console.log(
      `Silent verified Solo: ${Math.ceil((deadline - Date.now()) / 1000)}s`,
    );
    await pause(deadline - Date.now());
  }
  const result = await alice("results", {
    id: session.run.run.id,
    inputs: session.run.inputs,
  });
  assert.equal(result.champion.chain.pending, false);
  a = result.champion;
}
const initial = await bobGuest("market");
assert.ok(initial.round);
session.roundId ??= initial.round.id;
assert.equal(initial.round.id, session.roundId, "Resume the same proof round");
const roundId = session.roundId;
async function act(
  name: string,
  key: string,
  operation: string,
  data: Record<string, unknown> = {},
) {
  const id = (session.intents[key] ??= randomUUID());
  save();
  const call = api(name);
  let result = await call("market", { id, operation, data });
  for (let i = 0; !result.intent.complete && i < 10; i++) {
    await pause(2000);
    result = await call("market", { id, operation, data });
  }
  assert.equal(result.intent.complete, true, `${key} remains pending`);
  assert.ok(!result.intent.error, result.intent.error);
  session.transactions ??= {};
  session.transactions[key] = result.intent.transaction;
  save();
  return result;
}
if (!session.before) {
  session.before = { alice: a.coins, bob: b.coins };
  save();
}
await act("bob", "reserve-cancel", "reserve_mint", { roundId });
await act("bob", "cancel", "cancel_mint", { roundId });
if (!session.checks.includes("cancel")) {
  assert.equal((await bobGuest("profile")).coins, session.before.bob);
  session.checks.push("cancel");
  save();
}
await act("bob", "reserve", "reserve_mint", { roundId });
await act("alice", "unpaid-reserve", "reserve_mint", { roundId });
await act("bob", "fund", "fund_guest");
await act("bob", "mint", "mint", { roundId });
const minted = await bobGuest("market"),
  relic = minted.reservation.tokenId;
assert.ok(relic.startsWith("relic:"));
await act("bob", "tickets", "tickets", { roundId, count: 2 });
await act("alice", "tickets-alice", "tickets", { roundId, count: 1 });
const paid = await act("bob", "mint", "mint", { roundId });
assert.equal(paid.market.round.minted, 1, "retry cannot mint twice");
await act("bob", "equip", "equip_gear", { slot: "weapon", gearId: relic });
const nft = await bobGuest("nft");
assert.equal(
  nft.tokens.find((t: any) => t.tokenId === relic).extra.equippedTo,
  b.id,
);
console.log(
  "LIVE MINT: PASS (coin access, refund, demo funding, native payment, idempotency, tickets, equipped NFT)",
);
while (Date.now() < minted.round.endsAt) {
  console.log(
    `Draw deadline: ${Math.ceil((minted.round.endsAt - Date.now()) / 1000)}s`,
  );
  await pause(minted.round.endsAt - Date.now() + 1000);
}
await act("alice", "draw", "draw_round", { roundId });
const drawn = await bobGuest("market");
assert.equal(drawn.round.drawn, true);
assert.equal(drawn.round.reserved, 0);
assert.equal(drawn.round.winners.length, 2);
assert.equal(
  drawn.round.winners.reduce(
    (n: bigint, w: any) => n + BigInt(w.amountYocto),
    0n,
  ),
  10000000000000000000000n,
);
for (const name of ["alice", "bob"])
  await act(name, `withdraw-${name}`, "withdraw_prize");
const finalA = await alice("profile"),
  finalB = await bobGuest("profile");
assert.equal(finalA.coins, session.before.alice - 5);
assert.equal(finalB.coins, session.before.bob - 20);
assert.equal(
  (await view("get_champion", { champion_id: b.id })).equipped.weapon,
  relic,
);
const proof = {
  network: "testnet",
  contractId: config.contractId,
  verifiedAt: new Date().toISOString(),
  round: drawn.round,
  relicTokenId: relic,
  champions: [a.id, b.id],
  coinBalances: {
    before: session.before,
    after: { alice: finalA.coins, bob: finalB.coins },
  },
  transactions: session.transactions,
  checks: [
    "Solo-earned mint entry",
    "Cancel refunds coin once",
    "Bounded native testnet funding",
    "Guest-signed native paid mint",
    "Retry creates no second edition or charge",
    "Dynamic equipped relic NFT",
    "Weighted draw with two distinct champions",
    "Expired unpaid reservation refunded",
    "100% mint revenue allocated",
    "Both champions withdrew native prizes",
  ],
};
writeFileSync(
  "docs/testnet-market-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(JSON.stringify(proof, null, 2));
console.log("LIVE MINT + RAFFLE: PASS");
