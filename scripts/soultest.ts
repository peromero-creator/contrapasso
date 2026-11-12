import assert from "node:assert/strict";
import {
  createWorld,
  createDuelWorld,
  step,
  type Enemy,
  type Input,
} from "../src/sim/world.ts";
import { CORE_IDS, type CoreId } from "../src/sim/abilities.ts";
import { packInput, unpackInput } from "../src/sim/input.ts";
import { bot } from "../src/dev/bot.ts";
import { Referee } from "../server/referee.ts";
const idle: Input = { move: -1, aim: 0, attack: false, dash: false };
const enemy = (x = 3, z = 0, id = 100): Enemy => ({
  id,
  kind: "brute",
  x,
  z,
  hp: 2000,
  maxHp: 2000,
  r: 0.5,
  state: "recover",
  t: 100,
  cd: 100,
  dx: 0,
  dz: 0,
  hitDone: false,
  pattern: 0,
  flash: 0,
  spawn: 0,
  burnT: 0,
  burnCd: 0,
});
function arena(core: CoreId = "ember", staff = false) {
  const w = createWorld(
    3,
    ["ember", "ash", "iron", "pyre", "coup", "afterimage", "mercy"],
    {
      weaponId: staff ? "vesper-reed" : "starter",
      weaponLevel: 0,
      armorLevel: 0,
      core,
    },
  );
  w.player.x = w.player.z = 0;
  w.spawnDelay = 100;
  w.enemies = [enemy()];
  return w;
}
const frames = (w: ReturnType<typeof arena>, n: number, input = idle) => {
  for (let i = 0; i < n; i++) step(w, input);
};
for (const cast of [true, false])
  for (const ultimate of [true, false])
    for (const choice of [0, 1, 2, 3]) {
      const input = { ...idle, cast, ultimate, choice };
      assert.deepEqual(unpackInput(packInput(input)), input);
    }
const untrained = createWorld(1, [], {
  weaponLevel: 0,
  armorLevel: 0,
  core: "ember",
});
assert.equal(untrained.player.core, null);
step(untrained, { ...idle, cast: true, ultimate: true });
assert.equal(untrained.player.castN, 0);
for (const staff of [false, true]) {
  const w = arena("ember", staff);
  step(w, { ...idle, cast: true });
  assert.equal(w.shots.length, 0);
  frames(w, 20);
  assert.equal(w.shots.length, 0, "windup cannot hit");
  frames(w, 4);
  assert.equal(w.shots.length, staff ? 3 : 1);
  assert.equal(w.shots[0].pierce, staff ? 3 : 2);
  assert.ok(w.player.spellCd > 0);
  const n = w.player.castN;
  frames(w, 60, { ...idle, cast: true });
  assert.equal(w.player.castN, n, "cooldown prevents recast");
  assert.ok(w.enemies[0].hp < 2000);
}
for (const core of CORE_IDS) {
  const w = arena(core);
  w.player.hp = 40;
  w.player.charge = 99;
  step(w, { ...idle, ultimate: true });
  assert.equal(w.player.castN, 0);
  w.player.charge = 100;
  step(w, { ...idle, ultimate: true });
  assert.equal(w.player.charge, 0);
  frames(w, 35);
  assert.equal(w.enemies[0].hp, 2000);
  frames(w, 180);
  assert.ok(w.enemies[0].hp < 2000);
  assert.equal(w.player.castN, 1);
  assert.ok(
    w.player.charge < 5,
    "core cannot refill itself through its own pulses",
  );
  if (core === "iron") {
    assert.ok(w.player.hp > 40);
    assert.ok(w.player.wardT > 0);
  }
}
const overkill = arena();
overkill.enemies[0].hp = 1;
step(overkill, { ...idle, attack: true });
assert.ok(overkill.player.charge < 1, "overkill cannot farm charge");
const weave = arena();
step(weave, { ...idle, cast: true });
frames(weave, 44);
assert.ok(weave.player.weaveT > 0);
weave.shots = [];
weave.enemies = [enemy(2)];
weave.enemies[0].burnT = 0;
weave.enemies[0].burnCd = 100;
step(weave, { ...idle, attack: true });
assert.equal(weave.enemies[0].hp, 2000 - Math.round(30 * 1.25));
assert.equal(weave.player.weaveT, 0);
const timed = arena();
step(timed, { ...idle, cast: true });
frames(timed, 10, { ...idle, attack: true, dash: true, move: 0 });
assert.equal(timed.player.x, 0, "casting commits movement until recovery");
for (const core of CORE_IDS) {
  const a = arena(core, true),
    b = structuredClone(a);
  a.player.charge = b.player.charge = 100;
  for (let i = 0; i < 300; i++) {
    const input = {
      ...idle,
      cast: i === 150,
      ultimate: i === 0,
      attack: i > 210,
    };
    step(a, input);
    step(b, unpackInput(packInput(input)));
    assert.deepEqual(a, b);
    a.events.length = b.events.length = 0;
  }
}
const build = {
  skills: { ember: 1, ash: 1, iron: 1 },
  weaponLevel: 0,
  armorLevel: 0,
  weaponId: "vesper-reed" as const,
  core: "ember" as const,
};
const duel = createDuelWorld(1, build, build);
duel.enemies[0].spawn = 0;
duel.enemies[0].cd = 0;
duel.enemies[0].ability!.charge = 100;
duel.player.x = -1;
duel.enemies[0].x = 1;
frames(duel, 2);
assert.equal(duel.enemies[0].ability!.castId, "ember");
assert.equal(duel.enemies[0].ability!.charge, 0);
let now = 1_800_000_000_000;
const r = new Referee({ now: () => now, seed: () => 42 });
const owner = r.createSession().owner;
assert.throws(() => r.attune(owner, "ember"));
// Earn through a replay, then prove paid training + core enter the issued loadout.
const run = r.begin(owner);
const w = createWorld(run.seed, run.skills, run.equipment),
  inputs: number[] = [];
while (!["dead", "won"].includes(w.phase) && w.tick < 36000) {
  const i = bot(w);
  inputs.push(packInput(i));
  step(w, i);
  w.events.length = 0;
}
now += (w.tick * 1000) / 60 + 1000;
r.submit(owner, run.id, inputs);
r.train(owner, "ember");
r.attune(owner, "ember");
assert.equal(r.begin(owner).equipment.core, "ember");
assert.equal(r.profile(owner).build.core, "ember");
console.log(
  "Soul skills: PASS (27-bit inputs, paid gates, windup, staff fan, cooldown, charge conservation, three cores, rival casting, replay and authenticated attunement)",
);

const lethalSiphon = arena("iron");lethalSiphon.player.hp=1;lethalSiphon.player.charge=100;lethalSiphon.enemies[0].skills={reprisal:3};lethalSiphon.enemies[0].x=1;step(lethalSiphon,{...idle,ultimate:true});frames(lethalSiphon,45);assert.equal(lethalSiphon.player.hp,0,"siphon cannot revive a lethal retaliation");assert.equal(lethalSiphon.phase,"dead");
