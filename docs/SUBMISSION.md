# Demo and delivery

## Project description

**Contrapasso** is a browser action roguelike where the champion you build becomes someone else’s punishment. Descend through five circles, earn coin, take permanent vows and temper your gear. In asynchronous Duel, another player fights your saved champion’s actual build.

The champion is also a dynamic NEAR NFT: it carries equipped NFTs, its earned coin, its combat record and a native prize vault. Limited weapon mints require gameplay-earned access; their full testnet revenue enters the application treasury. All monetary amounts in this demo are free test NEAR.

Tracks: `games` and `nfts`.

## Five-minute demo sequence

1. Open the title screen, take the descent, and show movement, aiming, a heavy third swing, dash and the vitality bar.
2. Clear a circle, choose a rank for an unlocked power and descend through the lit gate. At the end, show replay verification and the confirmed coin save.
3. Open Train Champion, show the connected skill paths, unlock a permanent skill with coin, or temper an equipped item. Show its updated dynamic NFT metadata in What You Own.
4. Open Duel, choose a matched funded defender and show the rival health bar. Explain the 10+10 coin escrow and saved-build opponent. A completed or forfeited match settles the record and existing coin pool.
5. Open the Reliquary. Show limited supply, a coin reservation, demo funding, a native paid mint, seven distinct tradable weapon identities, repeatable earned mints, a silent attack preview and the transparent application treasury. Equip a relic in What You Own and show it in combat.
6. Open Player Market, show a listed relic’s level and kill history, buy it with test NEAR and equip the same NFT. Show seller proceeds and the 10% treasury share. There are no raffle tickets.
7. Show the wallet-claim form and explain that the equipped inventory and both vaults move with the champion. Use a disposable test champion for an actual claim.

Use `?silent=1` when recording silent footage. The development bot (`&autoplay=1`) is a test aid, not evidence of human difficulty balance; it waits for manual power choices. Available demo defenders are verified bot-built test champions.

## Evidence and reproduction

- Public contract: [contrapasso-261112-a23809.testnet](https://testnet.nearblocks.io/address/contrapasso-261112-a23809.testnet).
- [Solo / Duel proof](testnet-proof.json).
- [Code update with state preservation](testnet-upgrade-proof.json).
- [Upgrade / wallet claim proof](testnet-features-proof.json).
- [Weapon mint / upgrades / skill paths](testnet-arsenal-proof.json).
- [Ranged weapons and native resale](testnet-exchange-proof.json).
- [Treasury transition](testnet-treasury-proof.json).
- [Repeated mint and new melee weapon proof](testnet-forge-proof.json).
- [Historical mint / raffle proof](testnet-market-proof.json).
- `npm ci`, `npm test`, `npm run build`, `npm run contract:test`.
- `npm run dev`; open `http://127.0.0.1:5173/?silent=1`.
- A fresh clone runs Solo locally. Live writes need the operator’s private testnet configuration; no keys are distributed in the repository. See [NEAR setup](NEAR.md).

## Delivery checklist

- [x] Local game and referee, deterministic replays and silent mode.
- [x] Dynamic NFTs, vaults, upgrades, inventory and wallet claiming.
- [x] Asynchronous Duel, escrow, records and transfer locks.
- [x] Testnet limited mint and application treasury, with legacy prize rights preserved.
- [x] Seven tradable weapon archetypes, including two ranged classes, with in-hand models and attack animations.
- [x] Native player marketplace, retained NFT traits and seller withdrawals.
- [x] Twelve coin-unlocked skills, healing pickups and ambient inhabitants.
- [x] Original project art, optimized models and painted floors.
- [x] MIT code license and dependency/art credits.
- [ ] Record and upload the final video.
- [ ] Select hosting or provide local demo instructions with the video.
- [ ] Publish the repository and add its actual URL.
- [ ] Review the organizer’s current form and publish/submit only when the owner is ready.

## Limits to explain

The server holds guest keys and is the trusted gameplay referee. Claiming sends a champion to a wallet; playing through an external wallet, recovery and production identity are future work. The built-in exchange pays the 10% royalty atomically; external royalty quotations still require their marketplace to honor and pay them. This is a testnet demo with no real-money economy.
