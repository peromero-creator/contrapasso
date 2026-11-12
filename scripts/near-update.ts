import {
  Account,
  KeyPair,
  KeyPairSigner,
  actions,
  type KeyPairString,
} from "near-api-js";
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { testnetProvider } from "../server/rpc.ts";
import { refereeKey } from "../server/keys.ts";
const sha = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const config = JSON.parse(readFileSync(".data/near.json", "utf8"));
if (
  config.network !== "testnet" ||
  !config.contractId.endsWith(".testnet") ||
  config.accountId !== config.contractId
)
  throw new Error("Testnet contract account required");
const p = testnetProvider(config.rpcUrl);
if ((await p.viewNodeStatus()).chain_id !== "testnet")
  throw new Error("Wrong network");
const view = (method: string, args: Record<string, unknown> = {}) =>
  p.callFunction<any>({ contractId: config.contractId, method, args });
const code = readFileSync("build/contrapasso.wasm"),
  newHash = sha(code);
const old = await p.viewContractCode({ contractId: config.contractId }),
  oldHash = sha(old.code);
const cfg = await view("game_config");
const refereePublicKey = Buffer.from(
  createPublicKey(refereeKey(".data")).export({ format: "jwk" }).x!,
  "base64url",
).toString("hex");
if (cfg.referee_public_key !== refereePublicKey)
  throw new Error("Referee mismatch");
const state = await p.viewAccount({ accountId: config.contractId });
if (
  BigInt(state.amount) <
  BigInt(
    Number(state.storage_usage) +
      Math.max(0, code.length - old.code.length) +
      5000,
  ) *
    10n ** 19n +
    10n ** 23n
)
  throw new Error("Not enough free testnet balance");
const planPath = ".data/near-update-review.json";
if (!process.argv.includes("--execute")) {
  const plan = {
    contractId: config.contractId,
    expectedOldHash: oldHash,
    newHash,
    wasmBytes: code.length,
    network: "testnet",
    method: "deploy code only; preserve all contract state; no init",
    preparedAt: new Date().toISOString(),
  };
  writeFileSync(planPath, JSON.stringify(plan, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(plan, null, 2));
} else {
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  if (
    plan.contractId !== config.contractId ||
    plan.expectedOldHash !== oldHash ||
    plan.newHash !== newHash
  )
    throw new Error("Reviewed code changed; prepare the update again");
  const local = JSON.parse(readFileSync(".data/state.json", "utf8"));
  if (local.outbox.length)
    throw new Error("Drain pending operations before updating");
  const allState = async () => {
    const s = await p.viewContractState({ contractId: config.contractId });
    return sha(JSON.stringify(s.values));
  };
  const before = await allState(),
    supply = await view("nft_total_supply");
  const owner = JSON.parse(readFileSync(".data/near-plan.json", "utf8"));
  if (owner.accountId !== config.contractId)
    throw new Error("Owner plan mismatch");
  const signer = new KeyPairSigner(
    KeyPair.fromString(owner.secretKey as KeyPairString),
  );
  const account = new Account(config.contractId, p, signer);
  const outcome = await account.signAndSendTransaction({
    receiverId: config.contractId,
    actions: [actions.deployContract(code)],
    waitUntil: "FINAL",
  });
  if (
    sha((await p.viewContractCode({ contractId: config.contractId })).code) !==
    newHash
  )
    throw new Error("Published code mismatch");
  const after = await allState(),
    updated = await view("game_config");
  if (
    before !== after ||
    (await view("nft_total_supply")) !== supply ||
    updated.referee_public_key !== refereePublicKey
  )
    throw new Error("Contract state changed during code upgrade");
  config.updateTransaction = outcome.transaction.hash;
  delete config.features;
  writeFileSync(".data/near.json", JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
  const proof = {
    network: "testnet",
    contractId: config.contractId,
    transaction: outcome.transaction.hash,
    oldWasmSha256: oldHash,
    wasmSha256: newHash,
    stateHash: after,
    statePreserved: true,
    nftSupply: supply,
    features: updated.features,
    version: updated.version,
    verifiedAt: new Date().toISOString(),
  };
  writeFileSync(
    "docs/testnet-upgrade-proof.json",
    JSON.stringify(proof, null, 2) + "\n",
  );
  console.log(JSON.stringify(proof, null, 2));
}
