import assert from "node:assert/strict";
import { createDuelWorld, createWorld, step } from "../src/sim/world.ts";
import { SKILL_IDS } from "../src/sim/skills.ts";
import {
  copyBuild,
  fairMatch,
  DUEL_TICKS,
  type CombatBuild,
} from "../src/sim/build.ts";
import { packInput, unpackInput } from "../src/sim/input.ts";
import { bot } from "../src/dev/bot.ts";
import { Referee } from "../server/referee.ts";

const empty: CombatBuild = { skills: {}, weaponLevel: 0, armorLevel: 0 };
for (const seed of [1, 42, 20261112]) {
  const opponent: CombatBuild = {
    skills: Object.fromEntries(SKILL_IDS.map((id) => [id, 1])),
    weaponLevel: 0,
    armorLevel: 0,
  };
  const a = createDuelWorld(seed, opponent, empty),
    b = createDuelWorld(seed, opponent, empty);
  while (a.phase !== "won" && a.phase !== "dead") {
    const input = bot(a);
    step(a, input);
    step(b, unpackInput(packInput(input)));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.player.coins, 0);
    assert.equal(a.offers.length, 0);
    assert.ok(a.tick <= DUEL_TICKS);
    assert.ok(Number.isFinite(a.player.hp));
    a.events.length = b.events.length = 0;
  }
}
const boosted = createDuelWorld(
  1,
  { skills: { iron: 2 }, weaponLevel: 2, armorLevel: 3 },
  empty,
);
assert.equal(boosted.player.maxHp, 149);
assert.equal(boosted.player.weaponLevel, 2);
assert.equal(
  fairMatch(empty, {
    skills: { iron: 3, verdict: 3, ember: 3 },
    weaponLevel: 9,
    armorLevel: 9,
  }),
  false,
);

let now = Date.UTC(2026, 10, 12, 12);
const referee = new Referee({ now: () => now, seed: () => 42 });
const alice = referee.createSession().owner,
  bob = referee.createSession().owner;
const earn = (owner: string) => {
  const challenge = referee.begin(owner),
    w = createWorld(challenge.seed, challenge.skills, challenge.equipment),
    inputs: number[] = [];
  while (w.phase !== "won" && w.phase !== "dead") {
    const input = bot(w);
    inputs.push(packInput(input));
    step(w, input);
    w.events.length = 0;
  }
  now += Math.ceil((w.tick * 1000) / 60);
  return referee.submit(owner, challenge.id, inputs);
};
earn(alice);
earn(bob);
referee.defense(bob, true);
const target = referee.profile(bob).id;
const total = () => referee.profile(alice).coins + referee.profile(bob).coins;
const before = total();
const duel = referee.beginDuel(alice, target);
assert.equal(total(), before - 20, "both stakes must be escrowed");
assert.deepEqual(
  referee.beginDuel(alice, target),
  duel,
  "retrying an issued duel must not reserve another stake",
);
assert.throws(() => referee.train(bob, "iron"), /Duel/);
assert.equal(
  referee.opponents(alice).length,
  0,
  "a locked defender cannot be fought twice",
);
assert.throws(() => referee.submit(bob, duel.id, [0]), /not found/);
const w = createDuelWorld(
  duel.seed,
  duel.challengerBuild!,
  duel.opponent!.build,
);
const inputs: number[] = [];
while (w.phase !== "won" && w.phase !== "dead") {
  const input = bot(w);
  inputs.push(packInput(input));
  step(w, input);
  w.events.length = 0;
}
now += Math.ceil((w.tick * 1000) / 60);
referee.checkpoint(alice, duel.id, inputs.slice(0, 60));
assert.deepEqual(referee.currentDuel(alice)!.resumeInputs, inputs.slice(0, 60));
const rewound = [...inputs];
rewound[0] = rewound[0] ^ 1;
assert.throws(() => referee.submit(alice, duel.id, rewound), /rewind/);
const result = referee.submit(alice, duel.id, inputs);
assert.equal(total(), before, "Duel must never create coin");
assert.equal(result.receipt.result.coinDelta, w.phase === "won" ? 10 : -10);
assert.equal(
  referee.profile(alice).duelWins + referee.profile(alice).duelLosses,
  1,
);
referee.submit(alice, duel.id, inputs);
assert.equal(total(), before, "duplicate result must not move stakes twice");
const abandon = referee.beginDuel(alice, target);
referee.forfeit(alice, abandon.id);
assert.equal(total(), before);
const losses = referee.profile(alice).duelLosses;
const expiry = referee.beginDuel(alice, target);
now = expiry.expiresAt + 1;
assert.equal(
  referee.profile(alice).duelLosses,
  losses + 1,
  "expiry is a loss, not a free retry",
);
assert.equal(total(), before);
assert.equal(referee.profile(bob).lockedBy, null);
assert.throws(() => referee.submit(alice, expiry.id, [0]), /expired/);
assert.ok(
  referee.pendingChainOperations().some((e) => e.operation === "duel_settle"),
);
assert.ok(
  referee.pendingChainOperations().some((e) => e.operation === "duel_expire"),
);
console.log(
  "Duel: PASS (determinism, equipment, powers, escrow, ownership, fairness, idempotency, forfeit, expiry, coin conservation)",
);
