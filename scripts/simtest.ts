// Headless check: a simple bot plays the run twice with the same seed.
// The two runs must end in exactly the same state (that is what lets a server replay a run).
import { createWorld, step, type Input, type World } from "../src/sim/world.ts";
import { dirIndex } from "../src/sim/dirs.ts";

function bot(w: World): Input {
  const p = w.player;
  let best = null as null | { d: number; x: number; z: number };
  for (const e of w.enemies) {
    if (e.spawn > 0) continue;
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (!best || d < best.d) best = { d, x: e.x, z: e.z };
  }
  if (w.phase === "cleared") {
    const a = dirIndex(0 - p.x, -7.9 - p.z);
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

function run(seed: number, maxTicks: number) {
  const w = createWorld(seed);
  while (w.tick < maxTicks && w.phase !== "dead" && w.phase !== "won") {
    step(w, bot(w));
    w.events.length = 0;
  }
  return w;
}

const digest = (w: World) => JSON.stringify([w.tick, w.rng, w.floor, w.wave, w.phase, w.player, w.enemies, w.shots]);

let ok = true;
for (const seed of [1, 42, 20261112, 987654321]) {
  const a = run(seed, 60 * 60 * 6);
  const b = run(seed, 60 * 60 * 6);
  const same = digest(a) === digest(b);
  const finite = Number.isFinite(a.player.x) && Number.isFinite(a.player.z) && a.enemies.every((e) => Number.isFinite(e.x) && Number.isFinite(e.z));
  ok &&= same && finite;
  console.log(
    `seed ${seed}: ${a.phase} on floor ${a.floor} wave ${a.wave + 1}, ${(a.tick / 60).toFixed(0)}s, hp ${a.player.hp}, coins ${a.player.coins}, kills ${a.player.kills} | deterministic=${same} finite=${finite}`,
  );
}
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
