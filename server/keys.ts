import {
  createPrivateKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export function refereeKey(directory: string): KeyObject {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, "referee.pem");
  try {
    return createPrivateKey(readFileSync(file));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const key = generateKeyPairSync("ed25519").privateKey;
  writeFileSync(file, key.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
    flag: "wx",
  });
  return key;
}
