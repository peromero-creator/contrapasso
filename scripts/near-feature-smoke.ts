import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  Account,
  KeyPair,
  KeyPairSigner,
  actions,
  type KeyPairString,
} from "near-api-js";
import { testnetProvider } from "../server/rpc.ts";
import type { Champion } from "../src/shared/protocol.ts";
if (!process.argv.includes("--execute"))
  throw new Error("Authorized testnet smoke only: pass --execute");
const saved = JSON.parse(
  readFileSync(".data/near-smoke-sessions.json", "utf8"),
);
const cookie = saved.cookies.alice;
if (!cookie) throw new Error("Verified test guest is missing");
const api = async (
  path: string,
  body?: Record<string, unknown>,
): Promise<any> => {
  const r = await fetch(`http://127.0.0.1:5173/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const result: any = await r.json();
  if (!r.ok) throw new Error(`${path}: ${result.error}`);
  return result;
};
const p = testnetProvider();
assert.equal((await p.viewNodeStatus()).chain_id, "testnet");
const config = JSON.parse(readFileSync(".data/near.json", "utf8"));
const view = (method: string, args: Record<string, unknown>) =>
  p.callFunction<any>({ contractId: config.contractId, method, args });
const before: Champion = await api("profile");
assert.ok(before.chain?.features?.includes("claim"));
const file = ".data/near-feature-smoke-session.json";
let session: any;
try {
  session = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  const wallet = KeyPair.fromRandom("ed25519");
  session = {
    sourceId: before.id,
    beforeCoins: before.coins,
    receiver: `proof-${randomUUID().slice(0, 8)}.${config.contractId}`,
    secretKey: wallet.toString(),
  };
  writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
}
const save = () =>
  writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
if (!session.upgrades) {
  const levels = { ...before.build };
  const cost = 15 + 10 * levels.weaponLevel + (15 + 10 * levels.armorLevel);
  for (const slot of ["weapon", "armor"]) {
    const r = await api("upgrade", { slot });
    assert.equal(r.champion.chain.pending, false);
    assert.equal(r.upgrade.success, true);
  }
  const updated: Champion = await api("profile");
  assert.equal(updated.coins, session.beforeCoins - cost);
  assert.equal(updated.build.weaponLevel, levels.weaponLevel + 1);
  assert.equal(updated.build.armorLevel, levels.armorLevel + 1);
  const nft = await api("nft");
  assert.equal(
    nft.tokens.find((t: any) => t.tokenId === `weapon:${updated.id}`).extra
      .level,
    updated.build.weaponLevel,
  );
  session.upgrades = {
    coins: updated.coins,
    weaponLevel: updated.build.weaponLevel,
    armorLevel: updated.build.armorLevel,
  };
  save();
}
let recipientExists = true;
try {
  await p.viewAccount({ accountId: session.receiver });
} catch {
  recipientExists = false;
}
if (!recipientExists) {
  const plan = JSON.parse(readFileSync(".data/near-plan.json", "utf8"));
  const owner = new Account(
    config.contractId,
    p,
    KeyPairSigner.fromSecretKey(plan.secretKey),
  );
  await owner.signAndSendTransaction({
    receiverId: session.receiver,
    actions: [
      actions.createAccount(),
      actions.transfer(50000000000000000000000n),
      actions.addFullAccessKey(
        KeyPair.fromString(session.secretKey as KeyPairString).getPublicKey(),
      ),
    ],
    waitUntil: "FINAL",
  });
}
const recipientState = await p.viewAccount({ accountId: session.receiver });
if (BigInt(recipientState.amount) < 200000000000000000000000n) {
  const plan = JSON.parse(readFileSync(".data/near-plan.json", "utf8"));
  const owner = new Account(
    config.contractId,
    p,
    KeyPairSigner.fromSecretKey(plan.secretKey),
  );
  await owner.signAndSendTransaction({
    receiverId: session.receiver,
    actions: [
      actions.transfer(
        200000000000000000000000n - BigInt(recipientState.amount),
      ),
    ],
    waitUntil: "FINAL",
  });
}
const claimed = await api("claim", {
  championId: session.sourceId,
  receiver: session.receiver,
});
assert.equal(claimed.claimed.pending, false);
assert.notEqual(claimed.champion.id, session.sourceId);
const retry = await api("claim", {
  championId: session.sourceId,
  receiver: session.receiver,
});
assert.equal(
  retry.champion.id,
  claimed.champion.id,
  "claim retry must keep the same fresh guest",
);
for (const kind of ["champion", "weapon", "armor"]) {
  const t = await view("nft_token", {
    token_id: `${kind}:${session.sourceId}`,
  });
  assert.equal(t.owner_id, session.receiver);
  if (kind === "champion") {
    const e = JSON.parse(t.metadata.extra);
    assert.equal(e.coins, session.upgrades.coins);
    assert.equal(e.build.weaponLevel, session.upgrades.weaponLevel);
    assert.equal(e.build.armorLevel, session.upgrades.armorLevel);
  }
}
const wallet = new Account(
  session.receiver,
  p,
  KeyPairSigner.fromSecretKey(session.secretKey),
);
await wallet.callFunctionRaw({
  contractId: config.contractId,
  methodName: "nft_approve",
  args: {
    token_id: `champion:${session.sourceId}`,
    account_id: config.contractId,
    msg: "",
  },
  deposit: 10000000000000000000000n,
  gas: 100000000000000n,
  waitUntil: "FINAL",
});
assert.equal(
  await view("nft_is_approved", {
    token_id: `champion:${session.sourceId}`,
    approved_account_id: config.contractId,
  }),
  true,
);
await wallet.callFunctionRaw({
  contractId: config.contractId,
  methodName: "nft_revoke_all",
  args: { token_id: `champion:${session.sourceId}` },
  deposit: 1n,
  gas: 100000000000000n,
  waitUntil: "FINAL",
});
const proof = {
  network: "testnet",
  contractId: config.contractId,
  verifiedAt: new Date().toISOString(),
  championTokenId: `champion:${session.sourceId}`,
  receiver: session.receiver,
  transaction: claimed.claimed.transaction,
  upgrades: session.upgrades,
  newGuestTokenId: `champion:${claimed.champion.id}`,
  checks: [
    "Equipped weapon and armor +1",
    "Coin cost + dynamic NFT metadata",
    "Confirmed wallet claim carrying gear and vault",
    "Retry creates no second guest",
    "Receiver signed NFT approval and revoke with its own key",
  ],
};
writeFileSync(
  "docs/testnet-features-proof.json",
  JSON.stringify(proof, null, 2) + "\n",
);
console.log(JSON.stringify(proof, null, 2));
console.log("LIVE UPGRADE + WALLET CLAIM: PASS");
