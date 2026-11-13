import { skillInk } from "./skill-ink.ts";
import { FX_ORDER, FX_ALPHA } from "./effect-policy.ts";
import * as T from "three";
import { TECHNIQUES, techniqueId } from "../sim/techniques.ts";
import { CORES, abilityDuration, isSpell, type AbilityId, type CoreId } from "../sim/abilities.ts";
import type { SimEvent } from "../sim/world";

/** How hard a skill should land: 1 light, 2 firm, 3 heavy (capstones and ultimates). */
export function skillTier(id: AbilityId): 1 | 2 | 3 {
  const technique = techniqueId(id);
  if (technique) return technique.endsWith("-4") ? 3 : technique.endsWith("-3") ? 2 : 1;
  return isSpell(id) ? 1 : 3;
}
type Shape = "disc" | "half" | "strip";
/** The area a skill actually strikes, as the simulation resolves it. Projectiles have none. */
export function footprint(e: SimEvent): { shape: Shape; reach: number } | null {
  const id = e.ability!, technique = techniqueId(id);
  if (technique) {
    const spec = TECHNIQUES[technique];
    return spec.pattern === "fan" ? null : { shape: spec.pattern === "line" ? "strip" : spec.pattern === "arc" ? "half" : "disc", reach: spec.reach };
  }
  if (id === "lance") return null;
  if (id === "siphon-spell") return { shape: "strip", reach: 7 };
  return { shape: "disc", reach: e.amount ?? (id === "iron" ? 5 : id === "ash" ? 4.5 : id === "ember" ? 3.5 : 4) };
}
function tone(id: AbilityId) {
  if (id === "nova-spell") return 0xb4794d;
  if (id === "siphon-spell") return 0xb27e8c;
  if (!techniqueId(id)) return CORES[id as CoreId]?.color ?? 0xc4ad88;
  return id === "staff-2" ? 0xb77d53 : id.startsWith("staff") ? 0x8db2b3 : id.startsWith("dagger") ? 0x9eae8f : id.startsWith("axe") ? 0xb66e59 : 0xc4ad88;
}
const flat = (g: T.BufferGeometry) => g.rotateX(-Math.PI / 2);
const FILL: Record<Shape, T.BufferGeometry> = {
  disc: flat(new T.CircleGeometry(1, 48)),
  half: flat(new T.CircleGeometry(1, 32, -Math.PI / 2, Math.PI)),
  strip: flat(new T.PlaneGeometry(1, 1.7).translate(0.5, 0, 0)),
};
const EDGE: Record<Shape, T.BufferGeometry> = {
  disc: flat(new T.RingGeometry(0.93, 1, 64)),
  half: flat(new T.RingGeometry(0.93, 1, 32, 1, -Math.PI / 2, Math.PI)),
  // A line skill reads as one decisive cut down the middle of its lane.
  strip: flat(new T.PlaneGeometry(1, 0.16).translate(0.5, 0, 0)),
};
const WEIGHT = [
  { punch: 0.012, shake: 0.05, stop: 0 },
  { punch: 0.02, shake: 0.1, stop: 0.02 },
  { punch: 0.034, shake: 0.18, stop: 0.045 },
];
interface Stamp { root: T.Group; fill: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>; edge: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>; age: number; life: number; reach: number; peak: number; duck: number; shape: Shape; ability?: AbilityId }

/** Gives the player's skills weight: every contact stamps its real area on the ground,
 * answers through the camera, and yields the stage to whatever is cast next.
 * Matte, normal blending, no lights and no bloom; a small fixed pool. Presentation only. */
export class SkillWeight {
  readonly root = new T.Group();
  /** Skills cast back to back; 0 when the flow has lapsed. */
  chain = 0;
  peakChain = 0;
  private chainT = 0;
  private pulses = 0;
  private stamps: Stamp[] = [];
  constructor(scene: T.Scene) {
    scene.add(this.root);
    for (let i = 0; i < 6; i++) {
      const material = () => new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      const root = new T.Group(), fill = new T.Mesh(FILL.disc, material()), edge = new T.Mesh(EDGE.disc, material());
      fill.material.map=skillInk("sword-1");
      edge.position.y = 0.005;
      fill.renderOrder=edge.renderOrder=FX_ORDER.skill;
      root.add(fill, edge);
      root.visible = false;
      root.position.y = 0.05;
      this.root.add(root);
      this.stamps.push({ root, fill, edge, age: 0, life: 0, reach: 1, peak: 0, duck: 1, shape: "disc" });
    }
  }
  /** What the view should do for this event, or null when it is not a player's skill. */
  event(e: SimEvent): { punch: number; shake: number; stop: number; handoff: boolean; contact: boolean } | null {
    if (e.type !== "ability" || e.side === "enemy" || !e.ability) return null;
    const id = e.ability;
    if (e.stage === "charge") {
      this.chain = this.chainT > 0 ? this.chain + 1 : 1;
      this.chainT = abilityDuration(id) + 1.4;
      this.peakChain = Math.max(this.peakChain,this.chain);
      this.pulses = 0;
      return { punch: 0, shake: 0, stop: 0, handoff: this.chain >= 2, contact: false };
    }
    // Techniques and ultimates land on each pulse; spells land on release.
    if (e.stage !== (isSpell(id) ? "release" : "pulse")) return null;
    const tier = skillTier(id), base = WEIGHT[tier - 1];
    const scale = (this.pulses++ ? 0.5 : 1) * (1 + 0.12 * Math.min(3, Math.max(0, this.chain - 1)));
    const area = footprint(e);
    if (area) this.stamp(e, area.shape, area.reach, tier);
    return { punch: base.punch * scale, shake: base.shake * scale, stop: this.pulses > 1 ? 0 : base.stop, handoff: false, contact: true };
  }
  private stamp(e: SimEvent, shape: Shape, reach: number, tier: number) {
    // The newest skill owns the floor: older stamps step back at once.
    for (const s of this.stamps) if (s.root.visible) { s.duck = 0.4; s.fill.renderOrder=s.edge.renderOrder=FX_ORDER.previous; }
    const ultimate = !techniqueId(e.ability!) && !isSpell(e.ability!);
    const s = (ultimate && this.stamps.find(s=>s.root.visible && s.ability===e.ability)) || this.stamps.reduce((a, b) => (!b.root.visible || (a.root.visible && b.age / b.life > a.age / a.life) ? b : a));
    const color = tone(e.ability!);
    s.shape = shape; s.reach = reach; s.age = 0; s.duck = 1;
    s.life = ultimate ? 1.8 : 0.45 + 0.13 * tier;
    s.ability=e.ability;
    s.fill.renderOrder=s.edge.renderOrder=FX_ORDER.skill;
    s.fill.material.map=skillInk(e.ability!);
    s.peak = FX_ALPHA.floor;
    s.fill.geometry = FILL[shape]; s.edge.geometry = EDGE[shape];
    s.fill.material.color.setHex(color);
    s.edge.material.color.setHex(color).lerp(new T.Color(0xfff0d0), 0.35);
    s.root.position.set(e.x, 0.05, e.z);
    s.root.rotation.y = -(e.dir ?? 0) * Math.PI * 2 / 1024;
    s.root.visible = true;
    this.paint(s);
  }
  private paint(s: Stamp) {
    const t = Math.min(1, s.age / s.life), snap = Math.min(1, t / 0.16), out = 1 - (1 - snap) ** 3;
    const size = s.reach * (0.84 + 0.16 * out);
    if (s.shape === "strip") s.root.scale.set(s.reach * (0.55 + 0.45 * out), 1, 1);
    else s.root.scale.set(size, 1, size);
    s.fill.material.opacity = s.peak * (1 - t) ** 1.6 * s.duck;
    s.edge.material.opacity = 0.42 * (1 - t) ** 0.9 * s.duck;
  }
  update(dt: number) {
    if (this.chainT > 0 && (this.chainT -= dt) <= 0) this.chain = 0;
    for (const s of this.stamps) {
      if (!s.root.visible) continue;
      s.age += dt;
      if (s.age >= s.life) { s.root.visible = false; continue; }
      this.paint(s);
    }
  }
  clear(resetPeak = true) {
    this.chain = this.chainT = this.pulses = 0;
    if (resetPeak) this.peakChain = 0;
    for (const s of this.stamps) s.root.visible = false;
  }
}
