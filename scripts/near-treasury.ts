import { readFileSync, writeFileSync } from "node:fs";
import { Account, KeyPairSigner } from "near-api-js";
import { testnetProvider } from "../server/rpc.ts";
const config = JSON.parse(readFileSync(".data/near.json", "utf8"));
if (config.network !== "testnet" || !config.contractId.endsWith(".testnet"))
  throw new Error("Testnet only");
const provider = testnetProvider(config.rpcUrl);
if ((await provider.viewNodeStatus()).chain_id !== "testnet")
  throw new Error("Wrong network");
const view = () =>
  provider.callFunction<any>({
    contractId: config.contractId,
    method: "market_view",
    args: { champion_id: "" },
  });
const before = await view();
if (
  before.round &&
  !before.round.drawn &&
  Object.values(before.round.tickets).some((n) => Number(n) > 0)
)
  throw new Error("Settle existing ticket rights before retirement");
const report: any = {
  network: "testnet",
  contractId: config.contractId,
  before: {
    round: before.round?.id,
    mode: before.revenueMode,
    unpaid: before.round?.reserved,
    poolYocto: before.round?.poolYocto,
    treasuryYocto: before.treasuryYocto,
  },
};
if (!process.argv.includes("--execute"))
  console.log(
    JSON.stringify(
      {
        ...report,
        method: "retire_raffles",
        note: "Refund unpaid reservations; preserve native prize liabilities; carry unallocated revenue to owner-controlled treasury",
      },
      null,
      2,
    ),
  );
else {
  const plan = JSON.parse(readFileSync(".data/near-plan.json", "utf8"));
  if (plan.accountId !== config.contractId) throw new Error("Owner mismatch");
  const account = new Account(
    config.contractId,
    provider,
    KeyPairSigner.fromSecretKey(plan.secretKey),
  );
  if (before.revenueMode !== "treasury") {
    const result = await account.callFunctionRaw({
      contractId: config.contractId,
      methodName: "retire_raffles",
      args: {},
      gas: 100000000000000n,
      waitUntil: "FINAL",
    });
    report.transaction = result.transaction.hash;
  }
  const after = await view();
  if (after.revenueMode !== "treasury")
    throw new Error("Treasury read-back failed");
  report.after = {
    mode: after.revenueMode,
    treasuryYocto: after.treasuryYocto,
    roundClosed: after.round?.drawn,
  };
  report.verifiedAt = new Date().toISOString();
  writeFileSync(
    "docs/testnet-treasury-proof.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
