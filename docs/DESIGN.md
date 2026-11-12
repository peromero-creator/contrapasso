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

| Open point          | Default                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "+" upgrade odds    | +1 to +3 always succeed, +4 to +6 succeed 85% of the time, +7 to +9 70%. A failure burns only the coin. Maximum +9. Keep failure chances low.                                            |
| Selling a champion  | Equipped gear goes with it. Unequip an item first to keep it. Only equipped gear counts toward the champion's power.                                                                     |
| Where skills live   | On the champion, so a trained champion has value.                                                                                                                                        |
| New players         | No starting wheel. Everyone gets a free, account-bound starter weapon and armor that can be upgraded.                                                                                    |
| Mint oversubscribed | A coin deposit reserves a spot. If the mint sells out first, the coin is refunded.                                                                                                       |
| Raffle timing       | One draw per mint, up to three distinct winners. The testnet draw uses NEAR block randomness and publishes its seed for replay; stronger adversarial randomness remains production work. |
| Duel payout         | The challenger stakes coin. A win takes the same amount from the defending champion's vault; a loss pays the stake into that vault. No coin is created.                                  |
| Duel fairness       | Match by gear power so bought gear cannot stomp new players.                                                                                                                             |

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

The current guest account is custodial: the local server holds its key and pays ordinary gas through a restricted relay key. A confirmed wallet claim moves the champion, equipped gear, coin and native prize vault to an existing testnet wallet. This guest session then receives a fresh champion.

Gear upgrades are implemented with the odds and costs above. Every attempt binds the equipped NFT and its starting level; only confirmed metadata determines the next loadout.

The Reliquary implements a testnet edition of **Cinder Requiem**, a tradable weapon starting at +0 with the same base combat stats as the free blade. Each round has 12 editions, one per champion. Completing Solo unlocks a 10-coin reservation and a native mint price of 0.01 test NEAR. Cancelling an unpaid reservation refunds the coin; the draw refunds all remaining unpaid spots. An edition cannot be oversubscribed. Equipped tradable gear must be unequipped before transferring it separately, and cannot equip to two champions.

Tickets cost 5 coin, up to 10 per champion and 200 per round. After the deadline a player triggers an on-chain draw. Tickets weight selection without replacement; up to three distinct champions split 100% of the recorded pool equally, with any integer remainder going to the first winner. With no tickets, the full pool carries forward. The round publishes its block height and entropy so the selection can be replayed. Block randomness is adequate for a testnet demonstration; this is not a production VRF or a manipulation-proof raffle.

Native prizes belong to the champion NFT, can be withdrawn to its current owner, and return to the vault if a transfer fails. Transfers and gameplay writes lock while a native payout is pending. One bounded demo grant of 0.2 test NEAR is available after Solo, for up to six guest champions. The contract preserves prize liabilities and a minimum free reserve before sponsoring a guest. These are free testnet funds, with no real-money entry or payout.

NEP-199 royalty quotes allocate 10% to the contract and 90% to the seller. Marketplaces must honor the quote and actually pay `collect_royalty` to credit the tracked pool. A quote alone does not move funds.

## Next steps

1. Record the final demo and review the delivery checklist in `docs/SUBMISSION.md`.
2. Choose hosting and publish the repository when the owner is ready.
3. For production: wallet authentication/recovery, stronger randomness, independent contract review, oracle decentralization and additional bot controls. Mainnet is outside the current demo scope.
