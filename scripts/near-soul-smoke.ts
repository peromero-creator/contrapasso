import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createWorld, step } from "../src/sim/world.ts";
import { packInput } from "../src/sim/input.ts";
import { bot } from "../src/dev/bot.ts";
import { testnetProvider } from "../server/rpc.ts";
if (!process.argv.includes("--execute"))
  throw new Error("Authorized testnet writes require --execute");
const config = JSON.parse(readFileSync(".data/near.json", "utf8"));
const provider = testnetProvider(config.rpcUrl);
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const cookies = JSON.parse(
  readFileSync(".data/near-smoke-sessions.json", "utf8"),
).cookies;
const file = ".data/near-soul-session.json";
const saved: any = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : {};
const save = () => writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
async function api(path: string, body?: unknown) {
  const r = await fetch(`http://127.0.0.1:5173/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie: cookies.alice, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error}`);
  return j;
}
let profile = await api("profile");
assert.notEqual(profile.id, "c09951f2-1696-4663-ac6c-ab91b7b4cac1");
assert.ok(profile.skills.includes("ember"));
assert.ok(profile.chain.features.includes("soul_core"));
if (!saved.run) {
  if (profile.build.core !== "ember") {
    profile = await api("attune", { core: "ember" });
    saved.attuneTransaction = profile.chain.lastTransaction;
    save();
  }
  profile = await api("profile");
  assert.equal(profile.build.core, "ember");
  saved.before = {
    id: profile.id,
    coins: profile.coins,
    runs: profile.runs,
    skills: profile.skills,
  };
  saved.startedAt = Date.now();
  saved.run = await api("runs", {});
  save();
}
assert.equal(saved.run.equipment.core, "ember");
if (!saved.inputs) {
  const w = createWorld(saved.run.seed, saved.run.skills, saved.run.equipment);
  const inputs: number[] = [];
  let casts = 0,
    ultimates = 0;
  while (!["dead", "won"].includes(w.phase) && w.tick < 36000) {
    const input = bot(w);
    inputs.push(packInput(input));
    step(w, input);
    for (const e of w.events)
      if (e.type === "ability" && e.stage === "charge") {
        if (e.ability === "lance") casts++;
        else ultimates++;
      }
    w.events.length = 0;
  }
  assert.ok(["dead", "won"].includes(w.phase));
  assert.ok(casts > 0 && ultimates > 0);
  saved.inputs = inputs;
  saved.combat = {
    ticks: w.tick,
    casts,
    ultimates,
    kills: w.player.kills,
    floor: w.floor,
    outcome: w.phase,
  };
  save();
}
const finish = saved.startedAt + (saved.combat.ticks * 1000) / 60 + 1500;
while (Date.now() < finish) {
  const left = finish - Date.now();
  console.log(`Silent replay: ${Math.ceil(left / 1000)} seconds remaining`);
  await new Promise((r) => setTimeout(r, Math.min(30000, left)));
}
const result = await api("results", { id: saved.run.id, inputs: saved.inputs });
const repeat = await api("results", { id: saved.run.id, inputs: saved.inputs });
assert.equal(result.receipt.signature, repeat.receipt.signature);
assert.equal(repeat.champion.coins, result.champion.coins);
assert.equal(result.champion.build.core, "ember");
saved.result = result;
save();
const chain = await provider.callFunction<any>({
  contractId: config.contractId,
  method: "get_champion",
  args: { champion_id: profile.id },
});
assert.equal(chain.build.core, "ember");
assert.equal(chain.runs, result.champion.runs);
const original = await provider.callFunction<any>({
  contractId: config.contractId,
  method: "get_champion",
  args: { champion_id: "c09951f2-1696-4663-ac6c-ab91b7b4cac1" },
});
assert.equal(original.coins, 76);
const proof = {
  network: "testnet",
  contractId: config.contractId,
  verifiedAt: new Date().toISOString(),
  championId: profile.id,
  attuneTransaction: saved.attuneTransaction,
  resultTransaction: result.champion.chain.lastTransaction,
  issuedCore: saved.run.equipment.core,
  combat: saved.combat,
  coinsBefore: saved.before.coins,
  coinsAfter: chain.coins,
  duplicateSafe: true,
  coreAfterReplay: chain.build.core,
  originalOwnerCoin: original.coins,
};
writeFileSync(
  "docs/testnet-soul-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(JSON.stringify(proof, null, 2));
