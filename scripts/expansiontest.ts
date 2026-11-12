import assert from "node:assert/strict";
import { createWorld, step, type Enemy, type Input } from "../src/sim/world.ts";
import { WEAPON_IDS, weapon } from "../src/sim/weapons.ts";
import { canLearn, SKILL_BRANCHES } from "../src/sim/skills.ts";
import { packInput, unpackInput } from "../src/sim/input.ts";
import { bot } from "../src/dev/bot.ts";
const idle: Input = { move: -1, aim: 0, attack: false, dash: false };
const target = (x: number): Enemy => ({
  id: 1,
  kind: "brute",
  x,
  z: 0,
  hp: 1000,
  maxHp: 1000,
  r: 0.5,
  state: "recover",
  t: 10,
  cd: 10,
  dx: 0,
  dz: 0,
  hitDone: false,
  pattern: 0,
  flash: 0,
  spawn: 0,
  burnT: 0,
  burnCd: 0,
});
for (const id of WEAPON_IDS) {
  const a = createWorld(567, ["haste", "ash", "afterimage", "coup"], {
    weaponId: id,
    weaponLevel: 3,
    armorLevel: 1,
  });
  const b = createWorld(567, ["haste", "ash", "afterimage", "coup"], {
    weaponId: id,
    weaponLevel: 3,
    armorLevel: 1,
  });
  for (let n = 0; n < 2400 && a.phase !== "dead" && a.phase !== "won"; n++) {
    const input = packInput(bot(a));
    step(a, unpackInput(input));
    step(b, unpackInput(input));
    assert.deepEqual(a, b, `${id} deterministic replay`);
    a.events = [];
    b.events = [];
  }
  const w = createWorld(1, [], { weaponId: id, weaponLevel: 2, armorLevel: 0 });
  w.player.x = w.player.z = 0;
  w.spawnDelay = 10;
  w.enemies = [target(1.3)];
  step(w, { ...idle, attack: true });
  assert.equal(w.player.swingT, weapon(id).swing);
  if (weapon(id).impactDelay)
    for (let i = 0; i < Math.ceil(weapon(id).impactDelay! * 60) + 1; i++)
      step(w, idle);
  if (weapon(id).ranged) for (let i = 0; i < 5; i++) step(w, idle);
  assert.equal(
    w.enemies[0].hp,
    1000 - weapon(id).damage - 4,
    `${id} authentic +2 damage`,
  );
}
const reach = (id: "cinder-requiem" | "widows-fang") => {
  const w = createWorld(1, [], { weaponId: id, weaponLevel: 0, armorLevel: 0 });
  w.player.x = w.player.z = 0;
  w.spawnDelay = 10;
  w.enemies = [target(3.4)];
  step(w, { ...idle, attack: true });
  return w.enemies[0].hp;
};
assert.ok(reach("cinder-requiem") < 1000);
assert.equal(reach("widows-fang"), 1000);
const free = createWorld(1);
free.spawnDelay = 0;
free.wave = 1;
step(free, idle);
assert.equal(free.phase, "cleared");
assert.deepEqual(free.offers, []);
const learned = createWorld(1, ["iron"]);
learned.spawnDelay = 0;
learned.wave = 1;
step(learned, idle);
assert.deepEqual(learned.offers, ["iron"]);
const heal = createWorld(1, ["mercy"]);
heal.spawnDelay = 10;
heal.player.hp = 40;
heal.pickups = [{ id: 3, x: heal.player.x, z: heal.player.z, healing: 18 }];
step(heal, idle);
assert.equal(heal.player.hp, 67);
assert.equal(heal.pickups.length, 0);
step(heal, idle);
assert.equal(heal.player.hp, 67);
for (const branch of SKILL_BRANCHES) {
  const owned: import("../src/sim/skills.ts").SkillId[] = [];
  for (const id of branch.skills) {
    assert.ok(canLearn(owned, id));
    owned.push(id);
  }
  assert.equal(canLearn([], branch.skills[3]), false);
}
// The new combo powers must change damage, not just replay deterministically.
const strike = (pyre: boolean, burning: boolean) => {
  const w = createWorld(1, pyre ? ["pyre"] : []);
  w.player.x = w.player.z = 0;
  w.player.swingN = 2;
  w.spawnDelay = 10;
  const e = target(1.3);
  e.burnT = burning ? 3 : 0;
  e.burnCd = 10;
  w.enemies = [e];
  step(w, { ...idle, attack: true });
  return e.hp;
};
assert.equal(
  strike(false, true) - strike(true, true),
  12,
  "Pyre detonates burning victims",
);
assert.equal(
  strike(false, false),
  strike(true, false),
  "Pyre requires burning",
);
const dash = (skill: "afterimage" | "coup") => {
  const w = createWorld(1, [skill]);
  w.player.x = w.player.z = 0;
  w.spawnDelay = 10;
  w.enemies = [target(5)];
  step(w, { ...idle, dash: true });
  while (w.player.dashT > 0) step(w, idle);
  return w;
};
const echo = dash("afterimage");
assert.equal(echo.enemies[0].hp, 988, "Echo damages once at dash landing");
step(echo, idle);
assert.equal(echo.enemies[0].hp, 988);
const coup = dash("coup");
step(coup, { ...idle, attack: true });
assert.equal(
  coup.enemies[0].hp,
  962,
  "First post-dash strike gains 25 percent",
);
while (coup.player.attackCd > 0) step(coup, idle);
coup.enemies[0].x = coup.player.x + 1;
coup.enemies[0].knockT = 0;
step(coup, { ...idle, attack: true });
assert.equal(
  coup.enemies[0].hp,
  932,
  "Combo bonus is consumed after one strike",
);
const expired = dash("coup");
for (let i = 0; i < 61; i++) step(expired, idle);
step(expired, { ...idle, attack: true });
assert.equal(expired.enemies[0].hp, 970, "Combo window expires");
console.log(
  "Expansion: PASS (all weapon replays, NFT upgrade damage, distinct reach, paid-only skills, prerequisites, healing conservation, pyre/echo/dash combos)",
);
