# Contrapasso

A browser action roguelike for NEAR HACKATHON (`games` and `nfts`). Descend through five circles, build a champion, then fight another player's saved champion in an asynchronous Duel.

## Run

Requires Node.js 26 and npm.

```sh
npm ci
npm run dev
```

Open [localhost:5173](http://127.0.0.1:5173/). This starts the game and local referee together. A fresh checkout runs Solo locally; testnet writes require your own configured server credentials. See [NEAR setup](docs/NEAR.md).

1. **Take the Descent → Solo** starts a server-issued run. WASD moves, mouse aims, hold click attacks, Space dashes. Every third attack has a weapon-specific finisher.
2. Unlock skills with Solo coin in the three-path skill tree. Clear a circle → choose a rank for one of your unlocked powers with the mouse or **1 / 2 / 3** → enter the lit gate. Powers stack to rank 3.
3. Finish → the referee verifies the replay and saves earned coin. **Train Champion** opens the coin-funded skill tree. **Try Same Descent** repeats the seed and loadout.
4. **Train Champion** also tempers equipped gear from +0 to +9 with earned coin. **What You Own** lists dynamic NFTs, equips relics and claims a champion into an existing testnet wallet.
5. **The Reliquary** reserves a chosen long sword, war hammer, dagger, hand crossbow, soul staff, executioner axe or war spear with 10 coin, then mints it for 0.01 test NEAR. The current edition has 100 pieces; repeated mints each require fresh coin access and native payment. A bounded demo grant covers guest testnet gas. Mint revenue stays in the owner-controlled application treasury; there are no new tickets or raffle distributions.
6. **Player Market** lists unequipped tradable weapon NFTs for 0.001–1 test NEAR. Purchases preserve the token’s upgrades and history; 90% becomes seller proceeds and 10% enters the treasury. Withdraw proceeds from the same screen.
7. With testnet connected, **Duel** lists matched defenders. Both vaults stake 10 coin; the winner takes 20. Fights last up to 90 seconds. Forfeit or abandonment loses the challenger stake. Enable defense to let others challenge your build.

Escape pauses; losing focus also pauses. R restarts Solo. Sound defaults off; M enables it. [Silent mode](http://127.0.0.1:5173/?silent=1) hard-disables audio. The development-only `?silent=1&autoplay=1` bot still requires manual power choices.

## Features and status

- Deterministic 60 Hz combat, five circles, enemy waves and Warden.
- Twelve ranked skills in three prerequisite paths, coin-funded unlocks, saved progress and a 300-coin daily Solo cap.
- Replay-verifying referee, Ed25519 receipts and durable transaction retries.
- Dynamic champion/gear NFTs, coin-funded + upgrades, transfer-aware inventory, wallet claiming, coin and native prize vaults.
- Limited native testnet mints, refundable coin reservations, transparent application treasury and NEP-199 royalty quotations. Legacy prize withdrawals remain available to their owners.
- Asynchronous Duel with saved builds, power matching, defense, escrow, rival health bar and reconnect checkpoints.
- Seven tradable weapon archetypes, dark model portraits and a silent attack preview.
- NFT weapons with distinct reach, speed, damage and matching hand-attached models/animations. Upgrades and kill history remain on the token.
- A wider arena, restorative blood vessels, five distinct perimeter compositions, carved funerary niches, an ambient ferryman and many-faced shore spider.
- 2.5D presentation: an orthographic camera over painted floors, matte outlined characters, blob shadows, restrained hit feedback, knockback, blood splats and engraved vitality readouts.
- Art pipeline: concept images, Meshy image-to-3D with rig and preset animations, then local clip trimming, Meshopt compression and a runtime fallback to placeholder shapes.

Deployed on [NEAR testnet](https://testnet.nearblocks.io/address/contrapasso-261112-a23809.testnet). Solo, training, duplicate-result handling and Duel payout passed live verification; [public evidence](docs/testnet-proof.json) includes transaction IDs and NFT read-backs.

Live verification also covers [gear upgrades and wallet claims](docs/testnet-features-proof.json), plus [the previous mint/raffle revision](docs/testnet-market-proof.json). [The arsenal proof](docs/testnet-arsenal-proof.json) verifies mint, equip, +1 and authenticated combat loadouts for the hammer and dagger. [Treasury retirement](docs/testnet-treasury-proof.json) preserves old prize rights. New editions use the treasury; historical evidence remains for existing payout rights. [Ranged weapon and exchange proof](docs/testnet-exchange-proof.json) covers native resale, retained traits, duplicate retries and seller withdrawals. [Forge proof](docs/testnet-forge-proof.json) covers repeated earned mints and both new melee classes. The latest code update preserved existing contract state and NFTs.

Hosting, wallet sign-in/recovery and production randomness remain open. This is a custodial local demo: the server holds guest keys and signs gameplay results. All mint payments, funding and treasury balances use free test NEAR. No real-money economy is enabled. See [contract details and trust boundaries](docs/NEAR.md).

## Verification

```sh
npm test
npm run build
npm run contract:test
```

Tests cover combat/powers, deterministic replays, referee validation and persistence, reward caps, Duel fairness and coin conservation, relay recovery, asset processing, and compiled NFT transfers/approvals/callbacks, native mint replay protection, travelling bolts, piercing and fan attacks, stale sale quotes, listing locks, preserved NFT traits, seller withdrawals, weapon identities, skill prerequisites, reservation refunds, treasury conservation, failed payout restoration and royalty splits. The build type-checks browser and server code.

For a production-bundle preview, run `npm run referee` and `npm run preview` in separate terminals. The referee binds to loopback. Local progress and keys are under ignored `.data/`; deleting it destroys the save and breaks the configured signing identity.

## Documentation

- [Game design and testnet economy](docs/DESIGN.md)
- [NEAR setup, deployment and trust boundaries](docs/NEAR.md)
- [Art inputs and processing](docs/ART.md)
- [Demo and delivery checklist](docs/SUBMISSION.md)

## Credits

TypeScript, Vite, three.js, NEAR SDK JS / contract standards / near-api-js / near-workspaces, glTF Transform and meshoptimizer. Typography: Cinzel, Barlow and Barlow Condensed via Google Fonts.

The title illustration, weapon and ambient-creature concepts, five painted floors and character concept images were generated with Google Flow (Nano Banana 2.1). The hero and enemy models, rigs and animation clips were generated with Meshy from those concepts (`art/source/`). Interface icons, effects and fallback placeholder actors were created for this project. The Divine Comedy provides public-domain circle names and the contrapasso idea; the protagonist and game are original. Preserve actual asset licenses when adding exports. Source code is [MIT licensed](LICENSE), © 2026 peromero-creater. Generated project art retains the applicable Flow/Meshy service terms; third-party dependencies retain their own licenses.
