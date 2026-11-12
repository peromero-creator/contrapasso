# Project conventions

Read `docs/DESIGN.md` for game rules and `docs/NEAR.md` for contract behavior and trust boundaries. If `.local/HANDOFF.md` exists, read it before continuing an existing checkout.

## Development

Requires Node.js 26 and npm. `npm ci` installs dependencies. `npm run dev` starts Vite on 5173 and the local referee on 8787; check for an existing server before starting another.

```sh
npm test
npm run build
npm run contract:test
```

The last command compiles and tests WASM in a project-local NEAR sandbox. No global Rust installation is required. See `docs/ART.md` for asset processing.

## Simulation

- `src/sim/` is shared by client and referee. Keep it deterministic: no DOM, three.js, `Date`, `Math.random` or trigonometry; use seeded randomness and `DX`/`DZ` lookup tables.
- Only `step(world, input)` advances simulation, at one tick per call / 60 Hz. Rendering reads state without mutating it.
- Inputs use the versioned 27-bit codec in `src/sim/input.ts`. Bump `SIM_VERSION` for released rule or replay changes. Keep `.ts` extensions on sim imports so Node can run them directly.
- Run the simulation/replay tests after combat changes.

## Repository and runtime

- Keep UI and public documentation in English. Browser tests use `?silent=1`; sound defaults off and silent mode must remain a hard audio lock.
- Secrets and local state belong in ignored `.env` / `.data/`. Never print credentials or delete existing saves/signing keys. Keep machine settings, logs and private handoff notes outside Git.
- Testnet only. Transactions, spending, deployment, repository publication/push and submission require the owner's authorization. Existing checkout-specific approvals are recorded in the private handoff; do not request the same approval twice.
- Keep dependency/asset credits accurate. Planned art generation and economy features must not be described as shipped.
