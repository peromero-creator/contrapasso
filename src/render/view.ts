// Everything visual. Reads the simulation state, never changes it.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ARENA_HX, ARENA_HZ, PORTAL, type Enemy, type EnemyKind, type SimEvent, type World } from "../sim/world";
import { dirAngle } from "../sim/dirs";

const PITCH = (55 * Math.PI) / 180;
const CAM_DIST = 34;

/** One look per circle of the descent: fog, light and floor tint. */
export const CIRCLES = [
  { name: "LIMBO", fog: 0x0b0e14, tint: 0x8fa3b8, light: 0xbfd4ff, glow: 0x7fb4ff },
  { name: "LUST", fog: 0x14070f, tint: 0xb8527a, light: 0xffb3cf, glow: 0xff4f9a },
  { name: "GLUTTONY", fog: 0x0b1008, tint: 0x7d8f3a, light: 0xdfe8a8, glow: 0xa8d23a },
  { name: "GREED", fog: 0x120e04, tint: 0xb8922a, light: 0xffe2a0, glow: 0xffc12e },
  { name: "WRATH", fog: 0x140504, tint: 0xb8351c, light: 0xffb090, glow: 0xff4a1e },
];

interface EnemyView {
  group: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  base: THREE.Color[];
  hpBg: THREE.Sprite;
  hpFg: THREE.Sprite;
  tele: THREE.Mesh | null;
  h: number;
}

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
}

function groundTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a3634";
  g.fillRect(0, 0, 1024, 1024);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = 46 + Math.floor(rnd() * 30);
      g.fillStyle = `rgb(${v + 6},${v},${v - 4})`;
      g.fillRect(x * 128 + 3, y * 128 + 3, 122, 122);
    }
  }
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.lineWidth = 2;
  for (let i = 0; i < 90; i++) {
    let x = rnd() * 1024;
    let y = rnd() * 1024;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (rnd() - 0.5) * 70;
      y += (rnd() - 0.5) * 70;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(0,0,0,${rnd() * 0.18})`;
    g.fillRect(rnd() * 1024, rnd() * 1024, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const std = (color: number, emissive = 0x000000, ei = 1) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, emissive, emissiveIntensity: ei });

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private target = new THREE.Vector3();
  private shake = 0;
  private time = 0;

  private ground!: THREE.Mesh;
  private sigil!: THREE.Mesh;
  private key!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private torches: THREE.PointLight[] = [];
  private torchMats: THREE.MeshStandardMaterial[] = [];
  private circle = -1;

  private hero = new THREE.Group();
  private heroMats: THREE.MeshStandardMaterial[] = [];
  private heroBase: THREE.Color[] = [];
  private swordPivot = new THREE.Group();
  private slash = new THREE.Group();
  private slashMat!: THREE.MeshBasicMaterial;
  private slashT = 0;
  private swingSide = 1;

  private enemies = new Map<number, EnemyView>();
  private shots = new Map<number, THREE.Mesh>();
  private shotGeo = new THREE.SphereGeometry(0.24, 10, 8);
  private shotMat = new THREE.MeshBasicMaterial({ color: 0xff6a3a });
  private portal = new THREE.Group();
  private particles: Particle[] = [];
  private pGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene.fog = new THREE.Fog(0x0b0e14, 38, 70);
    this.scene.background = new THREE.Color(0x0b0e14);

    this.buildArena();
    this.buildHero();
    this.buildPortal();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.6, 0.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.setCircle(0);
    this.resize();
  }

  private buildArena() {
    this.hemi = new THREE.HemisphereLight(0x6a5a66, 0x120a0a, 1.1);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffd0b0, 2.4);
    this.key.position.set(9, 22, 10);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -22;
    sc.right = 22;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 60;
    this.key.shadow.bias = -0.0006;
    this.scene.add(this.key);

    const gmat = new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HX * 2, ARENA_HZ * 2), gmat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // the pit around the arena
    const pit = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshBasicMaterial({ color: 0x020203 }),
    );
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = -0.6;
    this.scene.add(pit);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(ARENA_HX * 2 + 1.2, 0.6, ARENA_HZ * 2 + 1.2),
      std(0x1c1a1a),
    );
    slab.position.y = -0.31;
    slab.receiveShadow = true;
    this.scene.add(slab);

    const sigMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
    this.sigil = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.5, 64), sigMat);
    this.sigil.rotation.x = -Math.PI / 2;
    this.sigil.position.y = 0.02;
    this.scene.add(this.sigil);
    const inner = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.72, 6), sigMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.02;
    this.scene.add(inner);

    const wallMat = std(0x161314);
    const mkWall = (w: number, d: number, x: number, z: number, h: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, h / 2 - 0.02, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    };
    mkWall(ARENA_HX * 2 + 1.2, 0.6, 0, -ARENA_HZ - 0.3, 2.4);
    mkWall(0.6, ARENA_HZ * 2 + 1.2, -ARENA_HX - 0.3, 0, 1.3);
    mkWall(0.6, ARENA_HZ * 2 + 1.2, ARENA_HX + 0.3, 0, 1.3);

    const pillarGeo = new THREE.CylinderGeometry(0.55, 0.7, 4.2, 10);
    const bowlGeo = new THREE.CylinderGeometry(0.75, 0.4, 0.45, 10);
    const fireGeo = new THREE.SphereGeometry(0.42, 10, 8);
    const spots: [number, number][] = [
      [-ARENA_HX + 1.2, -ARENA_HZ + 1.2],
      [ARENA_HX - 1.2, -ARENA_HZ + 1.2],
      [-ARENA_HX + 1.2, ARENA_HZ - 1.2],
      [ARENA_HX - 1.2, ARENA_HZ - 1.2],
      [-6.5, -ARENA_HZ + 0.9],
      [6.5, -ARENA_HZ + 0.9],
    ];
    spots.forEach(([x, z], i) => {
      const tall = i < 2 || i > 3;
      const p = new THREE.Mesh(pillarGeo, wallMat);
      p.scale.y = tall ? 1 : 0.45;
      p.position.set(x, tall ? 2.1 : 0.95, z);
      p.castShadow = true;
      this.scene.add(p);
      const top = tall ? 4.3 : 2.0;
      const bowl = new THREE.Mesh(bowlGeo, wallMat);
      bowl.position.set(x, top, z);
      this.scene.add(bowl);
      const fm = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff7a2a, emissiveIntensity: 1.5 });
      const fire = new THREE.Mesh(fireGeo, fm);
      fire.position.set(x, top + 0.35, z);
      this.scene.add(fire);
      this.torchMats.push(fm);
      if (i < 4) {
        const l = new THREE.PointLight(0xff7a2a, 45, 22, 2);
        l.position.set(x, top + 0.8, z);
        this.scene.add(l);
        this.torches.push(l);
      }
    });
  }

  private buildHero() {
    const add = (m: THREE.Mesh, mat: THREE.MeshStandardMaterial) => {
      m.castShadow = true;
      this.hero.add(m);
      this.heroMats.push(mat);
      this.heroBase.push(mat.emissive.clone());
    };
    const cloakMat = std(0x5a1016);
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.5, 12), cloakMat);
    cloak.position.y = 0.78;
    add(cloak, cloakMat);
    const bodyMat = std(0xd8cfc0);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 6, 12), bodyMat);
    body.position.y = 1.15;
    add(body, bodyMat);
    const headMat = std(0xe9e2d6, 0xffd9a0, 0.25);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), headMat);
    head.position.y = 1.86;
    add(head, headMat);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.035, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc46a, emissiveIntensity: 2.4 }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 2.22;
    this.hero.add(halo);

    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, emissive: 0xffa040, emissiveIntensity: 2.6 });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.07, 0.17), bladeMat);
    blade.position.x = 1.05;
    blade.castShadow = true;
    const hilt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.5), std(0x3a2a20));
    hilt.position.x = 0.3;
    this.swordPivot.add(blade, hilt);
    this.swordPivot.position.y = 1.05;
    this.hero.add(this.swordPivot);
    this.scene.add(this.hero);

    this.slashMat = new THREE.MeshBasicMaterial({
      color: 0xffb46a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const arc = new THREE.Mesh(new THREE.RingGeometry(1.0, 3.0, 28, 1, -1.22, 2.44), this.slashMat);
    arc.rotation.x = -Math.PI / 2;
    this.slash.add(arc);
    this.slash.position.y = 0.9;
    this.scene.add(this.slash);
  }

  private buildPortal() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.5, 48), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 7, 24, 1, true), beamMat);
    beam.position.y = 3.5;
    this.portal.add(ring, beam);
    this.portal.position.set(PORTAL.x, 0, PORTAL.z);
    this.portal.visible = false;
    this.scene.add(this.portal);
  }

  setCircle(i: number) {
    const idx = Math.max(0, Math.min(CIRCLES.length - 1, i));
    if (idx === this.circle) return;
    this.circle = idx;
    const c = CIRCLES[idx];
    (this.scene.fog as THREE.Fog).color.setHex(c.fog);
    (this.scene.background as THREE.Color).setHex(c.fog);
    (this.ground.material as THREE.MeshStandardMaterial).color.setHex(c.tint);
    this.key.color.setHex(c.light);
    (this.sigil.material as THREE.MeshBasicMaterial).color.setHex(c.glow);
    for (const l of this.torches) l.color.setHex(c.glow);
    for (const m of this.torchMats) m.emissive.setHex(c.glow);
  }

  private makeEnemy(kind: EnemyKind): EnemyView {
    const group = new THREE.Group();
    const mats: THREE.MeshStandardMaterial[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      group.add(m);
      if (!mats.includes(mat)) mats.push(mat);
      return m;
    };
    let h = 1.6;
    let tele: THREE.Mesh | null = null;
    if (kind === "imp") {
      const m = std(0xb3261e, 0x400404, 1);
      add(new THREE.CapsuleGeometry(0.38, 0.45, 6, 10), m, 0, 0.62, 0);
      const horn = std(0x1b1012);
      add(new THREE.ConeGeometry(0.1, 0.42, 6), horn, 0.12, 1.28, 0.2);
      add(new THREE.ConeGeometry(0.1, 0.42, 6), horn, 0.12, 1.28, -0.2);
      h = 1.6;
    } else if (kind === "archer") {
      const m = std(0x6b3fa0, 0x1a0830, 1);
      add(new THREE.CapsuleGeometry(0.3, 0.9, 6, 10), m, 0, 0.78, 0);
      add(new THREE.ConeGeometry(0.34, 0.6, 8), std(0x24142e), 0, 1.72, 0);
      const orb = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff5a2a, emissiveIntensity: 2.2 });
      add(new THREE.SphereGeometry(0.14, 8, 6), orb, 0.42, 1.05, 0);
      h = 2.2;
    } else if (kind === "brute") {
      const m = std(0x7a3b12, 0x2a0e02, 1);
      add(new THREE.CapsuleGeometry(0.78, 0.8, 6, 12), m, 0, 1.15, 0);
      const sh = std(0x2a1c14);
      add(new THREE.BoxGeometry(0.6, 0.45, 0.6), sh, 0, 1.7, 0.85);
      add(new THREE.BoxGeometry(0.6, 0.45, 0.6), sh, 0, 1.7, -0.85);
      add(new THREE.ConeGeometry(0.16, 0.6, 6), sh, 0.3, 2.3, 0.3);
      add(new THREE.ConeGeometry(0.16, 0.6, 6), sh, 0.3, 2.3, -0.3);
      h = 2.9;
    } else {
      const m = std(0x2a2230, 0x30103a, 1);
      add(new THREE.CapsuleGeometry(1.15, 1.7, 8, 14), m, 0, 1.95, 0);
      const crown = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc23a, emissiveIntensity: 2.6 });
      const t = add(new THREE.TorusGeometry(0.75, 0.09, 8, 24), crown, 0, 4.15, 0);
      t.rotation.x = Math.PI / 2;
      const eye = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3a2a, emissiveIntensity: 3 });
      add(new THREE.SphereGeometry(0.16, 8, 6), eye, 1.05, 3.1, 0.35);
      add(new THREE.SphereGeometry(0.16, 8, 6), eye, 1.05, 3.1, -0.35);
      h = 4.9;
    }
    if (kind === "brute" || kind === "warden") {
      const w = kind === "warden" ? 3.2 : 2.0;
      const len = kind === "warden" ? 12 : 10;
      tele = new THREE.Mesh(
        new THREE.PlaneGeometry(len, w),
        new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      tele.rotation.x = -Math.PI / 2;
      tele.position.set(len / 2, 0.05, 0);
      group.add(tele);
    }
    const hpBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x140808, depthTest: false }));
    const hpFg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff4a3a, depthTest: false }));
    const bw = kind === "warden" ? 4 : 1.3;
    hpBg.scale.set(bw, 0.13, 1);
    hpFg.scale.set(bw, 0.13, 1);
    hpBg.center.set(0, 0.5);
    hpFg.center.set(0, 0.5);
    hpBg.renderOrder = 10;
    hpFg.renderOrder = 11;
    hpBg.visible = hpFg.visible = false;
    this.scene.add(hpBg, hpFg);
    this.scene.add(group);
    return { group, mats, base: mats.map((m) => m.emissive.clone()), hpBg, hpFg, tele, h };
  }

  private burst(x: number, y: number, z: number, n: number, color: number, speed: number) {
    for (let i = 0; i < n; i++) {
      let p = this.particles.find((q) => q.life <= 0);
      if (!p) {
        if (this.particles.length > 220) return;
        const mesh = new THREE.Mesh(this.pGeo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.scene.add(mesh);
        p = { mesh, vx: 0, vy: 0, vz: 0, life: 0, max: 1 };
        this.particles.push(p);
      }
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      p.vx = Math.cos(a) * s;
      p.vz = Math.sin(a) * s;
      p.vy = 2 + Math.random() * 5;
      p.max = p.life = 0.25 + Math.random() * 0.35;
      p.mesh.position.set(x, y, z);
      (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      p.mesh.visible = true;
    }
  }

  /** Visual reactions to what just happened in the simulation. Returns hit-stop seconds. */
  consume(events: SimEvent[]): number {
    let stop = 0;
    const glow = CIRCLES[this.circle]?.glow ?? 0xffa040;
    for (const e of events) {
      switch (e.type) {
        case "swing":
          this.slashT = 0.16;
          this.swingSide = -this.swingSide;
          this.slash.scale.setScalar(e.amount === 2 ? 1.22 : 1);
          this.slashMat.color.setHex(e.amount === 2 ? 0xfff0d0 : 0xffb46a);
          break;
        case "hit":
          this.burst(e.x, 1.1, e.z, 6, 0xffd9a0, 7);
          this.shake = Math.max(this.shake, (e.amount ?? 0) > 40 ? 0.28 : 0.14);
          stop = Math.max(stop, (e.amount ?? 0) > 40 ? 0.055 : 0.028);
          break;
        case "kill":
          this.burst(e.x, 1.0, e.z, e.kind === "warden" ? 60 : 16, e.kind === "archer" ? 0xb070ff : 0xff5a3a, 9);
          this.shake = Math.max(this.shake, e.kind === "warden" ? 0.9 : 0.25);
          stop = Math.max(stop, 0.05);
          break;
        case "hurt":
          this.burst(e.x, 1.2, e.z, 10, 0xff2a2a, 6);
          this.shake = Math.max(this.shake, 0.5);
          break;
        case "dash":
          this.burst(e.x, 0.6, e.z, 8, 0xffe0b0, 3);
          break;
        case "spawn":
          this.burst(e.x, 0.2, e.z, 8, glow, 3);
          break;
        case "cleared":
        case "won":
          this.burst(e.x, 0.4, e.z, 40, 0xffd27a, 8);
          break;
      }
    }
    return stop;
  }

  sync(w: World, dt: number) {
    this.time += dt;
    this.setCircle(w.floor - 1);
    const p = w.player;

    // hero
    this.hero.position.set(p.x, 0, p.z);
    this.hero.rotation.y = -dirAngle(p.aim);
    const dashing = p.dashT > 0;
    this.hero.scale.set(dashing ? 1.35 : 1, dashing ? 0.8 : 1, 1);
    const blink = p.invuln > 0 && !dashing && Math.floor(this.time * 22) % 2 === 0;
    this.hero.visible = w.phase !== "dead" && !blink;
    for (let i = 0; i < this.heroMats.length; i++) {
      this.heroMats[i].emissive.copy(this.heroBase[i]);
      if (p.flash > 0) this.heroMats[i].emissive.setHex(0xff2222);
    }
    if (p.swingT > 0) {
      const s = 1 - p.swingT / 0.2;
      const e = 1 - (1 - s) * (1 - s);
      this.swordPivot.rotation.y = this.swingSide * (1.35 - e * 2.7);
    } else {
      this.swordPivot.rotation.y += (-0.95 * this.swingSide - this.swordPivot.rotation.y) * Math.min(1, dt * 14);
    }
    if (this.slashT > 0) {
      this.slashT -= dt;
      this.slash.position.set(p.x, 0.9, p.z);
      this.slash.rotation.y = -dirAngle(p.aim);
      this.slashMat.opacity = Math.max(0, this.slashT / 0.16) * 0.85;
    } else {
      this.slashMat.opacity = 0;
    }

    // enemies
    const seen = new Set<number>();
    for (const e of w.enemies) {
      seen.add(e.id);
      let v = this.enemies.get(e.id);
      if (!v) {
        v = this.makeEnemy(e.kind);
        this.enemies.set(e.id, v);
      }
      this.syncEnemy(e, v);
    }
    for (const [id, v] of this.enemies) {
      if (seen.has(id)) continue;
      this.scene.remove(v.group, v.hpBg, v.hpFg);
      this.enemies.delete(id);
    }

    // shots
    const live = new Set<number>();
    for (const s of w.shots) {
      live.add(s.id);
      let m = this.shots.get(s.id);
      if (!m) {
        m = new THREE.Mesh(this.shotGeo, this.shotMat);
        this.scene.add(m);
        this.shots.set(s.id, m);
      }
      m.position.set(s.x, 0.9, s.z);
    }
    for (const [id, m] of this.shots) {
      if (live.has(id)) continue;
      this.scene.remove(m);
      this.shots.delete(id);
    }

    // portal
    this.portal.visible = w.phase === "cleared";
    if (this.portal.visible) {
      const k = 1 + Math.sin(this.time * 5) * 0.06;
      this.portal.scale.set(k, 1, k);
    }
    for (const m of this.torchMats) m.emissiveIntensity = 1.4 + Math.sin(this.time * 9 + m.id) * 0.3;

    // particles
    for (const q of this.particles) {
      if (q.life <= 0) continue;
      q.life -= dt;
      q.vy -= 18 * dt;
      q.mesh.position.x += q.vx * dt;
      q.mesh.position.y = Math.max(0.05, q.mesh.position.y + q.vy * dt);
      q.mesh.position.z += q.vz * dt;
      (q.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, q.life / q.max);
      if (q.life <= 0) q.mesh.visible = false;
    }

    // camera follows the hero loosely so the whole arena stays readable
    const tx = p.x * 0.45;
    const tz = p.z * 0.3 - 0.8;
    this.target.x += (tx - this.target.x) * Math.min(1, dt * 5);
    this.target.z += (tz - this.target.z) * Math.min(1, dt * 5);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const sx = (Math.random() - 0.5) * this.shake;
    const sz = (Math.random() - 0.5) * this.shake;
    const dist = CAM_DIST * Math.max(1, 1.7 / this.camera.aspect);
    this.camera.position.set(this.target.x + sx, Math.sin(PITCH) * dist, this.target.z + Math.cos(PITCH) * dist + sz);
    this.camera.lookAt(this.target.x + sx, 0, this.target.z + sz);
  }

  private syncEnemy(e: Enemy, v: EnemyView) {
    v.group.position.set(e.x, 0, e.z);
    v.group.rotation.y = -Math.atan2(e.dz, e.dx);
    const rising = e.spawn > 0 ? Math.max(0.05, 1 - e.spawn / 0.9) : 1;
    v.group.scale.set(1, rising, 1);
    const wind = e.state === "windup";
    for (let i = 0; i < v.mats.length; i++) {
      const m = v.mats[i];
      m.emissive.copy(v.base[i]);
      if (wind && i === 0) m.emissive.setRGB(0.9, 0.55, 0.1).multiplyScalar(0.5 + 0.5 * Math.sin(this.time * 40));
      if (e.flash > 0) m.emissive.setRGB(1.6, 1.6, 1.6);
    }
    if (v.tele) {
      const charging = wind && !(e.kind === "warden" && e.pattern % 3 === 0);
      (v.tele.material as THREE.MeshBasicMaterial).opacity = charging ? 0.22 + 0.12 * Math.sin(this.time * 30) : 0;
    }
    const show = e.spawn <= 0 && (e.hp < e.maxHp || e.kind === "warden");
    v.hpBg.visible = v.hpFg.visible = show;
    if (show) {
      const bw = e.kind === "warden" ? 4 : 1.3;
      v.hpBg.position.set(e.x - bw / 2, v.h, e.z);
      v.hpFg.position.set(e.x - bw / 2, v.h, e.z);
      v.hpFg.scale.x = Math.max(0.001, bw * (e.hp / e.maxHp));
    }
  }

  /** Where the mouse points on the arena floor. */
  groundPoint(clientX: number, clientY: number, out: THREE.Vector3): boolean {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    return this.ray.ray.intersectPlane(this.plane, out) !== null;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.composer.render();
  }
}
