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

A clip specification can also select a named or indexed animation: `{ "file": "art/source/actions.glb", "clip": "Run" }`. Canonical model keys are `hero`, `imp`, `archer`, `brute`, `warden`, and `sword`. Other model names can be packed for future props but are not placed in the arena automatically yet.

Painted floors cover one complete 30 × 19 arena. Supported circle keys are `LIMBO`, `LUST`, `GLUTTONY`, `GREED`, and `WRATH`; supported images are PNG, JPG and WebP. Keep perspective out of the painted image because the game camera supplies it.

## Build

```sh
npm run assets
```

For each model the script reads its GLB, copies animation samplers onto matching named nodes, checks rest-pose compatibility, resamples animation, removes duplicates/unused data, indexes geometry, and applies Meshopt compression. It writes a single web GLB and records its clips, size, transform and credit information in the manifest. The manifest is published after processing succeeds. A missing required clip or incompatible rig is an error.

The client caches templates, clones skinned actors safely, normalizes height and grounds them, blends named animation states, and decodes Meshopt locally. A model load failure keeps the existing placeholder. A missing floor image keeps the procedural tile floor. The default empty manifest is valid and needs no external assets.

## Validate actual exports

`npm test` verifies merging and compression with a generated test fixture. It does **not** certify a future human rig. Before accepting an actual export, inspect idle/run/attack/dash/death, in-place root motion, facing, scale, the sword attachment and the Warden reuse in the browser. Adjust `rotationY` (degrees) and the export itself where needed. Replacing a model must not change combat distances or simulation state.

Record the actual asset pack, author, source URL and license in the manifest and credits before shipping. Do not copy characters or visual designs from other commercial games.

The title-screen illustration was generated in the same Flow project from the existing penitent character reference: `art/source/cover.jpg`, shipped as `public/assets/ui/cover.jpg`.

The limited blade uses `art/source/cinder-requiem.jpg` (Flow) and `art/source/cinder-requiem.glb` (Meshy image-to-3D, 4,000 target polygons). The shipped `sword` model is compressed and reduced to 512-pixel textures. It is shown when Cinder Requiem is equipped and shares the hero’s right-hand grip with the starter fallback, regardless of which model loads first. The concept is also used in the Reliquary and NFT cards.

Raw duplicate exports and unused generation attempts stay outside Git under `art/source/raw/`. Runtime assets, source inputs needed by `art.config.json`, and provenance stay in the repository.
