import * as THREE from "three";
import { batchScenery } from "./static-batch.ts";
import type { ModelLibrary } from "./assets";
import { ARENA_HX, ARENA_HZ, type World } from "../sim/world";

/** The arena's surroundings. Only authored assets stand here: the funerary arches, the
 * ferryman and the shore spider, on a plain ground. No hand-built blocks, bones or filler. */
export class Underworld {
  readonly ready: Promise<void>;
  private loads: Promise<void>[] = [];
  private root = new THREE.Group();
  private circles: THREE.Group[] = [];
  private boat = new THREE.Group();
  private spider = new THREE.Group();
  private drops = new Map<number, THREE.Group>();
  private time = 0;
  private stoneMaps = new Map<THREE.Texture, THREE.CanvasTexture>();
  private dark = new THREE.MeshStandardMaterial({
    color: 0x4c4840,
    roughness: 1,
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
    this.dark.map = grain;
    // Still water for the ferryman: it fades into the ground, with no slab and no hard rim.
    const ripple = document.createElement("canvas");
    ripple.width = ripple.height = 128;
    const wash = ripple.getContext("2d")!, fade = wash.createRadialGradient(64, 64, 10, 64, 64, 64);
    fade.addColorStop(0, "rgba(255,255,255,1)");
    fade.addColorStop(0.62, "rgba(255,255,255,.8)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    wash.fillStyle = fade;
    wash.fillRect(0, 0, 128, 128);
    const water = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(ripple), color: 0x1b2627, transparent: true, depthWrite: false });

    for (let circle = 0; circle < 6; circle++) {
      const g = new THREE.Group();
      this.root.add(g);
      this.circles.push(g);
      // A continuous ground keeps the surroundings from reading as a black void.
      const foundation = this.mesh(g, new THREE.PlaneGeometry(64, 48), this.dark, 0, -0.12, 0);
      foundation.rotation.x = -Math.PI / 2;
      const x = ARENA_HX + 2.4, north = -ARENA_HZ - .65;
      // Every piece below is an authored model: arches, relic weapons left standing in the
      // ground, and ashen figures of the damned. Each circle gets its own arrangement, all of
      // it outside the fighting floor and clear of the boss gate and the way down.
      if (circle === 0) {
        // Limbo: a funerary colonnade faces the ferryman's landing.
        this.arch(g, x, -6, 3.3);
        this.arch(g, x, -1, 3.8);
        this.arch(g, x, 4, 3.3);
        this.relic(g, "sword", -5.5, north, 3.2, 0.16);
        this.figure(g, "imp", 6.5, north, 2.3, -Math.PI / 2);
        this.figure(g, "imp", 11.5, north - 0.4, 2.6, -Math.PI / 2 - 0.3);
      } else if (circle === 1) {
        // Lust: broken thresholds, and blades left where their owners fell.
        this.prop(g,'lust-niche',-x,-3,4.2,.25);
        this.arch(g, x, 1, 3.7);
        this.relic(g, "dagger", x - 0.4, -4.4, 2.2, -0.22);
        this.relic(g, "dagger", x + 0.9, -5.2, 2.5, 0.2);
        this.relic(g, "spear", -x, 3.2, 4.6, 0.12);
        this.figure(g, "archer", 7, north, 2.7, -Math.PI / 2);
        this.figure(g, "archer", 12.5, north - 0.3, 2.5, -Math.PI / 2 + 0.35);
      } else if (circle === 2) {
        // Gluttony: the spider's hall, watched by a bloated colossus.
        this.arch(g, x, -3, 3.8);
        this.arch(g, -x, -5, 3.5);
        this.prop(g,'gluttony-cauldron',-x,1,2.4,.35);
        this.relic(g, "hammer", -x - 1.8, 5.2, 3.5, 0.18);
        this.figure(g, "brute", 8.5, north - 0.6, 3.6, -Math.PI / 2);
        this.figure(g, "imp", 3.5, north, 2.1, -Math.PI / 2 + 0.25);
      } else if (circle === 3) {
        // Greed: an abandoned armoury, hoarded and never used.
        this.prop(g,'greed-chest',x,2.2,1.8,-.35);
        this.arch(g, x, -3, 3.8);
        this.relic(g, "axe", -x - 0.6, -5.5, 3.8, 0.14);
        this.relic(g, "spear", -x + 0.5, -3.2, 4.8, -0.1);
        this.relic(g, "sword", -x - 0.3, -0.6, 3.3, 0.2);
        this.relic(g, "hammer", -x + 0.6, 2, 3.5, -0.17);
        this.relic(g, "staff", -x - 1.8, 4.6, 4.3, 0.09);
        this.figure(g, "brute", 7.5, north - 0.5, 3.3, -Math.PI / 2 - 0.2);
        this.figure(g, "archer", 12.5, north, 2.6, -Math.PI / 2);
      } else if (circle === 4) {
        // Wrath: the river returns; the far bank is a field of spent weapons.
        this.prop(g,'wrath-column',x,-5,3.6,-.25);
        this.arch(g, x, 2, 4.1);
        this.relic(g, "axe", 4.5, north, 3.9, 0.2);
        this.relic(g, "sword", 7, north - 0.5, 3.3, -0.16);
        this.relic(g, "hammer", 9.6, north, 3.6, 0.12);
        this.relic(g, "spear", 12.2, north - 0.4, 4.8, -0.08);
        this.figure(g, "imp", 15, north, 2.4, -Math.PI / 2 + 0.3);
      } else {
        // The boss chamber: a closed court of arches with two colossi keeping the far wall.
        this.arch(g, -x, -5, 4.2);
        this.arch(g, -x, 2, 4.2);
        this.arch(g, x, -5, 4.2);
        this.arch(g, x, 2, 4.2);
        this.figure(g, "brute", -4.5, north - 0.6, 3.9, -Math.PI / 2 + 0.18);
        this.figure(g, "brute", 4.5, north - 0.6, 3.9, -Math.PI / 2 - 0.18);
        this.relic(g, "sword", 9.5, north, 3.5, 0.15);
        this.relic(g, "axe", 12, north - 0.4, 3.9, -0.14);
      }
      if (circle === 0 || circle === 4) {
        const pool = this.mesh(g, new THREE.PlaneGeometry(2, 2), water, -x, -0.1, 0);
        pool.rotation.x = -Math.PI / 2;
        pool.scale.set(3.2, 6.6, 1);
      }
      for(const side of [-1,1]) {
        const stand=new THREE.Group();stand.position.set(side*(ARENA_HX+1.4),0,5);g.add(stand);
        this.loads.push(models.create('funerary-brazier',1.7).then(model=>{if(model)stand.add(model.root);}));
      }

    }
    this.root.add(this.boat, this.spider);
    this.boat.position.set(-ARENA_HX - 2.1, 0, 0);
    this.boat.rotation.y = 0;
    this.spider.position.set(ARENA_HX + 2.4, 0.4, -2.2);
    this.spider.rotation.y = -Math.PI / 5;
    for (const [kind, group, height] of [
      ["shore-spider", this.spider, 1.35],
      ["ferryman", this.boat, 2.7],
    ] as const) {
      this.loads.push(models.create(kind, height).then((model) => {
        if (model) group.add(model.root);
      }));
    }
    this.ready = Promise.all(this.loads).then(() => {
      for (const circle of this.circles) batchScenery(circle, new Set());
    });
  }
  private prop(g:THREE.Group,kind:string,x:number,z:number,height:number,turn:number){
    const spot=new THREE.Group();spot.position.set(x,0,z);spot.rotation.y=turn;g.add(spot);
    this.loads.push(this.models.create(kind,height).then(model=>{if(model)spot.add(model.root);}));
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
  /** A weapon model left standing in the ground, slightly askew. */
  private relic(g: THREE.Group, kind: string, x: number, z: number, height: number, lean: number) {
    const spot = new THREE.Group();
    spot.position.set(x, -0.25, z);
    spot.rotation.set(lean * 0.6, x * 1.7, lean);
    g.add(spot);
    this.loads.push(this.models.create(kind, height).then((model) => {
      if (!model) return;
      model.tint(0xd6cebd);
      if(kind!=='staff'){model.root.rotation.z=Math.PI;model.root.position.y=height-.12;}
      spot.add(model.root);
    }));
  }
  /** An ashen figure of the damned: an enemy model held still, larger than life. */
  private figure(g: THREE.Group, kind: string, x: number, z: number, height: number, turn: number) {
    const spot = new THREE.Group();
    spot.position.set(x, 0, z);
    spot.rotation.y = turn;
    g.add(spot);
    this.loads.push(this.models.create(kind, height).then((model) => {
      if (!model) return;
      model.play("idle");
      model.update(0);
      // Preserve the authored surface detail, but make scenery read as cold stone,
      // distinct from the same living enemy model in the arena.
      model.root.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue;
          const source = material.map;
          if (source) {
            let stone = this.stoneMaps.get(source);
            if (!stone) {
              const canvas = document.createElement('canvas');canvas.width=canvas.height=512;
              const ink = canvas.getContext('2d')!;
              ink.filter='grayscale(1) contrast(.65) brightness(1.35)';
              ink.drawImage(source.image as CanvasImageSource,0,0,512,512);
              stone = new THREE.CanvasTexture(canvas);stone.colorSpace=source.colorSpace;stone.flipY=source.flipY;
              this.stoneMaps.set(source,stone);
            }
            material.map=stone;
          }
          material.color.setHex(0xcfc8b8);material.emissive.setHex(0);material.emissiveMap=null;
        }
      });
      spot.add(model.root);
    }));
  }
  /** The authored funerary arch; nothing stands in for it while it loads. */
  private arch(g: THREE.Group, x: number, z: number, height: number) {
    const niche = new THREE.Group();
    niche.position.set(x, 0.1, z);
    niche.rotation.y = x > 0 ? -0.25 : 0.25;
    g.add(niche);
    this.loads.push(this.models.create("funerary-arch", height).then((model) => {
      if (model) niche.add(model.root);
    }));
  }
  sync(w: World, dt: number, visualCircle = w.floor - 1, chamber = false) {
    this.time += dt;
    this.root.visible = w.mode === "solo";
    const circle = chamber ? 5 : Math.max(0, Math.min(4, visualCircle));
    this.circles.forEach((g, i) => {
      g.visible = i === circle;
    });
    this.boat.visible = circle === 0 || circle === 4;
    this.spider.visible = circle === 2 || circle === 3;
    this.boat.position.y = 0.25 + Math.sin(this.time * 0.7) * 0.025;
    this.boat.position.z = Math.sin(this.time * 0.12) * 0.18;
    this.spider.position.y = 0.45 + Math.sin(this.time * 0.7) * 0.018;
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
