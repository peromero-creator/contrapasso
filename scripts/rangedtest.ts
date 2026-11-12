import assert from "node:assert/strict";
import {
  createWorld,
  createDuelWorld,
  step,
  type Enemy,
  type Input,
} from "../src/sim/world.ts";
const idle: Input = { move: -1, aim: 0, attack: false, dash: false };
const target = (id: number, x: number, z = 0): Enemy => ({
  id,
  kind: "brute",
  x,
  z,
  hp: 1000,
  maxHp: 1000,
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
function arena(id: "gravewhisper" | "vesper-reed", heavy = false) {
  const w = createWorld(1, [], { weaponId: id, weaponLevel: 2, armorLevel: 0 });
  w.player.x = w.player.z = 0;
  w.player.swingN = heavy ? 2 : 0;
  w.spawnDelay = 100;
  w.enemies = [target(100, 4), target(101, 6)];
  return w;
}
const bolt = arena("gravewhisper");
step(bolt, { ...idle, attack: true });
assert.equal(bolt.enemies[0].hp, 1000, "bolt travels before impact");
assert.equal(bolt.player.hp, bolt.player.maxHp);
for (let i = 0; i < 45; i++) step(bolt, idle);
assert.equal(bolt.enemies[0].hp, 965);
assert.equal(bolt.enemies[1].hp, 1000, "ordinary bolt stops at first target");
assert.equal(bolt.shots.length, 0);
const heavy = arena("gravewhisper", true);
step(heavy, { ...idle, attack: true });
for (let i = 0; i < 45; i++) step(heavy, idle);
assert.equal(heavy.enemies[0].hp, 949);
assert.equal(heavy.enemies[1].hp, 949, "third bolt pierces once per target");
const fan = arena("vesper-reed", true);
fan.enemies = [target(100, 4), target(101, 4, 0.85), target(102, 4, -0.85)];
step(fan, { ...idle, attack: true });
assert.equal(fan.shots.length, 3);
for (let i = 0; i < 40; i++) step(fan, idle);
assert.ok(
  fan.enemies.every((e) => e.hp < 1000),
  "fan reaches three lanes",
);
const expired = arena("vesper-reed");
expired.enemies = [target(100, 14)];
step(expired, { ...idle, attack: true });
for (let i = 0; i < 60; i++) step(expired, idle);
assert.equal(expired.enemies[0].hp, 1000);
assert.equal(expired.shots.length, 0, "range expires");
const fire = arena("gravewhisper");
fire.player.skills.ember = 1;
step(fire, { ...idle, attack: true });
for (let i = 0; i < 10; i++) step(fire, idle);
assert.ok(fire.enemies[0].burnT > 0, "ranged hits carry trained skills");
console.log(
  "Ranged: PASS (travel time, enemy-only hits, unique piercing, fan, expiry, upgraded damage, skill effects)",
);

// A ranged defender uses the same travelling projectile and cannot rotate it after release.
for (const identity of ["gravewhisper", "vesper-reed"] as const) {
  const w = createDuelWorld(
    42,
    { skills: {}, weaponLevel: 0, armorLevel: 0 },
    { skills: { ember: 1 }, weaponId: identity, weaponLevel: 1, armorLevel: 0 },
  );
  w.player.x = -2;
  w.enemies[0].x = 3;
  w.enemies[0].spawn = 0;
  w.enemies[0].cd = 0;
  for (let i = 0; i < 40 && !w.shots.length; i++) step(w, idle);
  assert.ok(w.shots.some((s) => s.side === "enemy" && s.style));
  const shot = w.shots[0],
    vx = shot.vx,
    vz = shot.vz;
  w.player.z = 4;
  step(w, idle);
  assert.equal(shot.vx, vx);
  assert.equal(shot.vz, vz);
  for (let i = 0; i < 50; i++) step(w, idle);
  assert.equal(
    w.player.hp,
    w.player.maxHp,
    "telegraphed ranged shot can be dodged",
  );
}
console.log("Ranged Duel: PASS (defender projectiles, fixed aim, dodge)");
