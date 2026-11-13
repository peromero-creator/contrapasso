import { bossMove, bossWindup, SLAM_RADIUS } from '../sim/bosses.ts';
import { PresentationSample } from "./presentation-sample.ts";
import { programSamples } from "./program-warmup.ts";
import { techniqueId, TECHNIQUES } from "../sim/techniques";
import { abilityClip } from "./weapon-pose";
import { Afterimages } from "./afterimages.ts";
import { SoulFx } from "./soul-fx";
import { CAST_TIME, CORE_TIME, abilityDuration } from "../sim/abilities";
import { attackClip, orientWeapon, mountGrip, starterWeapon } from "./weapon-pose";
import { Gore } from "./gore";
import { ImpactFx, softTexture } from "./impact";
import { combatLift, type CombatMotion } from "./combat-motion";
import { clearTransientEffects } from "./arena-reset.ts";
import { weapon, WEAPON_IDS, type WeaponId } from "../sim/weapons";
import { Underworld } from "./dressing";
// Everything visual. Reads the simulation state, never changes it.
import * as THREE from "three";
import {
  ARENA_HX,
  ARENA_HZ,
  JUMP_TIME,
  PLUNGE_FALL,
  PORTAL,
  type Enemy,
  type EnemyKind,
  type SimEvent,
  type World,
} from "../sim/world";
import { dirAngle } from "../sim/dirs";
import { rank } from "../sim/skills";
import { ModelLibrary, type AnimatedModel } from "./assets";
import { EnemyThreat } from './enemy-threat.ts';

// 2.5D: an orthographic camera at a fixed tilt over a painted floor, with flat
// shadowless light, so actors read as illustrated figures rather than lit 3D props.
/** How high the drawn jump arc peaks, in world units. */
const JUMP_HEIGHT = 1.5;
const PITCH = (42 * Math.PI) / 180;
const CAM_DIST = 60;
const VIEW_HEIGHT = 13;
/** Seconds an enemy's attack and charge animations should take, to match the combat rules. */
const WINDUP: Record<string, number> = {
  imp: 0.42,
  archer: 0.5,
  brute: 0.65,
  warden: 0.5,
  champion: 0.35,
};
const CHARGE: Record<string, number> = {
  brute: 0.55,
  warden: 0.6,
  champion: 0.3,
};
/** How the blade sits in the hero's right-hand bone (radians). */

function canvasTexture(
  size: number,
  draw: (g: CanvasRenderingContext2D) => void,
) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One look per circle of the descent: fog, light and floor tint. */
export const CIRCLES = [
  {
    name: "LIMBO",
    fog: 0x0b0e14,
    tint: 0x8fa3b8,
    light: 0xbfd4ff,
    glow: 0x7fb4ff,
  },
  {
    name: "LUST",
    fog: 0x14070f,
    tint: 0xb8527a,
    light: 0xffb3cf,
    glow: 0xff4f9a,
  },
  {
    name: "GLUTTONY",
    fog: 0x0b1008,
    tint: 0x7d8f3a,
    light: 0xdfe8a8,
    glow: 0xa8d23a,
  },
  {
    name: "GREED",
    fog: 0x120e04,
    tint: 0xb8922a,
    light: 0xffe2a0,
    glow: 0xffc12e,
  },
  {
    name: "WRATH",
    fog: 0x140504,
    tint: 0xb8351c,
    light: 0xffb090,
    glow: 0xff4a1e,
  },
];

interface EnemyView {
  sample: PresentationSample;
  group: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  base: THREE.Color[];
  hpBg: THREE.Sprite;
  hpFg: THREE.Sprite;
  tele: THREE.Mesh | null;
  threat?: EnemyThreat;
  bossPattern?: number;
  bossProgress?: number;
  h: number;
  model?: AnimatedModel;
  weaponModel?: AnimatedModel;
  starterProp?: THREE.Group;
}

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
}

interface DamageText {
  sprite: THREE.Sprite;
  life: number;
  size: number;
}
interface Pulse {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  radius: number;
}

function groundTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext("2d")!;
  g.fillStyle = "#3a3634";
  g.fillRect(0, 0, 1024, 1024);
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
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
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.75,
    metalness: 0.05,
    emissive,
    emissiveIntensity: ei,
  });

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private preparation?: Promise<void>;
  private preparedActors: AnimatedModel[] = [];
  private preparedPrograms?: THREE.Scene;
  private actorLoads: Promise<void>[] = [];
  /** Upload common enemy meshes and compile their shaders before the run starts.
   * Retain these materials so the program cache survives until the first wave. */
  prepare() {
    return this.preparation ??= (async () => {
      await Promise.all(this.actorLoads);
      const models = await Promise.all(['imp', 'archer', 'brute', 'warden', 'witness', 'cantor'].map(kind => this.models.create(kind)));
      const warmup = new THREE.Scene();
      const textures = new Set<THREE.Texture>();
      for (const model of models) if (model) {
        this.preparedActors.push(model); warmup.add(model.root); model.play('idle'); model.update(0);
        model.root.traverse(node => {
          if (node instanceof THREE.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            const map = (material as THREE.MeshStandardMaterial).map;
            if (map) textures.add(map);
          }
        });
      }
      for (const texture of textures) this.renderer.initTexture(texture);
      await this.soul.prepare();
      // Exercise material variants while the preparation screen still covers the
      // arena. No world is stepped and no gameplay/chain event is produced.
      for (const ability of ['ember', 'iron', 'ash', 'staff-4', 'hammer-4', 'siphon-spell', 'nova-spell'] as const) {
        this.soul.event({ type: 'ability', ability, stage: ability.endsWith('spell') ? 'release' : 'pulse', side: 'player', x: 0, z: 0 }, 'vesper-reed');
      }
      this.soul.event({ type: 'ability', ability: 'lance', stage: 'charge', side: 'player', x: 0, z: 0 });
      this.consume([{ type: 'hit', x: 0, z: 0, amount: 30 }, { type: 'kill', kind: 'brute', x: 0, z: 0 }, { type: 'plunge', x: 0, z: 0 }]);
      this.gore.update(0);
      this.afterimages.emit(this.hero);
      warmup.add(new THREE.Mesh(this.boltGeo, this.boltMat), new THREE.Mesh(this.shotGeo, this.soulMat), new THREE.Mesh(this.shotGeo, this.shotMat));
      const threatSample = new EnemyThreat();
      warmup.add(threatSample.root);
      this.preparedPrograms = programSamples([this.scene, warmup]);
      threatSample.dispose();
      await this.renderer.compileAsync(this.preparedPrograms, this.camera, this.scene);
      // Some drivers defer pipeline creation and buffer upload until a real draw.
      // Draw once behind the preparation screen, then restore the clean arena in
      // the same task, before the browser can present the warm-up geometry.
      this.preparedPrograms.fog = this.scene.fog?.clone() ?? null;
      this.scene.traverseVisible(node => {
        if (node instanceof THREE.Light) this.preparedPrograms!.add(node.clone());
      });
      for (const node of this.preparedPrograms.children) { node.visible = true; node.frustumCulled = false; }
      this.renderer.render(this.preparedPrograms, this.camera);
      this.clearArenaEffects();
      this.shake = this.punch = 0; this.kick.set(0, 0); this.lastImpactTime = -1;
      this.finisherT = this.plungeT = this.liftPeak = 0;
      this.renderer.render(this.scene, this.camera);
    })();
  }
  private gore = new Gore(this.scene);
  private impact = new ImpactFx(this.scene);
  /** Camera reactions: a shove along the blow and a brief zoom punch. */
  private kick = new THREE.Vector2();
  private punch = 0;
  private dustCd = 0;
  private heroShadow!: THREE.Mesh;
  /** Highest point of the current leap, so the landing can answer it. */
  private liftPeak = 0;
  /** Presentation lag that turns the simulation's instant attack step into a stride. */
  private stride = new THREE.Vector2();
  private finisherT = 0;
  /** Jump presentation: current height, and where a dive started from. */
  private airY = 0;
  private diveFrom = 0;
  private diveT0 = 0;
  private plungeT = 0;
  private cracks: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; life: number }[] = [];
  private crackTex = canvasTexture(256, (g) => {
    g.translate(128, 128);
    g.lineCap = "round";
    for (let i = 0; i < 11; i++) {
      let a = (i / 11) * Math.PI * 2 + (Math.random() - 0.5) * 0.4, x = 0, y = 0;
      const len = 60 + Math.random() * 55;
      g.beginPath();
      g.moveTo(0, 0);
      for (let d = 0; d < len; d += 14) {
        a += (Math.random() - 0.5) * 0.7;
        x += Math.cos(a) * 14;
        y += Math.sin(a) * 14;
        g.lineTo(x, y);
      }
      g.strokeStyle = "rgba(12,9,8,0.9)";
      g.lineWidth = 5 - (i % 3);
      g.stroke();
    }
    const pit = g.createRadialGradient(0, 0, 2, 0, 0, 46);
    pit.addColorStop(0, "rgba(10,8,7,0.75)");
    pit.addColorStop(1, "rgba(10,8,7,0)");
    g.fillStyle = pit;
    g.fillRect(-128, -128, 256, 256);
  });
  private leanAxis = new THREE.Vector3();
  private leanQ = new THREE.Quaternion();
  private calm = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.3 : 1;
  private soul = new SoulFx(this.scene, true);
  private previousCast = 0;
  private afterimages!: Afterimages;
  private echoCd = 0;
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  private viewH = VIEW_HEIGHT;
  private aspect = 1;
  private lastImpactTime = -1;
  private heroSample = new PresentationSample();
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private target = new THREE.Vector3();
  private shake = 0;
  private time = 0;
  private lastWorldTick = 0;
  private models = new ModelLibrary();
  private heroModel: AnimatedModel | null = null;
  private previousHero = new THREE.Vector2();
  private previousHeroSwing = -1;
  private baseGround: THREE.Texture | null = null;

  private ground!: THREE.Mesh;
  private sigil!: THREE.Mesh;
  private sigilInner!: THREE.Mesh;
  private rimMats: THREE.MeshBasicMaterial[] = [];
  private splats: {
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    life: number;
  }[] = [];
  private shadowTex = canvasTexture(128, (g) => {
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, "rgba(0,0,0,0.8)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.62)");
    grad.addColorStop(0.8, "rgba(0,0,0,0.3)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
  private splatTex = canvasTexture(256, (g) => {
    const pool = g.createRadialGradient(128, 128, 8, 128, 128, 78);
    pool.addColorStop(0, "#6b5454");
    pool.addColorStop(0.6, "#b79b9b");
    pool.addColorStop(1, "#d0aaaa");
    g.fillStyle = pool;
    g.beginPath();
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * Math.PI * 2,
        r = 44 + Math.random() * 25;
      const x = 128 + Math.cos(angle) * r,
        y = 128 + Math.sin(angle) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    for (let i = 0; i < 38; i++) {
      const angle = Math.random() * Math.PI * 2,
        d = 35 + Math.random() * 75;
      g.fillStyle = i % 3 === 0 ? "#ae8f8f" : "#d6baba";
      g.beginPath();
      g.ellipse(
        128 + Math.cos(angle) * d,
        128 + Math.sin(angle) * d,
        2 + Math.random() * 9,
        1 + Math.random() * 4,
        angle,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
    g.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 1100; i++) {
      g.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.2})`;
      g.fillRect(
        Math.random() * 256,
        Math.random() * 256,
        1 + Math.random() * 3,
        1 + Math.random() * 2,
      );
    }
  });
  private key!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private torches: THREE.PointLight[] = [];
  private torchMats: THREE.MeshStandardMaterial[] = [];
  private circle = -1;

  private hero = new THREE.Group();
  private heroMats: THREE.MeshStandardMaterial[] = [];
  private heroBase: THREE.Color[] = [];
  private swordPivot = new THREE.Group();
  private swordGrip = new THREE.Group();
  private starterBlade = new THREE.Group();
  private relicBlades = new Map<WeaponId, THREE.Group>();
  private equippedWeapon: WeaponId = "starter";
  private rivalWeapon: WeaponId = "starter";
  private weaponLevel = 0;
  private weaponGlow = new THREE.PointLight(0xff9d58, 0, 2.2);
  private underworld!: Underworld;
  useWeapon(identity: WeaponId, level = 0) {
    this.equippedWeapon = identity;
    this.weaponLevel = level;
    this.starterBlade.visible =
      identity === "starter" || !this.relicBlades.has(identity);
    for (const [id, root] of this.relicBlades) root.visible = id === identity;
    this.weaponGlow.color.setHex(weapon(identity).color);
    this.weaponGlow.intensity = Math.min(0.3, level * 0.035);
  }
  private slash = new THREE.Group();
  private slashArc!: THREE.Mesh;
  private thrustTrail!: THREE.Mesh;
  private slashMat!: THREE.MeshBasicMaterial;
  private slashT = 0;
  private swingSide = 1;
  private heroMoving = false;
  private heroMotionTick = -1;

  private enemies = new Map<number, EnemyView>();
  private fallen: { view: EnemyView; life: number; vx: number; vz: number; lit: boolean }[] = [];
  private look = new THREE.Vector2();
  private shots = new Map<number, THREE.Mesh>();
  private shotGeo = new THREE.SphereGeometry(0.16, 10, 8);
  private boltGeo = new THREE.BoxGeometry(0.8, 0.07, 0.07);
  private boltMat = new THREE.MeshBasicMaterial({ color: 0xc4bba5 });
  private soulMat = new THREE.MeshBasicMaterial({ color: 0x9eada9 });
  private shotMat = new THREE.MeshBasicMaterial({ color: 0xff6a3a });
  private portal = new THREE.Group();
  private particles: Particle[] = [];
  private pGeo = new THREE.OctahedronGeometry(0.1, 0);
  /** One shared glow per projectile colour, so shots read as light rather than beads. */
  private haloTex = softTexture();
  private halo = (color: number) =>
    new THREE.SpriteMaterial({ map: this.haloTex, color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  private halos = new Map<THREE.Material, THREE.SpriteMaterial>();
  private squashT = 0;
  private squashAmp = 0;
  private damageTexts: DamageText[] = [];
  private pulses: Pulse[] = [];

  private damageText(x: number, z: number, text: string, color: string, y = 2, size = 1) {
    if (this.damageTexts.length >= 40) return;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "600 54px Cinzel, Georgia, serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#18110c";
    ctx.strokeText(text, 128, 82);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 82);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
        toneMapped: false,
      }),
    );
    sprite.position.set(x + (Math.random() - 0.5) * 0.5, y, z);
    sprite.scale.set(1.5, 0.75, 1);
    sprite.renderOrder = 20;
    this.scene.add(sprite);
    this.damageTexts.push({ sprite, life: 0.65, size });
  }

  private pulse(x: number, z: number, radius: number) {
    this.impact.ring(x, z, radius);
  }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene.background = new THREE.Color(0x0b0e14);

    this.afterimages = new Afterimages(this.scene);
    this.buildArena();
    this.buildHero();
    this.buildPortal();

    this.setCircle(0);
    this.resize();
  }

  private buildArena() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xcfc4bc, 2.3);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff0e0, 1.1);
    this.key.position.set(-6, 14, 16);
    this.scene.add(this.key);

    const gmat = new THREE.MeshBasicMaterial({
      map: groundTexture(),
      toneMapped: false,
    });
    this.baseGround = gmat.map;
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA_HX * 2, ARENA_HZ * 2),
      gmat,
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);
    this.underworld = new Underworld(this.scene, this.models);

    // the void around the arena, a dark stone rim and a thin glowing edge
    const flat = (
      w: number,
      d: number,
      x: number,
      y: number,
      z: number,
      material: THREE.Material,
    ) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      this.scene.add(m);
      return m;
    };
    flat(
      400,
      400,
      0,
      -0.2,
      0,
      new THREE.MeshBasicMaterial({ color: 0x030203 }),
    );
    flat(
      ARENA_HX * 2 + 1.8,
      ARENA_HZ * 2 + 1.8,
      0,
      -0.04,
      0,
      new THREE.MeshBasicMaterial({ color: 0x0d0a0b }),
    );
    const edge = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    this.rimMats.push(edge);
    flat(ARENA_HX * 2 + 0.3, 0.12, 0, 0.01, -ARENA_HZ - 0.08, edge);
    flat(ARENA_HX * 2 + 0.3, 0.12, 0, 0.01, ARENA_HZ + 0.08, edge);
    flat(0.12, ARENA_HZ * 2 + 0.3, -ARENA_HX - 0.08, 0.01, 0, edge);
    flat(0.12, ARENA_HZ * 2 + 0.3, ARENA_HX + 0.08, 0.01, 0, edge);

    const sigMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.16,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    this.sigil = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.5, 64), sigMat);
    this.sigil.rotation.x = -Math.PI / 2;
    this.sigil.position.y = 0.02;
    this.scene.add(this.sigil);
    this.sigilInner = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 2.72, 6),
      sigMat,
    );
    this.sigilInner.rotation.x = -Math.PI / 2;
    this.sigilInner.position.y = 0.02;
    this.scene.add(this.sigilInner);
  }

  /** A soft dark disc under an actor: the only "shadow" in a 2.5D scene. */
  private blobShadow(radius: number) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 3.6, radius * 3.0),
      new THREE.MeshBasicMaterial({
        map: this.shadowTex,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.03;
    m.userData.keep = true;
    return m;
  }

  /** Broken ground where a leaping blow came down. */
  private crack(x: number, z: number, size: number) {
    let c = this.cracks.find((q) => q.life <= 0);
    if (!c) {
      if (this.cracks.length >= 8) c = this.cracks.reduce((a, b) => (a.life < b.life ? a : b));
      else {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: this.crackTex, transparent: true, depthWrite: false, toneMapped: false }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.04;
        this.scene.add(mesh);
        c = { mesh, life: 0 };
        this.cracks.push(c);
      }
    }
    c.life = 3.2;
    c.mesh.visible = true;
    c.mesh.position.set(x, 0.04, z);
    c.mesh.rotation.z = Math.random() * Math.PI * 2;
    c.mesh.scale.set(size, size, 1);
  }

  /** The answer to a leap: dust, a ring, a jolt, and cracked ground under the heavy ones. */
  private land(x: number, z: number, height: number) {
    this.pulse(x, z, 1.1 + 2.4 * height);
    this.impact.puff(x, z, Math.round(5 + 9 * height), 0x9b8c7c, 2.2 + 3.4 * height, 1.1 + 1.2 * height);
    this.burst(x, 0.1, z, 3 + 10 * height, 0x8a7b6b, 3.5 + 3 * height);
    this.squashT = 0.15;
    this.squashAmp = 0.1 + 0.16 * Math.min(1, height);
    this.shake = Math.max(this.shake, 0.1 + 0.32 * height);
    this.punch = Math.max(this.punch, 0.008 + 0.022 * height);
    if (height >= 0.45) this.crack(x, z, 2.2 + 2.2 * height);
  }

  private splat(x: number, z: number, size: number) {
    let s = this.splats.find((q) => q.life <= 0);
    if (!s) {
      if (this.splats.length >= 100)
        s = this.splats.reduce((a, b) => (a.life < b.life ? a : b));
      else {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({
            map: this.splatTex,
            color: 0x630c13,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        mesh.rotation.x = -Math.PI / 2;
        this.scene.add(mesh);
        s = { mesh, life: 0 };
        this.splats.push(s);
      }
    }
    s.life = 45;
    s.mesh.visible = true;
    s.mesh.position.set(
      Math.max(-ARENA_HX + 0.5, Math.min(ARENA_HX - 0.5, x)),
      0.015 + Math.random() * 0.004,
      Math.max(-ARENA_HZ + 0.5, Math.min(ARENA_HZ - 0.5, z)),
    );
    s.mesh.rotation.z = Math.random() * Math.PI * 2;
    s.mesh.scale.set(
      size * (0.8 + Math.random() * 0.6),
      size * (0.8 + Math.random() * 0.6),
      1,
    );
  }

  private blood(x: number, z: number, drops: number, size: number) {
    this.gore.spray(
      x,
      z,
      drops,
      x - this.hero.position.x,
      z - this.hero.position.z,
    );
    this.splat(
      x + (Math.random() - 0.5) * 0.9,
      z + (Math.random() - 0.5) * 0.9,
      size,
    );
  }

  private buildHero() {
    this.heroShadow = this.blobShadow(0.8);
    this.hero.add(this.heroShadow);
    const add = (m: THREE.Mesh, mat: THREE.MeshStandardMaterial) => {
      m.castShadow = true;
      this.hero.add(m);
      this.heroMats.push(mat);
      this.heroBase.push(mat.emissive.clone());
    };
    const cloakMat = std(0x5a1016);
    const cloak = new THREE.Mesh(
      new THREE.ConeGeometry(0.62, 1.5, 12),
      cloakMat,
    );
    cloak.position.y = 0.78;
    add(cloak, cloakMat);
    const bodyMat = std(0xd8cfc0);
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 0.55, 6, 12),
      bodyMat,
    );
    body.position.y = 1.15;
    add(body, bodyMat);
    const headMat = std(0xe9e2d6, 0xffd9a0, 0.25);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 14, 10),
      headMat,
    );
    head.position.y = 1.86;
    add(head, headMat);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.035, 8, 24),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffc46a,
        emissiveIntensity: 2.4,
      }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 2.22;
    this.hero.add(halo);

    this.starterBlade.add(starterWeapon());
    this.swordGrip.add(this.starterBlade);
    this.swordPivot.add(this.swordGrip);
    this.swordPivot.position.y = 1.05;
    this.hero.add(this.swordPivot);
    this.scene.add(this.hero);
    this.actorLoads.push(this.models.create("hero", 2.2).then((model) => {
      if (!model) return;
      this.heroModel = model;
      for (const child of this.hero.children)
        if (child !== this.swordPivot && !child.userData.keep)
          child.visible = false;
      this.hero.add(model.root);
      // carry the blade in the right hand instead of orbiting the body
      const hand = model.bone("RightHand");
      if (hand) {
        mountGrip(hand, this.swordGrip);
        // The entire grip moves to the hand, including a relic loaded before the hero.
      }
    }));
    // Keep light membership stable through hurt blinking and afterimage cloning.
    this.scene.add(this.weaponGlow);
    for (const id of WEAPON_IDS) {
      const spec = weapon(id);
      if (!spec.model) continue;
      this.actorLoads.push(this.models.create(spec.model, spec.height).then((model) => {
        if (!model) return;
        orientWeapon(model.root, spec);
        this.relicBlades.set(id, model.root);
        this.swordGrip.add(model.root);
        this.useWeapon(this.equippedWeapon, this.weaponLevel);
      }));
    }

    this.slashMat = new THREE.MeshBasicMaterial({
      color: 0xffb46a,
      transparent: true,
      opacity: 0,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 3.0, 28, 1, -1.22, 2.44),
      this.slashMat,
    );
    arc.rotation.x = -Math.PI / 2;
    this.slash.add(arc);
    this.slashArc = arc;
    this.thrustTrail = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.025, 0.09),
      this.slashMat,
    );
    this.thrustTrail.position.x = 1.65;
    this.slash.add(this.thrustTrail);
    this.slash.position.y = 0.9;
    this.scene.add(this.slash);
  }

  private buildPortal() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.9,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.5, 48), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffb040,
      transparent: true,
      opacity: 0.22,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.15, 7, 24, 1, true),
      beamMat,
    );
    beam.position.y = 3.5;
    this.portal.add(ring, beam);
    this.portal.position.set(PORTAL.x, 0, PORTAL.z);
    this.portal.visible = false;
    this.scene.add(this.portal);
  }

  private clearArenaEffects() {
    this.gore.clear();
    this.impact.clear();
    this.soul.clear();
    clearTransientEffects(this.scene,
      [this.cracks, this.splats, this.pulses, this.particles],
      this.damageTexts, []);
    this.afterimages.clear();
    this.squashT = this.squashAmp = this.dustCd = this.echoCd = 0;
    for (const c of this.fallen) this.disposeEnemy(c.view);
    this.fallen = [];
  }

  setCircle(i: number) {
    const idx = Math.max(0, Math.min(CIRCLES.length - 1, i));
    if (idx === this.circle) return;
    this.circle = idx;
    this.clearArenaEffects();
    const c = CIRCLES[idx];
    (this.scene.background as THREE.Color).setHex(c.fog);
    (this.ground.material as THREE.MeshBasicMaterial).color.setHex(c.tint);
    for (const m of this.rimMats) m.color.setHex(0x776856);
    this.key.color.setHex(c.light);
    (this.sigil.material as THREE.MeshBasicMaterial).color.setHex(c.glow);
    for (const l of this.torches) l.color.setHex(c.glow);
    for (const m of this.torchMats) m.emissive.setHex(c.glow);
    void this.models.floor(c.name).then((texture) => {
      if (this.circle !== idx) return;
      const material = this.ground.material as THREE.MeshBasicMaterial;
      material.map = texture ?? this.baseGround;
      // painted floors are dimmed a little so the actors stand out
      material.color.setHex(texture ? 0xc4c4c4 : c.tint);
      this.sigil.visible = this.sigilInner.visible = !texture;
      material.needsUpdate = true;
    });
  }

  private makeEnemy(kind: EnemyKind): EnemyView {
    const group = new THREE.Group();
    const mats: THREE.MeshStandardMaterial[] = [];
    const add = (
      geo: THREE.BufferGeometry,
      mat: THREE.MeshStandardMaterial,
      x: number,
      y: number,
      z: number,
    ) => {
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
      const orb = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xff5a2a,
        emissiveIntensity: 2.2,
      });
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
    } else if (kind === "champion") {
      const cloak = std(0x271c32, 0x220818, 1);
      add(new THREE.ConeGeometry(0.62, 1.5, 12), cloak, 0, 0.78, 0);
      add(
        new THREE.CapsuleGeometry(0.3, 0.55, 6, 12),
        std(0x9293aa),
        0,
        1.15,
        0,
      );
      add(
        new THREE.SphereGeometry(0.27, 14, 10),
        std(0xe5d4c1, 0xff2840, 0.4),
        0,
        1.86,
        0,
      );
      add(
        new THREE.BoxGeometry(1.55, 0.07, 0.17),
        std(0x371b2b, 0xff426b, 2.5),
        1.05,
        1.05,
        0,
      );
      h = 2.5;
    } else {
      const m = std(0x2a2230, 0x30103a, 1);
      add(new THREE.CapsuleGeometry(1.15, 1.7, 8, 14), m, 0, 1.95, 0);
      const crown = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffc23a,
        emissiveIntensity: 2.6,
      });
      const t = add(
        new THREE.TorusGeometry(0.75, 0.09, 8, 24),
        crown,
        0,
        4.15,
        0,
      );
      t.rotation.x = Math.PI / 2;
      const eye = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xff3a2a,
        emissiveIntensity: 3,
      });
      add(new THREE.SphereGeometry(0.16, 8, 6), eye, 1.05, 3.1, 0.35);
      add(new THREE.SphereGeometry(0.16, 8, 6), eye, 1.05, 3.1, -0.35);
      h = 4.9;
    }
    if (kind === "champion") {
      const w = 2.0, len = 6;
      tele = new THREE.Mesh(
        new THREE.PlaneGeometry(len, w),
        new THREE.MeshBasicMaterial({
          color: 0xff3020,
          transparent: true,
          opacity: 0,
          blending: THREE.NormalBlending,
          depthWrite: false,
        }),
      );
      tele.rotation.x = -Math.PI / 2;
      tele.position.set(len / 2, 0.05, 0);
      group.add(tele);
    }
    group.add(this.blobShadow(h * 0.33));
    const hpBg = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x140808, depthTest: false }),
    );
    const hpFg = new THREE.Sprite(
      new THREE.SpriteMaterial({
        color: 0xb77667,
        depthTest: false,
        toneMapped: false,
      }),
    );
    const bw = kind === "warden" ? 4 : 1.3;
    hpBg.scale.set(bw + 0.04, 0.16, 1);
    hpFg.scale.set(bw, 0.13, 1);
    hpBg.center.set(0, 0.5);
    hpFg.center.set(0, 0.5);
    hpBg.renderOrder = 10;
    hpFg.renderOrder = 11;
    hpBg.visible = hpFg.visible = false;
    this.scene.add(hpBg, hpFg);
    this.scene.add(group);
    const threat = kind === 'champion' ? undefined : new EnemyThreat();
    if (threat) this.scene.add(threat.root);
    return {
      sample: new PresentationSample(),
      group,
      mats,
      base: mats.map((m) => m.emissive.clone()),
      hpBg,
      hpFg,
      tele,
      threat,
      h,
    };
  }

  private burst(
    x: number,
    y: number,
    z: number,
    n: number,
    color: number,
    speed: number,
    glow = false,
  ) {
    for (let i = 0; i < Math.ceil(n * 0.4); i++) {
      let p = this.particles.find((q) => q.life <= 0);
      if (!p) {
        if (this.particles.length > 90) return;
        const mesh = new THREE.Mesh(
          this.pGeo,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            blending: THREE.NormalBlending,
            depthWrite: false,
          }),
        );
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
      p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const material = p.mesh.material as THREE.MeshBasicMaterial;
      material.color.setHex(color);
      const blending = glow ? THREE.AdditiveBlending : THREE.NormalBlending;
      if (material.blending !== blending) {
        material.blending = blending;
        material.needsUpdate = true;
      }
      p.mesh.visible = true;
    }
  }

  /** Visual reactions to what just happened in the simulation. Returns hit-stop seconds. */
  consume(events: SimEvent[]): number {
    let stop = 0;
    const glow = CIRCLES[this.circle]?.glow ?? 0xffa040;
    for (const e of events) {
      this.soul.event(e, e.side === "enemy" ? this.rivalWeapon : this.equippedWeapon);
      switch (e.type) {
        case "swing":
          if (e.amount === 2 && e.side !== "enemy") this.finisherT = 0.5;
          this.slashT = 0; // The shared weapon-specific ink stroke now owns the swing silhouette.
          this.swingSide = -this.swingSide;
          this.slash.scale.setScalar(e.amount === 2 ? 1.22 : 1);
          this.slashMat.color.setHex(e.amount === 2 ? 0xfff0d0 : 0xffb46a);
          break;
        case "ranged":
          break;
        case "hit": {
          const heavy = (e.amount ?? 0) > 40;
          const hx = e.x - this.hero.position.x, hz = e.z - this.hero.position.z;
          const hl = Math.hypot(hx, hz) || 1;
          this.damageText(e.x, e.z, String(e.amount ?? 0), heavy ? "#ffd59a" : "#e8dcc5", 2, heavy ? 1.35 : 1);
          this.burst(e.x, 1.1, e.z, 3, 0x9c7154, 3);
          this.blood(e.x, e.z, 12, 1.0);
          const fin = this.finisherT > 0;
          this.impact.hit(e.x, e.z, hx / hl, hz / hl, (heavy ? 1.45 : 1) * (fin ? 1.3 : 1), weapon(this.equippedWeapon).color);
          if (fin) {
            // The chain's closing blow holds a beat longer and hits the frame harder.
            stop = Math.max(stop, 0.028);
            this.shake = Math.max(this.shake, 0.2);
            this.punch = Math.max(this.punch, 0.014);
          }
          this.kick.x += (hx / hl) * (heavy ? 0.16 : 0.07);
          this.kick.y += (hz / hl) * (heavy ? 0.16 : 0.07);
          if (this.kick.length() > 0.3) this.kick.setLength(0.3);
          this.shake = Math.max(this.shake, heavy ? 0.17 : 0.09);
          if (heavy && !weapon(this.equippedWeapon).ranged) stop = Math.max(stop, .022);
          break;
        }
        case "kill":
          this.gore.shatter(e.x, e.z, e.kind === "warden" ? 14 : 6);
          this.burst(
            e.x,
            1.0,
            e.z,
            e.kind === "warden" ? 60 : 16,
            e.kind === "archer" ? 0xb070ff : 0xff5a3a,
            9,
          );
          this.blood(
            e.x,
            e.z,
            e.kind === "warden" ? 55 : 28,
            e.kind === "warden" ? 3.4 : 2.1,
          );
          this.splat(
            e.x + (Math.random() - 0.5) * 1.4,
            e.z + (Math.random() - 0.5) * 1.4,
            0.8,
          );
          this.pulse(e.x, e.z, e.kind === "warden" ? 4.2 : 1.9);
          {
            const kx = e.x - this.hero.position.x, kz = e.z - this.hero.position.z, kl = Math.hypot(kx, kz) || 1;
            this.impact.hit(e.x, e.z, kx / kl, kz / kl, e.kind === "warden" ? 2.6 : 1.9, weapon(this.equippedWeapon).color);
          }
          this.shake = Math.max(this.shake, e.kind === "warden" ? 0.45 : 0.22);
          this.punch = Math.max(this.punch, e.kind === "warden" ? 0.06 : 0.022);
          stop = Math.max(stop, e.kind === "warden" ? 0.08 : 0.024);
          break;
        case "hurt":
          this.damageText(e.x, e.z, `−${e.amount ?? 0}`, "#d6a092", 2.5);
          this.blood(e.x, e.z, 10, 0.8);
          this.impact.hit(e.x, e.z, Math.random() - 0.5, Math.random() - 0.5, 1.1, 0xff3a22, 0.12);
          this.shake = Math.max(this.shake, 0.3);
          this.punch = Math.max(this.punch, 0.018);
          stop = Math.max(stop, 0.026);
          break;
        case "jump":
          this.impact.puff(e.x, e.z, 6, 0x9b8c7c, 2.4, 1.1);
          this.pulse(e.x, e.z, 1.1);
          break;
        case "land":
          this.land(e.x, e.z, 0.22);
          break;
        case "plunge":
          // The whole frame answers the dive: cracked ground, a ring at the blow's true reach, a held beat.
          this.land(e.x, e.z, 1);
          this.impact.hit(e.x, e.z, Math.random() - 0.5, Math.random() - 0.5, 1.05, weapon(this.equippedWeapon).color);
          this.plungeT = 0.3;
          this.finisherT = 0.1;
          stop = Math.max(stop, 0.06);
          break;
        case "dash":
          this.burst(e.x, 0.6, e.z, 8, 0xffe0b0, 3);
          this.impact.puff(e.x, e.z, 5, 0x9b8c7c, 2.8, 1);
          this.impact.ring(e.x, e.z, 1.3, 0xffcd7e, true);
          break;
        case "spawn":
          this.burst(e.x, 0.2, e.z, 8, glow, 3);
          this.pulse(e.x, e.z, 1.5);
          break;
        case "cleared":
        case "won":
          this.burst(e.x, 0.4, e.z, 40, 0xffd27a, 8);
          break;
        case "burn":
          this.burst(e.x, 0.6, e.z, 2, 0xff852a, 1.4);
          break;
        case "boss-impact":
          if (e.bossMove === 'slam') { this.impact.ring(e.x, e.z, SLAM_RADIUS, 0xb28368); this.shake = Math.max(this.shake,.08); }
          break;
        case "nova":
          this.impact.ring(e.x, e.z, e.amount ?? 3, 0xffcd7e, e.followsCaster);
          this.burst(e.x, 0.4, e.z, 16, 0xffcd7e, 5);
          break;
        case "heal":
          this.burst(e.x, 0.8, e.z, 16, 0x84e8b7, 3);
          this.pulse(e.x, e.z, 1.2);
          break;
        case "echo":
          this.burst(e.x, 0.5, e.z, 22, 0xadc1ef, 4);
          this.impact.ring(e.x, e.z, 2.8, 0xffcd7e, e.followsCaster);
          break;
        case "skill":
          this.burst(e.x, 1, e.z, 24, 0xe9b76e, 4);
          break;
      }
    }
    // One accent per impact window. Multi-hit spells and burn ticks must not
    // repeatedly halt movement for the whole duration of the attack.
    if (stop && this.time - this.lastImpactTime < .16 && stop < .08) return 0;
    if (stop) this.lastImpactTime = this.time;
    return stop;
  }

  sync(w: World, dt: number, alpha = 1) {
    this.rivalWeapon = w.enemies.find(e => e.kind === "champion")?.weaponId ?? "starter";
    const battlefieldChanged =
      w.tick < this.lastWorldTick || w.floor - 1 !== this.circle;
    if (w.tick < this.lastWorldTick) {
      this.clearArenaEffects();
      this.lastImpactTime = -1;
      this.stride.set(0, 0);
      this.liftPeak = this.finisherT = this.airY = this.diveFrom = this.plungeT = 0;
      this.kick.set(0, 0);
      this.shake = this.punch = 0;
    }
    this.lastWorldTick = w.tick;
    this.time += dt;
    this.setCircle(w.floor - 1);
    const p = w.player;
    if (
      p.weaponId !== this.equippedWeapon ||
      p.weaponLevel !== this.weaponLevel
    )
      this.useWeapon(p.weaponId, p.weaponLevel);
    this.underworld.sync(w, dt);
    if (battlefieldChanged) this.soul.clear();
    this.slashMat.color.setHex(weapon(p.weaponId).color);
    if (
      p.weaponLevel >= 3 &&
      w.tick % Math.max(2, 10 - p.weaponLevel) === 0 &&
      p.swingT > 0
    )
      this.burst(p.x, 0.8, p.z, 2, weapon(p.weaponId).color, 1.5);
    this.slash.scale.setScalar(
      (weapon(p.weaponId).reach / 2.7) *
        (p.swingN % 3 === 0 ? 1.22 : 1) *
        (1 + 0.18 * rank(p.skills, "reach")),
    );

    // hero
    // The simulation steps the hero forward in one tick on every swing; draw it as a stride.
    if (w.tick !== this.heroMotionTick && !battlefieldChanged && p.swingT > 0 && p.swingN !== this.previousHeroSwing) {
      const jx = p.x - this.previousHero.x, jz = p.z - this.previousHero.y, jump = Math.hypot(jx, jz);
      if (jump > 0.12 && jump < 1.2) this.stride.set(-jx, -jz);
    }
    this.stride.multiplyScalar(Math.exp(-dt * 26));
    if (battlefieldChanged) this.stride.set(0, 0);
    this.finisherT -= dt;
    const rawMotion: CombatMotion | undefined = w.phase === 'dead' || p.dashT > 0 || p.jumpT > 0 ? undefined : p.castT > 0 ? {
      weapon: p.weaponId, ability: p.castId, elapsed: abilityDuration(p.castId!) - p.castT, combo: Number(p.castId?.split('-')[1]) || 1,
    } : p.swingT > 0 ? { weapon: p.weaponId, elapsed: weapon(p.weaponId).swing-p.swingT, combo:p.swingN } : undefined;
    const sampled = this.heroSample.sample(w.tick, p.x, p.z, `${p.weaponId}:${p.castT>0?'cast:'+p.castN:'swing:'+p.swingN}`, rawMotion, alpha, battlefieldChanged);
    this.hero.position.set((p.swingT > 0 ? p.x : sampled.x) + this.stride.x, 0, (p.swingT > 0 ? p.z : sampled.z) + this.stride.y);
    this.soul.sync(w, dt, this.hero.position);
    this.hero.rotation.y = -dirAngle(p.castT > 0 ? p.castAim : p.aim);
    const dashing = p.dashT > 0;
    // The simulation only knows "in the air"; the arc is drawn here, and a dive falls from wherever it began.
    if (p.jumpT > 0 && !p.plunge) {
      this.airY = JUMP_HEIGHT * Math.sin(Math.PI * (1 - p.jumpT / JUMP_TIME));
      this.diveFrom = 0;
    } else if (p.jumpT > 0) {
      if (!this.diveFrom) {
        this.diveFrom = Math.max(0.5, this.airY);
        this.diveT0 = p.jumpT;
      }
      this.airY = this.diveFrom * Math.min(1, p.jumpT / this.diveT0) ** 1.6;
    } else this.airY = this.diveFrom = 0;
    this.plungeT -= dt;
    const airborne = p.jumpT > 0;
    // The body stretches into the blow at contact and recoils when struck.
    const spec = weapon(p.weaponId);
    const sw = p.swingT > 0 ? 1 - p.swingT / spec.swing : -1;
    const at = (spec.impactDelay ?? spec.swing * 0.35) / spec.swing;
    const thrust = sw >= 0 ? Math.exp(-((sw - at) ** 2) / 0.012) : 0;
    const recoil = p.flash > 0 ? Math.sin(Math.min(1, p.flash / 0.25) * Math.PI) * 0.1 : 0;
    // In the air the body stretches with its speed; the landing squashes it flat for a beat.
    const rush = !airborne ? 0 : p.plunge ? 1.25 : Math.abs(Math.cos(Math.PI * (1 - p.jumpT / JUMP_TIME)));
    this.squashT -= dt;
    const squash = this.squashT > 0 && !airborne ? this.squashAmp * Math.sin((this.squashT / 0.15) * Math.PI) : 0;
    this.hero.scale.set(
      dashing ? 1.35 : 1 + 0.09 * thrust - 0.5 * recoil - 0.08 * rush + 0.8 * squash,
      dashing ? 0.8 : 1 - 0.04 * thrust + recoil + 0.17 * rush - squash,
      1 + (dashing ? 0 : 0.5 * recoil - 0.08 * rush + 0.8 * squash),
    );
    const blink = false;
    this.hero.visible = (w.phase !== "dead" || !!this.heroModel) && !blink;
    if (this.heroModel) {
      // A 120 Hz display renders a 60 Hz simulation state more than once.
      // Repeated samples are not a stop command (nor is a hit-stop frame).
      if (w.tick !== this.heroMotionTick || battlefieldChanged) {
        this.heroMoving = !battlefieldChanged && Math.abs(p.x - this.previousHero.x) + Math.abs(p.z - this.previousHero.y) > .001;
        this.heroMotionTick = w.tick;
      }
      const moving = this.heroMoving;
      this.heroModel.play(
        w.phase === "dead"
          ? "death"
          : p.castT > 0
            ? abilityClip(p.castId!, p.weaponId)
            : airborne
              ? p.plunge ? "ultimate-slam" : "attack-vault"
            : this.plungeT > 0
              ? "ultimate-slam"
            : dashing
              ? "dash"
              : p.swingT > 0
                ? attackClip(p.weaponId, p.swingN)
                : moving
                  ? "run"
                  : "idle",
        p.castT > 0
          ? abilityDuration(p.castId!)
          : airborne && !p.plunge
            ? JUMP_TIME * 1.6
          : airborne || this.plungeT > 0
            ? PLUNGE_FALL + 0.3
          : p.swingT > 0
            ? weapon(p.weaponId).swing
            : undefined,
        (p.castT > 0 && p.castN !== this.previousCast) ||
          (p.swingT > 0 && p.swingN !== this.previousHeroSwing),
      );
      this.heroModel.flash(p.flash > 0.19 ? 0xa8382a : p.flash > 0 ? 0x401b16 : null);
      const motion = sampled.motion;
      this.heroModel.update(dt, motion, this.airY);
      // Off the ground the shadow tightens; coming down, the floor answers.
      const lift = combatLift(motion);
      const height = Math.min(1, lift + this.airY / JUMP_HEIGHT);
      this.heroShadow.scale.setScalar(1 - 0.38 * height);
      (this.heroShadow.material as THREE.MeshBasicMaterial).opacity = 1 - 0.45 * height;
      if (lift > this.liftPeak) this.liftPeak = lift;
      else if (lift < 0.04 && this.liftPeak > 0) {
        if (this.liftPeak > 0.2) this.land(p.x + Math.cos(dirAngle(p.aim)) * 0.5, p.z + Math.sin(dirAngle(p.aim)) * 0.5, this.liftPeak);
        this.liftPeak = 0;
      }
    }
    this.dustCd -= dt;
    if (this.heroMoving && !dashing && !airborne && this.dustCd <= 0 && w.phase !== "dead") {
      this.dustCd = 0.17;
      this.impact.puff(p.x, p.z, 1, 0x8d7f70, 0.7, 0.75);
    }
    this.echoCd -= dt;
    if (
      ((p.dashT > 0 && rank(p.skills, "afterimage")) || (p.jumpT > 0 && p.plunge) || (p.castT > 0 && p.castPending && techniqueId(p.castId) && TECHNIQUES[techniqueId(p.castId)!].dash)) &&
      this.echoCd <= 0 &&
      this.heroModel
    ) {
      this.echoCd = 0.055;
      this.afterimages.emit(this.hero);
    }
    if (battlefieldChanged) this.afterimages.clear();
    this.afterimages.update(dt);
    this.swordGrip.localToWorld(this.weaponGlow.position.set(.8, 0, 0));
    this.previousHeroSwing = p.swingN;
    this.previousCast = p.castN;
    this.previousHero.set(p.x, p.z);
    for (let i = 0; i < this.heroMats.length; i++) {
      this.heroMats[i].emissive.copy(this.heroBase[i]);
      if (p.flash > 0) this.heroMats[i].emissive.setHex(0x401b16);
    }
    if (p.swingT > 0) {
      const s = 1 - p.swingT / weapon(p.weaponId).swing;
      const e = 1 - (1 - s) * (1 - s);
      this.swordPivot.rotation.y = this.swingSide * (1.35 - e * 2.7);
    } else {
      this.swordPivot.rotation.y +=
        (-0.95 * this.swingSide - this.swordPivot.rotation.y) *
        Math.min(1, dt * 14);
    }
    this.slashArc.visible = p.weaponId !== "acheron-needle";
    this.thrustTrail.visible = p.weaponId === "acheron-needle";
    if (this.slashT > 0) {
      this.slashT -= dt;
      this.slash.position.set(p.x, 0.9, p.z);
      this.slash.rotation.y = -dirAngle(p.aim);
      this.slashMat.opacity = Math.max(0, this.slashT / 0.16) * 0.24;
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
        const actor = v;
        void this.models.create(e.boss ?? e.kind, v.h - 0.3).then((model) => {
          if (!model) return;
          if (this.enemies.get(e.id) !== actor) {
            model.dispose();
            return;
          }
          for (const child of actor.group.children)
            if (child !== actor.tele && !child.userData.keep)
              child.visible = false;
          actor.model = model;
          actor.group.add(model.root);
          if (e.kind === "champion") {
            const spec = weapon(e.weaponId),
              hand = model.bone("RightHand");
            if (hand && !spec.model) { const grip = new THREE.Group(); actor.starterProp=starterWeapon(); grip.add(actor.starterProp); mountGrip(hand, grip); }
            if (hand && spec.model)
              void this.models.create(spec.model, spec.height).then((blade) => {
                if (!blade) return;
                if (this.enemies.get(e.id) !== actor) {
                  blade.dispose();
                  return;
                }
                const grip = new THREE.Group();
                mountGrip(hand, grip);
                orientWeapon(blade.root, spec);
                actor.weaponModel = blade;
                grip.add(blade.root);
                hand.add(grip);
              });
          }
        });
      }
      const position = v.sample.sample(w.tick, e.x, e.z, '', undefined, alpha, battlefieldChanged);
      this.syncEnemy(e, v, position);
      v.model?.update(dt, e.kind === 'champion' && (e.ability?.castT ?? 0) > 0 ? {
        weapon: e.weaponId ?? 'starter', ability: e.ability!.castId, elapsed: abilityDuration(e.ability!.castId!) - e.ability!.castT, combo: Number(e.ability!.castId?.split('-')[1]) || 1,
      } : undefined, 0, v.bossProgress);
    }
    for (const [id, v] of this.enemies) {
      if (seen.has(id)) continue;
      this.scene.remove(v.hpBg, v.hpFg);
      if (v.tele) v.tele.visible = false;
      v.threat?.clear();
      if (v.model && !battlefieldChanged) {
        // The killing blow throws the body back; it flares once, then cools.
        const fx = v.group.position.x - this.hero.position.x;
        const fz = v.group.position.z - this.hero.position.z;
        const fl = Math.hypot(fx, fz) || 1;
        const throwSpeed = v.h > 2.6 ? 2.2 : 6.5;
        v.model.flash(0x594638);
        v.model.play("death", 0.9);
        this.fallen.push({ view: v, life: 2.2, vx: (fx / fl) * throwSpeed, vz: (fz / fl) * throwSpeed, lit: true });
        if (this.fallen.length > 10)
          this.disposeEnemy(this.fallen.shift()!.view);
      } else this.disposeEnemy(v);
      this.enemies.delete(id);
    }

    for (const corpse of this.fallen) {
      corpse.life -= dt;
      if (corpse.lit && corpse.life < 2.13) {
        corpse.view.model?.flash(null);
        corpse.lit = false;
      }
      const body = corpse.view.group.position;
      body.x = Math.max(-ARENA_HX, Math.min(ARENA_HX, body.x + corpse.vx * dt));
      body.z = Math.max(-ARENA_HZ, Math.min(ARENA_HZ, body.z + corpse.vz * dt));
      const drag = Math.exp(-dt * 5.5);
      corpse.vx *= drag;
      corpse.vz *= drag;
      corpse.view.model?.update(dt);
      if (corpse.life < 0.7) corpse.view.group.position.y -= dt * 1.5;
      if (corpse.life <= 0) this.disposeEnemy(corpse.view);
    }
    this.fallen = this.fallen.filter((c) => c.life > 0);

    // shots
    const live = new Set<number>();
    for (const s of w.shots) {
      live.add(s.id);
      let m = this.shots.get(s.id);
      if (!m) {
        m = new THREE.Mesh(
          s.style === "bolt" || s.style === "lance"
            ? this.boltGeo
            : this.shotGeo,
          s.side === "player"
            ? s.style === "bolt"
              ? this.boltMat
              : this.soulMat
            : this.shotMat,
        );
        const base = m.material as THREE.MeshBasicMaterial;
        let glow = this.halos.get(base);
        if (!glow) this.halos.set(base, (glow = this.halo(base.color.getHex())));
        const aura = new THREE.Sprite(glow);
        aura.scale.setScalar(1.25);
        m.add(aura);
        this.scene.add(m);
        this.shots.set(s.id, m);
      }
      m.scale.set(
        s.style === "lance" ? 3.5 : 1,
        s.style === "lance" ? 0.55 : 1,
        s.style === "lance" ? 0.55 : 1,
      );
      m.position.set(s.x, 0.9, s.z);
      m.rotation.y = -Math.atan2(s.vz, s.vx);
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
    for (const m of this.torchMats)
      m.emissiveIntensity = 0.4 + Math.sin(this.time * 1.2 + m.id) * 0.03;

    this.gore.update(dt);
    this.impact.update(dt, this.hero.position);
    // particles
    for (const text of this.damageTexts) {
      text.life -= dt;
      const age = 0.65 - text.life;
      // Numbers punch in oversized, settle, then drift.
      const pop = age < 0.06 ? 0.6 + 0.75 * (age / 0.06) : 1.35 - 0.35 * Math.min(1, (age - 0.06) / 0.1);
      text.sprite.scale.set(1.8 * text.size * pop, 0.9 * text.size * pop, 1);
      text.sprite.position.y += dt * (age < 0.16 ? 2.6 : 0.7);
      text.sprite.material.opacity = Math.max(0, text.life / 0.4);
      if (text.life <= 0) {
        this.scene.remove(text.sprite);
        text.sprite.material.map?.dispose();
        text.sprite.material.dispose();
      }
    }
    this.damageTexts = this.damageTexts.filter((text) => text.life > 0);
    for (const p of this.pulses) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.mesh.scale.setScalar(p.radius * (1 - p.life / 0.35));
      p.mesh.material.opacity = Math.max(0, p.life / 0.35) * 0.22;
      if (p.life <= 0) p.mesh.visible = false;
    }
    for (const q of this.particles) {
      if (q.life <= 0) continue;
      q.life -= dt;
      q.vy -= 18 * dt;
      q.mesh.position.x += q.vx * dt;
      q.mesh.position.y = Math.max(0.05, q.mesh.position.y + q.vy * dt);
      q.mesh.position.z += q.vz * dt;
      const fade = Math.max(0, q.life / q.max);
      (q.mesh.material as THREE.MeshBasicMaterial).opacity = fade;
      q.mesh.scale.setScalar(0.45 + 0.75 * fade);
      q.mesh.rotation.x += dt * 9;
      q.mesh.rotation.z += dt * 7;
      if (q.life <= 0) q.mesh.visible = false;
    }

    for (const c of this.cracks) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.mesh.material.opacity = Math.min(0.8, c.life / 1.4);
      if (c.life <= 0) c.mesh.visible = false;
    }
    for (const q of this.splats) {
      if (q.life <= 0) continue;
      q.life -= dt;
      q.mesh.material.opacity = Math.min(0.85, q.life / 2.5);
      if (q.life <= 0) q.mesh.visible = false;
    }

    // fixed tilt; follow the hero but never look far past the arena
    const halfW = (this.viewH * this.aspect) / 2;
    const halfD = this.viewH / (2 * Math.sin(PITCH));
    const limX = Math.max(0, ARENA_HX + 4.5 - halfW);
    const limZ = Math.max(0, ARENA_HZ + 3.2 - halfD);
    // Lean the frame a little toward where the hero is facing.
    const facing = dirAngle(p.castT > 0 ? p.castAim : p.aim);
    this.look.x += (Math.cos(facing) * 0.55 - this.look.x) * Math.min(1, dt * 2.5);
    this.look.y += (Math.sin(facing) * 0.55 - this.look.y) * Math.min(1, dt * 2.5);
    const tx = Math.max(-limX, Math.min(limX, p.x + this.look.x * this.calm));
    const tz = Math.max(-limZ, Math.min(limZ, p.z + this.look.y * this.calm)) - 0.8;
    this.target.x += (tx - this.target.x) * Math.min(1, dt * 5);
    this.target.z += (tz - this.target.z) * Math.min(1, dt * 5);
    this.shake *= Math.exp(-dt * 9);
    if (this.shake < 0.003) this.shake = 0;
    this.kick.multiplyScalar(Math.exp(-dt * 13));
    this.punch *= Math.exp(-dt * 10);
    const t = this.time, amp = this.shake * this.calm;
    const sx = (Math.sin(t * 91) + Math.sin(t * 57 + 1.3)) * 0.5 * amp + this.kick.x * this.calm;
    const sz = (Math.sin(t * 83 + 2.1) + Math.sin(t * 49)) * 0.5 * amp + this.kick.y * this.calm;
    const zoom = 1 + (this.punch < 0.0005 ? 0 : this.punch * this.calm);
    if (this.camera.zoom !== zoom) {
      this.camera.zoom = zoom;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(
      this.target.x + sx,
      Math.sin(PITCH) * CAM_DIST,
      this.target.z + Math.cos(PITCH) * CAM_DIST + sz,
    );
    this.camera.lookAt(this.target.x + sx, 0, this.target.z + sz);
  }

  private disposeEnemy(v: EnemyView) {
    v.threat?.dispose();
    this.scene.remove(v.group, v.hpBg, v.hpFg);
    v.starterProp?.traverse(o=>{ if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();} });
    v.weaponModel?.dispose();
    v.model?.dispose();
    for (const child of v.group.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      child.geometry.dispose();
      if (Array.isArray(child.material))
        child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
    v.hpBg.material.dispose();
    v.hpFg.material.dispose();
  }

  private syncEnemy(e: Enemy, v: EnemyView, position: { x: number; z: number } = e) {
    v.threat?.sync(e, position);
    const wind = e.state === "windup";
    // A blow squashes the body and tips it away from the attacker; a wind-up trembles.
    const k = e.flash > 0 ? Math.min(1, e.flash / 0.14) : 0;
    const heft = e.kind === "warden" ? 0.35 : e.kind === "brute" || e.kind === "champion" ? 0.6 : 1;
    const wob = k > 0 ? Math.exp(-3.2 * (1 - k)) * Math.cos((1 - k) * 8.5) * heft : 0;
    const charge = wind ? Math.max(0, Math.min(1, 1 - e.t / (e.kind === "warden" ? bossWindup(e) : WINDUP[e.kind] || 0.5))) : 0;
    const tremble = wind ? Math.sin(this.time * 46 + e.id) * (0.012 + 0.04 * charge) : 0;
    v.group.position.set(position.x + tremble, 0, position.z);
    v.group.rotation.set(
      0,
      (e.ability?.castT ?? 0) > 0
        ? -dirAngle(e.ability!.castAim)
        : -Math.atan2(e.dz, e.dx),
      0,
    );
    if (k > 0) {
      let lx = e.knockX ?? 0, lz = e.knockZ ?? 0;
      if (!((e.knockT ?? 0) > 0) || lx * lx + lz * lz < 1e-6) {
        lx = e.x - this.hero.position.x;
        lz = e.z - this.hero.position.z;
      }
      const l = Math.hypot(lx, lz) || 1;
      this.leanAxis.set(lz / l, 0, -lx / l);
      this.leanQ.setFromAxisAngle(this.leanAxis, 0.32 * heft * k * k);
      v.group.quaternion.premultiply(this.leanQ);
    }
    const rising = e.spawn > 0 ? Math.max(0.05, 1 - e.spawn / 0.9) : 1;
    v.group.scale.set(1 + 0.2 * wob, rising * (1 - 0.15 * wob), 1 + 0.2 * wob);
    if (v.model) {
      const ritual = e.kind === 'warden' && e.boss && e.boss !== 'warden';
      const casting = ritual && (wind || e.state === 'recover') && bossMove(e) !== 'charge';
      const state = casting ? (bossMove(e) === 'slam' ? 'attack-slam' : 'attack') :
        (e.ability?.castT ?? 0) > 0
          ? abilityClip(e.ability!.castId!, e.weaponId ?? "starter")
          : e.state === "act"
            ? "dash"
            : wind
              ? attackClip(e.weaponId, e.pattern)
              : e.state === "seek"
                ? "run"
                : "idle";
      v.model.play(
        state,
        (e.ability?.castT ?? 0) > 0
          ? abilityDuration(e.ability!.castId!)
          : state === "cast"
          ? CAST_TIME
          : state.startsWith("ultimate")
            ? CORE_TIME
            : state.startsWith("attack")
              ? e.kind === "warden" ? bossWindup(e) : WINDUP[e.kind]
              : state === "dash"
                ? CHARGE[e.kind]
                : undefined,
        !!ritual && wind && v.bossPattern !== e.pattern,
      );
      if (ritual) {
        if (v.bossPattern !== e.pattern) { v.bossPattern = e.pattern; v.bossProgress = 0; }
        if (casting) {
          const contact = bossMove(e) === "slam" ? .43 : .7;
          const duration = bossMove(e) === "slam" ? 1.45 : 1.25;
          const progress = wind ? contact * (1 - e.t / bossWindup(e)) : contact + (1-contact)*Math.min(1, Math.max(0,duration-e.t)/.5);
          v.bossProgress = Math.max(v.bossProgress ?? 0, progress);
        } else v.bossProgress = undefined;
      }
      v.model.flash(
        e.flash > 0.09
          ? 0x503a28
          : e.flash > 0
          ? 0x302820
          : wind
            ? 0x3b2818
            : e.burnT > 0
              ? 0x3b2010
              : null,
      );
    }
    for (let i = 0; i < v.mats.length; i++) {
      const m = v.mats[i];
      m.emissive.copy(v.base[i]);
      if (e.burnT > 0) m.emissive.lerp(new THREE.Color(0xff5a16), 0.45);
      if (wind && i === 0) m.emissive.setRGB(0.15, 0.08, 0.02);
      if (e.flash > 0) m.emissive.setRGB(0.12, 0.1, 0.08);
    }
    if (v.tele) {
      const charging = wind && !(e.kind === "warden" && e.pattern % 3 === 0);
      // The warning fills as the blow approaches and snaps bright just before it lands.
      (v.tele.material as THREE.MeshBasicMaterial).opacity = charging
        ? 0.1 + 0.26 * charge * charge + (charge > 0.82 ? 0.14 : 0)
        : 0;
      if (e.kind === "champion")
        v.tele.scale.x = e.attackKind === "swing" ? 0.5 : 1;
    }
    const show = e.spawn <= 0 && (e.hp < e.maxHp || e.kind === "warden");
    v.hpBg.visible = v.hpFg.visible = show;
    if (show) {
      const bw = e.kind === "warden" ? 4 : 1.3;
      v.hpBg.position.set(position.x - bw / 2, v.h, position.z);
      v.hpFg.position.set(position.x - bw / 2, v.h, position.z);
      v.hpFg.scale.x = Math.max(0.001, bw * (e.hp / e.maxHp));
    }
  }

  /** Where the mouse points on the arena floor. */
  groundPoint(clientX: number, clientY: number, out: THREE.Vector3): boolean {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(ndc, this.camera);
    return this.ray.ray.intersectPlane(this.plane, out) !== null;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    // narrow windows zoom out so at least 20 units of arena width stay visible
    this.viewH = Math.max(VIEW_HEIGHT, 20 / this.aspect);
    const halfW = (this.viewH * this.aspect) / 2;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = this.viewH / 2;
    this.camera.bottom = -this.viewH / 2;
    this.camera.far = CAM_DIST * 2 + 100;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
