# Contrapasso — game design

Working design. Planned economy features are distinguished from the implemented integration below.

## Idea

In Dante's poem a *contrapasso* is a punishment that mirrors the sin. In this game the hero fights down through their own hell, and whatever they build returns as punishment for someone else: a finished champion becomes an opponent that other players must beat.

- Genre: isometric-style action roguelike in the browser (2.5D: painted floors, 3D characters, fixed tilted camera).
- Setting: the first five circles of the Divine Comedy, as the hero's own sins: Limbo, Lust, Gluttony, Greed, Wrath. The other four come later.
- The hero is not Dante. Original name, world, characters and art.

## Site flow

1. Landing page: the title, an opening scene (a short video is planned), a Play button.
2. Play slides the page up and shows the mode choice: **Solo** and **Duel**.

## Solo

A run is five floors, one circle each. Each floor is one arena with waves of enemies; the boss waits on the fifth floor. After a floor the player picks one of three powers. Solo is where coin is earned.

## Duel

For the hackathon the duel is asynchronous: the player fights another player's champion, played by the AI with that player's gear and skills. The result is written to the champion's win/loss record. Real-time duels are on the roadmap.

## Economy

**Coin** is the in-game money. It is earned only by playing Solo and it is bound to the account (it cannot be sold or transferred). Coin is spent on:

- skills,
- "+" upgrades of weapons and armor,
- the duel entry stake,
- the right to enter an NFT mint,
- raffle tickets (with whatever is left).

**NFTs** are everything a player can customise: weapons, armor and the champion itself.

- Gear is released in limited mints (for example 500 or 1000 pieces).
- Entering a mint costs coin, so only people who played can mint. The mint price itself is paid in real value.
- All mint revenue goes into a pool that is handed to ticket holders by raffle. The system feeds itself and the team keeps nothing.
- Gear changes how the hero plays more than how strong they are. Power comes from "+" upgrades and skills, which cost coin, not money.

**NEAR-style NFT behaviour** (what the `nfts` track asks for):

- The champion NFT acts like an account: it holds its equipped gear, a coin vault and its win/loss record. Sell the champion and all of it moves with the NFT.
- Gear NFTs are dynamic: the "+" level, kills and past owners are written on the token.
- Resale royalties also flow into the raffle pool.

## Proposed economy defaults

| Open point | Default |
|---|---|
| "+" upgrade odds | +1 to +3 always succeed, +4 to +6 succeed 85% of the time, +7 to +9 70%. A failure burns only the coin. Maximum +9. Keep failure chances low. |
| Selling a champion | Equipped gear goes with it. Unequip an item first to keep it. Only equipped gear counts toward the champion's power. |
| Where skills live | On the champion, so a trained champion has value. |
| New players | No starting wheel. Everyone gets a free, account-bound starter weapon and armor that can be upgraded. |
| Mint oversubscribed | A coin deposit reserves a spot. If the mint sells out first, the coin is refunded. |
| Raffle timing | One draw per mint, several winners, drawn with verifiable randomness. |
| Duel payout | The challenger stakes coin. A win takes the same amount from the defending champion's vault; a loss pays the stake into that vault. No coin is created. |
| Duel fairness | Match by gear power so bought gear cannot stomp new players. |

## Known gaps

- **Bots.** Coin leads to real value through the raffle, so bots that really play are worth running. The referee server stops fake results, not bots. For the demo: a daily coin cap.
- **Raffle and the law.** A raffle with real money can count as a game of chance in some countries. On testnet this is not an issue; say so in the README.
- **Scope.** Judges want the foundation. One weapon mint and one champion are enough for the demo.

## Anti-cheat

A browser must not be able to claim a win. Fights are deterministic: the client sends the seed and every tick's input, the referee server replays the fight with the same code and signs the result, and the contracts accept only signed results. `scripts/simtest.ts` proves the replay property.

## Track fit

- `games`: "judged on the game loop, not the token", bonus if players never notice the chain.
- `nfts`: NFTs as accounts that own money, hold inventory and earn.

## Implemented integration (2026-11-12)

The testnet contract and local relay implement the champion vault, permanent training, champion/starter gear NFTs and asynchronous Duel. Public testnet deployment is verified at `contrapasso-261112-a23809.testnet`; see [NEAR setup and trust boundaries](NEAR.md).

Duel uses a 10-coin stake from each side, locked before combat. Only opted-in defenders with a funded vault are listed. Opponents use their deepest Solo build plus permanent training and equipped gear. A fight ends on death or after 90 simulation seconds; a challenge expires after 10 wall-clock minutes. The champion and its equipped gear cannot transfer during a Duel. The winner takes the 20-coin escrow pool; leaving or abandoning an opened challenge is a challenger loss. Duel creates no coin.

The current guest account is custodial: the local server holds its key and pays testnet gas through a restricted relay key. This is a demo foundation. External wallet claiming, non-starter mints, upgrades and raffle mechanics are still planned.
