import { readFileSync, writeFileSync } from "node:fs";
import { Account, KeyPairSigner } from "near-api-js";
import { testnetProvider } from "../server/rpc.ts";
const config = JSON.parse(readFileSync(".data/near.json", "utf8"));
if (config.network !== "testnet" || !config.contractId.endsWith(".testnet"))
  throw new Error("Testnet only");
const provider = testnetProvider(config.rpcUrl);
if ((await provider.viewNodeStatus()).chain_id !== "testnet")
  throw new Error("Wrong network");
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const id = arg("--id", `cinder-${Date.now().toString(36)}`),
  duration = Number(arg("--seconds", "86400"));
if (
  !/^[a-z0-9-]{1,40}$/.test(id) ||
  !Number.isSafeInteger(duration) ||
  duration < 30 ||
  duration > 604800
)
  throw new Error("Invalid round");
const request = { id, duration_seconds: duration };
if (!process.argv.includes("--execute")) {
  console.log(
    JSON.stringify(
      {
        network: "testnet",
        contractId: config.contractId,
        method: "open_round",
        args: request,
      },
      null,
      2,
    ),
  );
} else {
  const plan = JSON.parse(readFileSync(".data/near-plan.json", "utf8"));
  if (plan.accountId !== config.contractId) throw new Error("Owner mismatch");
  const account = new Account(
    config.contractId,
    provider,
    KeyPairSigner.fromSecretKey(plan.secretKey),
  );
  const outcome = await account.callFunctionRaw({
    contractId: config.contractId,
    methodName: "open_round",
    args: request,
    gas: 100000000000000n,
    waitUntil: "FINAL",
  });
  const view = await provider.callFunction<any>({
    contractId: config.contractId,
    method: "market_view",
    args: { champion_id: "" },
  });
  const proof = {
    network: "testnet",
    contractId: config.contractId,
    transaction: outcome.transaction.hash,
    round: view.round,
    verifiedAt: new Date().toISOString(),
  };
  writeFileSync(
    ".data/near-round-report.json",
    JSON.stringify(proof, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(proof, null, 2));
}
