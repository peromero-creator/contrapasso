# Contrapasso

A browser action roguelike for NEAR HACKATHON (`games` and `nfts`). Descend through five circles, build a champion, then fight another player's saved champion in an asynchronous Duel.

## Run

Requires Node.js 26 and npm.

```sh
npm ci
npm run dev
```

Open [localhost:5173](http://127.0.0.1:5173/). This starts the game and local referee together. A fresh checkout runs Solo locally; testnet writes require your own configured server credentials. See [NEAR setup](docs/NEAR.md).

1. **Take the Descent → Solo** starts a server-issued run. WASD moves, mouse aims, hold click attacks, Space dashes. Every third swing is heavy.
2. Clear a circle → choose one of three powers with the mouse or **1 / 2 / 3** → enter the lit gate. Powers stack to rank 3.
3. Finish → the referee verifies the replay and saves earned coin. **Train Champion** buys a permanent starting power. **Try Same Descent** repeats the seed and loadout.
4. With testnet connected, **Duel** lists matched defenders. Both vaults stake 10 coin; the winner takes 20. Fights last up to 90 seconds. Forfeit or abandonment loses the challenger stake. Enable defense to let others challenge your build.

Escape pauses; losing focus also pauses. R restarts Solo. Sound defaults off; M enables it. [Silent mode](http://127.0.0.1:5173/?silent=1) hard-disables audio. The development-only `?silent=1&autoplay=1` bot still requires manual power choices.

## Features and status

- Deterministic 60 Hz combat, five circles, enemy waves and Warden.
- Eight ranked powers, permanent training, saved progress and a 300-coin daily Solo cap.
- Replay-verifying referee, Ed25519 receipts and durable transaction retries.
- Champion and starter gear NFTs, a champion-owned coin vault, transfer-aware equipment and Duel records.
- Asynchronous Duel with saved builds, power matching, defense, escrow, rival health bar and reconnect checkpoints.
- Local GLB animation merging, Meshopt compression and runtime model fallback.

Deployed on [NEAR testnet](https://testnet.nearblocks.io/address/contrapasso-261112-a23809.testnet). Solo, training, duplicate-result handling and Duel payout passed live verification; [public evidence](docs/testnet-proof.json) includes transaction IDs and NFT read-backs.

The current art is procedural placeholder geometry. Gear upgrades, limited mints, raffle/royalties, external wallet claiming and hosting remain planned. This is a custodial local demo: the server holds guest keys and signs gameplay results. No real-money economy is enabled. See [contract details and trust boundaries](docs/NEAR.md).

## Verification

```sh
npm test
npm run build
npm run contract:test
```

Tests cover combat/powers, deterministic replays, referee validation and persistence, reward caps, Duel fairness and coin conservation, relay recovery, asset processing, and compiled NFT transfers/approvals/callbacks. The build type-checks browser and server code.

For a production-bundle preview, run `npm run referee` and `npm run preview` in separate terminals. The referee binds to loopback. Local progress and keys are under ignored `.data/`; deleting it destroys the save and breaks the configured signing identity.

## Documentation

- [Game design and planned economy](docs/DESIGN.md)
- [NEAR setup, deployment and trust boundaries](docs/NEAR.md)
- [Art inputs and processing](docs/ART.md)

## Credits

TypeScript, Vite, three.js, NEAR SDK JS / contract standards / near-api-js / near-workspaces, glTF Transform and meshoptimizer. Typography: Barlow and Barlow Condensed via Google Fonts. Development tools include Claude Code and Codex.

Arena geometry, placeholder actors, interface icons and synthesized effects were created for this project. The Divine Comedy provides public-domain circle names and the contrapasso idea; the protagonist and game are original. Google Flow and Meshy are planned art tools and have not supplied shipped assets. Preserve actual asset licenses when adding exports. Project license/attribution is pending.
