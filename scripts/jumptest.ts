import assert from "node:assert/strict";
import { createWorld, step, JUMP_TIME, PLUNGE_RADIUS, type Enemy, type Input } from "../src/sim/world.ts";
import { MAX_PACKED_INPUT, packInput, unpackInput } from "../src/sim/input.ts";
import { weapon } from "../src/sim/weapons.ts";

const idle: Input = { move: -1, aim: 0, attack: false, dash: false };
const target = (id: number, x: number, z = 0): Enemy => ({
  id, kind: "brute", x, z, hp: 1000, maxHp: 1000, r: 0.5, state: "recover", t: 100, cd: 100,
  dx: 0, dz: 0, hitDone: false, pattern: 0, flash: 0, spawn: 0, burnT: 0, burnCd: 0,
});
function arena() {
  const w = createWorld(1, [], { weaponId: "starter", weaponLevel: 0, armorLevel: 0 });
  w.player.x = w.player.z = 0;
  w.spawnDelay = 100;
  w.enemies = [target(100, 2), target(101, 9)];
  w.phase = "fight";
  return w;
}
const run = (w: ReturnType<typeof arena>, input: Input, ticks: number) => {
  const seen: string[] = [];
  for (let i = 0; i < ticks; i++) {
    step(w, input);
    seen.push(...w.events.map((e) => e.type));
    w.events.length = 0;
  }
  return seen;
};

// Codec: the jump shares the technique field, stays inside 30 bits, and old replays decode unchanged.
const packed = packInput({ ...idle, aim: 512, jump: true, technique: 3 });
assert.ok(packed <= MAX_PACKED_INPUT);
assert.deepEqual({ jump: unpackInput(packed).jump, technique: unpackInput(packed).technique }, { jump: true, technique: 0 });
assert.equal(unpackInput(packInput({ ...idle, technique: 4 })).jump, undefined);
assert.equal(unpackInput(packInput({ ...idle, technique: 4 })).technique, 4);
assert.throws(() => unpackInput(6 << 27));

// A plain jump leaves the ground for JUMP_TIME, lands without harm, and cannot be chained at once.
let w = arena();
let seen = run(w, { ...idle, jump: true }, 1);
assert.ok(seen.includes("jump") && w.player.jumpT > 0);
seen = run(w, idle, Math.ceil(JUMP_TIME * 60) + 1);
assert.ok(seen.includes("land") && !seen.includes("plunge"));
assert.equal(w.enemies[0].hp, 1000);
assert.equal(run(w, { ...idle, jump: true }, 1).includes("jump"), false, "jump cooldown");

// No dash, swing or technique starts in the air.
w = arena();
run(w, { ...idle, jump: true }, 1);
run(w, { ...idle, dash: true }, 3);
assert.equal(w.player.dashT, 0);

// Attacking in the air dives along the aim and breaks everything in reach on landing, once.
w = arena();
run(w, { ...idle, jump: true }, 1);
seen = [];
let landedAt = -1;
for (let t = 0; t < 30; t++) {
  const now = run(w, { ...idle, attack: true }, 1);
  if (now.includes("plunge") && landedAt < 0) landedAt = t;
  seen.push(...now);
}
assert.equal(seen.filter((e) => e === "plunge").length, 1);
assert.ok(landedAt >= 13 && landedAt <= 17, `the dive needs height first (landed at tick ${landedAt})`);
const spec = weapon("starter");
assert.equal(w.enemies[0].hp, 1000 - Math.round(spec.damage * spec.heavy));
assert.equal(w.enemies[1].hp, 1000, "outside the radius");
assert.ok(w.player.x > 1 && w.player.x < 4, "the dive carries the hero forward");
assert.ok(Math.hypot(w.enemies[0].x - w.player.x, w.enemies[0].z - w.player.z) <= PLUNGE_RADIUS + 0.5 + 2);
assert.ok(w.player.jumpT === 0 && !w.player.plunge);

// Same inputs, same world.
const a = arena(), b = arena();
for (const i of [{ ...idle, jump: true }, ...Array(40).fill({ ...idle, attack: true, move: 100 })]) { step(a, i); step(b, i); a.events.length = b.events.length = 0; }
assert.deepEqual(a.player, b.player);
assert.deepEqual(a.enemies, b.enemies);

console.log("Jump: PASS (30-bit codec, airtime, cooldown, no air dash, single plunge, radius, knock, determinism)");
