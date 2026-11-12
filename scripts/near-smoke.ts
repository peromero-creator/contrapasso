import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { testnetProvider } from "../server/rpc.ts";
import {
  createWorld,
  createDuelWorld,
  step,
  type World,
} from "../src/sim/world.ts";
import { packInput } from "../src/sim/input.ts";
import { bot } from "../src/dev/bot.ts";
import { SKILLS, SKILL_IDS } from "../src/sim/skills.ts";
import type { Champion, RunChallenge } from "../src/shared/protocol.ts";

if (!process.argv.includes("--execute"))
  throw new Error(
    "Live testnet transactions require authorization. Pass --execute only after approval.",
  );
const base = "http://127.0.0.1:5173";
const info = (await (await fetch(`${base}/api/info`)).json()) as {
  network: string;
  contractId: string;
};
assert.equal(info.network, "testnet");
assert.ok(info.contractId.endsWith(".testnet"));
const rpc = testnetProvider();
const sessionFile = ".data/near-smoke-sessions.json";
let session: {
  cookies: Record<string, string>;
  duel?: RunChallenge;
  before?: number;
} = { cookies: {} };
try {
  session = JSON.parse(readFileSync(sessionFile, "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
const saveSession = () =>
  writeFileSync(sessionFile, JSON.stringify(session), { mode: 0o600 });
assert.equal((await rpc.viewNodeStatus()).chain_id, "testnet");
const view = (method: string, args: Record<string, unknown>) =>
  rpc.callFunction<any>({ contractId: info.contractId, method, args });
function guest(name: string) {
  let cookie = session.cookies[name] ?? "";
  return async (path: string, body?: Record<string, unknown>): Promise<any> => {
    const r = await fetch(`${base}/api/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120000),
    });
    const set = r.headers.get("set-cookie");
    if (set) {
      cookie = set.split(";")[0];
      session.cookies[name] = cookie;
      saveSession();
    }
    const data: any = await r.json();
    if (!r.ok) throw new Error(`${path}: ${data.error ?? r.status}`);
    return data;
  };
}
function replay(w: World) {
  const inputs: number[] = [];
  while (w.phase !== "dead" && w.phase !== "won") {
    const input = bot(w);
    inputs.push(packInput(input));
    step(w, input);
    w.events.length = 0;
  }
  return inputs;
}
async function waitForPlayback(
  challenge: RunChallenge,
  started: number,
  inputs: number[],
) {
  const deadline = started + Math.ceil((inputs.length * 1000) / 60);
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    console.log(
      `Silent replay pacing: ${Math.ceil(remaining / 1000)}s remaining`,
    );
    await new Promise((r) => setTimeout(r, Math.min(10000, remaining)));
  }
}
const alice = guest("alice"),
  bobGuest = guest("bob");
let a: Champion = await alice("profile"),
  b: Champion = await bobGuest("profile");
assert.equal(a.chain?.pending, false);
assert.equal(b.chain?.pending, false);
console.log(
  "Testnet: two real guest champions confirmed. Playing Solo silently.",
);
await Promise.all(
  [alice, bobGuest].map(async (api) => {
    if ((await api("profile")).runs > 0) return;
    const challenge: RunChallenge = await api("runs", {}),
      started = Date.now();
    const world = createWorld(
        challenge.seed,
        challenge.skills,
        challenge.equipment,
      ),
      inputs = replay(world);
    await waitForPlayback(challenge, started, inputs);
    const result = await api("results", { id: challenge.id, inputs });
    assert.equal(result.champion.chain.pending, false);
    assert.ok(result.receipt.result.awardedCoins >= 10);
    const again = await api("results", { id: challenge.id, inputs });
    assert.equal(again.champion.coins, result.champion.coins);
  }),
);
a = await alice("profile");
b = await bobGuest("profile");
const skill =
  a.skills[0] ?? SKILL_IDS.find((id) => SKILLS[id].cost <= a.coins)!;
assert.ok(skill);
if (!a.skills.includes(skill)) a = await alice("train", { skill });
assert.ok(a.skills.includes(skill));
assert.equal(a.chain?.pending, false);
if (!b.defending) b = await bobGuest("defense", { enabled: true });
assert.equal(b.defending, true);
assert.equal(b.chain?.pending, false);
if (!session.duel) {
  const active: RunChallenge | null = await alice("duel-current");
  const lobby = await alice("duel-lobby");
  if (!active)
    assert.ok(lobby.opponents.some((o: { id: string }) => o.id === b.id));
  session.before = a.coins + b.coins + (active ? 20 : 0);
  session.duel = active ?? (await alice("duels", { opponentId: b.id }));
  saveSession();
}
assert.ok(session.duel);
const duel = session.duel,
  before = session.before!,
  started = duel.expiresAt - 10 * 60000;
const lockedA = await view("get_champion", { champion_id: a.id }),
  lockedB = await view("get_champion", { champion_id: b.id });
if (lockedA.lockedBy) {
  assert.equal(lockedA.lockedBy, duel.id);
  assert.equal(lockedB.lockedBy, duel.id);
  assert.equal(lockedA.coins + lockedB.coins, before - 20);
} else
  assert.equal((await view("get_duel", { duel_id: duel.id })).settled, true);
const world = createDuelWorld(
    duel.seed,
    duel.challengerBuild!,
    duel.opponent!.build,
  ),
  inputs = replay(world);
console.log("Testnet: both stakes locked. Playing the issued Duel silently.");
await waitForPlayback(duel, started, inputs);
const saved = await alice("results", { id: duel.id, inputs });
assert.equal(saved.champion.chain.pending, false);
a = await alice("profile");
b = await bobGuest("profile");
assert.equal(a.coins + b.coins, before);
assert.equal(a.duelWins + a.duelLosses, 1);
assert.equal(b.duelWins + b.duelLosses, 1);
assert.equal(a.lockedBy, null);
assert.equal(b.lockedBy, null);
for (const c of [a, b]) {
  const token = await view("nft_token", { token_id: `champion:${c.id}` }),
    extra = JSON.parse(token.metadata.extra);
  assert.equal(token.owner_id, c.chain!.accountId);
  assert.equal(extra.coins, c.coins);
  assert.equal(extra.duelWins, c.duelWins);
  assert.equal(extra.duelLosses, c.duelLosses);
  for (const kind of ["weapon", "armor"])
    assert.equal(
      (await view("nft_token", { token_id: `${kind}:${c.id}` })).owner_id,
      c.chain!.accountId,
    );
}
const report = {
  network: "testnet",
  contractId: info.contractId,
  verifiedAt: new Date().toISOString(),
  champions: [a, b].map((c) => ({
    id: c.id,
    owner: c.chain!.accountId,
    coins: c.coins,
    wins: c.duelWins,
    losses: c.duelLosses,
    transaction: c.chain!.lastTransaction,
  })),
  duelId: duel.id,
  outcome: saved.receipt.result.outcome,
  checks: [
    "Solo replay + duplicate result",
    "NFT ownership + dynamic metadata",
    "Permanent training",
    "Opt-in defense + matchmaking",
    "Both stakes locked",
    "Verified Duel + conserved coin + both NFT records",
  ],
};
writeFileSync(".data/near-smoke-report.json", JSON.stringify(report, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
console.log("LIVE TESTNET: PASS");
