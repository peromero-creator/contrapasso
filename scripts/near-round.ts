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
  duration = Number(arg("--seconds", "86400")),
  cap = Number(arg("--cap", "100"));
if (
  !/^[a-z0-9-]{1,40}$/.test(id) ||
  !Number.isSafeInteger(duration) ||
  duration < 30 ||
  duration > 604800 ||
  !Number.isSafeInteger(cap) ||
  cap < 1 ||
  cap > 1000
)
  throw new Error("Invalid round");
const request = { id, duration_seconds: duration, cap };
if (!process.argv.includes("--execute")) {
  console.log(
    JSON.stringify(
      {
        network: "testnet",
        contractId: config.contractId,
        method: "open_round",
        args: request,
        closePrevious: process.argv.includes("--close-previous"),
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
  let closeTransaction: string | undefined;
  if (process.argv.includes("--close-previous")) {
    const current = await provider.callFunction<any>({
      contractId: config.contractId,
      method: "market_view",
      args: { champion_id: "" },
    });
    if (current.round && !current.round.drawn && current.round.id !== id) {
      if (current.revenueMode !== "treasury")
        throw new Error("Only treasury editions can be closed early");
      const closed = await account.callFunctionRaw({
        contractId: config.contractId,
        methodName: "close_edition",
        args: {},
        gas: 100000000000000n,
        waitUntil: "FINAL",
      });
      closeTransaction = closed.transaction.hash;
    }
  }
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
    closeTransaction,
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
