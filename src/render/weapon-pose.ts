import type * as THREE from "three";
import { weapon, type WeaponId } from "../sim/weapons";

/** Shared by the player, Duel rival and animation workshop. */
export function attackClip(id: WeaponId = "starter", combo = 1) {
  if (id === "guillotine-hymn")
    return combo % 3 === 0 ? "attack-axe-heavy" : "attack-axe";
  return (
    (
      {
        "acheron-needle": "attack-spear",
        gravewhisper: "attack-crossbow",
        "vesper-reed": "attack-staff",
        tollkeeper: "attack-hammer",
        "widows-fang": "attack-dagger",
      } as Partial<Record<WeaponId, string>>
    )[id] ?? "attack"
  );
}
export function orientWeapon(
  root: THREE.Group,
  spec: ReturnType<typeof weapon>,
) {
  const bolt = spec.ranged === "bolt";
  root.rotation.z = bolt ? 0 : -Math.PI / 2;
  root.rotation.y = bolt ? Math.PI / 2 : 0;
  root.position.set(
    bolt ? 0.22 : spec.model === "spear" ? -1.05 : -0.15,
    bolt ? -0.12 : 0,
    0,
  );
}

/** Reuse the existing rig, keeping contacts synchronized to each technique. */
export function abilityClip(id: import('../sim/abilities').AbilityId, identity: WeaponId) {
  if (id.includes('-') && !id.endsWith('-spell')) {
    if (identity === 'vesper-reed') return 'cast';
    return attackClip(identity, id.endsWith('-4') || id.endsWith('-3') ? 3 : 1);
  }
  return id === 'iron' ? 'ultimate-iron' : id === 'ember' || id === 'ash' ? 'ultimate' : 'cast';
}
