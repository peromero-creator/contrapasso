# Contrapasso — game design

Working design. The testnet defaults and remaining production work are recorded below.

## Idea

In Dante's poem a _contrapasso_ is a punishment that mirrors the sin. In this game the hero fights down through their own hell, and whatever they build returns as punishment for someone else: a finished champion becomes an opponent that other players must beat.

- Genre: isometric-style action roguelike in the browser (2.5D: painted floors, 3D characters, fixed tilted camera).
- Setting: the first five circles of the Divine Comedy, as the hero's own sins: Limbo, Lust, Gluttony, Greed, Wrath. The other four come later.
- The hero is not Dante. Original name, world, characters and art.

## Site flow

1. Landing page: the title, an opening scene (a short video is planned), a Play button.
2. Play slides the page up and shows the mode choice: **Solo** and **Duel**.

## Solo

A run is five floors, one circle each. Each floor has waves of enemies. Floors II, IV and V also contain an optional boss gate. After a floor the player chooses an offered rank for an already unlocked power; with no eligible power, the gate opens immediately. Solo is where coin is earned.

## Duel

For the hackathon the duel is asynchronous: the player fights another player's champion, played by the AI with that player's gear and skills. The result is written to the champion's win/loss record. Real-time duels are on the roadmap.

## Economy

**Coin** is the in-game money. It is earned only by playing Solo and it is bound to the account (it cannot be sold or transferred). Coin is spent on:

- skills,
- "+" upgrades of weapons and armor,
- the duel entry stake,
- the right to enter an NFT mint,
- access to limited NFT editions.

**NFTs** are everything a player can customise: weapons, armor and the champion itself.

- Gear is released in limited mints (for example 500 or 1000 pieces).
- Entering a mint costs coin, so only people who played can mint. The mint price itself is paid in real value.
- Mint revenue accumulates in an application treasury controlled by the project owner. Its later in-game use is a product decision; there are no new ticket sales or automatic distributions.
- Gear changes how the hero plays more than how strong they are. Power comes from "+" upgrades and skills, which cost coin, not money.

**NEAR-style NFT behaviour** (what the `nfts` track asks for):

- The champion NFT acts like an account: it holds its equipped gear, a coin vault and its win/loss record. Sell the champion and all of it moves with the NFT.
- Gear NFTs are dynamic: the "+" level, kills and past owners are written on the token.
- Paid resale royalties also flow into the application treasury.

## Proposed economy defaults

| Open point          | Default                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "+" upgrade odds    | +1 to +3 always succeed, +4 to +6 succeed 85% of the time, +7 to +9 70%. A failure burns only the coin. Maximum +9. Keep failure chances low.                                            |
| Selling a champion  | Equipped gear goes with it. Unequip an item first to keep it. Only equipped gear counts toward the champion's power.                                                                     |
| Where skills live   | On the champion, so a trained champion has value.                                                                                                                                        |
| New players         | No starting wheel. Everyone gets a free, account-bound starter weapon and armor that can be upgraded.                                                                                    |
| Mint oversubscribed | A coin deposit reserves a spot. If the mint sells out first, the coin is refunded.                                                                                                       |
| Duel payout         | The challenger stakes coin. A win takes the same amount from the defending champion's vault; a loss pays the stake into that vault. No coin is created.                                  |
| Duel fairness       | Match by gear power so bought gear cannot stomp new players.                                                                                                                             |

## Known gaps

- **Bots.** The referee stops fake results, not bots that actually play. Earned mint access still needs bot controls; the demo has a daily coin cap.
- **Scope.** Demonstrate a complete playable loop and meaningful NFT ownership. A public player count is not listed as an eligibility requirement; this does not replace showing a convincing game.

## Anti-cheat

A browser must not be able to claim a win. Fights are deterministic: the client sends the seed and every tick's input, the referee server replays the fight with the same code and signs the result, and the contracts accept only signed results. `scripts/simtest.ts` proves the replay property.

## Track fit

- `games`: "judged on the game loop, not the token", bonus if players never notice the chain.
- `nfts`: NFTs as accounts that own money, hold inventory and earn.

## Integration history (0.5, 2026-11-12)

The raffle below describes the prior deployed revision. Revision 0.6 removes new ticket sales in favor of a treasury, preserving historical liabilities.

The testnet contract and local relay implement the champion vault, permanent training, champion/starter gear NFTs and asynchronous Duel. Public testnet deployment is verified at `contrapasso-261112-a23809.testnet`; see [NEAR setup and trust boundaries](NEAR.md).

Duel uses a 10-coin stake from each side, locked before combat. Only opted-in defenders with a funded vault are listed. Opponents use their deepest Solo build plus permanent training and equipped gear. A fight ends on death or after 90 simulation seconds; a challenge expires after 10 wall-clock minutes. The champion and its equipped gear cannot transfer during a Duel. The winner takes the 20-coin escrow pool; leaving or abandoning an opened challenge is a challenger loss. Duel creates no coin.

The current guest account is custodial: the local server holds its key and pays ordinary gas through a restricted relay key. A confirmed wallet claim moves the champion, equipped gear, coin and native prize vault to an existing testnet wallet. This guest session then receives a fresh champion.

Gear upgrades are implemented with the odds and costs above. Every attempt binds the equipped NFT and its starting level; only confirmed metadata determines the next loadout.

The Reliquary implements a testnet edition of **Cinder Requiem**, a tradable weapon starting at +0 with the same base combat stats as the free blade. Each round has 12 editions, one per champion. Completing Solo unlocks a 10-coin reservation and a native mint price of 0.01 test NEAR. Cancelling an unpaid reservation refunds the coin; the draw refunds all remaining unpaid spots. An edition cannot be oversubscribed. Equipped tradable gear must be unequipped before transferring it separately, and cannot equip to two champions.

Tickets cost 5 coin, up to 10 per champion and 200 per round. After the deadline a player triggers an on-chain draw. Tickets weight selection without replacement; up to three distinct champions split 100% of the recorded pool equally, with any integer remainder going to the first winner. With no tickets, the full pool carries forward. The round publishes its block height and entropy so the selection can be replayed. Block randomness is adequate for a testnet demonstration; this is not a production VRF or a manipulation-proof raffle.

Native prizes belong to the champion NFT, can be withdrawn to its current owner, and return to the vault if a transfer fails. Transfers and gameplay writes lock while a native payout is pending. One bounded demo grant of 0.2 test NEAR is available after Solo, for up to six guest champions. The contract preserves prize liabilities and a minimum free reserve before sponsoring a guest. These are free testnet funds, with no real-money entry or payout.

NEP-199 royalty quotes allocate 10% to the contract and 90% to the seller. Marketplaces must honor the quote and actually pay `collect_royalty` to credit the tracked pool. A quote alone does not move funds.

## Weapon and skill-tree revision (0.6)

This revision turns relics into distinct combat archetypes with matching in-hand models, persistent upgrades and transferable history. Three initial paths: long sword (reach), war hammer (slow impact) and dagger (fast close combat). Customization stays attached to owned NFTs; appearance alone must never select unowned combat power.

All new permanent skill unlocks cost earned coin, with shared prerequisite rules in the referee and contract. A three-branch skill tree replaces the flat list. Circle rewards improve skills already unlocked on the champion for that descent; they do not grant free permanent unlocks. Existing paid skills remain owned. Compact Skills badges reveal details instead of printing every power on cards.

Mint access and native payment remain separate. The owner chose to remove raffle sales and hold revenue in the application treasury. Existing round liabilities are honored when retiring the prior round; unallocated revenue moves to the treasury. No new fungible token or mainnet deployment is part of this revision.

The arena expands from 30×19 to 34×22, with healing pickups and perimeter ruins, hanging chains and ambient inhabitants outside the combat boundary. Every seventh Solo kill drops a blood vessel restoring 18 life (boosted by Stolen Mercy); full-health players do not consume it. The ranged and marketplace expansion is documented below.

## Ranged weapons, exchange and map direction (0.7)

Gravewhisper is a deliberate hand crossbow (31 base damage, 11-unit range, 0.65-second cooldown); every third bolt pierces two distinct targets. Vesper Reed is a soul staff (22 damage, 8.5-unit range, 0.48-second cooldown); every third cast fires a three-way fan. Shots travel, expire and respect target sides. Upgrades add two damage per level and trained skills apply to hits. Ranged Duel defenders use the same weapons and fixed-aim, dodgeable projectiles. Simulation version is 0.6.0.

The Ash Exchange sells existing, unequipped tradable gear for 0.001–1 test NEAR. Listings lock equipment/transfer until cancellation or sale. A purchase requires the exact quoted price and listing revision, transfers the same NFT atomically, preserves its identity, level and kills, and appends the seller to its recent owner history. The seller receives a withdrawable 90% balance and the application treasury receives 10%. A failed withdrawal restores the balance; sale proceeds belong to the selling account, not its champion. Champion sales and auctions are outside this marketplace UI.

Each circle now has a deliberate perimeter composition: Limbo’s ferry landing and tombs, Lust’s broken thresholds and cloth, Gluttony’s cistern and spider ossuary, Greed’s coffers and shrine, and Wrath’s basalt riverbank. Ambient creatures occupy fixed niches outside combat. The carved arch shares the existing Flow/Meshy art direction. Combat bloom and rapid blinking are disabled; subdued particles, serif damage numbers and a delayed vitality-loss trail keep hits readable without bright bursts.

## Forge and combat presentation (0.8)

The primary catalog mints new weapons; player listings are optional resale of already minted gear. Treasury editions allow sequential mints by the same champion. Each consumes a fresh 10-coin reservation and exact 0.01-test-NEAR payment, producing a distinct token. Only one reservation per champion can be active at a time; cancellation refunds only the current unpaid reservation. Legacy raffle editions keep their original one-mint rules. The owner may choose 1–1,000 total pieces; the live `forge-demo-1` edition has 100. The existing 50-participant bound keeps close/refund work bounded even when players mint repeatedly.

Guillotine Hymn is an executioner axe: 43 base damage, 2.9 reach, wide cleave, 0.58-second recovery. Its third cut deals another 35% damage against targets below 35% life. Acheron Needle is a war spear: 27 damage, 4.1 reach, narrow alignment, 0.43-second recovery; the third thrust gains 1.2 reach. Both use real in-hand models. Damage lands after the animation windup (axe 0.30 seconds; spear 0.12), once per attack; dashing before contact cancels the strike. Simulation version is 0.7.0.

The mint catalog previews the hero's actual attack clips silently. Inventory and resale cards render the same game model in a dark stone chamber rather than showing raw studio concept images. Weapon identity, level, kills and owner history still come from NFT metadata. Faster consecutive attacks explicitly restart the animation instead of leaving it at its final pose.

Blood uses directional clots, textured floor stains lasting up to 45 seconds, and short-lived bone/flesh fragments. Defeated actors play their death clip before sinking away. Pools are bounded (180 gore pieces, 100 stains, 10 falling actors) and clear between floors/runs. No bloom or white damage flash is added.

## Soul skills and combat weaving (0.9)

Ember Edge now unlocks **Q / Soul Lance**: a 0.70-second committed cast with release at 0.38 seconds, a cooldown of 5 seconds minus 0.4 per Restless rank, and 34 base damage at rank one. Vesper Reed releases three slightly spread lances, each piercing three distinct targets; other weapons cast one lance piercing two. Ember, Gravespan and Funeral Pyre affect the cast. After release, the first weapon attack within 2.5 seconds gains 25% damage, consumed once. This stacks with Last Rites' dash-follow-up bonus and weapon-specific third hits. The HUD announces the available follow-up.

The champion has one **soul core**, attuned in the skill tree from already paid training. Attuning is free; ownership of the skill is required. Ember Edge opens Furnace Heart (three expanding, burning pulses, 3.5 / 4.5 / 5.5 reach); Ash Step opens Reaping Orbit (six cuts over three seconds, 4.5 reach, follows the caster); Iron Vow opens Sanguine Covenant (nearby siphon, then 45% damage reduction for five seconds). Pyre, Ashen Echo and Stolen Mercy strengthen their corresponding cores. Only one core can be equipped. R consumes a full 100% meter, with a 1.05-second committed animation and release at 0.65 seconds. Dealt damage charges the core, excluding overkill and the active ultimate's pulses. Every descent begins empty. Healing cannot revive a lethal retaliation.

Core choice travels with the champion NFT and is included in referee-issued Solo/Duel builds. Duel rivals cast with the same timings and fixed aim. Q/R are part of simulation 0.8.0's 27-bit replay input; N now restarts Solo.

The skill tree includes a silent hero-animation theatre, core descriptions and paid unlock paths. Cast, charged release and judgment clips use the existing hero rig. Layered flame silhouettes, inscribed seals, orbit cuts, siphon ribbons and a restrained ward distinguish abilities; Ashen Echo leaves brief frozen character silhouettes during dash. No bloom or full-screen flash is added. The perimeter uses authored funerary arches, planted relics, ashen statues derived from existing enemy models, and generated themed props. The ferryman and shore spider remain ambient scenery outside combat. The earlier procedural filler has been retired.

## Living arsenal and branching skill tree (0.10)

The skill atlas separates seven weapon families, Q spells, R ultimates and shared soul vows. Each weapon family has four paid techniques mapped to 1–4: the first opens two sibling nodes, and learning both siblings opens the capstone. Costs are 20 / 35 / 35 / 60 earned coin. These are ordinary character progression, with no separate skill NFTs, mint fee or new collection. Existing learned vows and existing champion persistence remain intact.

Select a node to inspect its effect. Hold the learn control for 1.1 seconds to fill its bar and node ring; releasing early, losing focus, cancelling the pointer or hiding the page cancels without a request. A completed hold sends one purchase. Authoritative ownership, prerequisites and coin checks still run on the referee and contract. The UI marks the skill learned only after the saved profile reports it. Mouse, touch and keyboard Space/Enter share the same hold behavior.

Weapon techniques only work with their corresponding family in hand. Blades share a branch between Cinder Blade and Cinder Requiem. Hammers emphasize fractures and wards; daggers favor lunges and siphoning; crossbows use piercing volleys; staves use soul fans, rings and harvests; axes cleave, pull and execute; spears thrust through narrow lanes. Every technique has a committed animation, timed contact and independent cooldown. Multi-contact moves use 0.28-second spacing and fixed cast aim; circular attacks follow the caster. Contact damage gains two per weapon level and 15% per circle rank above one. Only learned techniques for the current weapon are offered as circle rewards or included in Duel gear-power matching.

Q has three selectable spells. Soul Lance retains its Ember Edge gate; Cinder Circle and Blood Thread each cost 35 coin. Circle burns a four-step radius; Thread siphons a seven-step narrow lane and heals six life per hit. Q's first-contact 25% weaving bonus also applies to weapon techniques, consumed once rather than once per pulse. One Q selection is saved as `build.spell`, validated against learned skills and carried in issued Solo/Duel loadouts. The three existing R cores remain separate. Duel rivals use the same active-ability rules. Simulation 0.9 uses a 30-bit input including a 0–4 weapon-technique slot; reward choice keys remain 1–3 only while the reward screen is open.

## Combat presentation and atlas navigation

The skill atlas offers an all-paths overview as well as individual weapon, Q, R and passive branches. Drag, zoom or use keyboard navigation to explore; Fit tree restores the complete view and Find selected returns to the inspected node. Selecting an active skill previews its matching weapon beside the map, with an optional expanded theatre. Previewing remains cosmetic and never equips an unowned NFT or buys training.

The hero's existing rig now layers distinct weapon accents and ranged hand alignment onto technique-specific clips. Cast facing follows the committed aim. Ground cuts, staff wisps, inward harvests and heavy contact pauses strengthen motion without increasing flash intensity. Gameplay, referee inputs, costs, NFT metadata and the deployed contract remain unchanged by this rendering revision.

## Next steps

1. Record the final demo and review the delivery checklist in `docs/SUBMISSION.md`.
2. Choose hosting and publish the repository when the owner is ready.
3. For production: wallet authentication/recovery, stronger randomness, independent contract review, oracle decentralization and additional bot controls. Mainnet is outside the current demo scope.

## Preparation and motion presentation

Solo begins with an owned-weapon preparation screen. Selecting a card previews the actual held weapon and its four techniques without changing ownership or unlocking skills. Starting equips that same NFT through the existing authenticated operation, waits for confirmation, then requests the authoritative run loadout. Listed weapons and gear bound to another champion are unavailable. Level and kill history are displayed from inventory metadata. Failed or pending equipment operations keep the player in preparation and retain the existing retry intent. Selection is locked during confirmation.

The skill-tree link from preparation opens the selected weapon family; closing it returns to the same preparation screen. Camp groups Skills, Inventory and Market on a fixed navigation rail, with weapon preparation below Descent. Unlearned skill slots remain hidden during combat. Preview slow motion affects presentation only.

Final Absolution has an aerial descent, Cathedral Fall a raised ground strike, Astral Funeral horned soul projectiles, and Reaping Orbit animated spectral guards. Their ranges, pulses, charge costs, cooldowns and damage are unchanged. Airborne presentation grants no invulnerability. The guards illustrate existing orbit pulses and do not acquire targets or add attacks. A third-circle blacksmith is deferred.

## Combat input continuity

Q, R and weapon techniques have a single 14-tick input buffer (about 233 ms). A press near the end of an attack or cast starts at the next legal opening, including while basic attack is held. The most recent skill press replaces the previous one. Dash and pause/menu transitions clear the buffer; expired, unlearned and uncharged requests do not fire later. This is client input handling: the referee still receives ordinary versioned inputs and enforces the existing recovery, ownership and cooldown rules.

Space jumps; attacking during the jump commits a plunge in the aimed direction. The HUD shows jump recovery and the airborne attack opportunity. These actions use simulation 0.10.0's existing 30-bit input. Arena transitions clear transient spell, damage-text and ghost effects while keeping shared actor geometry; new runs clear the cosmetic hit chain. Hit flares use subdued warm tones, and reduced-motion mode uses a static low-health tint.

The result screen distinguishes a locally verified replay from a confirmed testnet save. Pending saves are checked again using the same run ID, with a manual retry after connection failures. Confirmation never awards the same replay twice.


## Combat performance and training readability

The arena renderer draws only during a run and stops while its tab is hidden. Static perimeter meshes are batched by material, blood uses two bounded instanced draws, and dash silhouettes reuse at most four skeletons. Model fit bounds are cached per asset and rotation. The illustrated lighting and full-resolution artwork are retained; the unused post-processing copy is removed.

The displayed hero interpolates between simulation ticks. Attached windups and moving attacks use that displayed position; released projectiles and enemy death explosions retain their world positions. Windup lifetime follows the simulation clock through hit-stop. Passive nova triggers use short, four-mesh echoes; caster-centered dash/reprisal echoes follow the hero, while victim explosions keep their impact origin; active ultimates retain their full signatures. Light hits no longer stop the whole game; heavy contacts keep a short accent with a minimum interval between pauses. Damage, hit times and replay inputs are unchanged.

Skill Tree opens on the equipped weapon's branch. All Paths presents ten readable branch cards with learned counts. Each branch retains its growing connections, pan, zoom and silent matching-weapon preview. The selected skill shows its action, damage/cooldown where applicable, prerequisite or missing coin, and one training/equip control. Progression formulas sit behind a disclosure. A learned technique from another weapon family is marked as learned, not ready in the current hand. Hold-to-learn cancellation and server-authoritative payment remain unchanged.


## Carried auras and frame pacing (0.10.1)

Active area skills travel with their wielder: staff rings, hammer aftershocks, Q circle/thread and all three cores. Furnace Heart now moves its authoritative damage center before each pulse, for both the player and Duel rival. Its visual tail follows the displayed actor too. Released bolts and victim-centered death explosions still travel or resolve at their actual target; they are not pulled back onto the hero. Simulation version 0.10.1 distinguishes these rules from older replays.

Common enemy meshes and shaders are prepared before issuing a new Solo or Duel challenge. Enemy positions and health bars interpolate between simulation ticks. Repeated ritual strokes share cached geometry; strokes with the same motion are drawn together. Flat translucent effects use one pass. Enemy imp, archer and brute exports use bounded Meshopt simplification while retaining their original textures, bones and animation samples. Full-resolution arena rendering and character outlines remain enabled.

Preparation waits for the hero and held-weapon models, retains compiled effect material variants, and performs a covered warm-up draw before combat. Skinned actors and their outlines cache a bind-pose sphere for depth sorting, avoiding a first-draw scan of every animated vertex. Frustum culling stays disabled on those meshes so the approximate sorting bound cannot clip animated limbs.

Afterimages never contribute lights. The held weapon's light lives in the scene and follows the grip independently of actor visibility, keeping the light count stable through dash echoes and hurt blinking. This avoids recompiling the arena's lit materials during combat.

## Enemy attack readability

Solo enemies have distinct, matte windup cues: the imp's close strike fills a small circle, archers show their tracking aim, brutes and charging Wardens mark a locked lane, and a Warden's radial volley uses an outward-pointing seal instead of a charge lane. The lane stops at the arena boundary. These are anticipation cues, not new damage zones; the existing contact rules, dodge windows and replays are unchanged. The imp's attack animation now uses its actual 0.42-second windup.

Cues follow the displayed enemy position independently of body shake and recoil. They fill continuously without blinking or adding lights, share geometry across enemies, and normally disappear at release. The Witness gaze remains visible for its brief contact beat. Each active warning uses at most three draws. Duel keeps its existing weapon/skill presentation.

## Boss encounters and combo openings (simulation 0.11)

Optional gates on floors II, IV and V lead to the Warden, Hollow Witness and Cinder Cantor respectively. The Warden keeps its charge/radial pattern. The Hollow Witness fixes a narrow gaze lane before striking, alternating with slow radial volleys. The Cinder Cantor alternates a fixed-aim projectile fan, a close circular slam and a charge. Below half life the two ritual bosses add projectiles; the phase is captured at the start of a warning, so taking damage cannot widen a volley mid-warning. Damage geometry and floor tells share the same constants. Regular waves and circle rewards remain available when a boss is skipped.

A boss's recovery is a visible opening. The first weapon finisher (every third basic strike or shot) to hit during that recovery gains 20% damage and extends recovery by 0.18 seconds. Further hits cannot extend it again. Techniques and passive damage do not consume the opening. A compact boss bar names the opponent and signals the opening.

Basic attack taps are retained for up to ten simulation ticks, letting a slightly early second or third press begin when the weapon is ready. The queued attack keeps its aim, executes once, and is cancelled by a dash, jump or committed ability. This does not shorten weapon cooldowns or grant new powers. Client and referee both use simulation 0.12.0; older unfinished runs must restart. NFT ownership, traits, payouts and contract ABI are unchanged.

## Optional chambers and unified atlas (0.12)

After clearing an eligible circle and choosing its rank upgrade, approach the carved gate and press E or use its Enter button. The ordinary lit exit always remains available, including on floor V. A boss cannot be entered during waves, from a distance, or twice on one floor. Entry opens painted door leaves and fades through darkness to a separate crypt presentation with a boss-specific painted floor and an authored perimeter. Boss life is 600 / 750 / 900. Victory returns to the cleared circle and offers one additional rank for already learned powers; boss kills use the existing 60-coin award and daily cap. Death remains a normal Solo loss. Skipping every boss is a valid descent and still unlocks mint access on completion. Inputs remain 30-bit; the choice field also records gate entry. There is no new contract ABI or paid boss entry.

The skill atlas shows every real path on one pannable map: seven weapon families, Q, R and soul vows, with consistent circles and colored regions. Category buttons focus a region without removing the others. All paths fits the complete map. Only actual prerequisites have connecting lines. There are 42 learnable skills; spell/core representations can share an existing skill rather than adding purchases. Hold-to-learn, costs and authoritative ownership checks are unchanged.

Reward cards use four original Flow illustrations, a distinct skill icon, the effect and its rank increase. Inventory cards emphasize practical stats, with token identifiers and ownership in expandable details. Market fees, testnet denomination and transfer consequences remain available. The rejected procedural bell hall is no longer used; original circle floors are retained, with generated perimeter scenery.


## Camp and combat presentation polish

Camp has a live idle champion with drag-to-turn, a fixed page rail and immediate loading placeholders. Solo begins with weapon portraits, damage/reach comparison and the equipped family’s techniques. A brief dark descent transition covers arena preparation. Rewards emphasize the chosen card before continuing; the results screen counts saved coin and records elapsed time, chosen vows and peak FLOW across all rooms. The pause screen shows the current build. Settings are device-local: volume, shake, pixel-density quality, fullscreen, menu motion and control hints. Silent sessions cannot create an audio context.

Skills begins on the equipped weapon’s path. An affordable next technique is marked NEXT; coin shortfall is shown when appropriate. Successful training lights its action slot after confirmation. Q/R open learned-choice lists, and arrow keys navigate nodes and rewards. Soul-vow rows have explicit names. Preview effects use the same contact footprints as combat.

Effects have one rendering priority policy: enemy warnings above the newest player skill, older skills, weapon strikes and scenery. Six pooled floor marks use distinct weapon-family masks. The three cores leave different 1.8-second aftermath marks; repeated Reaping Orbit pulses reuse one mark. These spent marks stay at their impact position while active rings and other following effects travel with their caster. Damage within 0.25 seconds is combined per victim. FLOW changes color at three casts and adds a bounded weapon-tip trail at five; it does not alter damage, currency or cooldowns.

Skill transitions carry the displayed pose into the next clip, with contact-aware bridges and follow-through. Heavy contacts have a restrained camera response, and large area skills briefly widen the view according to the shake setting. Boss phase changes have a short presentation pause; deaths slow briefly and recovery openings receive a floor mark. All simulation timings and replay inputs remain version 0.12.0.

Five painted north walls anchor the gates. A painted pilgrim exit replaces the old translucent cylinder. A repeated stone border replaces the black floor band. Warden, Witness and Cantor have separate floor art; the arena bounds and optional-entry rules are unchanged. Generated braziers, a gate threshold, draped Lust niche, Gluttony cauldron, chained Greed chest and broken Wrath column remain outside the fighting area. Environment models and shaders are prepared before a descent.
