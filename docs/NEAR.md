# NEAR testnet integration

## Deployment status

Deployed and verified on public NEAR testnet on 2026-11-12. No mainnet assets are used.

- Contract: [contrapasso-261112-a23809.testnet](https://testnet.nearblocks.io/address/contrapasso-261112-a23809.testnet)
- Deployment: [5yUzP5M6VCMMH8x25tMvSNKLue7STeB271QvXwxmVqw5](https://testnet.nearblocks.io/txns/5yUzP5M6VCMMH8x25tMvSNKLue7STeB271QvXwxmVqw5)
- WASM SHA-256: `1a779d74ca677e3658d2b3fd3773295cfa2e94836050145a011a8b52038a23d8`
- Latest code-only update: [4AGpJTHMu9142iQLZ9111Vpm2H4CfHi7DKn7VNhEdHsd](https://testnet.nearblocks.io/txns/4AGpJTHMu9142iQLZ9111Vpm2H4CfHi7DKn7VNhEdHsd), version 0.9.0. Existing state and 34 NFTs were preserved; [upgrade proof](testnet-upgrade-proof.json).
- Published code and referee public key were read back and matched. The local server is connected through a restricted relay key.
- Live verification passed: two guest champions played verified Solo, a permanent power was bought, defense was enabled, both Duel stakes were locked, and the winning replay paid the pool and updated both NFTs. Repeating a result did not award twice.
- A separate silent browser run earned 165 coin, then won its Duel and finished with 175 coin and a 1–0 record, confirmed directly from NFT metadata.
- Public transaction IDs and read-back evidence: [Solo and Duel](testnet-proof.json), [upgrades and wallet claims](testnet-features-proof.json), [mint and raffle](testnet-market-proof.json). The raffle proof confirms a 0.01-test-NEAR pool split into two 0.005 prizes, both withdrawn, and unpaid reservation refunds. Total funding was 10 free test NEAR; the original Solo/Duel snapshot measured about 0.047 in fees and 6.206 reserved for storage, before subsequent feature tests.

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

The browser records simulation `0.8.0` inputs. The local referee issues seeds and loadouts, replays every tick, and signs complete results. The contract accepts Ed25519-signed operations bound to its domain, contract, current NFT owner, champion revision, expiry and one-time receipt ID. The WASM verifies signatures with NEAR's native Ed25519 host function; the checked-in C adapter adds this function to the SDK 2 QuickJS bridge during the build and restores the SDK source afterward.

Local commits and relay requests are serialized. The durable outbox retries after network failures; an on-chain receipt lookup recovers a lost acknowledgement without awarding twice. Writes first synchronize NFT ownership and the chain's current vault. An externally transferred champion cannot continue using its old guest session. Invalid operations do not block unrelated champions' relays. The server imports existing local champions as a one-time signed migration checkpoint, preserving the owner's current progress.

Duel defenders opt in, must have played Solo, and need 10 coin. Matchmaking allows a power difference of at most `max(6, floor(challengerPower × 0.35))`; power includes skill ranks and equipped levels. The AI uses the defender's saved deepest Solo build and equipment. The fight lasts at most 90 simulation seconds, within a 10-minute challenge deadline. Progress checkpoints permit reconnecting to the same issued Duel. Restarting or closing the page does not refund a losing stake.

## Keys and trust boundaries

All runtime state and secrets are git-ignored under `.data/`; never publish or delete it casually.

| File                       | Purpose                                                                     |
| -------------------------- | --------------------------------------------------------------------------- |
| `state.json`               | Local champions, challenges, replays, receipts and ordered outbox           |
| `referee.pem`              | Ed25519 oracle signing key                                                  |
| `near-plan.json`           | Full-access contract owner key and restricted relay key for this deployment |
| `near.json`                | Testnet connection and the restricted runtime relay key                     |
| `near-smoke-sessions.json` | Private, resumable smoke-test guest cookies and issued challenge            |
| `near-guests.json`         | Custodial guest keys and implicit NFT owner addresses                       |

The runtime key can only call `apply_receipt` on this contract, with a 2 test NEAR gas allowance. It cannot deploy code, issue direct NEAR transfers or change the referee key. Valid signed receipts can trigger the contract's bounded sponsorship and prize transfers. The full-access owner key remains in the offline deployment plan.

This is a **custodial local demo**: guest keys are generated and held by the server, and normal play has no wallet popups. An implicit address can own NFTs before receiving NEAR. After verified Solo, a bounded contract grant can activate/fund a guest for one native testnet mint. The server uses that guest’s own key for the payable mint; it never loads the contract owner key into the web runtime.

The inventory UI can claim a champion to an existing testnet wallet. It waits for final confirmation before rotating the guest and is idempotent by source champion. Equipped gear, coin and native prizes follow the champion. A wallet owner can call payable `withdraw_prize({champion_id})` directly with exactly one yoctoNEAR and sufficient gas, independently of the referee, to withdraw its native prize vault. Guest playback through an external wallet, wallet import/export, recovery, production identity and production hosting remain future work.

The authorized referee is trusted to report valid gameplay and migration balances. Determinism and revision checks stop invented browser scores and replayed receipts; they do not make the oracle trustless or stop bots that actually play. A single contract owner controls upgrades and referee-key rotation. All mint payments, sponsorship and raffle prizes use free test NEAR. No mainnet value or real-money economy is enabled.

Available demo defenders are test champions built by recorded, verified bot Solo runs. Their matches are real replay-verifiable test matches, not evidence of human player activity.

## Arsenal and application treasury (0.6)

Current editions offer Cinder Requiem (long sword), Tollkeeper (war hammer), and Widow’s Fang (dagger). The 10-coin reservation binds the weapon identity, and the 0.01-test-NEAR mint creates that gear NFT. Actual equipped metadata determines the authenticated combat build, model, attack timing and damage. Every + level adds two weapon damage; upgrades and kill history remain on the NFT. Permanent skill purchases enforce the same three-branch prerequisites in the game, referee and contract; skills travel with the champion.

The owner retired the ticket-free `cinder-demo-1` round and moved its unallocated 0.01 test NEAR to the application treasury. New rounds reject ticket purchases and make no automatic prize allocation. Unpaid reservations still refund when an edition closes or is cancelled. Previous awarded prize vaults remain claimable. [Retirement proof](testnet-treasury-proof.json), [live weapon mint/equip/upgrade and skill proof](testnet-arsenal-proof.json).

`retire_raffles` is owner-only and refuses to retire an active round with paid ticket rights. `withdraw_treasury({receiver_id, amount})` requires the offline owner and one yoctoNEAR. It locks the requested amount, preserves native liabilities until successful completion, and restores the treasury on a failed transfer. The web runtime never loads the owner key. Only royalties actually received through `collect_royalty` credit the treasury.

`near:update` verifies the complete raw state at fixed finalized blocks, paging large snapshots before and after a code-only deployment. It never reinitializes the contract. Actual VM tests cover fresh 0.6 deployment and in-place upgrade from 0.5, including legacy prize rights and treasury callback failures. The live arsenal proof uses separate test champions; the original owner's 76-coin champion is preserved.

Within an authorized testnet scope: `npm run near:treasury -- --execute` retires the old edition, `npm run near:round -- --id <unique-edition> --seconds 86400 --execute` opens a new one, and `npm run near:arsenal-smoke -- --execute` resumes the saved arsenal proof. It must remain on the edition recorded in its private session.

## Native gear marketplace (0.7)

The built-in exchange pays royalties atomically; external NEP-199 quotes still require the external market to pay. Signed `list_gear`, `cancel_sale` and `buy_gear` operations bind ownership and a unique listing version. Buyers attach the exact native price from their own account. Listed gear cannot equip, transfer, enter a transfer callback or receive approvals. A completed purchase removes the listing, transfers the existing token and clears approvals, retaining level/kills and appending owner history.

`exchange_view({owner_id})` returns active listings and that account’s sale balance. Ninety percent belongs to the seller and ten percent credits the treasury. Native liability records the entire received amount until a successful withdrawal. `withdraw_sales` uses the guest receipt flow; `withdraw_sale_proceeds()` lets a wallet owner withdraw directly with one yoctoNEAR. Both share an account-level pending lock. Failed transfers restore proceeds, including any new credits arriving while the transfer is pending. Champion transfer does not transfer the selling account’s proceeds.

`close_edition()` lets the offline owner close a treasury edition early, refunding every unpaid coin reservation. It cannot close a legacy raffle. `near:round -- --id ranged-demo-1 --seconds 86400 --close-previous --execute` was used to start the ranged edition within the existing authorized testnet budget. Runtime servers cannot invoke these owner methods.

Both ranged weapons were minted and upgraded on public testnet. A real native purchase and seller withdrawal passed, including a same-intent retry with no second payment. [Exchange proof](testnet-exchange-proof.json). Fresh WASM and in-place 0.6→0.7 VM tests verify listing locks, stale quotes, paid replay protection, preserved nonzero kill history, royalties and withdrawals. The deployment preserves the serialized root and uses the existing market map prefix for exchange state.

Reproduce within authorized testnet scope with `npm run near:exchange-smoke -- --execute`. It resumes its private saved intents and edition; it is not a generic load test. Free testnet balances only; guest custody and external wallet gameplay limitations still apply.

## Expanded forge (0.8)

The same champion can now mint repeatedly in treasury editions, paying fresh coin access and native value each time. The reservation map retains one active/current entry per champion; the round's participant list stays unique, so close/cancel never refunds an already minted item twice. Unique serial token IDs preserve prior NFTs. Legacy raffle behavior stays unchanged. `open_round` accepts an owner-only `cap` from 1 to 1,000 (default 12 for compatibility); the CLI defaults to 100. There are still at most 50 distinct participants per round to bound refund work.

`expanded_arsenal` and `repeat_mint` advertise actual deployed support. Guillotine Hymn and Acheron Needle are accepted by the shared catalog, referee and contract, with metadata-selected combat builds. The API refuses these new mints on older deployments. `forge-demo-1` has 100 pieces and a seven-day window; the former treasury edition was closed with unpaid reservations refunded. [Forge verification](testnet-forge-proof.json). `npm run near:forge-smoke -- --execute` resumes the private existing test champion and never requests additional sponsorship.

A silent browser test separately minted and equipped the axe, completed a replay-verified Solo descent to circle three, and confirmed 31 kills on that same NFT. The daily coin cap credited zero additional coin; the vault stayed at 60.

Both fresh WASM and in-place 0.7→0.8 VM verification passed, including two different paid mints on one champion, retained coin accounting, distinct tokens and equipment metadata. The previous deployment evidence is [archived here](testnet-exchange-upgrade-proof.json).

## Historical mint and native prize accounting (0.5)

The following records the prior raffle implementation and historical proof. It is retained for existing prize rights; current editions use the treasury above.

Version 0.5 adds separate lookup-map prefixes without changing the serialized champion/NFT root. `near:update` deploys code only, compares the full raw state hash and NFT supply before/after, and never calls `init`. `game_config` advertises actual deployed features; the server does not trust a hand-edited local feature flag.

Owner-controlled `open_round({id, duration_seconds})` opens a unique edition after the previous draw. `npm run near:round -- --id cinder-demo --seconds 180` prepares a public request; add `--execute` only within the operator’s authorized testnet scope. The default duration is one day. The web runtime does not hold the owner key needed to open rounds.

Signed market receipts support reservation/cancellation, mint, tickets, draw, guest funding, withdrawal and gear equip/unequip. A reservation debits 10 earned coin, one per champion per round, with 12 editions. Native mint requires the current NFT owner as predecessor and exactly 0.01 test NEAR. A duplicate paid receipt rejects the whole transaction and its deposit; a zero-deposit receipt lookup/retry is idempotent. The server’s durable intent is saved before sending, uses a client UUID, debits local coin only after confirmation, and retains uncertain transactions for the same-id retry. Only a known final failure or a known pre-broadcast insufficient-balance error releases an unconfirmed intent.

Tickets cost 5 coin, with 10 per champion and 200 per round. After closure, a signed draw uses NEAR block randomness, weighted sampling without replacement, and up to three distinct champions. Equal shares plus an integer remainder exhaust the full pool. Unpaid reservations refund automatically in that draw; with no tickets the pool carries forward. The block and 32-byte entropy are public, and `selectWinners` in `contracts/market.js` reproduces selection. This is not a production VRF: timing and block production assumptions limit adversarial fairness.

The contract tracks native pool/prize liabilities. Prizes belong to champion IDs, so NFT transfer changes their beneficiary. A withdrawal clears the vault and locks the champion while its native promise is pending. A private callback releases liability only on success; on failure it restores the vault. Funding uses the same callback lock. The demo sponsorship is one 0.2-test-NEAR grant after Solo, at most six champions, and cannot consume prize liabilities or the minimum 0.5-test-NEAR free reserve. A receipt replay cannot schedule a second native transfer.

`nft_payout` / `nft_transfer_payout` quote NEP-199 payouts: 90% seller, 10% contract, preserving all units and enforcing the recipient limit. The marketplace is responsible for payment. Only native value actually attached to `collect_royalty` enters recorded raffle accounting; sending a quote or transferring an NFT alone does not create pool revenue.

With approved testnet writes, `npm run near:market-smoke -- --execute` uses private, resumable test sessions to exercise coin access/refund, sponsored native mint, same-id retry, gear metadata/equip, tickets, draw, unpaid reservation refund and both native withdrawals. It writes only public proof to `docs/testnet-market-proof.json`. Private cookies and intent progress remain under `.data/`.

## Soul core and active skills (0.9)

`attune` binds one owned Ember Edge, Ash Step or Iron Vow attunement to `build.core`. It costs no additional coin and cannot grant training. The signed operation enforces owner/revision checks and the existing Duel/transfer locks. The core is retained in champion transfers and in authenticated Solo/Duel loadouts; it is not taken from a browser preference. `soul_core` advertises actual deployed support.

The 27-bit replay codec adds cast and ultimate inputs. Soul Lance requires paid Ember Edge. Core energy begins at zero and is earned by actual damage, bounded by remaining target life. Ultimate pulses cannot fill their own energy meter. The referee reproduces casting, projectiles, timed area effects, healing and the weapon follow-up bonus at 60 Hz. Duel defenders use the same ability rules and fixed cast direction.

Fresh WASM and an in-place 0.8→0.9 upgrade passed the actual VM suite, including unowned-core rejection, Duel locks and core retention after NFT transfer. The 0.8 deployment record is [archived here](testnet-forge-upgrade-proof.json). Live proof: [soul combat verification](testnet-soul-proof.json). Reproduce only within the authorized testnet scope with `npm run near:soul-smoke -- --execute`; private sessions remain under `.data/`.

The live replay check cast 15 Soul Lances and six core ultimates, reached circle four with 61 kills, and rejected duplicate rewards. A separate silent browser run bought Ember Edge, attuned Furnace Heart, minted and equipped Vesper Reed, and recorded 46 kills on that same staff NFT. It reached circle three; the daily cap correctly credited no extra coin. Core choice survived both results. Transaction IDs and direct NFT read-back are in the proof above.
