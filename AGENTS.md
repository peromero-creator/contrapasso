# Contrapasso — handoff for the next coding agent

Read this file first, then `docs/DESIGN.md`. It tells you what the project is, the rules you must not break, what already works and what to build next.

## What this is

Contrapasso is a browser action roguelike for **NEAR HACKATHON** (tracks: `games` and `nfts`).
The hero descends through their own hell, one circle at a time. Whatever a player builds comes back as someone else's punishment: your champion becomes an opponent other players fight.

- Development and submission deadline: **2026-11-14 23:59 UTC** (2026-11-15 02:59 Istanbul).
- Hackathon rules: https://nearhackathon.com/HACKATHON.md (re-read before submitting).
- Work started on 2026-11-12. All code in this folder was written inside the hackathon window.

## Rules you must not break

1. **Never without the owner's explicit yes:** send the hackathon submission, post on X, make the repo public, push, sign transactions, spend tokens, deploy to mainnet, install system toolchains.
2. **No secrets in git.** `.env` holds `MESHY_API_KEY` and is git-ignored. Never print the key, never copy it into another file.
3. **Go easy on Meshy credits.** Balance was 2125 at handoff. Budget for the whole game is about 400. Check `GET https://api.meshy.ai/openapi/v1/balance` before a batch. Costs: textured image-to-3D 30 (low-poly smart-topology 5, plus 10 for textures), rig 5, each animation 3. Docs index: https://docs.meshy.ai/llms.txt
4. **The game must be original.** The Divine Comedy is public domain and gives us the circles. Do not copy the name, characters, art or look of Hades or of EA's 2010 "Dante's Inferno". The hero is not Dante.
5. **Keep the simulation deterministic** (see "Simulation rules" below). The anti-cheat design depends on it.
6. Game UI and README are in **English** (international judges). The owner speaks Turkish; talk to the owner in Turkish.
7. Testnet only. NEAR Intents has no testnet, so do not build on it for this game.

## Run and test

```bash
npm install
npm run dev          # http://localhost:5173
node scripts/simtest.ts   # a bot plays 4 seeds twice; must print PASS
npm run typecheck
```

Controls: WASD move, mouse aim, click attack (every third swing is heavy), Space dash, R restart.

## What exists (2026-11-12)

| File | What it does |
|---|---|
| `src/sim/world.ts` | The whole combat simulation at a fixed 60 Hz: hero move, dash, melee; enemies `imp`, `archer`, `brute` and the boss `warden`; waves; 5 floors joined by a portal; coins on kill. |
| `src/sim/dirs.ts` | 1024-direction lookup table (rounded so every JS engine agrees). |
| `src/render/view.ts` | three.js scene: arena, placeholder shapes for every actor, tilted fixed camera, bloom, hit sparks, camera shake, one colour mood per circle. |
| `src/main.ts` | Input, fixed-step loop, hit-stop, per-tick replay log, HUD, landing page → mode choice → run. |
| `src/ui/style.css`, `index.html` | Landing page ("CONTRAPASSO", Play), mode cards (Solo live, Duel locked), HUD, end screen. |
| `scripts/simtest.ts` | Headless determinism and sanity test. |

Verified: the page loads, the landing slides up, Solo starts, the scene renders, enemies spawn and chase, the bot test passes.
**Not verified:** nobody has played it by hand yet. Combat feel and balance are untested (the test bot dies on floor 3 after about 50 seconds).

Not built yet: skills, coin spending, "+" upgrades, any contract, the referee server, the duel, mint/tickets/raffle, real 3D models, painted floors, sound, README, LICENSE.

## Simulation rules (do not break)

- Nothing in `src/sim/` may touch the DOM, three.js, `Date`, `Math.random` or trigonometry (`sin`, `cos`, `atan2`). Use `rand(world)` and the `DX`/`DZ` tables. `Math.sqrt` and plain arithmetic are fine.
- The sim advances only through `step(world, input)`. One call is one tick of 1/60 s.
- An `Input` is `{ move, aim, attack, dash }` with `move`/`aim` as direction indexes (0..1023, `move = -1` to stand still). `main.ts` packs each tick's input into one integer in `replay`.
- Rendering reads the world and never writes to it. Visual randomness (particles, shake) lives in `view.ts` only.
- Imports inside `src/sim/` use the `.ts` extension so Node can run the sim directly.
- After any sim change run `node scripts/simtest.ts`.

## Next steps, in priority order

If time runs out, cut from the bottom.

1. **Feel and balance.** Have the owner play. Tune speeds, damage, wave sizes. Add a little sound.
2. **Skills.** After each floor offer 1 of 3 powers (about 8 total). Each power needs a player effect and, later, a boss attack pattern (see the duel). Permanent skills are bought with coin and live on the champion.
3. **Art pipeline.** Concept images from Google Flow (the owner's account), then the Meshy API: image-to-3D → rigging → preset animations → GLB. Write a script that merges clips, compresses for the web (gltf-transform) and writes an asset manifest; `view.ts` loads GLBs and keeps the placeholder shape when a file is missing. Needed: hero (reused as the boss, scaled and tinted) with idle, run, attack, dash, death; two enemy models; a sword; a few props; one painted floor image per circle. If the hero model is not ready by the evening of 2026-11-13, use CC0 packs instead and list them in the README.
4. **Referee server** (Node). It receives `seed` + packed inputs, replays the run with the same sim code and signs the result. Contracts accept only signed results.
5. **Contracts on NEAR testnet.** Champion NFT, gear NFT, coin, "+" upgrade, duel stake. This machine has no Rust toolchain (`cargo`, `near`, `cargo-near` are missing): ask the owner before installing, or use near-sdk-js.
6. **Duel tab.** Fight another player's champion, played by the AI with that player's gear and skills. Win/loss is written to the champion NFT.
7. **Mint, tickets and raffle.** Last piece; if it does not fit, describe it in the README as the designed economy.
8. **Players never notice the chain.** Guest account, no wallet popups or gas prompts in the normal loop.
9. **Submission pack.** English README with "do X → see Y" steps, a LICENSE (ask the owner which name to put on it), a list of tools and assets used (Meshy, Google Flow, any CC0 packs), a short demo video, optionally a hosted demo. The owner posts on X and confirms the exact submission payload.

## Waiting on the owner

- Play the build and say how the combat feels.
- Confirm or change the proposed defaults in `docs/DESIGN.md` ("Proposed defaults").
- Art direction for the hero before any Meshy credits are spent.
- Permission to install Rust when the contracts start.
- The name for the LICENSE, the NEAR payout account, and the final yes for the repo, the X post and the submission.
