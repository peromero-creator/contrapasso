import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const sdk = "node_modules/near-sdk-js";
try {
  await access(`${sdk}/lib/cli/deps/qjsc`);
} catch {
  const setup = spawnSync(process.execPath, ["lib/cli/post-install.js"], {
    cwd: sdk,
    stdio: "inherit",
  });
  if (setup.status !== 0)
    throw new Error("Project-local contract compiler setup failed");
}
await mkdir("build", { recursive: true });
async function run(args) {
  const file = `${sdk}/builder/builder.c`;
  const original = await readFile(file);
  try {
    if (args.includes("transpileJsAndBuildWasm")) {
      let source = original.toString().replaceAll("\r\n", "\n");
      const marker = "static JSValue near_read_register";
      const registration = '  JS_SetPropertyStr(ctx, global_obj, "env", env);';
      if (!source.includes(marker) || !source.includes(registration))
        throw new Error("Unsupported SDK bridge source");
      source = source.replace(
        marker,
        (await readFile("contracts/ed25519-host.c", "utf8")) + "\n" + marker,
      );
      source = source.replace(
        registration,
        '  JS_SetPropertyStr(ctx, env, "ed25519_verify", JS_NewCFunction(ctx, near_ed25519_verify, "ed25519_verify", 3));\n' +
          registration,
      );
      await writeFile(file, source);
    }
    const result = spawnSync(process.execPath, args, { stdio: "inherit" });
    if (result.status !== 0)
      throw new Error(`Contract build step failed: ${args[1] ?? args[0]}`);
  } finally {
    await writeFile(file, original);
  }
}
await run([
  "node_modules/typescript/bin/tsc",
  "--project",
  "contracts/tsconfig.json",
]);
await run([
  `${sdk}/lib/cli/cli.js`,
  "validateContract",
  "contracts/contract.ts",
]);
await run([
  `${sdk}/lib/cli/cli.js`,
  "createJsFileWithRollup",
  "contracts/contract.ts",
  "build/contrapasso.wasm",
]);
await run([
  `${sdk}/lib/cli/cli.js`,
  "transpileJsAndBuildWasm",
  "build/contrapasso.wasm",
]);
if (process.argv.includes("--fixtures")) {
  await run([
    `${sdk}/lib/cli/cli.js`,
    "createJsFileWithRollup",
    "contracts/test-receiver.ts",
    "build/test-receiver.wasm",
  ]);
  await run([
    `${sdk}/lib/cli/cli.js`,
    "transpileJsAndBuildWasm",
    "build/test-receiver.wasm",
  ]);
}
