import { access, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const directory = resolve(".data/tools");
await mkdir(directory, { recursive: true, mode: 0o700 });
try {
  await access(resolve(directory, "near-sandbox"));
} catch {
  const { Binary } = await import("near-sandbox");
  const { AWSUrl } = createRequire(import.meta.url)(
    "near-sandbox/getBinary.js",
  );
  await (await Binary.create("near-sandbox", AWSUrl(), directory)).install();
}
for (const args of [
  ["scripts/contract-build.mjs", "--fixtures"],
  ["scripts/contract-vm-test.mjs"],
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
