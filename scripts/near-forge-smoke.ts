import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { testnetProvider } from "../server/rpc.ts";
if (!process.argv.includes("--execute"))
  throw new Error("Authorized testnet writes require --execute");
const config = JSON.parse(readFileSync(".data/near.json", "utf8"));
assert.equal(config.network, "testnet");
const provider = testnetProvider(config.rpcUrl);
assert.equal((await provider.viewNodeStatus()).chain_id, "testnet");
const cookie = JSON.parse(
  readFileSync(".data/near-smoke-sessions.json", "utf8"),
).cookies.bob;
const file = ".data/near-forge-session.json";
const saved: any = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : { intents: {}, transactions: {}, tokens: {} };
const save = () =>
  writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
async function call(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:5173/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error}`);
  return data;
}
async function act(
  label: string,
  operation: string,
  data: Record<string, unknown>,
) {
  const id = (saved.intents[label] ??= randomUUID());
  save();
  let result = await call("market", { id, operation, data });
  for (let n = 0; !result.intent.complete && n < 12; n++) {
    await new Promise((r) => setTimeout(r, 1500));
    result = await call("market", { id, operation, data });
  }
  if (
    result.intent.complete &&
    result.intent.error?.startsWith("Get demo test NEAR") &&
    !(saved.retried ?? {})[label]
  ) {
    (saved.retried ??= {})[label] = true;
    (saved.rejectedIntents ??= []).push(id);
    saved.intents[label] = randomUUID();
    save();
    return act(label, operation, data);
  }
  assert.ok(
    result.intent.complete && !result.intent.error,
    result.intent.error ?? "Still pending",
  );
  saved.transactions[label] = result.intent.transaction;
  save();
  return result;
}
const before = await call("profile");
assert.notEqual(before.id, "c09951f2-1696-4663-ac6c-ab91b7b4cac1");
assert.ok(before.chain.features.includes("repeat_mint"));
const market = await call("market");
assert.equal(market.round.id, "forge-demo-1");
assert.equal(market.round.cap, 100);
if (BigInt(market.proceedsYocto ?? "0") > 0n)
  await act("proceeds:withdraw", "withdraw_sales", {});
saved.championId ??= before.id;
saved.coinsBefore ??= before.coins;
save();
for (const id of ["guillotine-hymn", "acheron-needle"]) {
  if (saved.tokens[id]) continue;
  await act(`${id}:reserve`, "reserve_mint", {
    roundId: "forge-demo-1",
    weaponId: id,
  });
  const minted = await act(`${id}:mint`, "mint", { roundId: "forge-demo-1" }),
    tokenId = minted.market.reservation.tokenId;
  const supply = await provider.callFunction({
    contractId: config.contractId,
    method: "nft_total_supply",
    args: {},
  });
  await act(`${id}:mint`, "mint", { roundId: "forge-demo-1" });
  assert.equal(
    await provider.callFunction({
      contractId: config.contractId,
      method: "nft_total_supply",
      args: {},
    }),
    supply,
  );
  await act(`${id}:equip`, "equip_gear", { slot: "weapon", gearId: tokenId });
  assert.equal((await call("profile")).build.weaponId, id);
  const token: any = await provider.callFunction({
    contractId: config.contractId,
    method: "nft_token",
    args: { token_id: tokenId },
  });
  const traits = JSON.parse(token.metadata.extra);
  assert.equal(traits.weaponId, id);
  assert.equal(traits.level, 0);
  saved.tokens[id] = { tokenId, ownerId: token.owner_id, traits };
  save();
  console.log(
    `${id}: minted once, duplicate safe, equipped from chain metadata`,
  );
}
if (!saved.cancelled) {
  await act("refund:reserve", "reserve_mint", {
    roundId: "forge-demo-1",
    weaponId: "guillotine-hymn",
  });
  await act("refund:cancel", "cancel_mint", { roundId: "forge-demo-1" });
  saved.cancelled = true;
  save();
}
const after = await call("profile");
assert.equal(after.coins, saved.coinsBefore - 20);
assert.notEqual(
  saved.tokens["guillotine-hymn"].tokenId,
  saved.tokens["acheron-needle"].tokenId,
);
const proof = {
  network: "testnet",
  contractId: config.contractId,
  edition: "forge-demo-1",
  editionSupply: 100,
  championId: saved.championId,
  coinsBefore: saved.coinsBefore,
  coinsAfter: after.coins,
  repeatMintVerified: true,
  duplicateMintSafe: true,
  cancelRefundVerified: true,
  tokens: saved.tokens,
  transactions: saved.transactions,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  "docs/testnet-forge-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(
  "Forge: PASS — two distinct paid mints on one champion, replay safety and third reservation refund.",
);
