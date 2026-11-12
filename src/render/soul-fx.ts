import * as T from "three";
import { CORES, CAST_TIME, CORE_TIME, type AbilityId } from "../sim/abilities";
import type { SimEvent, World } from "../sim/world";

// Matte, layered silhouettes: no additive bloom, full-screen flashes or strobing.
// Geometry is shared; at most 32 transient motifs and 4 trails per tick survive.
const colors = {
  lance: 0x9dc2c5,
  ember: CORES.ember.color,
  ash: CORES.ash.color,
  iron: CORES.iron.color,
};
const ring = new T.RingGeometry(0.89, 1, 64);
const shard = new T.PlaneGeometry(0.65, 2.4);
const lanceGeo = new T.ConeGeometry(0.1, 1.2, 5).rotateZ(-Math.PI / 2);
const trailGeo = new T.PlaneGeometry(1.5, 0.1).rotateX(-Math.PI / 2);
const blade = new T.TorusGeometry(1, 0.035, 4, 32, Math.PI * 0.8);
const orbitBlade = new T.BufferGeometry();
const strip: number[] = [],
  indices: number[] = [];
for (let i = 0; i <= 32; i++) {
  const t = i / 32,
    a = t * 1.65,
    edge = 0.92,
    inner = edge - 0.16 * Math.sin(Math.PI * t);
  strip.push(
    Math.cos(a) * edge,
    0,
    Math.sin(a) * edge,
    Math.cos(a) * inner,
    0,
    Math.sin(a) * inner,
  );
  if (i < 32) {
    const j = i * 2;
    indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
  }
}
orbitBlade.setAttribute("position", new T.Float32BufferAttribute(strip, 3));
orbitBlade.setIndex(indices);
interface Motif {
  root: T.Group;
  life: number;
  max: number;
  radius: number;
  kind: AbilityId | "combo" | "trail";
  inward: boolean;
  travel?: boolean;
}
export class SoulFx {
  private motifs: Motif[] = [];
  private root = new T.Group();
  private time = 0;
  private ward = new T.Group();
  private core = new T.Mesh(
    new T.OctahedronGeometry(0.11),
    new T.MeshBasicMaterial({ color: 0xcba670 }),
  );
  private seal: T.CanvasTexture;
  private flame: T.CanvasTexture;
  constructor(scene: T.Scene) {
    scene.add(this.root);
    this.root.add(this.ward, this.core);
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    g.translate(256, 256);
    g.strokeStyle = "#d2bc96";
    g.lineWidth = 3;
    for (const r of [163, 190, 230]) {
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = 0; i < 12; i++) {
      g.save();
      g.rotate((i * Math.PI) / 6);
      g.beginPath();
      g.moveTo(-7, -200);
      g.lineTo(0, -222);
      g.lineTo(7, -200);
      g.moveTo(0, -207);
      g.lineTo(0, -187);
      g.stroke();
      g.restore();
    }
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI * 4) / 5 - Math.PI / 2;
      g.lineTo(Math.cos(a) * 160, Math.sin(a) * 160);
    }
    g.stroke();
    const flame = document.createElement("canvas");
    flame.width = 256;
    flame.height = 512;
    const f = flame.getContext("2d")!;
    // Painted tapered tongues with transparent edges, not geometric spikes.
    for (let layer = 0; layer < 4; layer++) {
      const inset = layer * 18;
      const gradient = f.createLinearGradient(0, 500, 0, 15 + layer * 65);
      gradient.addColorStop(0, "rgba(88,32,24,0)");
      gradient.addColorStop(0.16, "rgba(166,67,38,.48)");
      gradient.addColorStop(
        0.5,
        layer > 1 ? "rgba(224,165,92,.72)" : "rgba(192,94,45,.50)",
      );
      gradient.addColorStop(1, "rgba(190,105,66,0)");
      f.fillStyle = gradient;
      f.beginPath();
      f.moveTo(40 + inset, 490);
      f.bezierCurveTo(20 + inset, 350, 160, 320, 85 + inset, 190);
      f.bezierCurveTo(150, 240, 110, 80, 158, 12 + layer * 60);
      f.bezierCurveTo(115, 190, 245 - inset, 230, 196 - inset, 350);
      f.bezierCurveTo(230 - inset, 420, 190 - inset, 475, 178 - inset, 490);
      f.closePath();
      f.fill();
    }
    this.flame = new T.CanvasTexture(flame);
    this.flame.colorSpace = T.SRGBColorSpace;
    this.seal = new T.CanvasTexture(c);
    this.seal.colorSpace = T.SRGBColorSpace;
    for (let i = 0; i < 6; i++) {
      const m = new T.Mesh(
        new T.PlaneGeometry(0.48, 1.5),
        new T.MeshBasicMaterial({
          color: 0xa96d80,
          transparent: true,
          opacity: 0.14,
          side: T.DoubleSide,
          depthWrite: false,
        }),
      );
      const a = (i * Math.PI) / 3;
      m.position.set(Math.cos(a) * 0.75, 0.9, Math.sin(a) * 0.75);
      m.rotation.y = -a + Math.PI / 2;
      this.ward.add(m);
    }
  }
  private part(
    root: T.Group,
    geo: T.BufferGeometry,
    color: number,
    opacity = 0.55,
  ) {
    const m = new T.Mesh(
      geo,
      new T.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        side: T.DoubleSide,
      }),
    );
    root.add(m);
    m.userData.alpha = opacity;
    return m;
  }
  event(e: SimEvent) {
    if (e.type !== "ability" && e.type !== "combo" && e.type !== "echo") return;
    const kind =
      e.type === "combo" ? "combo" : e.type === "echo" ? "ash" : e.ability!;
    const color =
      e.side === "enemy"
        ? 0xb15b64
        : kind === "combo"
          ? 0xb9a281
          : colors[kind];
    const root = new T.Group();
    root.position.set(e.x, 0.06, e.z);
    const charge = e.stage === "charge",
      lance = kind === "lance";
    const max = charge
      ? lance
        ? CAST_TIME
        : CORE_TIME
      : kind === "combo"
        ? 0.4
        : 0.9;
    const radius =
      e.amount ??
      (lance
        ? 1.2
        : charge
          ? 1.6
          : kind === "ash"
            ? 4.5
            : kind === "iron"
              ? 5
              : 3.5);
    if (lance && !charge) {
      root.rotation.y = (-(e.dir ?? 0) * Math.PI * 2) / 1024;
      for (const angle of [-0.17, 0, 0.17]) {
        const bolt = new T.Group();
        bolt.rotation.y = angle;
        root.add(bolt);
        const point = this.part(bolt, lanceGeo, color, 0.85);
        point.position.set(0.6, 0.95, 0);
        const trail = this.part(bolt, trailGeo, color, 0.4);
        trail.position.set(-0.5, 0.95, 0);
      }
    } else if (kind === "combo") {
      root.rotation.y = (-(e.dir ?? 0) * Math.PI * 2) / 1024;
      for (let i = 0; i < 3; i++) {
        const m = this.part(root, blade, color, 0.5 - i * 0.1);
        m.rotation.x = -Math.PI / 2;
        m.position.set(0.6, 0.5 + i * 0.13, 0);
        m.scale.setScalar(1.7 + i * 0.25);
      }
    } else {
      const glyph = this.part(
        root,
        new T.PlaneGeometry(2, 2),
        color,
        charge ? 0.45 : 0.25,
      );
      (glyph.material as T.MeshBasicMaterial).map = this.seal;
      glyph.rotation.x = -Math.PI / 2;
      for (let i = 0; i < (kind === "ash" ? 3 : lance ? 6 : 12); i++) {
        const a = (i * Math.PI * 2) / (kind === "ash" ? 3 : lance ? 6 : 12),
          m = this.part(
            root,
            kind === "ash" ? orbitBlade : shard,
            kind === "ember" ? 0xffffff : color,
            kind === "ember" ? 0.75 : 0.5,
          );
        m.position.set(Math.cos(a) * 0.8, 0.15, Math.sin(a) * 0.8);
        if (kind === "ash") {
          m.position.set(0, 0.65, 0);
          m.rotation.y = a;
        } else {
          (m.material as T.MeshBasicMaterial).map = this.flame;
          m.rotation.z = kind === "iron" ? Math.PI : 0;
          m.scale.set(0.7, 0.55 + (i % 3) * 0.2, 0.7);
          m.position.y = 0.7;
        }
      }
      const rim = this.part(root, ring, color, kind === "ember" ? 0.13 : 0.24);
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.02;
    }
    this.root.add(root);
    this.motifs.push({
      root,
      life: max,
      max,
      radius,
      kind,
      inward: charge || kind === "iron",
      travel: lance && !charge,
    });
    while (this.motifs.length > 32) this.dispose(this.motifs.shift()!);
  }
  private dispose(m: Motif) {
    this.root.remove(m.root);
    m.root.traverse((n) => {
      if (n instanceof T.Mesh) {
        n.material.dispose();
        if (
          ![ring, shard, blade, orbitBlade, lanceGeo, trailGeo].includes(
            n.geometry,
          )
        )
          n.geometry.dispose();
      }
    });
  }
  clear() {
    for (const m of this.motifs) this.dispose(m);
    this.motifs = [];
  }
  sync(w: World, dt: number) {
    this.time += dt;
    const p = w.player;
    this.core.visible = !!p.core && w.phase !== "dead";
    this.core.position.set(p.x, 1.25, p.z + 0.15);
    this.core.rotation.y = this.time;
    this.core.material.color.setHex(p.core ? CORES[p.core].color : 0x888888);
    this.core.scale.setScalar(0.7 + p.charge / 130);
    this.ward.visible = p.wardT > 0;
    this.ward.position.set(p.x, 0, p.z);
    this.ward.rotation.y = this.time * 0.4;
    for (const m of this.motifs) {
      m.life -= dt;
      const t = 1 - Math.max(0, m.life) / m.max;
      if (m.travel) {
        for (const b of m.root.children) {
          b.position.x += dt * 8;
          b.position.z += Math.sin(b.rotation.y) * dt * 8;
        }
      } else if (m.kind !== "combo") {
        const size = m.inward
          ? m.radius * (1 - 0.55 * t)
          : m.radius * (0.25 + 0.75 * (1 - (1 - t) ** 3));
        m.root.scale.set(size, 1, size);
        m.root.rotation.y += (m.kind === "ash" ? 2.8 : 0.16) * dt;
      }
      m.root.traverse((n) => {
        if (n instanceof T.Mesh) {
          n.material.opacity = n.userData.alpha * (1 - t) ** 0.7;
          if (n.geometry === shard)
            n.position.y =
              0.6 + Math.sin(t * Math.PI) * (m.kind === "ember" ? 0.5 : 0.3);
        }
      });
    }
    for (const m of this.motifs) if (m.life <= 0) this.dispose(m);
    this.motifs = this.motifs.filter((m) => m.life > 0);
  }
}
