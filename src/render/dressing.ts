import * as THREE from "three";
import type { ModelLibrary } from "./assets";
import { ARENA_HX, ARENA_HZ, type World } from "../sim/world";

/** Ambient inhabitants and scenery never write gameplay state or deal damage. */
export class Underworld {
  private root = new THREE.Group();
  private chains: THREE.Group[] = [];
  private boat = new THREE.Group();
  private spider = new THREE.Group();
  private legs: THREE.Group[] = [];
  private drops = new Map<number, THREE.Group>();
  private time = 0;
  private stone = new THREE.MeshStandardMaterial({
    color: 0x494348,
    roughness: 1,
    metalness: 0,
  });
  private iron = new THREE.MeshStandardMaterial({
    color: 0x302624,
    roughness: 0.9,
  });
  private bone = new THREE.MeshStandardMaterial({
    color: 0xb8ad94,
    roughness: 1,
  });
  private ember = new THREE.MeshBasicMaterial({ color: 0xe69a59 });
  constructor(scene: THREE.Scene, models: ModelLibrary) {
    scene.add(this.root);
    for (const side of [-1, 1])
      for (let i = 0; i < 5; i++) {
        const x = side * (ARENA_HX + 0.8),
          z = -ARENA_HZ + 2 + i * 4;
        const ruin = this.mesh(
          new THREE.CylinderGeometry(0.52, 0.8, 1.2 + (i % 3) * 0.7, 6),
          this.stone,
          x,
          0.8,
          z,
        );
        ruin.rotation.z = side * 0.12;
        this.mesh(
          new THREE.BoxGeometry(1.6, 0.35, 1.4),
          this.stone,
          x,
          0.12,
          z,
        );
        if (i % 2 === 0) {
          const chain = new THREE.Group();
          chain.position.set(x, 7, z);
          for (let k = 0; k < 9; k++) {
            const link = new THREE.Mesh(
              new THREE.TorusGeometry(0.18, 0.045, 5, 8),
              this.iron,
            );
            link.position.y = -k * 0.29;
            link.rotation.y = ((k % 2) * Math.PI) / 2;
            chain.add(link);
          }
          const cage = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.45),
            this.iron,
          );
          cage.position.y = -3;
          chain.add(cage);
          this.root.add(chain);
          this.chains.push(chain);
        }
      }
    // The ferryman circles the shore, outside the playable boundary.
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.3, 4.6),
      this.iron,
    );
    hull.position.y = 0.15;
    this.boat.add(hull);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.4, 4), this.iron);
    bow.rotation.x = Math.PI / 2;
    bow.position.z = -2.3;
    this.boat.add(bow);
    const cloak = new THREE.Mesh(
      new THREE.ConeGeometry(0.48, 1.7, 7),
      new THREE.MeshStandardMaterial({ color: 0x29282c, roughness: 1 }),
    );
    cloak.position.y = 1.15;
    this.boat.add(cloak);
    const hood = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 8, 6),
      this.iron,
    );
    hood.position.set(0, 2, 0);
    this.boat.add(hood);
    const face = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 7, 5),
      this.bone,
    );
    face.position.set(0, 2, -0.18);
    this.boat.add(face);
    const oar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 3.6, 5),
      this.iron,
    );
    oar.position.set(0.65, 1.4, 0);
    oar.rotation.z = -0.3;
    this.boat.add(oar);
    this.boat.position.set(-ARENA_HX - 0.6, 0, 0);
    this.root.add(this.boat);
    const water = this.mesh(
      new THREE.PlaneGeometry(4, ARENA_HZ * 2 + 4),
      new THREE.MeshBasicMaterial({
        color: 0x223234,
        transparent: true,
        opacity: 0.7,
      }),
      -ARENA_HX - 2,
      -0.08,
      0,
    );
    water.rotation.x = -Math.PI / 2;
    // A many-faced shore spider. The faces watch; this creature is not a target.
    const abdomen = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 10, 8),
      this.iron,
    );
    abdomen.scale.set(1, 0.6, 1.3);
    abdomen.position.y = 0.8;
    this.spider.add(abdomen);
    for (let i = 0; i < 5; i++) {
      const face = new THREE.Mesh(
        new THREE.SphereGeometry(0.23, 7, 5),
        this.bone,
      );
      face.scale.set(0.8, 1, 0.6);
      face.position.set((i - 2) * 0.27, 1.02, -0.6 + Math.abs(i - 2) * 0.08);
      this.spider.add(face);
      for (const offset of [-0.06, 0.06]) {
        const eye = new THREE.Mesh(
          new THREE.SphereGeometry(0.035, 5, 4),
          this.ember,
        );
        eye.position
          .copy(face.position)
          .add(new THREE.Vector3(offset, 0.04, -0.14));
        this.spider.add(eye);
      }
    }
    for (const side of [-1, 1])
      for (let i = 0; i < 4; i++) {
        const leg = new THREE.Group();
        leg.position.set(side * 0.5, 0.75, (i - 1.5) * 0.4);
        const a = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.035, 1.25, 5),
          this.iron,
        );
        a.rotation.z = side * 1;
        a.position.x = side * 0.5;
        leg.add(a);
        const b = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.018, 1.15, 5),
          this.iron,
        );
        b.rotation.z = -side * 0.25;
        b.position.set(side * 1, 0.1, 0);
        leg.add(b);
        this.spider.add(leg);
        this.legs.push(leg);
      }
    this.spider.position.set(ARENA_HX + 0.9, 0, -4);
    this.root.add(this.spider);
    for (const [kind, group, height] of [
      ["shore-spider", this.spider, 1.6],
      ["ferryman", this.boat, 2.7],
    ] as const) {
      void models.create(kind, height).then((model) => {
        if (!model) return;
        group.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry.dispose();
        });
        group.clear();
        group.add(model.root);
        if (kind === "shore-spider") this.legs = [];
      });
    }
  }
  private mesh(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    this.root.add(m);
    return m;
  }
  sync(w: World, dt: number) {
    this.time += dt;
    this.root.visible = w.mode === "solo";
    this.chains.forEach(
      (g, i) => (g.rotation.z = Math.sin(this.time * 0.5 + i) * 0.06),
    );
    this.boat.position.z = Math.sin(this.time * 0.09) * 5;
    this.boat.position.y = Math.sin(this.time * 0.8) * 0.06;
    this.spider.position.y = Math.sin(this.time * 0.7) * 0.025;
    this.spider.rotation.y = Math.sin(this.time * 0.16) * 0.12;
    this.legs.forEach(
      (g, i) => (g.rotation.x = Math.sin(this.time * 1.6 + i) * 0.16),
    );
    const live = new Set(w.pickups.map((p) => p.id));
    for (const [id, g] of this.drops)
      if (!live.has(id)) {
        this.root.remove(g);
        g.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            if (!Array.isArray(o.material)) o.material.dispose();
          }
        });
        this.drops.delete(id);
      }
    for (const item of w.pickups) {
      let g = this.drops.get(item.id);
      if (!g) {
        g = new THREE.Group();
        const vessel = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.3, 1),
          new THREE.MeshStandardMaterial({
            color: 0x9b172c,
            emissive: 0x95172c,
            emissiveIntensity: 0.6,
            roughness: 0.5,
          }),
        );
        vessel.position.y = 0.5;
        g.add(vessel);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.4, 0.52, 24),
          new THREE.MeshBasicMaterial({
            color: 0xff7f89,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.7,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        g.add(ring);
        this.root.add(g);
        this.drops.set(item.id, g);
      }
      g.position.set(item.x, Math.sin(this.time * 3 + item.id) * 0.07, item.z);
      g.rotation.y = this.time * 0.6;
    }
  }
}
