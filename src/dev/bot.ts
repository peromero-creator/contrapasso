import { weapon } from "../sim/weapons.ts";
// A development-only input source. It follows the same rules as a player.
import { PORTAL, type Input, type World } from "../sim/world.ts";
import { dirIndex } from "../sim/dirs.ts";

export function bot(w: World): Input {
  const p = w.player;
  if (w.phase === "reward")
    return {
      move: -1,
      aim: p.aim,
      attack: false,
      dash: false,
      choice: 1 + (w.floor % Math.max(1, w.offers.length)),
    };
  if (w.phase === "cleared") {
    const a = dirIndex(-p.x, PORTAL.z - p.z);
    return { move: a, aim: a, attack: false, dash: false };
  }
  let target = null as null | { d: number; x: number; z: number };
  for (const e of w.enemies) {
    if (e.spawn > 0) continue;
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (!target || d < target.d) target = { d, x: e.x, z: e.z };
  }
  if (!target) return { move: -1, aim: p.aim, attack: false, dash: false };
  const aim = dirIndex(target.x - p.x, target.z - p.z);
  const dodge = w.tick % 90 < 12;
  const spec = weapon(p.weaponId);
  const close = target.d < spec.reach - 0.5;
  const retreat =
    !!spec.ranged && target.d < 4 && Math.abs(p.x) < 15 && Math.abs(p.z) < 9;
  return {
    move: dodge
      ? (aim + 256) % 1024
      : retreat
        ? (aim + 512) % 1024
        : close
          ? -1
          : aim,
    aim,
    attack: close,
    cast: target.d < 10 && p.spellCd <= 0,
    ultimate: target.d < 5 && p.charge >= 100,
    dash: dodge && w.tick % 90 === 0,
  };
}
