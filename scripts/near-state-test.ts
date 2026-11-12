import assert from "node:assert/strict";
import { contractStateHash } from "./near-state.ts";
const entries = [
  { key: "YQ==", value: "MQ==" },
  { key: "Yg==", value: "Mg==" },
];
let calls = 0;
const paged = await contractStateHash(async (p) => {
  calls++;
  if (calls === 1) {
    assert.equal(p.finality, "final");
    return {
      block_hash: "fixed",
      values: [entries[0]],
      last_key: entries[0].key,
    };
  }
  assert.equal(p.block_id, "fixed");
  assert.equal(p.after_key_base64, entries[0].key);
  assert.equal(p.finality, undefined);
  return { block_hash: "fixed", values: [entries[1]] };
}, "example.testnet");
const whole = await contractStateHash(
  async () => ({ block_hash: "other", values: [...entries].reverse() }),
  "example.testnet",
);
assert.equal(paged, whole);
assert.equal(calls, 2);
await assert.rejects(
  contractStateHash(
    async () => ({
      block_hash: "fixed",
      values: [entries[0]],
      last_key: "same",
    }),
    "example.testnet",
  ),
  /Duplicate|advance/,
);
let n = 0;
await assert.rejects(
  contractStateHash(
    async () => ({
      block_hash: String(n++),
      values: [entries[0]],
      last_key: "next",
    }),
    "example.testnet",
  ),
  /block changed/,
);
console.log("STATE SNAPSHOT: PASS");
