import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { testnetProvider } from "../server/rpc.ts";
import { weapon } from "../src/sim/weapons.ts";
if (!process.argv.includes("--execute"))
  throw new Error("Authorized testnet writes require --execute");
const cookies = JSON.parse(
  readFileSync(".data/near-smoke-sessions.json", "utf8"),
).cookies;
const file = ".data/near-arsenal-session.json";
const saved: any = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : { intents: {}, transactions: {}, champions: {} };
const save = () => writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
const config = JSON.parse(readFileSync(".data/near.json", "utf8"));
const provider = testnetProvider(config.rpcUrl);
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const call = async (
  name: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<any> => {
  const res = await fetch(`http://127.0.0.1:5173/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      cookie: cookies[name],
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const value = (await res.json()) as any;
  if (!res.ok) throw new Error(`${name} ${path}: ${value.error}`);
  return value;
};
const market = await call("alice", "market");
assert.equal(market.revenueMode, "treasury");
saved.round ??= market.round.id;
assert.equal(saved.round, market.round.id, "Resume the same edition");
save();
async function act(name: string, op: string, data: Record<string, unknown>) {
  const key = `${name}:${op}`,
    id = (saved.intents[key] ??= randomUUID());
  save();
  let result = await call(name, "market", { id, operation: op, data });
  for (let n = 0; !result.intent.complete && n < 12; n++) {
    await new Promise((r) => setTimeout(r, 1500));
    result = await call(name, "market", { id, operation: op, data });
  }
  if (
    op === "mint" &&
    result.intent.complete &&
    result.intent.error?.startsWith("Get demo test NEAR") &&
    !(saved.retriedFunding ?? {})[name]
  ) {
    (saved.retriedFunding ??= {})[name] = true;
    (saved.failedIntents ??= []).push(id);
    saved.intents[key] = randomUUID();
    save();
    return act(name, op, data);
  }
  assert.ok(
    result.intent.complete && !result.intent.error,
    result.intent.error ?? "Still pending",
  );
  saved.transactions[key] = result.intent.transaction;
  save();
  return result;
}
for (const [name, identity] of [
  ["bob", "tollkeeper"],
  ["alice", "widows-fang"],
] as const) {
  let profile = await call(name, "profile");
  assert.ok(profile.chain.features.includes("arsenal"));
  assert.notEqual(profile.id, "c09951f2-1696-4663-ac6c-ab91b7b4cac1");
  await act(name, "reserve_mint", { roundId: saved.round, weaponId: identity });
  const funds = await call(name, "market");
  if (!funds.sponsored && funds.fundingAvailable)
    await act(name, "fund_guest", {});
  const minted = await act(name, "mint", { roundId: saved.round });
  const tokenId = minted.market.reservation.tokenId;
  await act(name, "equip_gear", { slot: "weapon", gearId: tokenId });
  profile = await call(name, "profile");
  if (profile.build.weaponLevel === 0) {
    await call(name, "upgrade", { slot: "weapon" });
    profile = await call(name, "profile");
  }
  assert.equal(profile.build.weaponId, identity);
  assert.equal(profile.build.weaponLevel, 1);
  if (name === "alice")
    for (const skill of ["ember", "reach"]) {
      if (!profile.skills.includes(skill)) {
        profile = await call(name, "train", { skill });
      }
    }
  const inventory = await call(name, "nft"),
    token = inventory.tokens.find((t: any) => t.tokenId === tokenId);
  assert.equal(token.extra.level, 1);
  assert.equal(token.extra.weaponId, identity);
  assert.equal(token.extra.damage, weapon(identity).damage + 2);
  const run = await call(name, "runs", {});
  assert.equal(run.equipment.weaponId, identity);
  assert.equal(run.equipment.weaponLevel, 1);
  saved.champions[name] = {
    id: profile.id,
    weaponId: identity,
    tokenId,
    level: token.extra.level,
    damage: token.extra.damage,
    skills: profile.skills,
    coins: profile.coins,
    issuedBuild: run.equipment,
  };
  save();
  console.log(
    `${identity}: minted, equipped, upgraded and authenticated in run loadout`,
  );
}
const original = await provider.callFunction<any>({
  contractId: config.contractId,
  method: "get_champion",
  args: { champion_id: "c09951f2-1696-4663-ac6c-ab91b7b4cac1" },
});
assert.equal(original.coins, 76);
const after = await call("alice", "market");
const proof = {
  network: "testnet",
  contractId: config.contractId,
  version: "0.6.0",
  round: saved.round,
  champions: saved.champions,
  transactions: saved.transactions,
  treasuryYocto: after.treasuryYocto,
  originalChampionCoins: original.coins,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  "docs/testnet-arsenal-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log("LIVE ARSENAL: PASS");
