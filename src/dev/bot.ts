import { weaponTechniques, TECHNIQUES } from "../sim/techniques.ts";
import { weapon } from "../sim/weapons.ts";
// A development-only input source. It follows the same rules as a player.
import { BOSS_GATE, bossAvailable, nearBossGate, nearWaveBell, waveBellReady, WAVE_BELL, PORTAL, type Input, type World } from "../sim/world.ts";
import { dirIndex } from "../sim/dirs.ts";

export function bot(w: World, visitBosses = false): Input {
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
    let target = visitBosses && bossAvailable(w) ? BOSS_GATE : PORTAL;
    if (target === PORTAL && !w.portalArmed && (p.x - PORTAL.x) ** 2 + (p.z - PORTAL.z) ** 2 < PORTAL.r ** 2)
      target = { ...PORTAL, z: PORTAL.z + PORTAL.r + 1 };
    // A straight route along the north edge can cross the ordinary exit and
    // silently skip a requested boss. Steer around its activation circle.
    if (target === BOSS_GATE) {
      const dx = target.x - p.x, dz = target.z - p.z;
      const length2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((PORTAL.x - p.x) * dx + (PORTAL.z - p.z) * dz) / Math.max(length2, 0.001)));
      if ((p.x + dx * t - PORTAL.x) ** 2 + (p.z + dz * t - PORTAL.z) ** 2 < (PORTAL.r + 0.25) ** 2) {
        const clearance = PORTAL.r + 1;
        target = p.z < PORTAL.z && Math.abs(p.x - PORTAL.x) < clearance
          ? { ...BOSS_GATE, x: PORTAL.x + (p.x < PORTAL.x ? -clearance : clearance), z: p.z }
          : { ...BOSS_GATE, x: p.x, z: PORTAL.z + clearance };
      }
    }
    const a = dirIndex(target.x-p.x, target.z - p.z);
    if(visitBosses && nearBossGate(w))return {move:-1,aim:a,attack:false,dash:false,choice:1};
    return { move: a, aim: a, attack: false, dash: false };
  }
  // Between waves the hero walks to the ritual bell and rings it to continue.
  if (waveBellReady(w)) {
    const a = dirIndex(WAVE_BELL.x - p.x, WAVE_BELL.z - p.z);
    if (nearWaveBell(w)) return { move: -1, aim: a, attack: false, dash: false, choice: 1 };
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
    cast: target.d < (p.spell === "nova-spell" ? 4 : p.spell === "siphon-spell" ? 7 : 10) && p.spellCd <= 0,
    ultimate: target.d < 5 && p.charge >= 100,
    technique: weaponTechniques(p.weaponId).findIndex((id,i) => (p.skills[id] ?? 0)>0 && p.techniqueCd[i]<=0 && target.d < TECHNIQUES[id].reach + Math.max(0,TECHNIQUES[id].dash ?? 0)) + 1,
    dash: dodge && w.tick % 90 === 0,
  };
}
