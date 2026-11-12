# Art pipeline

Shipped art: a title illustration, five painted floors and concept images from Google Flow, plus animated characters and a blade prop from Meshy (`scripts/meshy.mjs` runs image-to-3D, rigging and preset animations through the Meshy API and needs `MESHY_API_KEY` in `.env`; it spends credits). `npm run assets` only processes local files: it does not call any service or read keys. Placeholder shapes remain as the fallback when a model is missing.

Per model, `art.config.json` may also set `textureSize` (downscale textures; uses macOS `sips`) and `windows` (seconds of a clip to keep per state, for example `{ "attack": [0.35, 0.85] }`). At load time the game removes horizontal root motion from the `Hips` bone so characters stay on their simulation position.

## Inputs

Obtain an approved hero concept before spending any generation credits. Export a rigged GLB and separate, **in-place** animation GLBs from the same rig and rest pose. Keep node/bone names unchanged.

The hero needs `idle`, `run`, `attack`, `dash` and `death`. Enemy clips may reuse those names; missing states fall back to `idle`. The hero model is reused for the Warden when no separate `warden` asset is provided, with a larger scale and purple tint.

Keep source files outside the web build, for example under `art/source/`. Configure `art.config.json`:

```json
{
  "output": "public/assets",
  "models": {
    "hero": {
      "source": "art/source/hero.glb",
      "height": 2.2,
      "rotationY": 90,
      "clips": {
        "idle": "art/source/hero-idle.glb",
        "run": "art/source/hero-run.glb",
        "attack": "art/source/hero-attack.glb",
        "dash": "art/source/hero-dash.glb",
        "death": "art/source/hero-death.glb"
      },
      "requiredClips": ["idle", "run", "attack", "dash", "death"],
      "credit": {
        "author": "Fill with actual author",
        "license": "Fill with actual license",
        "source": "Fill with actual provenance"
      }
    }
  },
  "floors": { "LIMBO": "art/source/limbo.webp" }
}
```

A clip specification can also select a named or indexed animation: `{ "file": "art/source/actions.glb", "clip": "Run" }`. Runtime model keys are `hero`, `imp`, `archer`, `brute`, `warden`, `sword`, `hammer`, `dagger`, `shore-spider` and `ferryman`. Additional packed props require explicit placement.

Painted floors cover one complete 34 × 22 arena. Supported circle keys are `LIMBO`, `LUST`, `GLUTTONY`, `GREED`, and `WRATH`; supported images are PNG, JPG and WebP. Keep perspective out of the painted image because the game camera supplies it.

## Build

```sh
npm run assets
```

For each model the script reads its GLB, copies animation samplers onto matching named nodes, checks rest-pose compatibility, resamples animation, removes duplicates/unused data, indexes geometry, and applies Meshopt compression. It writes a single web GLB and records its clips, size, transform and credit information in the manifest. The manifest is published after processing succeeds. A missing required clip or incompatible rig is an error.

The client caches templates, clones skinned actors safely, normalizes height and grounds them, blends named animation states, and decodes Meshopt locally. A model load failure keeps the existing placeholder. A missing floor image keeps the procedural tile floor. The default empty manifest is valid and needs no external assets.

## Validate actual exports

`npm test` verifies merging and compression with a generated test fixture. It does **not** certify a future human rig. Before accepting an actual export, inspect idle/run/attack/dash/death, in-place root motion, facing, scale, the sword attachment and the Warden reuse in the browser. Adjust `rotationY` (degrees) and the export itself where needed. Replacing a model must not change combat distances or simulation state.

Record the actual asset pack, author, source URL and license in the manifest and credits before shipping. Do not copy characters or visual designs from other commercial games.

The title-screen illustration was generated in the same Flow project from the existing penitent character reference: `art/source/cover.jpg`, which remains the preserved original; the active enhanced export is described below.

The limited blade uses `art/source/cinder-requiem.jpg` (Flow) and `art/source/cinder-requiem.glb` (Meshy image-to-3D, 4,000 target polygons). The shipped `sword` model is compressed and reduced to 512-pixel textures. It is shown when Cinder Requiem is equipped and shares the hero’s right-hand grip with the starter fallback, regardless of which model loads first. The concept is also used in the Reliquary and NFT cards.

Raw duplicate exports and unused generation attempts stay outside Git under `art/source/raw/`. Runtime assets, source inputs needed by `art.config.json`, and provenance stay in the repository.


## Arsenal and environment revision

Tollkeeper (war hammer) and Widow’s Fang (dagger) use original Flow concepts and Meshy props, alongside Cinder Requiem. The existing hero rig has two additional Meshy animations: Heavy Hammer Swing and Thrust Slash. They are merged only after matching bone rest poses, trimmed locally, and played at the deterministic weapon's swing duration. NFT class selects the in-hand model; + level adds a restrained light, with embers from +3. Unowned preview artwork does not alter combat.

`src/render/dressing.ts` adds original low-poly ruins, suspended chains, a ferryman and a many-faced shore spider. The ferryman and spider use original Flow concepts converted through Meshy, packed with 512-pixel textures. They sway and drift as ambient props outside combat boundaries; they have no combat AI or skeletal walking animation. Blood vessels are real deterministic drops, rendered separately from their healing rules.

The original title composition is retained. Flow's available 2K enhancement produced `art/source/cover-enhanced-2k.jpg` (2752×1536); `public/assets/ui/cover-4k.jpg` is the 3840-pixel-wide display export, preserving aspect ratio. This is a Flow-enhanced 2K image resampled for a 4K display, not native 4K generation. Flow's 4K option required a subscription upgrade and was not purchased.
