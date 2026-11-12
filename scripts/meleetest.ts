import assert from "node:assert/strict";
import { createWorld, step, type Enemy, type Input } from "../src/sim/world.ts";
import { weapon, type WeaponId } from "../src/sim/weapons.ts";
const idle: Input = { move: -1, aim: 0, attack: false, dash: false };
const target = (x: number, z = 0): Enemy => ({
  id: 100,
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
function arena(id: WeaponId, heavy = false) {
  const w = createWorld(1, [], { weaponId: id, weaponLevel: 2, armorLevel: 0 });
  w.player.x = w.player.z = 0;
  w.player.swingN = heavy ? 2 : 0;
  w.spawnDelay = 100;
  w.enemies = [target(2)];
  return w;
}
function impact(w: ReturnType<typeof arena>) {
  step(w, { ...idle, attack: true });
  for (let i = 0; i < 24; i++) step(w, idle);
}
for (const id of ["guillotine-hymn", "acheron-needle"] as const) {
  const w = arena(id);
  step(w, { ...idle, attack: true });
  assert.equal(w.enemies[0].hp, 1000, "no damage before contact");
  for (let i = 0; i < Math.floor(weapon(id).impactDelay! * 60) - 1; i++)
    step(w, idle);
  assert.equal(w.enemies[0].hp, 1000);
  for (let i = 0; i < 4; i++) step(w, idle);
  assert.equal(w.enemies[0].hp, 1000 - weapon(id).damage - 4);
  for (let i = 0; i < 40; i++) step(w, idle);
  assert.equal(
    w.enemies[0].hp,
    1000 - weapon(id).damage - 4,
    "hit exactly once",
  );
  const cancel = arena(id);
  step(cancel, { ...idle, attack: true });
  step(cancel, { ...idle, dash: true });
  for (let i = 0; i < 40; i++) step(cancel, idle);
  assert.equal(cancel.enemies[0].hp, 1000, "dodge cancels uncommitted strike");
}
const finish = arena("guillotine-hymn", true);
finish.enemies[0].hp = 300;
impact(finish);
assert.equal(
  finish.enemies[0].hp,
  300 - Math.round(Math.round(47 * 1.65) * 1.35),
);
const wide = arena("guillotine-hymn");
wide.enemies = [target(1, 2)];
impact(wide);
assert.ok(wide.enemies[0].hp < 1000, "axe cleaves across wide arc");
const narrow = arena("acheron-needle");
narrow.enemies = [target(1, 2)];
impact(narrow);
assert.equal(narrow.enemies[0].hp, 1000, "spear requires alignment");
for (const heavy of [false, true]) {
  const w = arena("acheron-needle", heavy);
  w.enemies = [target(5.4)];
  impact(w);
  assert.equal(w.enemies[0].hp < 1000, heavy, "only third thrust gains reach");
}
console.log(
  "Melee: PASS (contact timing, one hit, dodge cancel, execution, cleave, narrow thrust, third-hit reach)",
);
