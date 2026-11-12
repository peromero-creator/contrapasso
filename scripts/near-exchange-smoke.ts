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
const cookies = JSON.parse(
  readFileSync(".data/near-smoke-sessions.json", "utf8"),
).cookies;
const file = ".data/near-exchange-session.json";
const saved: any = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : { intents: {}, transactions: {}, champions: {} };
const save = () => writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
async function call(
  name: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(`http://127.0.0.1:5173/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      cookie: cookies[name],
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const value: any = await res.json();
  if (!res.ok) throw new Error(`${name} ${path}: ${value.error}`);
  return value;
}
async function act(
  name: string,
  label: string,
  operation: string,
  data: Record<string, unknown>,
) {
  const key = `${name}:${label}`,
    id = (saved.intents[key] ??= randomUUID());
  save();
  let result = await call(name, "market", { id, operation, data });
  for (let n = 0; !result.intent.complete && n < 12; n++) {
    await new Promise((r) => setTimeout(r, 1500));
    result = await call(name, "market", { id, operation, data });
  }
  assert.ok(
    result.intent.complete && !result.intent.error,
    result.intent.error ?? "Pending",
  );
  saved.transactions[key] = result.intent.transaction;
  save();
  return result;
}
const market = await call("alice", "market");
assert.equal(market.revenueMode, "treasury");
saved.round ??= market.round.id;
assert.equal(saved.round, market.round.id);
assert.equal(saved.round, "ranged-demo-1");
save();
for (const [name, identity] of [
  ["alice", "gravewhisper"],
  ["bob", "vesper-reed"],
] as const) {
  if (saved.champions[name]) continue;
  const profile = await call(name, "profile");
  assert.ok(profile.chain.features.includes("exchange"));
  assert.notEqual(profile.id, "c09951f2-1696-4663-ac6c-ab91b7b4cac1");
  await act(name, "reserve", "reserve_mint", {
    roundId: saved.round,
    weaponId: identity,
  });
  const minted = await act(name, "mint", "mint", { roundId: saved.round });
  const tokenId = minted.market.reservation.tokenId;
  await act(name, "equip", "equip_gear", { slot: "weapon", gearId: tokenId });
  let after = await call(name, "profile");
  if (after.build.weaponLevel === 0) {
    await call(name, "upgrade", { slot: "weapon" });
    after = await call(name, "profile");
  }
  assert.equal(after.build.weaponId, identity);
  assert.equal(after.build.weaponLevel, 1);
  const nft = (await call(name, "nft")).tokens.find(
    (t: any) => t.tokenId === tokenId,
  );
  saved.champions[name] = {
    id: after.id,
    accountId: after.chain.accountId,
    tokenId,
    traits: nft.extra,
  };
  save();
  console.log(`${identity}: minted, equipped and upgraded on testnet`);
}
const tokenId = saved.champions.alice.tokenId,
  priceYocto = "15000000000000000000000";
if (!saved.saleComplete) {
  await act("alice", "unequip", "unequip_gear", { slot: "weapon" });
  const listed = await act("alice", "list", "list_gear", {
    tokenId,
    priceYocto,
  });
  saved.listing ??= listed.market.listings.find(
    (l: any) => l.tokenId === tokenId,
  );
  save();
  assert.ok(saved.listing);
  const quote = { tokenId, priceYocto, listingId: saved.listing.id };
  await act("bob", "buy", "buy_gear", quote);
  const duplicate = await act("bob", "buy", "buy_gear", quote);
  assert.equal(duplicate.intent.complete, true);
  const token = await provider.callFunction<any>({
    contractId: config.contractId,
    method: "nft_token",
    args: { token_id: tokenId },
  });
  const traits = JSON.parse(token.metadata.extra),
    before = saved.champions.alice.traits;
  assert.equal(token.owner_id, saved.champions.bob.accountId);
  for (const key of ["weaponId", "level", "kills", "damage", "reach"])
    assert.equal(traits[key], before[key]);
  assert.deepEqual(
    traits.pastOwners,
    [...before.pastOwners, saved.champions.alice.accountId].slice(-10),
  );
  const proceeds = (await call("alice", "market")).proceedsYocto;
  assert.equal(proceeds, "13500000000000000000000");
  await act("alice", "withdraw", "withdraw_sales", {});
  assert.equal((await call("alice", "market")).proceedsYocto, "0");
  saved.saleComplete = true;
  saved.sale = {
    tokenId,
    priceYocto,
    seller: saved.champions.alice.accountId,
    buyer: token.owner_id,
    traits,
    proceedsYocto: proceeds,
    withdrawn: true,
  };
  save();
}
// A genuine transferable relic remains available for the silent browser purchase.
const offer = await act("bob", "browser-list", "list_gear", {
  tokenId,
  priceYocto: "18000000000000000000000",
});
saved.browserListing ??= offer.market.listings.find(
  (l: any) => l.tokenId === tokenId,
);
save();
await act("bob", "staff-unequip", "unequip_gear", { slot: "weapon" });
const staffOffer = await act("bob", "staff-list", "list_gear", {
  tokenId: saved.champions.bob.tokenId,
  priceYocto: "20000000000000000000000",
});
saved.staffListing ??= staffOffer.market.listings.find(
  (l: any) => l.tokenId === saved.champions.bob.tokenId,
);
save();
const original = await provider.callFunction<any>({
  contractId: config.contractId,
  method: "get_champion",
  args: { champion_id: "c09951f2-1696-4663-ac6c-ab91b7b4cac1" },
});
assert.equal(original.coins, 76);
const proof = {
  network: "testnet",
  contractId: config.contractId,
  round: saved.round,
  transactions: saved.transactions,
  champions: saved.champions,
  sale: saved.sale,
  browserListing: saved.browserListing,
  staffListing: saved.staffListing,
  originalVaultPreserved: 76,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  "docs/testnet-exchange-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(
  "LIVE EXCHANGE: PASS (both ranged NFTs, upgrades, exact NFT sale, history, duplicate retry, withdrawal, original vault preserved)",
);
