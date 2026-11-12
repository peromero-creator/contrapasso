import { FailoverRpcProvider, JsonRpcProvider } from "near-api-js";

export const TESTNET_RPC_URL = "https://test.rpc.fastnear.com";
export const TESTNET_RPC_URLS = [
  TESTNET_RPC_URL,
  "https://near-testnet.drpc.org",
  "https://rpc.testnet.near.org",
  "https://archival-rpc.testnet.near.org",
];
/** Every fallback is pinned to testnet. Re-sending an identical signed transaction retains its hash/nonce. */
export function testnetProvider(requested = TESTNET_RPC_URL) {
  if (!TESTNET_RPC_URLS.includes(requested))
    throw new Error("Unsupported testnet RPC");
  // The legacy public endpoint now returns deprecation/rate-limit errors.
  const primary =
    requested === "https://rpc.testnet.near.org" ? TESTNET_RPC_URL : requested;
  return new FailoverRpcProvider(
    [
      ...new Set([primary, TESTNET_RPC_URL, "https://near-testnet.drpc.org"]),
    ].map(
      (url) =>
        new JsonRpcProvider({ url }, { retries: 1, wait: 400, backoff: 1.5 }),
    ),
  );
}
