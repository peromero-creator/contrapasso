// Record a bot run, then replay only its packed inputs and compare every tick.
import assert from "node:assert/strict";
import { createWorld, step, DT, PORTAL, type Enemy, type Input, type World } from "../src/sim/world.ts";
import { dirIndex } from "../src/sim/dirs.ts";
import { packInput as pack, unpackInput as unpack } from "../src/sim/input.ts";
import { SKILL_IDS, type SkillId } from "../src/sim/skills.ts";

function bot(w: World): Input {
  const p = w.player;
  if (w.phase === "reward") return { move: -1, aim: p.aim, attack: false, dash: false, choice: 1 + w.floor % Math.max(1, w.offers.length) };
  let best = null as null | { d: number; x: number; z: number };
  for (const e of w.enemies) {
    if (e.spawn > 0) continue;
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (!best || d < best.d) best = { d, x: e.x, z: e.z };
  }
  if (w.phase === "cleared") {
    const a = dirIndex(0 - p.x, PORTAL.z - p.z);
    return { move: a, aim: a, attack: false, dash: false };
  }
  if (!best) return { move: -1, aim: p.aim, attack: false, dash: false };
  const aim = dirIndex(best.x - p.x, best.z - p.z);
  const close = best.d < 2.6;
  // step back from danger now and then, otherwise close in and swing
  const dodge = w.tick % 90 < 12;
  const move = dodge ? (aim + 256) % 1024 : close ? -1 : aim;
  return { move, aim, attack: close, dash: dodge && w.tick % 90 === 0 };
}

const digest = (w: World) => JSON.stringify(w);

function record(seed: number, maxTicks: number, trained: readonly SkillId[] = []) {
  const w = createWorld(seed, trained);
  const log: { input: number; state: string }[] = [];
  while (w.tick < maxTicks && w.phase !== "dead" && w.phase !== "won") {
    const input = bot(w);
    step(w, input);
    assert.ok(Number.isFinite(w.player.x) && Number.isFinite(w.player.z));
    assert.ok(w.enemies.every((e) => Number.isFinite(e.x) && Number.isFinite(e.z)));
    assert.ok(w.shots.every((s) => Number.isFinite(s.x) && Number.isFinite(s.z)));
    log.push({ input: pack(input), state: digest(w) });
    w.events.length = 0;
  }
  return { w, log };
}

const idle: Input = { move: -1, aim: 0, attack: false, dash: false };
function arena() {
  const w = createWorld(1);
  w.player.x = w.player.z = 0;
  w.spawnDelay = 10;
  return w;
}
function enemy(kind: Enemy["kind"]): Enemy {
  return {
    id: 1, kind, x: 1.3, z: 0, hp: 30, maxHp: 30, r: 0.55,
    state: "windup", t: DT / 2, cd: 0, dx: -1, dz: 0,
    hitDone: false, pattern: 3, flash: 0, spawn: 0, burnT: 0, burnCd: 0,
  };
}

// A killing blow must prevent both a last melee hit and a last projectile volley.
for (const kind of ["imp", "archer", "brute", "warden"] as const) {
  const w = arena();
  const e = enemy(kind);
  if (kind === "brute") e.state = "act";
  w.enemies.push(e);
  step(w, { ...idle, attack: true });
  assert.equal(w.player.hp, 100, `killed ${kind} must not hurt the player`);
  assert.equal(w.shots.length, 0, `killed ${kind} must not fire`);
  assert.equal(w.player.kills, 1);
  assert.equal(w.enemies.length, 0);
}

// Dash immunity and the damage grace period prevent unavoidable stacked hits.
for (const dash of [false, true]) {
  const w = arena();
  for (let id = 1; id <= 2; id++) w.shots.push({ id, x: 0.4, z: 0, vx: 0, vz: 0, life: 1, dmg: 9 });
  step(w, { ...idle, dash });
  assert.equal(w.player.hp, dash ? 100 : 91);
}

// The portal restores health once, and the final wave can finish the run.
const portal = arena();
portal.phase = "cleared";
portal.player.x = PORTAL.x;
portal.player.z = PORTAL.z;
portal.player.hp = 65;
step(portal, idle);
assert.equal(portal.floor, 2);
assert.equal(portal.player.hp, 85);
assert.equal(portal.phase, "fight");
const victory = arena();
victory.unlocked = ["ember", "iron", "haste"];
victory.floor = 5;
victory.wave = 2;
victory.wavesInFloor = 3;
victory.spawnDelay = 0;
step(victory, idle);
assert.equal(victory.phase, "reward");
assert.equal(new Set(victory.offers).size, 3);
const waiting = digest(victory);
step(victory, idle);
step(victory, { ...idle, choice: 4 });
assert.equal(digest(victory), waiting, "the reward waits for a valid selection");
step(victory, { ...idle, choice: 1 });
assert.equal(victory.phase, "cleared");
victory.player.x=PORTAL.x;victory.player.z=PORTAL.z;step(victory,idle);
assert.equal(victory.phase, "won");
for (const phase of ["dead", "won"] as const) {
  const w = arena();
  w.phase = phase;
  const before = digest(w);
  step(w, { ...idle, attack: true, dash: true });
  assert.equal(digest(w), before, "finished runs must stay frozen");
}
console.log("Combat regressions: PASS (killing blows, invulnerability, portal, victory, terminal state)");

// Every power changes its advertised combat behavior, including interactions.
function skilled(id: SkillId) {
  const w = arena(); w.player.skills[id] = 1; return w;
}
const ember = skilled("ember");
const burning = enemy("brute"); burning.hp = burning.maxHp = 200; burning.state = "recover"; burning.t = 10;
ember.enemies.push(burning);
step(ember, { ...idle, attack: true });
const hpAfterSwing = burning.hp;
for (let i = 0; i < 40; i++) { step(ember, idle); ember.events.length = 0; }
assert.ok(burning.hp < hpAfterSwing, "burn keeps damaging after the swing");
const reach = skilled("reach"); const far = enemy("imp"); far.x = 4; reach.enemies.push(far);
step(reach, { ...idle, attack: true }); assert.equal(reach.player.kills, 1);
const verdict = skilled("verdict"); verdict.player.swingN = 2;
const heavy = enemy("brute"); heavy.hp = 60; verdict.enemies.push(heavy);
step(verdict, { ...idle, attack: true }); assert.equal(verdict.player.kills, 1);
const ash = skilled("ash"); const near = enemy("imp"); near.hp = 18; ash.enemies.push(near);
ash.shots.push({ id: 2, x: 0.4, z: 0, vx: 0, vz: 0, dmg: 9, life: 1 });
step(ash, { ...idle, dash: true }); assert.equal(ash.player.kills, 1); assert.equal(ash.shots.length, 0); assert.ok(ash.player.dashCd < 0.75);
const blood = skilled("blood"); blood.player.hp = 50; blood.enemies.push(enemy("imp"));
step(blood, { ...idle, attack: true }); assert.equal(blood.player.hp, 52);
const iron = createWorld(1, ["iron"]); iron.spawnDelay = 10;
iron.shots.push({ id: 1, x: iron.player.x, z: iron.player.z, vx: 0, vz: 0, dmg: 20, life: 1 });
step(iron, idle); assert.equal(iron.player.maxHp, 120); assert.equal(iron.player.hp, 102);
const haste = skilled("haste"); const normal = arena();
step(haste, { ...idle, move: 0, attack: true }); step(normal, { ...idle, move: 0, attack: true });
assert.ok(haste.player.x > normal.player.x); assert.ok(haste.player.attackCd < normal.player.attackCd);
const reprisal = skilled("reprisal"); const attacker = enemy("imp"); attacker.hp = 16; reprisal.enemies.push(attacker);
step(reprisal, idle); assert.equal(reprisal.player.hp, 90); assert.equal(reprisal.player.kills, 1);
const mortal = skilled("reprisal"); mortal.player.skills.blood = 3; mortal.player.hp = 1;
const lastAttacker = enemy("imp"); lastAttacker.hp = 16; mortal.enemies.push(lastAttacker);
step(mortal, idle); assert.equal(mortal.phase, "dead"); assert.equal(mortal.player.hp, 0, "life on kill cannot revive a lethal hit");
for (const id of SKILL_IDS) {
  const w = arena(); w.floor = 2; w.wave = 1; w.spawnDelay = 0; w.player.skills[id] = 3;
  step(w, idle); assert.ok(!w.offers.includes(id), "maxed powers cannot be offered");
}
for (const move of [-1, 0, 1023]) for (const aim of [0, 1023]) for (const choice of [0, 1, 2, 3]) {
  const input = { move, aim, choice, attack: true, dash: true };
  assert.deepEqual(unpack(pack(input)), { ...input, cast: false, ultimate: false, technique: 0 });
}
// Technique codes 1..4 are slots and 5 is the jump; 6 and 7 stay invalid.
for (const n of [-1, 0.5, 2047, 0x40000000, 6 << 27, 7 << 27, NaN]) assert.throws(() => unpack(n));
console.log("Powers and input codec: PASS (all eight powers, rank cap, choices, invalid inputs)");

for (const seed of [1, 42, 20261112, 987654321]) {
  const { w: a, log } = record(seed, 60 * 60 * 6);
  const b = createWorld(seed);
  for (const entry of log) {
    step(b, unpack(entry.input));
    assert.equal(digest(b), entry.state, `seed ${seed}: replay diverged at tick ${b.tick}`);
    b.events.length = 0;
  }
  console.log(
    `seed ${seed}: ${a.phase} on floor ${a.floor} wave ${a.wave + 1}, ${(a.tick / 60).toFixed(0)}s, hp ${a.player.hp}, coins ${a.player.coins}, kills ${a.player.kills} | replay=${log.length} ticks matched`,
  );
}
const complete = record(42, 60 * 600, SKILL_IDS);
assert.equal(complete.w.phase, "won", "a trained champion can complete all five circles");
const championReplay = createWorld(42, SKILL_IDS);
for (const entry of complete.log) {
  step(championReplay, unpack(entry.input));
  assert.equal(digest(championReplay), entry.state, `complete replay diverged at ${championReplay.tick}`);
  championReplay.events.length = 0;
}
console.log(`Five-circle champion: PASS (${complete.log.length} replay ticks, boss defeated)`);
console.log("PASS");
