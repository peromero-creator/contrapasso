import { testnetProvider, TESTNET_RPC_URLS } from "../server/rpc.ts";
import {
  Account,
  KeyPair,
  KeyPairSigner,
  actions,
  type KeyPairString,
} from "near-api-js";
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { refereeKey } from "../server/keys.ts";

const directory = resolve(".data"),
  plan = JSON.parse(readFileSync(join(directory, "near-plan.json"), "utf8"));
if (!process.argv.includes("--execute"))
  throw new Error(
    "Read the prepared plan first. Use --execute only when testnet deployment is authorized.",
  );
if (
  plan.network !== "testnet" ||
  !TESTNET_RPC_URLS.includes(plan.rpcUrl) ||
  !plan.accountId.endsWith(".testnet") ||
  plan.contractId !== plan.accountId
)
  throw new Error("Refusing non-testnet deployment");
const code = readFileSync("build/contrapasso.wasm");
if (createHash("sha256").update(code).digest("hex") !== plan.wasmSha256)
  throw new Error("WASM changed; prepare and review the new plan");
const publicKey = Buffer.from(
  createPublicKey(refereeKey(directory)).export({ format: "jwk" }).x!,
  "base64url",
).toString("hex");
if (publicKey !== plan.refereePublicKey) throw new Error("Referee key changed");
const provider = testnetProvider(plan.rpcUrl);
if ((await provider.viewNodeStatus()).chain_id !== "testnet")
  throw new Error("RPC is not testnet");
const owner = KeyPair.fromString(plan.secretKey as KeyPairString),
  relay = KeyPair.fromString(plan.relaySecretKey as KeyPairString);
let state;
try {
  state = await provider.viewAccount({ accountId: plan.accountId });
} catch (e) {
  const type = String((e as any).type ?? "");
  const message = String((e as Error).message);
  if (
    !type.includes("UnknownAccount") &&
    !message.includes("does not exist") &&
    !message.includes("UNKNOWN_ACCOUNT")
  )
    throw e;
  const result = await fetch("https://helper.testnet.near.org/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      newAccountId: plan.accountId,
      newAccountPublicKey: owner.getPublicKey().toString(),
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!result.ok)
    throw new Error(
      `Testnet faucet returned ${result.status}; no deployment was sent`,
    );
  for (let n = 0; n < 12; n++) {
    try {
      state = await provider.viewAccount({ accountId: plan.accountId });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
if (!state) throw new Error("Faucet account has not appeared yet");
const account = new Account(plan.accountId, provider, new KeyPairSigner(owner));
const initialized = state.code_hash !== "11111111111111111111111111111111";
if (initialized)
  throw new Error(
    "Account already has code; refusing to overwrite an existing contract",
  );
if (
  BigInt(state.amount) <
  BigInt(code.length + 20000) * 10000000000000000000n +
    250000000000000000000000n
)
  throw new Error(
    "Faucet balance is insufficient for code storage and a reserve",
  );
const outcome = await account.signAndSendTransaction({
  receiverId: plan.contractId,
  actions: [
    actions.deployContract(code),
    actions.functionCall(
      "init",
      { referee_public_key: publicKey, owner_id: plan.accountId },
      100000000000000n,
      0n,
    ),
    actions.addFunctionCallAccessKey(
      relay.getPublicKey(),
      plan.contractId,
      ["apply_receipt"],
      2000000000000000000000000n,
    ),
  ],
  waitUntil: "FINAL",
});
const config = await provider.callFunction<any>({
  contractId: plan.contractId,
  method: "game_config",
  args: {},
});
if (config?.referee_public_key !== publicKey)
  throw new Error("Deployed configuration does not match");
const published = await provider.viewContractCode({
  contractId: plan.contractId,
});
if (
  createHash("sha256").update(published.code).digest("hex") !== plan.wasmSha256
)
  throw new Error("Published code hash does not match");
writeFileSync(
  join(directory, "near.json"),
  JSON.stringify(
    {
      network: "testnet",
      rpcUrl: plan.rpcUrl,
      accountId: plan.accountId,
      contractId: plan.contractId,
      secretKey: plan.relaySecretKey,
      deploymentTransaction: outcome.transaction.hash,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify(
    {
      network: "testnet",
      contractId: plan.contractId,
      transaction: outcome.transaction.hash,
      codeVerified: true,
      refereeVerified: true,
      relay: "Restricted to apply_receipt",
      explorer: `https://testnet.nearblocks.io/address/${plan.contractId}`,
    },
    null,
    2,
  ),
);
