# Art pipeline

Shipped art: a title illustration, eight painted floors, five north-wall backdrops and concept images from Google Flow, plus animated characters and a blade prop from Meshy (`scripts/meshy.mjs` runs image-to-3D, rigging and preset animations through the Meshy API and needs `MESHY_API_KEY` in `.env`; it spends credits). `npm run assets` only processes local files: it does not call any service or read keys. Placeholder shapes remain as the fallback when a model is missing.

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

A clip specification can also select a named or indexed animation: `{ "file": "art/source/actions.glb", "clip": "Run" }`. Runtime model keys and credits are recorded in `public/assets/manifest.json`. Additional packed props require explicit placement.

Painted floors cover one complete 34 × 22 arena. Supported floor keys are `LIMBO`, `LUST`, `GLUTTONY`, `GREED`, `WRATH`, `BOSS_WARDEN`, `BOSS_WITNESS`, and `BOSS_CANTOR`; supported images are PNG, JPG and WebP. Keep perspective out of the painted image because the game camera supplies it.

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

The limited blade uses `art/source/cinder-requiem.jpg` (Flow) and `art/source/cinder-requiem.glb` (Meshy image-to-3D, 4,000 target polygons). The shipped `sword` model is compressed and reduced to 512-pixel textures. It is shown when Cinder Requiem is equipped and shares the hero’s right-hand grip with the starter fallback, regardless of which model loads first. The concept remains a source reference; the Reliquary and NFT cards now render the actual packed game model.

Raw duplicate exports and unused generation attempts stay outside Git under `art/source/raw/`. Runtime assets, source inputs needed by `art.config.json`, and provenance stay in the repository.


## Arsenal and environment revision

Tollkeeper (war hammer) and Widow’s Fang (dagger) use original Flow concepts and Meshy props, alongside Cinder Requiem. The existing hero rig has two additional Meshy animations: Heavy Hammer Swing and Thrust Slash. They are merged only after matching bone rest poses, trimmed locally, and played at the deterministic weapon's swing duration. NFT class selects the in-hand model; + level adds a restrained light, with embers from +3. Unowned preview artwork does not alter combat.

`src/render/dressing.ts` adds original low-poly ruins, a ferryman and a many-faced shore spider. The ferryman and spider use original Flow concepts converted through Meshy, packed with 512-pixel textures. They sway and drift as ambient props outside combat boundaries; they have no combat AI or skeletal walking animation. Blood vessels are real deterministic drops, rendered separately from their healing rules.

The original title composition is retained. Flow's available 2K enhancement produced `art/source/cover-enhanced-2k.jpg` (2752×1536); `public/assets/ui/cover-4k.jpg` is the 3840-pixel-wide display export, preserving aspect ratio. This is a Flow-enhanced 2K image resampled for a 4K display, not native 4K generation. Flow's 4K option required a subscription upgrade and was not purchased.

## Ranged and environment revision (0.7)

Gravewhisper and Vesper Reed use original Flow concepts converted into Meshy props. The hero rig adds Cowboy Quick Draw Shooting and Mage Spell Cast clips, trimmed to the weapon action windows. Crossbow source geometry is horizontal, so its height normalization and hand orientation differ from upright blades; the same transform applies to a Duel rival. The shared NFT identity selects the visible model and deterministic projectile rules.

The original carved funerary arch was generated in the same Flow project and converted through Meshy (8,000 target polygons, 1024-pixel packed texture). It frames the shore-spider and circle shrines. Five perimeter layouts use the arch, matte weathered stone, tombs, cloth, urns, cisterns, coffers and basalt. The ferryman stays at his landing; the spider stays within its niche. Ambient props never overlap intended combat rules or become attackable targets.

Bloom and rapid model blinking are disabled. Warm bone damage text uses Cinzel; the vitality bar has a delayed loss trail. Hit particles and camera impulses are reduced, with no full-white damage flash. The source concepts, model inputs and packed assets retain actual provenance in `art.config.json` and the manifest.

## Forge presentation (0.8)

Guillotine Hymn and Acheron Needle are original Flow concepts in the same project, converted into Meshy axe and spear props. The hero's existing rig adds Charged Axe Chop and Axe Spin Attack; the spear uses a separately trimmed Thrust Slash clip. Contact frames were inspected in a local silent animation study before choosing the windows. The charged axe clip retains its final descending cut rather than the long hold. Player, rival and mint preview share grip transforms and attack selection.

Fourteen packed models and five painted floors ship. `src/render/relics.ts` renders cached portraits from the same packed weapon meshes in a dark stone chamber; raw neutral-background concepts remain in `art/source/` for provenance, not in product cards. The mint preview uses the hero rig and actual action durations and never changes equipment, gameplay, rewards or audio.

Blood textures and stone-chamber geometry are original procedural art. Directional clots, fragments, irregular stained-floor decals and existing death clips add weight without brighter lighting. Pools are capped and reused. Full anatomical dismemberment is not implemented.

## Soul skill presentation (0.9)

The same Meshy hero rig adds Charged Spell Cast (125), Mage Spell Cast 3 (132) and Sword Judgment (102), in `art/source/hero-soul-actions.glb`. Contact-sheet inspection selected cast 0.35–1.45 seconds, charged ultimate 1.25–2.10 and judgment 0.70–1.70. Runtime durations match deterministic windup/contact/recovery. No new character or third-party game art is used.

`src/render/soul-fx.ts` draws original layered flame textures, seals, tapering orbit blades, lance streaks and ward facets. Effects use normal transparency and bounded lifetimes, with at most 32 motifs. Dash echoes copy the current posed hero and fade over 0.3 seconds. The skill-tree preview uses the same rig and effects; it has no gameplay, payment or audio side effects. The earlier procedural perimeter filler has been replaced by authored props and ashen static poses from the existing enemy rigs.

## Weapon mastery presentation (0.10)

The skill atlas uses original SVG branch paths and weapon-family icons, circular learned nodes and a hold-to-learn ring. Seven weapon tabs, spells and ultimates separate browsing from the four combat hotkeys. The existing hero rig and weapon models supply the technique clips; no new generated models or animation credits were used for this revision. Directed trails, circular cuts and hammer ground fractures follow actual hit patterns without bloom. Reused clips have move-specific durations and contacts; this is not a new set of 28 bespoke motion-capture clips.


## Combat motion and atlas polish

Player, Duel champion and silent theatre now share the same grip mounting and matte starter blade. Preview selection waits for its requested model before resuming, so a slow prop load cannot play the new technique with the previous weapon. Matching weapon branches preview the equipped variant; other branches remain cosmetic previews.

Existing clips are selected by technique (lunges, spins, judgments and staff channels), with small family-specific spine, arm and wrist accents for preparation, contact and recovery. A presentation clock maps the simulation contact to the release portion of a clip. Staff and crossbow releases use two short arm-aim corrections and a wrist alignment toward the actor's firing direction; segment lengths and simulation positions remain unchanged. Heavy two-hand clips align the shaft through both palms. The hammer window is corrected to 0.95–1.75 seconds of Heavy Hammer Swing, retaining the actual downward contact instead of ending during its preparation. Clip-specific contact markers distinguish thrusts from sweeps and judgments. Additive poses restore before each new sample. These are refinements of the existing 15-clip rig, not new generated motion-capture assets or 28 bespoke animations.

Weapon-specific tapered strokes replace the generic basic swing arc. Staff volleys use curved ink wisps, hammers use grounded fractures, pulls contract inward, and heavy impacts get a short bounded hit stop. Volley count, spread, speed and lifetime match their corresponding technique; Soul Lance shows one shot for ordinary weapons and three for a staff. All effects use normal transparency and bounded pools, without bloom or full-screen flashes. The shared theatre shows these effects beside the tree and can expand for inspection.

The atlas has an overview of all ten categories, draggable and zoomable maps, Fit tree and Find selected controls, arrow-key panning and keyboard focus reveal. A single branch fits its viewport; the preview stays adjacent on desktop. Learning retains the original cancellable 1.1-second hold. No asset generation credits were spent in this pass.

## Descent motion and signatures

The hero now includes two more same-rig Meshy presets from `hero-descent-actions.glb`: `Basic_Jump` (catalog action 86, sampled at 1.50–3.60 seconds) and `Charged_Ground_Slam` (127, sampled at 1.05–2.80). Final Absolution uses the leap with a hand-directed descending blade; Cathedral Fall uses the slam plus a 0.75 m cosmetic lift. Contacts remain at the existing simulation times. The render clock separates a readable windup, accelerated strike, short contact hold and recovery. Blade combo two uses the existing thrust clip.

Astral Funeral has original curved horned soul heads on its existing three-projectile fan. Reaping Orbit briefly raises two animated, translucent copies of the hero with held blades per pulse, using a bounded pool of four actors per effect renderer. These are visual strokes of the existing attack, not autonomous companions. Hammer pulses leave tapered ground cracks and small falling stone fragments. Normal alpha blending, restrained opacity and no bloom remain the rule.

Motion reference: the practice-area attacks in [Nilmoyism’s weapon showcase](https://www.youtube.com/watch?v=-4KwXB9tm_4) and [Legend Stuff’s alternate moveset showcase](https://www.youtube.com/watch?v=nntoW5uSme4). References informed pose separation and effect timing; no footage, game assets or textures were imported. Preparation and skill previews share the gameplay models, grip corrections and contact clock, with an optional 0.35× preview speed.

### Staff and core choreography

Staff casts now use a shared gesture layer: a lifted preparation, two-hand forward release, downward planting for Cinder Halo/Furnace Heart, and upright gathering for Soul Harvest/Sanguine Covenant. Joint rotations preserve limb lengths and reset on interruption. A restrained charge accent follows the held staff crown. Gameplay and the preview theatre use the same posing.

Core and staff area effects use distinct outward flame waves, inward tapered soul/blood strokes and tangential spectral cuts. Painted flames have soft edges; the covenant ward uses open curved ribs. Core release events no longer draw a second impact on top of the authoritative pulse. Spectral guards lunge through their existing swing and fade over their complete lifetime. All effects use normal alpha blending; damage, ranges and cooldowns are unchanged.

### Arsenal motion and effect budgets

Heavy techniques retain a longer preparation and contact hold; daggers recover quickly and thrusts use a short contact pause. Spear and lunge tips follow the committed aim, with a supporting back hand for spear thrusts. Crossbows receive a brief recoil that settles before the next shot. The hammer's raised slam keeps its head above the gripping hand and descends toward the floor. Axe executions use the heavy chop; dagger dances retain the quicker dagger clip. Thrown daggers spin independently of their projectile trajectory.

Weapon strokes use five shared immutable geometries, with one to three meshes per contact. Hammer fractures share one mesh; soul heads merge their horns, teeth and whiskers into one mesh and reuse a single geometry. Each animated actor caches rig lookup; ghost materials and transient effect parts are cached for their lifetime. The existing 32-motif and four-guard bounds remain. The unused bloom pass and its render targets are removed. These are rendering changes only, with no new art download or simulation rule change.

### Movement and transition continuity

Combat windups, blade trails, circling cuts and Reaping Orbit follow their wielder. Spectral guards retain their local lunge while moving with the orbit's owner. Released projectiles and victim-centered explosions remain in world space; active area rings and hammer aftershocks now follow the wielder (simulation 0.10.1). Windups disappear on release, interruption or owner death; the effect pool limits are unchanged.

Animation transitions capture the displayed rig pose, including hand corrections, and blend into the next sample. Restarting the same clip uses the same path, avoiding a snap to its first frame. Cached transforms are restored before sampling so corrections cannot accumulate. Locomotion decisions only update on a new simulation tick; a high refresh rate or hit-stop no longer alternates run and idle on repeated frames. Existing contact times, damage and replay rules are unchanged.


### Runtime enemy geometry budget

The imp, archer and brute builds set `simplify: { "ratio": 0.5, "error": 0.005 }` in `art.config.json`. The packer applies Meshopt simplification after welding and before compression; the error bound can stop it before the target ratio. Current triangle counts are 4,572 / 5,266 / 7,128 (previously 9,147 / 10,550 / 12,690). The 1024-pixel textures, 24-joint rigs and all animation sampler values are retained. Original source GLBs remain unchanged, so the runtime exports can be rebuilt or retuned. Hero and held-weapon geometry is unchanged.

Ritual ribbon groups and repeated plate/flame shapes reuse immutable geometry. Flat translucent strokes use a single rendering pass while keeping their normal alpha blending. No generated art, texture downscaling or paid service was used for this optimization.

## Ritual bosses

The Hollow Witness and Cinder Cantor are original Flow concepts developed from owner-supplied references to eye-bearing palms, ritual horns and funerary drapery. Their source concepts are `art/source/hollow-witness.jpg` and `art/source/cinder-cantor.jpg`. The original social-media screenshots are not game assets and are not redistributed in this repository.

Both characters now use separate Meshy rigs and preset clips. The Witness uses Mage Spell Cast 3; the Cantor uses Mage Spell Cast and Charged Ground Slam, alongside idle, run and death. The render clock samples the selected attack through preparation, contact and recovery; a finisher-induced recovery extension cannot rewind the displayed pose. These are adapted presets, not bespoke motion capture. Their packed exports use 512px textures and approximately 6,100 triangles each, under 450 KB per character. Boss models/textures/shaders are prepared before play, and reuse the existing bounded effects with no additional lights or postprocessing.

Outline thickness is supplied per material rather than baked into a shared shader program. Differently sized actors therefore retain the intended line weight without requiring a new shader variant for each size. Architectural exploration for a bell hall, palm-eye pillars and balconies is a separate concept direction; it is not a shipped new map.

## Penitent gate and vow cards

`public/art/penitent-gate.jpg` and `public/art/vow-cards.jpg` are original Google Flow / Nano Banana illustrations generated for Contrapasso. The gate uses the established palm-eye/ivory/bronze direction; the card atlas contains weapon, spell, soul-core and endurance motifs. Social-media reference screenshots are not distributed as game assets.

The gate is a painted 2.5D prop, not a newly rigged 3D model: one image mapped onto a silhouette frame and two hinged leaves with a dark aperture. It adds four opaque meshes and no lights. Card panels are selected with CSS, while skill names, effects, costs and input cues remain live text. Original circle artwork is retained; the experimental primitive bell-hall scene was withdrawn. No additional Meshy generation was used for this revision.


## Authored perimeter and contact ink

The pilgrim exit (`public/art/pilgrim-exit.jpg`), five `wall-*.jpg` backdrops, `stone-border.jpg` and three `art/source/floor-*.jpg` boss floors are original Google Flow / Nano Banana 2.1 exports. North-wall UVs align their painted openings with the actual gates. One silhouette cutout supplies the exit; four repeated textured strips supply the border. No additional lights or postprocessing are used.

Six original Flow concepts were converted with Meshy image-to-3D. Their source JPG/GLB files are retained under `art/source/`; shipped files use Meshopt compression and 512px textures:

| Prop | Triangles | Packed bytes |
| --- | ---: | ---: |
| Funerary brazier | 4,044 | 208,388 |
| Gate threshold | 3,076 | 142,476 |
| Lust niche | 2,927 | 181,200 |
| Gluttony cauldron | 2,981 | 157,660 |
| Greed chest | 2,791 | 158,888 |
| Wrath column | 3,182 | 168,500 |

Planted weapon props are grounded blade-first. Static enemy figures use cached grayscale versions of their authored textures, with their emissive contribution removed, to distinguish stone scenery from living enemies. These props load before shader preparation.

Contact ink is drawn once into cached 256px masks: blade cuts, hammer/axe fractures, dagger/orbit arcs, spear/bolt lanes, staff seals and three distinct core marks. Marks have a six-slot pool. The weapon-tip trail uses one mesh with six ribbon segments; older strokes recede and enemy warning materials draw above them. These textures are original procedural illustration, not copied game sprites. Hidden camp and preview canvases skip rendering.

The ten new painted environment and boss images retain their original pixel dimensions and use JPEG quality 85 for delivery (11.03 MB total, down from 26.73 MB). Full-quality downloads stay in the ignored raw art folder.
