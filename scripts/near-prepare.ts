import { TESTNET_RPC_URL } from "../server/rpc.ts";
import { KeyPair, type KeyPairString } from "near-api-js";
import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { refereeKey } from "../server/keys.ts";

const directory = resolve(".data");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const file = join(directory, "near-plan.json");
let plan: {
  network: "testnet";
  rpcUrl: string;
  accountId: string;
  contractId: string;
  secretKey: KeyPairString;
  relaySecretKey: KeyPairString;
  refereePublicKey: string;
  wasmSha256: string;
  wasmBytes: number;
};
try {
  plan = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  const key = KeyPair.fromRandom("ed25519"),
    relay = KeyPair.fromRandom("ed25519");
  const id = `contrapasso-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${randomBytes(3).toString("hex")}.testnet`;
  plan = {
    network: "testnet",
    rpcUrl: TESTNET_RPC_URL,
    accountId: id,
    contractId: id,
    secretKey: key.toString() as KeyPairString,
    relaySecretKey: relay.toString() as KeyPairString,
    refereePublicKey: "",
    wasmSha256: "",
    wasmBytes: 0,
  };
}
plan.rpcUrl = TESTNET_RPC_URL;
const wasm = readFileSync("build/contrapasso.wasm");
plan.wasmSha256 = createHash("sha256").update(wasm).digest("hex");
plan.wasmBytes = wasm.length;
plan.refereePublicKey = Buffer.from(
  createPublicKey(refereeKey(directory)).export({ format: "jwk" }).x!,
  "base64url",
).toString("hex");
writeFileSync(file, JSON.stringify(plan, null, 2), { mode: 0o600 });
console.log(
  JSON.stringify(
    {
      network: plan.network,
      accountId: plan.accountId,
      contractId: plan.contractId,
      wasmBytes: plan.wasmBytes,
      wasmSha256: plan.wasmSha256,
      faucet: "https://helper.testnet.near.org/account",
      minimumStorageNEAR:
        Math.ceil((plan.wasmBytes + 16000) * 1e-5 * 100) / 100,
      relayMethods: ["apply_receipt"],
      relayAllowanceTestNEAR: 2,
      privateKeys: "Saved only under git-ignored .data; not printed",
      executed: false,
    },
    null,
    2,
  ),
);
