import * as THREE from "three";
import { weapon, type WeaponId } from "../sim/weapons.ts";

/** Shared by the player, Duel rival and animation workshop. */
export function attackClip(id: WeaponId = "starter", combo = 1) {
  if ((id === "starter" || id === "cinder-requiem") && combo % 3 === 2) return "attack-spear";
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
  // The dagger GLB is authored point-down (blade at -Y), opposite the other
  // melee models; flip it so the handle seats in the fist and the blade leads.
  const dagger = spec.model === "dagger";
  root.rotation.z = bolt ? 0 : dagger ? Math.PI / 2 : -Math.PI / 2;
  root.rotation.y = bolt ? Math.PI / 2 : 0;
  root.position.set(
    bolt ? 0.22 : dagger ? 0.8 : spec.model === "spear" ? -1.05 : spec.model === "hammer" ? -.45 : -0.15,
    bolt ? -0.12 : 0,
    0,
  );
}

/** Reuse the existing rig, keeping contacts synchronized to each technique. */
export function abilityClip(id: import('../sim/abilities').AbilityId, identity: WeaponId) {
  const clips: Record<string, string> = {
    'sword-1': 'attack', 'sword-2': 'attack-spear', 'sword-3': 'attack', 'sword-4': 'attack-vault',
    'hammer-1': 'attack-hammer', 'hammer-2': 'attack-axe', 'hammer-3': 'ultimate-iron', 'hammer-4': 'ultimate-slam',
    'dagger-1': 'attack-dagger', 'dagger-2': 'attack-crossbow', 'dagger-3': 'attack', 'dagger-4': 'attack',
    'staff-1': 'cast', 'staff-2': 'ultimate-slam', 'staff-3': 'cast', 'staff-4': 'ultimate',
    // attack-axe is the overhead chop; attack-axe-heavy is the full-turn sweep.
    'axe-1': 'attack-axe-heavy', 'axe-2': 'attack-axe', 'axe-3': 'attack-axe-heavy', 'axe-4': 'attack-axe',
    'spear-1': 'attack-spear', 'spear-2': 'attack-spear', 'spear-3': 'attack', 'spear-4': 'attack-spear',
  };
  if (clips[id]) return clips[id];
  if (id.startsWith('crossbow-')) return 'attack-crossbow';
  return id === 'ember' ? 'ultimate-slam' : id === 'iron' ? 'ultimate-iron' : id === 'ash' || id === 'nova-spell' ? 'ultimate' : 'cast';
}

/**
 * The hand joint sits at the wrist, inside the gauntlet cuff. A held shaft belongs
 * in the fist: measured on the hero rig, the curled fingers close about three
 * quarters of a forearm past the joint, a little toward the palm.
 */
const FIST_ALONG = 0.74;
const FIST_PALMWARD = -0.12;
/** The fist's centre in the hand joint's own space. The off hand passes palmward 0. */
export function fistPoint(hand: THREE.Object3D, target = new THREE.Vector3(), palmward = FIST_PALMWARD) {
  const reach = hand.position.length();
  return target.set(palmward * reach, FIST_ALONG * reach, 0);
}
export function fistWorld(hand: THREE.Object3D, target = new THREE.Vector3(), palmward = FIST_PALMWARD) {
  return hand.localToWorld(fistPoint(hand, target, palmward));
}
export function mountGrip(hand: THREE.Object3D, grip: THREE.Group) {
  hand.updateWorldMatrix(true, false);
  const scale = hand.getWorldScale(new THREE.Vector3());
  grip.scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
  grip.rotation.set(0, -Math.PI / 2, 0);
  fistPoint(hand, grip.position);
  hand.add(grip);
}
/** The fallback is a matte forged blade, with the same grip in every view. */
export function starterWeapon() {
  const root = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(.08,-.08); shape.lineTo(1.35,-.065); shape.lineTo(1.65,0);
  shape.lineTo(1.35,.065); shape.lineTo(.08,.08); shape.closePath();
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.045,bevelEnabled:false}),new THREE.MeshStandardMaterial({color:0x968a77,roughness:.7,metalness:0,emissive:0x342318,emissiveIntensity:.16}));
  blade.rotation.x = Math.PI / 2;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(.09,.09,.4),new THREE.MeshStandardMaterial({color:0x65513b,roughness:.85}));
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.24,6),new THREE.MeshStandardMaterial({color:0x322820,roughness:1}));
  handle.rotation.z = Math.PI/2; handle.position.x=-.08;
  // The fist closes on the handle, with the guard resting against it.
  const held = new THREE.Group(); held.position.x = .09;
  held.add(blade,guard,handle); root.add(held); return root;
}
