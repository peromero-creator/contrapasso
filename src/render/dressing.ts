import * as THREE from "three";
import { batchScenery } from "./static-batch.ts";
import type { ModelLibrary } from "./assets";
import { ARENA_HX, ARENA_HZ, type World } from "../sim/world";

/** Five perimeter compositions. Everything stays outside the playable rectangle. */
export class Underworld {
  private root = new THREE.Group();
  private circles: THREE.Group[] = [];
  private boat = new THREE.Group();
  private spider = new THREE.Group();
  private drops = new Map<number, THREE.Group>();
  private cloth: THREE.Mesh[] = [];
  private time = 0;
  private moving = new Set<THREE.Object3D>();
  private souls: THREE.Group[] = [];
  private censers: THREE.Group[] = [];
  private stone = new THREE.MeshStandardMaterial({
    color: 0x928a7e,
    roughness: 1,
  });
  private dark = new THREE.MeshStandardMaterial({
    color: 0x4c4840,
    roughness: 1,
  });
  private bone = new THREE.MeshStandardMaterial({
    color: 0xa39880,
    roughness: 1,
  });
  private bronze = new THREE.MeshStandardMaterial({
    color: 0x6e5740,
    roughness: 0.9,
    metalness: 0.12,
  });
  constructor(
    scene: THREE.Scene,
    private models: ModelLibrary,
  ) {
    scene.add(this.root);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ink = canvas.getContext("2d")!;
    ink.fillStyle = "#b0a89b";
    ink.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1800; i++) {
      const tone = 70 + Math.floor(Math.random() * 110);
      ink.fillStyle = `rgba(${tone},${tone},${tone},0.28)`;
      ink.fillRect(
        Math.random() * 128,
        Math.random() * 128,
        1 + Math.random() * 5,
        1 + Math.random() * 3,
      );
    }
    const grain = new THREE.CanvasTexture(canvas);
    grain.colorSpace = THREE.SRGBColorSpace;
    grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
    grain.repeat.set(0.4, 0.4);
    this.stone.map = grain;
    this.dark.map = grain;
    this.bone.map = grain;
    this.bronze.map = grain;

    for (let circle = 0; circle < 5; circle++) {
      const g = new THREE.Group();
      this.root.add(g);
      this.circles.push(g);
      // A continuous catacomb foundation grounds the niches instead of leaving props in a black void.
      const foundation = this.mesh(g,new THREE.PlaneGeometry(64,48),this.dark,0,-.12,0);
      foundation.rotation.x = -Math.PI/2;
      for(const side of [-1,1]) {
        this.box(g,1.2,1.3,28,side*(ARENA_HX+5.8),.4,0,this.dark);
      }
      // A low masonry shelf grounds scenery in the painted arena without covering combat.
      for (const side of [-1, 1]) {
        this.box(
          g,
          4.4,
          0.45,
          11,
          side * (ARENA_HX + 2.4),
          -0.23,
          -2,
          this.dark,
        );
        for (let i = 0; i < 4; i++) {
          const slab = this.box(
            g,
            3.9 - (i % 2) * 0.3,
            0.25,
            2.65,
            side * (ARENA_HX + 2.4),
            0,
            -6 + i * 2.5,
            this.stone,
          );
          slab.rotation.y = side * (i % 2 ? 0.035 : -0.025);
        }
      }
      const x = ARENA_HX + 2.4;
      if (circle === 0) {
        // Limbo: a quiet landing opposite a funerary colonnade.
        this.dock(g, -x, 0);
        this.arch(g, x, -4, 3.3, false);
        this.tomb(g, x, -1, 0.2);
        this.tomb(g, x, 2, -0.15);
        this.urn(g, x - 0.9, -6);
        this.urn(g, x + 0.8, -6);
      } else if (circle === 1) {
        // Lust: two broken thresholds and torn, wind-worn cloth.
        this.arch(g, -x, -3, 4.2, true);
        this.arch(g, x, 1, 3.7, true);
        this.banner(g, -x, -3, 3.7);
        this.banner(g, x, 1, 3.2);
        this.tomb(g, -x, 3, 0.35);
        this.urn(g, x, -5);
      } else if (circle === 2) {
        // Gluttony: a drained cistern and the spider's recessed ossuary.
        this.basin(g, -x, -1, 1.6);
        this.arch(g, x, -3, 3.8, true);

        for (let i = 0; i < 8; i++)
          this.urn(
            g,
            x + (i % 2 ? 1.3 : -1.3),
            -6 + Math.floor(i / 2) * 1.7,
            0.55,
          );
      } else if (circle === 3) {
        // Greed: abandoned counting tables, sealed coffers and a watching idol.
        this.arch(g, x, -3, 3.8, false);

        for (let i = 0; i < 3; i++) {
          this.box(g, 1.9, 0.85, 1.05, -x, 0.55, -4 + i * 2.6, this.dark);
          this.box(g, 2, 0.12, 1.15, -x, 1.02, -4 + i * 2.6, this.bronze);
          this.box(g, 0.12, 0.6, 1.18, -x, 0.7, -4 + i * 2.6, this.bronze);
        }
        this.urn(g, x, 2, 1.3);
      } else {
        // Wrath: the river returns beneath a fractured basalt shrine.
        this.dock(g, -x, 0);
        for (let i = 0; i < 5; i++) {
          const h = [2.7, 4, 3.2, 1.4, 2][i];
          const p = this.mesh(
            g,
            new THREE.CylinderGeometry(0.45, 0.65, h, 5),
            this.dark,
            x + (i % 2) * 0.6,
            h / 2,
            -6 + i * 1.8,
          );
          p.rotation.z = i % 2 ? 0.09 : -0.08;
        }
        this.basin(g, x, 3, 1.1);
      }
      this.populate(g, circle);
      // Broken reliefs at the far wall form a backdrop, not a row of obstacles.
      // Keep the optional doorway and the crypt return threshold unobstructed.
      if (circle === 2) {
        this.box(g, 7, 0.4, 1.6, -8, 0.1, -ARENA_HZ - 1.1, this.dark);
        this.box(g, 3.5, 0.9, 0.8, -9, 0.55, -ARENA_HZ - 1.4, this.stone);
      }
      this.box(g, 4, 0.35, 1.3, 9, 0.1, -ARENA_HZ - 1, this.stone);
    }
    for (const group of [...this.censers, ...this.souls]) batchScenery(group, new Set());
    for (const node of [...this.cloth, ...this.censers, ...this.souls]) this.moving.add(node);
    for (const group of this.circles) batchScenery(group, this.moving);
    this.root.add(this.boat, this.spider);
    this.boat.position.set(-ARENA_HX - 2.1, 0, 0);
    this.boat.rotation.y = 0;
    this.spider.position.set(ARENA_HX + 2.4, 0.4, -2.2);
    this.spider.rotation.y = -Math.PI / 5;
    for (const [kind, group, height] of [
      ["shore-spider", this.spider, 1.35],
      ["ferryman", this.boat, 2.7],
    ] as const) {
      void models.create(kind, height).then((model) => {
        if (model) group.add(model.root);
      });
    }
  }
  private mesh(
    g: THREE.Group,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  }
  private box(
    g: THREE.Group,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat = this.stone,
  ) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, -h / 2);
    shape.lineTo(w / 2, -h / 2);
    shape.lineTo(w / 2, h / 2);
    shape.lineTo(-w / 2, h / 2);
    shape.closePath();
    const bevel = Math.min(0.09, h * 0.18, w * 0.08, d * 0.08);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: d - bevel * 2,
      bevelEnabled: true,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 1,
      steps: 1,
    });
    geo.translate(0, 0, -d / 2 + bevel);
    return this.mesh(g, geo, mat, x, y, z);
  }
  private arch(
    g: THREE.Group,
    x: number,
    z: number,
    height: number,
    broken: boolean,
  ) {
    const niche = new THREE.Group();
    niche.position.set(x, 0.1, z);
    niche.rotation.y = x > 0 ? -0.25 : 0.25;
    g.add(niche);
    const fallback = new THREE.Group();
    niche.add(fallback);
    this.moving.add(fallback);
    for (const side of [-1, 1]) {
      const h = broken && side === 1 ? height * 0.55 : height;
      this.box(fallback, 0.65, h, 0.8, side * 1.4, h / 2, 0, this.stone);
    }
    void this.models.create("funerary-arch", height).then((model) => {
      if (!model) return;
      niche.remove(fallback);
      fallback.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      niche.add(model.root);
    });
  }
  private tomb(g: THREE.Group, x: number, z: number, angle: number) {
    const t = new THREE.Group();
    t.position.set(x, 0.15, z);
    t.rotation.y = angle;
    g.add(t);
    this.box(t, 1.1, 0.6, 2, 0, 0.3, 0, this.dark);
    this.box(t, 1.3, 0.2, 2.2, 0, 0.7, 0, this.stone);
    this.box(t, 0.55, 0.08, 1.3, 0, 0.84, 0, this.bone);
  }
  private urn(g: THREE.Group, x: number, z: number, scale = 1) {
    this.mesh(
      g,
      new THREE.CylinderGeometry(0.28 * scale, 0.38 * scale, 0.7 * scale, 8),
      this.bone,
      x,
      0.2 + 0.35 * scale,
      z,
    );
    this.mesh(
      g,
      new THREE.CylinderGeometry(0.34 * scale, 0.3 * scale, 0.1, 8),
      this.dark,
      x,
      0.25 + 0.7 * scale,
      z,
    );
  }
  private basin(g: THREE.Group, x: number, z: number, radius: number) {
    this.mesh(
      g,
      new THREE.CylinderGeometry(radius, radius + 0.15, 0.6, 12),
      this.stone,
      x,
      0.3,
      z,
    );
    this.mesh(
      g,
      new THREE.CylinderGeometry(radius - 0.16, radius - 0.16, 0.02, 12),
      this.dark,
      x,
      0.61,
      z,
    );
    this.urn(g, x, z, 0.6);
  }
  private dock(g: THREE.Group, x: number, z: number) {
    this.box(
      g,
      4.2,
      0.08,
      10,
      x,
      0.19,
      z,
      new THREE.MeshStandardMaterial({ color: 0x273334, roughness: 0.82 }),
    );
    for (let i = 0; i < 4; i++)
      this.box(
        g,
        0.38,
        0.16,
        3.8,
        x + 0.2 + i * 0.45,
        0.31,
        z + 3.1,
        this.dark,
      );
    this.urn(g, x + 1.5, z + 4.8, 0.8);
  }
  private banner(g: THREE.Group, x: number, z: number, y: number) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.9, 0);
    shape.lineTo(0.9, 0);
    shape.lineTo(0.8, -1.8);
    shape.lineTo(0.25, -1.5);
    shape.lineTo(-0.2, -2.2);
    shape.lineTo(-0.85, -1.9);
    shape.closePath();
    const cloth = this.mesh(
      g,
      new THREE.ShapeGeometry(shape),
      new THREE.MeshStandardMaterial({
        color: 0x583635,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
      x,
      y,
      z,
    );
    this.cloth.push(cloth);
  }
  private populate(g: THREE.Group, circle: number) {
    const ash = new THREE.MeshStandardMaterial({
      color: [0x606773, 0x73505c, 0x67634b, 0x79694b, 0x694c45][circle],
      roughness: 1,
    });
    // Stage ritual niches at the back, keeping the central gate and floor entirely readable.
    for (const side of [-1, 1]) {
      const x = side * 12.5,
        z = -ARENA_HZ - 1.9;
      for (let i = 0; i < 4; i++) {
        const rib = this.mesh(
          g,
          new THREE.TorusGeometry(1.4 - i * 0.12, 0.1, 5, 18, Math.PI * 0.85),
          this.bone,
          x + side * i * 0.5,
          1.1,
          z + i * 0.1,
        );
        rib.rotation.set(Math.PI / 2, 0.3 * side, Math.PI / 2);
      }
      for (let i = 0; i < 12; i++) {
        const ox = x + Math.sin(i * 2.4) * 1.6,
          oz = z + Math.cos(i * 3.1) * 0.7;
        const skull = this.mesh(
          g,
          new THREE.IcosahedronGeometry(0.16 + (i % 3) * 0.025, 1),
          this.bone,
          ox,
          0.2 + (i % 2) * 0.1,
          oz,
        );
        skull.scale.set(0.9, 1.1, 0.85);
        // Recessed eye sockets remain dark rather than emitting light.
        for (const eye of [-1, 1])
          this.mesh(
            g,
            new THREE.SphereGeometry(0.047, 5, 4),
            this.dark,
            ox + eye * 0.063,
            0.24 + (i % 2) * 0.1,
            oz + 0.13,
          );
      }
      const hanging = new THREE.Group();
      hanging.position.set(side * (ARENA_HX + 1.3), 4.2, -6);
      g.add(hanging);
      this.censers.push(hanging);
      for (let i = 0; i < 12; i++) {
        const link = this.mesh(
          hanging,
          new THREE.TorusGeometry(0.1, 0.018, 4, 8),
          this.bronze,
          0,
          -i * 0.16,
          0,
        );
        link.rotation.y = i % 2 ? Math.PI / 2 : 0;
      }
      this.mesh(
        hanging,
        new THREE.ConeGeometry(0.33, 0.6, 6),
        this.bronze,
        0,
        -2.1,
        0,
      ).rotation.z = Math.PI;
      // Sloping stalactites frame the far corners; no overhead silhouette crosses the player.
      for (let i = 0; i < 4; i++)
        this.mesh(
          g,
          new THREE.ConeGeometry(0.3 + i * 0.06, 1.1 + i * 0.17, 5),
          this.dark,
          side * (15 + i * 0.8),
          4.2 - i * 0.12,
          z - 1,
        ).rotation.z = Math.PI;
      for (let i = 0; i < 3; i++) {
        const soul = new THREE.Group();
        soul.position.set(
          side * (ARENA_HX + 2.4) + (i % 2) * 0.5,
          0.2,
          4 + i * 1.15,
        );
        g.add(soul);
        this.souls.push(soul);
        this.mesh(soul, new THREE.ConeGeometry(0.24, 0.95, 6), ash, 0, 0.48, 0);
        const head = this.mesh(
          soul,
          new THREE.SphereGeometry(0.13, 6, 5),
          this.bone,
          0,
          1.03,
          0.03,
        );
        head.scale.y = 1.25;
        const face = this.mesh(
          soul,
          new THREE.PlaneGeometry(0.14, 0.19),
          this.dark,
          0,
          1.05,
          0.155,
        );
        face.rotation.x = -0.1;
        soul.userData.baseZ = soul.position.z;
        soul.userData.phase = i + circle;
      }
      // Tiny candles and charred offerings near the inner lip, all under ankle height.
      for (let i = 0; i < 8; i++) {
        const px = side * (ARENA_HX + 0.2 + (i % 2) * 0.2),
          pz = -8 + i * 1.9;
        this.mesh(
          g,
          new THREE.CylinderGeometry(0.055, 0.075, 0.18, 5),
          this.bone,
          px,
          0.09,
          pz,
        );
        this.mesh(
          g,
          new THREE.ConeGeometry(0.045, 0.12, 5),
          new THREE.MeshBasicMaterial({ color: 0x9e7444 }),
          px,
          0.24,
          pz,
        );
      }
    }
    // Low flat inlays enrich the playable floor without pretending to be collidable props.
    const seal = new THREE.Mesh(
      new THREE.RingGeometry(3.8, 3.83, 64),
      new THREE.MeshBasicMaterial({
        color: 0x9d8b71,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    seal.rotation.x = -Math.PI / 2;
    seal.position.set(0, 0.025, 0);
    g.add(seal);
  }
  sync(w: World, dt: number, visualCircle = w.floor - 1) {
    this.time += dt;
    for (const soul of this.souls) {
      soul.position.y =
        0.2 + Math.sin(this.time * 0.7 + soul.userData.phase) * 0.045;
      soul.position.z =
        soul.userData.baseZ +
        Math.sin(this.time * 0.12 + soul.userData.phase) * 0.18;
    }
    for (const [i, c] of this.censers.entries())
      c.rotation.z = Math.sin(this.time * 0.45 + i) * 0.04;
    this.root.visible = w.mode === "solo";
    const circle = Math.max(0, Math.min(4, visualCircle));
    this.circles.forEach((g, i) => {
      g.visible = i === circle;
    });
    this.boat.visible = circle === 0 || circle === 4;
    this.spider.visible = circle === 2 || circle === 3;
    this.boat.position.y = 0.25 + Math.sin(this.time * 0.7) * 0.025;
    this.boat.position.z = Math.sin(this.time * 0.12) * 0.18;
    this.spider.position.y = 0.45 + Math.sin(this.time * 0.7) * 0.018;
    this.cloth.forEach((m, i) => {
      m.rotation.x = Math.sin(this.time * 0.5 + i) * 0.035;
    });
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
        this.mesh(
          g,
          new THREE.IcosahedronGeometry(0.3, 1),
          new THREE.MeshStandardMaterial({ color: 0x9b3948, roughness: 0.75 }),
          0,
          0.5,
          0,
        );
        const ring = this.mesh(
          g,
          new THREE.RingGeometry(0.4, 0.48, 24),
          new THREE.MeshBasicMaterial({
            color: 0xb6878c,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.55,
          }),
          0,
          0.05,
          0,
        );
        ring.rotation.x = -Math.PI / 2;
        this.root.add(g);
        this.drops.set(item.id, g);
      }
      g.position.set(
        item.x,
        Math.sin(this.time * 1.5 + item.id) * 0.035,
        item.z,
      );
      g.rotation.y = this.time * 0.3;
    }
  }
}
