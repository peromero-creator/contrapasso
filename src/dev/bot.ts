// A development-only input source. It follows the same rules as a player.
import type { Input, World } from "../sim/world.ts";
import { dirIndex } from "../sim/dirs.ts";

export function bot(w: World): Input {
  const p = w.player;
  if (w.phase === "reward") return { move: -1, aim: p.aim, attack: false, dash: false, choice: 1 + w.floor % 3 };
  if (w.phase === "cleared") { const a = dirIndex(-p.x, -7.9 - p.z); return { move: a, aim: a, attack: false, dash: false }; }
  let target = null as null | { d: number; x: number; z: number };
  for (const e of w.enemies) {
    if (e.spawn > 0) continue;
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (!target || d < target.d) target = { d, x: e.x, z: e.z };
  }
  if (!target) return { move: -1, aim: p.aim, attack: false, dash: false };
  const aim = dirIndex(target.x - p.x, target.z - p.z);
  const dodge = w.tick % 90 < 12;
  const close = target.d < 2.6;
  return { move: dodge ? (aim + 256) % 1024 : close ? -1 : aim, aim, attack: close, dash: dodge && w.tick % 90 === 0 };
}
