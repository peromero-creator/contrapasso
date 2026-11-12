# NEAR testnet integration

## Deployment status

Deployed and verified on public NEAR testnet on 2026-11-12. No mainnet assets are used.

- Contract: [contrapasso-261112-a23809.testnet](https://testnet.nearblocks.io/address/contrapasso-261112-a23809.testnet)
- Deployment: [5yUzP5M6VCMMH8x25tMvSNKLue7STeB271QvXwxmVqw5](https://testnet.nearblocks.io/txns/5yUzP5M6VCMMH8x25tMvSNKLue7STeB271QvXwxmVqw5)
- WASM SHA-256: `85578dfcacfe0a772bcf2d8c6c8926b598a4769d07ee9ac4907ab41b24c2dfc1`
- Published code and referee public key were read back and matched. The local server is connected through a restricted relay key.
- Live verification passed: two guest champions played verified Solo, a permanent power was bought, defense was enabled, both Duel stakes were locked, and the winning replay paid the pool and updated both NFTs. Repeating a result did not award twice.
- A separate silent browser run earned 165 coin, then won its Duel and finished with 175 coin and a 1–0 record, confirmed directly from NFT metadata.
- Public transaction IDs and read-back evidence: [testnet-proof.json](testnet-proof.json). Total funding was 10 free test NEAR; measured transaction fees were about 0.047 test NEAR and storage reserved about 6.206 test NEAR.

NEAR HACKATHON accepts testnet-only projects in every track (Q-010); public RPC is free (Q-009). No NEAR AI API key is needed for this game. RPC uses FASTNEAR with a dRPC fallback, both pinned to testnet. The legacy public NEAR endpoint returned deprecation/rate-limit errors during live verification and is no longer the default. See the [official provider list](https://docs.near.org/api/rpc/providers). See the [organizer's rules](https://nearhackathon.com/HACKATHON.md).

## Reproduce

Node.js 26 and npm are required. Rust is not required.

```sh
npm ci
npm test
npm run build
npm run contract:test
npm run near:prepare
```

`contract:test` downloads the official NEAR sandbox and the SDK's compiler binaries into project-local ignored directories, builds both WASM files, and exercises the compiled contract. The SDK expects pnpm in its install hook; `.npmrc` disables dependency hooks, and the contract build explicitly runs the required local compiler setup. Supported compiler targets are macOS and Linux; Windows needs a compatible environment. macOS Apple Silicon uses the SDK's x64 WASI compiler and may need Rosetta.

`near:prepare` creates or reuses a local plan, stores private keys under `.data/`, and prints only public deployment details. It creates no external account and signs nothing. Review the named testnet account, WASM hash, storage estimate and relay allowance.

Only after the owner explicitly authorizes deployment and test transactions:

```sh
npm run near:deploy -- --execute
```

The script verifies the testnet RPC, requests a free named account from the official helper, refuses to overwrite existing code, then atomically deploys, initializes and installs a relay key. It verifies the published code and referee key before writing `.data/near.json`. If the faucet is unavailable, it stops; no mainnet fallback is used. Restart `npm run dev` after installing the configuration. With authorization for live test transactions, run `npm run near:smoke -- --execute`: it creates two real guest champions, plays and verifies Solo replays at normal elapsed time, checks duplicate results, buys training, opts a defender in, plays a Duel, and reads both NFT records and vaults back from public testnet. It emits no audio. Test-session cookies and the issued Duel are kept privately in `.data/near-smoke-sessions.json` so a retry resumes rather than starting over. The public proof report is saved under `.data/near-smoke-report.json`; keys and session cookies are never logged.

## What lives on chain

- One champion NFT and two free starter gear NFTs per guest champion. Champion metadata includes its coin vault, permanent training, deepest Solo build, equipped token IDs, Solo record, Duel record and lock.
- Gear metadata includes kind, level, kill count and recent previous owners. Starter gear is bound to its champion; it cannot be transferred individually. The owner can unequip it before transferring the champion to retain that item.
- Champion transfers carry the equipped gear, vault, skills and record. Defense is disabled on transfer. `nft_transfer_call` locks mutation during its callback and returns the equipment with the champion if the receiver rejects it.
- NEP-171 core, NEP-177 metadata, NEP-178 approvals and NEP-181 enumeration interfaces, using `near-contract-standards` plus equipment-aware transfer guards. The local VM tests cover transfers, approvals, receiver acceptance and receiver return.
- Coin is an integer vault in the champion state, not a transferable fungible token. Only Solo creates coin, capped at 300 per UTC day. Training spends coin. Transfers carry the whole champion vault as designed.
- A Duel reserves 10 coin from each champion. Both NFTs and their builds are locked. The referee verifies the fight and the winner receives the escrowed 20; no coin is minted. Forfeit, simulation timeout and abandoned challenges are losses for the challenger. An unopened challenge whose testnet relay fails is reconciled without charging either chain vault.

## Referee and relay

The browser records simulation `0.3.0` inputs. The local referee issues seeds and loadouts, replays every tick, and signs complete results. The contract accepts Ed25519-signed operations bound to its domain, contract, current NFT owner, champion revision, expiry and one-time receipt ID. The WASM verifies signatures with NEAR's native Ed25519 host function; the checked-in C adapter adds this function to the SDK 2 QuickJS bridge during the build and restores the SDK source afterward.

Local commits and relay requests are serialized. The durable outbox retries after network failures; an on-chain receipt lookup recovers a lost acknowledgement without awarding twice. Writes first synchronize NFT ownership and the chain's current vault. An externally transferred champion cannot continue using its old guest session. Invalid operations do not block unrelated champions' relays. The server imports existing local champions as a one-time signed migration checkpoint, preserving the owner's current progress.

Duel defenders opt in, must have played Solo, and need 10 coin. Matchmaking allows a power difference of at most `max(6, floor(challengerPower × 0.35))`; power includes skill ranks and equipped levels. The AI uses the defender's saved deepest Solo build and equipment. The fight lasts at most 90 simulation seconds, within a 10-minute challenge deadline. Progress checkpoints permit reconnecting to the same issued Duel. Restarting or closing the page does not refund a losing stake.

## Keys and trust boundaries

All runtime state and secrets are git-ignored under `.data/`; never publish or delete it casually.

| File | Purpose |
| --- | --- |
| `state.json` | Local champions, challenges, replays, receipts and ordered outbox |
| `referee.pem` | Ed25519 oracle signing key |
| `near-plan.json` | Full-access contract owner key and restricted relay key for this deployment |
| `near.json` | Testnet connection and the restricted runtime relay key |
| `near-smoke-sessions.json` | Private, resumable smoke-test guest cookies and issued challenge |
| `near-guests.json` | Custodial guest keys and implicit NFT owner addresses |

The runtime key can only call `apply_receipt` on this contract, with a 2 test NEAR gas allowance. It cannot deploy code, transfer NEAR or change the referee key. The full-access owner key remains in the offline deployment plan.

This is a **custodial local demo**: guest keys are generated and held by the server, and normal play has no wallet popups. An implicit address can own NFTs before receiving NEAR; guest addresses are not funded or independently usable wallets yet. Wallet import/export, account recovery, claiming a champion in an external wallet, production identity and production hosting are unfinished. NFT ownership and transfer semantics are tested at the contract level, but there is no transfer UI yet.

The authorized referee is trusted to report valid gameplay and migration balances. Determinism and revision checks stop invented browser scores and replayed receipts; they do not make the oracle trustless or stop bots that actually play. A single contract owner controls upgrades and referee-key rotation. No mainnet value, raffle, mint sale, royalties or real-money economy is enabled.

Available demo defenders are test champions built by recorded, verified bot Solo runs. Their matches are real replay-verifiable test matches, not evidence of human player activity.
