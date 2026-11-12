import { weapon, weaponId, type WeaponId } from "./weapons.ts";
// Deterministic combat simulation. No DOM, no three.js, no Math.random, no trig:
// the same inputs and seed always give the same run, so a server can replay it.
import { DX, DZ, DIRS, dirIndex } from "./dirs.ts";
import {
  SKILL_IDS,
  MAX_SKILL_RANK,
  rank,
  type SkillId,
  type Skills,
} from "./skills.ts";
import { DUEL_TICKS, type CombatBuild } from "./build.ts";

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const ARENA_HX = 17;
export const ARENA_HZ = 11;
export const FLOORS = 5;
export const PORTAL = { x: 0, z: -ARENA_HZ + 1.6, r: 1.5 };

export interface Input {
  /** direction index to move in, or -1 to stand still */
  move: number;
  /** direction index the hero faces */
  aim: number;
  attack: boolean;
  dash: boolean;
  /** Offered power slot, 1..3. Zero/undefined means no selection. */
  choice?: number;
}

export type EnemyKind = "imp" | "archer" | "brute" | "warden" | "champion";
export type EnemyState = "seek" | "windup" | "act" | "recover";

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  r: number;
  state: EnemyState;
  t: number;
  cd: number;
  dx: number;
  dz: number;
  hitDone: boolean;
  pattern: number;
  flash: number;
  spawn: number;
  burnT: number;
  burnCd: number;
  skills?: Skills;
  weaponLevel?: number;
  weaponId?: WeaponId;
  comboT?: number;
  armorLevel?: number;
  retaliationCd?: number;
  attackKind?: "dash" | "swing";
  /** Shove from a sword hit: a velocity that plays out over knockT seconds. */
  knockX?: number;
  knockZ?: number;
  knockT?: number;
}

export interface Shot {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  dmg: number;
  side?: "player" | "enemy";
  style?: "bolt" | "soul";
  pierce?: number;
  hitIds?: number[];
  skills?: Skills;
  heavy?: boolean;
}

export interface Player {
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  aim: number;
  swingT: number;
  swingN: number;
  attackCd: number;
  dashT: number;
  dashCd: number;
  dashDir: number;
  invuln: number;
  flash: number;
  coins: number;
  kills: number;
  skills: Skills;
  weaponLevel: number;
  weaponId: WeaponId;
  comboT: number;
  armorLevel: number;
  burnT: number;
  burnCd: number;
}

export type Phase = "fight" | "reward" | "cleared" | "dead" | "won";

export interface SimEvent {
  type:
    | "swing"
    | "hit"
    | "kill"
    | "hurt"
    | "dash"
    | "shot"
    | "spawn"
    | "cleared"
    | "floor"
    | "won"
    | "dead"
    | "reward"
    | "skill"
    | "nova"
    | "burn"
    | "heal"
    | "echo"
    | "ranged";
  x: number;
  z: number;
  kind?: EnemyKind;
  amount?: number;
  dir?: number;
}

export interface World {
  tick: number;
  seed: number;
  rng: number;
  floor: number;
  wave: number;
  wavesInFloor: number;
  spawnDelay: number;
  phase: Phase;
  player: Player;
  enemies: Enemy[];
  shots: Shot[];
  events: SimEvent[];
  nextId: number;
  offers: SkillId[];
  unlocked: readonly SkillId[];
  pickups: { id: number; x: number; z: number; healing: number }[];
  mode: "solo" | "duel";
}

const STATS: Record<
  EnemyKind,
  { hp: number; r: number; speed: number; coins: number }
> = {
  imp: { hp: 55, r: 0.55, speed: 4.4, coins: 3 },
  archer: { hp: 40, r: 0.5, speed: 3.2, coins: 4 },
  brute: { hp: 170, r: 0.95, speed: 2.5, coins: 9 },
  warden: { hp: 900, r: 1.5, speed: 3.1, coins: 60 },
  champion: { hp: 100, r: 0.55, speed: 6.5, coins: 0 },
};

const P_R = 0.5;
const P_SPEED = 7.6;
const DASH_SPEED = 26;
const DASH_TIME = 0.16;
const DASH_CD = 0.75;
const SWING_TIME = 0.2;
const ATTACK_CD = 0.3;
const MELEE_RANGE = 2.7;
const MELEE_COS = 0.34;
const MELEE_DMG = 30;

function rand(w: World): number {
  w.rng = (w.rng + 0x6d2b79f5) >>> 0;
  let t = w.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const wavesFor = (floor: number) => (floor < 3 ? 2 : 3);

export function createWorld(
  seed: number,
  trained: readonly SkillId[] = [],
  equipment: {
    weaponLevel: number;
    armorLevel: number;
    weaponId?: WeaponId;
  } = { weaponLevel: 0, armorLevel: 0 },
): World {
  const skills: Skills = {};
  for (const id of trained) if (SKILL_IDS.includes(id)) skills[id] = 1;
  const maxHp = 100 + rank(skills, "iron") * 20 + equipment.armorLevel * 3;
  const w: World = {
    tick: 0,
    seed: seed >>> 0,
    rng: seed >>> 0,
    floor: 1,
    wave: 0,
    wavesInFloor: wavesFor(1),
    spawnDelay: 0.9,
    phase: "fight",
    player: {
      x: 0,
      z: ARENA_HZ - 2.5,
      hp: maxHp,
      maxHp,
      aim: Math.floor(DIRS * 0.75),
      swingT: 0,
      swingN: 0,
      attackCd: 0,
      dashT: 0,
      dashCd: 0,
      dashDir: 0,
      invuln: 0,
      flash: 0,
      coins: 0,
      kills: 0,
      skills,
      weaponLevel: equipment.weaponLevel,
      weaponId: weaponId(equipment.weaponId),
      comboT: 0,
      armorLevel: equipment.armorLevel,
      burnT: 0,
      burnCd: 0,
    },
    enemies: [],
    shots: [],
    events: [],
    nextId: 1,
    offers: [],
    unlocked: [...trained],
    pickups: [],
    mode: "solo",
  };
  return w;
}

/** One authenticated champion build against another. No Solo rewards or waves. */
export function createDuelWorld(
  seed: number,
  challenger: CombatBuild,
  defender: CombatBuild,
): World {
  const w = createWorld(seed, [], challenger);
  w.mode = "duel";
  w.floor = 5;
  w.wavesInFloor = 1;
  w.spawnDelay = 0;
  Object.assign(w.player, {
    x: -6,
    z: 0,
    aim: 0,
    skills: { ...challenger.skills },
  });
  w.player.hp = w.player.maxHp =
    100 + 20 * rank(challenger.skills, "iron") + challenger.armorLevel * 3;
  const hp = 100 + 20 * rank(defender.skills, "iron") + defender.armorLevel * 3;
  w.enemies.push({
    id: w.nextId++,
    kind: "champion",
    x: 6,
    z: 0,
    hp,
    maxHp: hp,
    r: 0.55,
    state: "seek",
    t: 0,
    cd: 0.5,
    dx: -1,
    dz: 0,
    hitDone: false,
    pattern: 0,
    flash: 0,
    spawn: 0.8,
    burnT: 0,
    burnCd: 0,
    skills: { ...defender.skills },
    weaponLevel: defender.weaponLevel,
    weaponId: weaponId(defender.weaponId),
    armorLevel: defender.armorLevel,
    retaliationCd: 0,
  });
  return w;
}

function waveSpec(floor: number, wave: number, last: boolean): EnemyKind[] {
  const out: EnemyKind[] = [];
  const push = (k: EnemyKind, n: number) => {
    for (let i = 0; i < n; i++) out.push(k);
  };
  if (floor === FLOORS && last) {
    push("warden", 1);
    push("imp", 3);
    push("archer", 2);
    return out;
  }
  push("imp", 2 + floor + wave);
  push("archer", Math.max(0, floor - 1 + (wave > 0 ? 1 : 0)));
  push(
    "brute",
    floor >= 3
      ? Math.floor((floor - 1 + wave) / 2)
      : floor === 2 && wave === 1
        ? 1
        : 0,
  );
  return out;
}

function spawnEnemy(w: World, kind: EnemyKind) {
  const s = STATS[kind];
  const p = w.player;
  let x = 0;
  let z = 0;
  for (let tries = 0; tries < 12; tries++) {
    x = (rand(w) * 2 - 1) * (ARENA_HX - 1.5);
    z = (rand(w) * 2 - 1) * (ARENA_HZ - 1.5);
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz > 49) break;
  }
  if (kind === "warden") {
    x = 0;
    z = -ARENA_HZ + 4;
  }
  const hpScale = 1 + (w.floor - 1) * 0.18;
  const hp = Math.round(s.hp * (kind === "warden" ? 1 : hpScale));
  w.enemies.push({
    id: w.nextId++,
    kind,
    x,
    z,
    hp,
    maxHp: hp,
    r: s.r,
    state: "seek",
    t: 0,
    cd: 0.6 + rand(w) * 1.2,
    dx: 0,
    dz: 1,
    hitDone: false,
    pattern: 0,
    flash: 0,
    spawn: 0.7 + rand(w) * 0.35,
    burnT: 0,
    burnCd: 0,
  });
  w.events.push({ type: "spawn", x, z, kind });
}

function spawnWave(w: World) {
  const last = w.wave === w.wavesInFloor - 1;
  for (const k of waveSpec(w.floor, w.wave, last)) spawnEnemy(w, k);
}

function hurtPlayer(w: World, dmg: number, dot = false): boolean {
  const p = w.player;
  if ((!dot && p.invuln > 0) || w.phase !== "fight") return false;
  dmg = Math.max(1, Math.round(dmg * (1 - 0.1 * rank(p.skills, "iron"))));
  p.hp -= dmg;
  if (!dot) p.invuln = 0.55;
  p.flash = 0.25;
  w.events.push({ type: "hurt", x: p.x, z: p.z, amount: dmg });
  if (!dot && rank(p.skills, "reprisal") > 0)
    nova(w, p.x, p.z, 3.5, 16 * rank(p.skills, "reprisal"));
  if (p.hp <= 0) {
    p.hp = 0;
    w.phase = "dead";
    w.events.push({ type: "dead", x: p.x, z: p.z });
  }
  return true;
}

function hurtEnemy(w: World, e: Enemy, raw: number, dot = false) {
  const skills = e.skills ?? {};
  const dmg = Math.max(1, Math.round(raw * (1 - 0.1 * rank(skills, "iron"))));
  e.hp -= dmg;
  e.flash = 0.14;
  if (!dot)
    w.events.push({ type: "hit", x: e.x, z: e.z, amount: dmg, kind: e.kind });
  if (
    !dot &&
    e.hp > 0 &&
    rank(skills, "reprisal") &&
    (e.retaliationCd ?? 0) <= 0
  ) {
    e.retaliationCd = 1;
    w.events.push({ type: "nova", x: e.x, z: e.z, amount: 3.5 });
    if ((w.player.x - e.x) ** 2 + (w.player.z - e.z) ** 2 < 3.5 ** 2)
      hurtPlayer(w, 16 * rank(skills, "reprisal"));
  }
}

function nova(w: World, x: number, z: number, radius: number, dmg: number) {
  for (const e of w.enemies) {
    if (e.spawn > 0 || e.hp <= 0) continue;
    const dx = e.x - x,
      dz = e.z - z;
    if (dx * dx + dz * dz <= (radius + e.r) * (radius + e.r)) {
      hurtEnemy(w, e, dmg);
    }
  }
  for (const s of w.shots)
    if (
      s.side !== "player" &&
      (s.x - x) ** 2 + (s.z - z) ** 2 <= radius * radius
    )
      s.life = 0;
  w.events.push({ type: "nova", x, z, amount: radius });
}

function offerSkills(w: World) {
  const pool = w.unlocked.filter(
    (id) => rank(w.player.skills, id) < MAX_SKILL_RANK,
  );
  for (let i = 0; i < Math.min(3, pool.length); i++) {
    const j = i + Math.floor(rand(w) * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  w.offers = pool.slice(0, 3);
  w.phase = w.offers.length ? "reward" : w.floor === FLOORS ? "won" : "cleared";
  if (!w.offers.length)
    w.events.push({
      type: w.phase as "won" | "cleared",
      x: PORTAL.x,
      z: PORTAL.z,
    });
  w.shots = [];
  w.events.push({ type: "reward", x: w.player.x, z: w.player.z });
}

function chooseSkill(w: World, choice: number) {
  const id = w.offers[choice - 1];
  const p = w.player;
  p.skills[id] = rank(p.skills, id) + 1;
  if (id === "iron") {
    p.maxHp += 20;
    p.hp = Math.min(p.maxHp, p.hp + 20);
  }
  w.offers = [];
  w.events.push({ type: "skill", x: p.x, z: p.z, amount: choice });
  w.phase = w.floor === FLOORS ? "won" : "cleared";
  w.events.push({
    type: w.phase === "won" ? "won" : "cleared",
    x: PORTAL.x,
    z: PORTAL.z,
  });
}

function clampArena(o: { x: number; z: number }, r: number) {
  if (o.x < -ARENA_HX + r) o.x = -ARENA_HX + r;
  if (o.x > ARENA_HX - r) o.x = ARENA_HX - r;
  if (o.z < -ARENA_HZ + r) o.z = -ARENA_HZ + r;
  if (o.z > ARENA_HZ - r) o.z = ARENA_HZ - r;
}

function fireShot(
  w: World,
  x: number,
  z: number,
  dx: number,
  dz: number,
  speed: number,
  dmg: number,
) {
  w.shots.push({
    id: w.nextId++,
    x,
    z,
    vx: dx * speed,
    vz: dz * speed,
    life: 3.2,
    dmg,
  });
  w.events.push({ type: "shot", x, z });
}

const KNOCK_TIME = 0.1;

function fireWeapon(
  w: World,
  x: number,
  z: number,
  aim: number,
  identity: WeaponId,
  level: number,
  skills: Skills,
  heavy: boolean,
  combo: boolean,
  side: "player" | "enemy",
) {
  const blade = weapon(identity),
    speed = blade.projectileSpeed!;
  const damage = Math.round(
    (blade.damage + level * 2) *
      (heavy ? blade.heavy + 0.6 * rank(skills, "verdict") : 1) *
      (combo ? 1 + 0.25 * rank(skills, "coup") : 1),
  );
  const spread = heavy && blade.ranged === "soul" ? [-32, 0, 32] : [0];
  for (const offset of spread) {
    const dir = (aim + offset + DIRS) % DIRS;
    w.shots.push({
      id: w.nextId++,
      x: x + DX[dir] * 0.7,
      z: z + DZ[dir] * 0.7,
      vx: DX[dir] * speed,
      vz: DZ[dir] * speed,
      life: (blade.reach + 0.6 * rank(skills, "reach")) / speed,
      dmg: damage,
      side,
      style: blade.ranged,
      pierce: heavy && blade.ranged === "bolt" ? 2 : 1,
      hitIds: [],
      skills: { ...skills },
      heavy,
    });
  }
}

function melee(w: World) {
  const p = w.player;
  const ax = DX[p.aim];
  const az = DZ[p.aim];
  const heavy = p.swingN % 3 === 0;
  const blade = weapon(p.weaponId);
  const base = blade.damage + p.weaponLevel * 2;
  const dmg = Math.round(
    (heavy ? base * (blade.heavy + 0.6 * rank(p.skills, "verdict")) : base) *
      (p.comboT > 0 ? 1 + 0.25 * rank(p.skills, "coup") : 1),
  );
  p.comboT = 0;
  if (heavy && p.weaponId === "tollkeeper")
    nova(w, p.x + ax * 1.5, p.z + az * 1.5, 2.5, 10 + p.weaponLevel);
  for (const e of w.enemies) {
    if (e.spawn > 0 || e.hp <= 0) continue;
    const ex = e.x - p.x;
    const ez = e.z - p.z;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d > blade.reach + e.r + 0.6 * rank(p.skills, "reach")) continue;
    if (
      d > 0.001 &&
      (ex * ax + ez * az) / d < blade.arc - 0.12 * rank(p.skills, "reach")
    )
      continue;
    const burning = e.burnT > 0;
    hurtEnemy(w, e, dmg);
    if (heavy && burning && rank(p.skills, "pyre"))
      nova(w, e.x, e.z, 2.5, 12 * rank(p.skills, "pyre"));
    if (rank(p.skills, "ember") > 0) e.burnT = 3;
    const kb =
      e.kind === "warden"
        ? 0
        : e.kind === "brute"
          ? 0.55
          : e.kind === "champion"
            ? heavy
              ? 1.4 + 0.3 * rank(p.skills, "verdict")
              : 0.8
            : heavy
              ? 2.1 + 0.45 * rank(p.skills, "verdict")
              : 1.25;
    if (e.state !== "act" && kb > 0) {
      e.knockX = (ax * kb * blade.knock) / KNOCK_TIME;
      e.knockZ = (az * kb * blade.knock) / KNOCK_TIME;
      e.knockT = KNOCK_TIME;
    }
  }
}

function stepPlayer(w: World, input: Input) {
  const p = w.player;
  if (p.comboT > 0) p.comboT -= DT;
  if (p.attackCd > 0) p.attackCd -= DT;
  if (p.dashCd > 0) p.dashCd -= DT;
  if (p.invuln > 0) p.invuln -= DT;
  if (p.flash > 0) p.flash -= DT;
  if (p.swingT > 0) p.swingT -= DT;

  if (input.dash && p.dashCd <= 0 && p.dashT <= 0) {
    p.dashDir = input.move >= 0 ? input.move : input.aim;
    p.dashT = DASH_TIME;
    p.comboT = 1 + DASH_TIME;
    p.dashCd = DASH_CD * (1 - 0.12 * rank(p.skills, "ash"));
    if (p.invuln < DASH_TIME + 0.08) p.invuln = DASH_TIME + 0.08;
    p.swingT = 0;
    w.events.push({ type: "dash", x: p.x, z: p.z, dir: p.dashDir });
    if (rank(p.skills, "ash") > 0)
      nova(w, p.x, p.z, 2.5, 18 * rank(p.skills, "ash"));
  }

  if (p.dashT > 0) {
    p.dashT -= DT;
    p.x += DX[p.dashDir] * DASH_SPEED * DT;
    p.z += DZ[p.dashDir] * DASH_SPEED * DT;
    if (p.dashT <= 0 && rank(p.skills, "afterimage")) {
      nova(w, p.x, p.z, 2.8, 12 * rank(p.skills, "afterimage"));
      w.events.push({ type: "echo", x: p.x, z: p.z });
    }
  } else {
    if (p.swingT <= 0) p.aim = input.aim;
    if (input.attack && p.attackCd <= 0) {
      p.aim = input.aim;
      p.swingN += 1;
      const blade = weapon(p.weaponId);
      p.swingT = blade.swing;
      p.attackCd =
        (blade.cooldown + (p.swingN % 3 === 0 ? blade.cooldown * 0.4 : 0)) *
        (1 - 0.08 * rank(p.skills, "haste"));
      p.x += DX[p.aim] * blade.lunge;
      p.z += DZ[p.aim] * blade.lunge;
      w.events.push({
        type: blade.ranged ? "ranged" : "swing",
        x: p.x,
        z: p.z,
        dir: p.aim,
        amount: p.swingN % 3 === 0 ? 2 : 1,
      });
      if (blade.ranged) {
        fireWeapon(
          w,
          p.x,
          p.z,
          p.aim,
          p.weaponId,
          p.weaponLevel,
          p.skills,
          p.swingN % 3 === 0,
          p.comboT > 0,
          "player",
        );
        p.comboT = 0;
      } else melee(w);
    }
    if (input.move >= 0) {
      const slow = p.swingT > 0 ? 0.55 : 1;
      const speed = P_SPEED * (1 + 0.08 * rank(p.skills, "haste"));
      p.x += DX[input.move] * speed * slow * DT;
      p.z += DZ[input.move] * speed * slow * DT;
    }
  }
  clampArena(p, P_R);
}

function stepEnemy(w: World, e: Enemy) {
  // A killing swing resolves before enemies act on this tick.
  if (e.hp <= 0) return;
  const p = w.player;
  const s = STATS[e.kind];
  if (e.flash > 0) e.flash -= DT;
  if (e.spawn > 0) {
    e.spawn -= DT;
    return;
  }
  if ((e.knockT ?? 0) > 0) {
    e.knockT! -= DT;
    e.x += e.knockX! * DT;
    e.z += e.knockZ! * DT;
    clampArena(e, e.r);
    // lesser enemies reel for the length of the shove; the Duel rival keeps acting
    if (e.kind !== "champion" && e.kind !== "warden") return;
  }
  if (e.cd > 0) e.cd -= DT;
  if ((e.retaliationCd ?? 0) > 0) e.retaliationCd! -= DT;
  let ex = p.x - e.x;
  let ez = p.z - e.z;
  const d = Math.sqrt(ex * ex + ez * ez);
  if (d > 0.0001) {
    ex /= d;
    ez /= d;
  } else {
    ex = 0;
    ez = 1;
  }
  const reach = e.r + P_R;

  switch (e.kind) {
    case "champion": {
      const skills = e.skills ?? {};
      const blade = weapon(e.weaponId);
      if ((e.comboT ?? 0) > 0) e.comboT! -= DT;
      const attackReach = blade.reach + 0.6 * rank(skills, "reach");
      if (e.state === "seek") {
        e.dx = ex;
        e.dz = ez;
        const speed = s.speed * (1 + 0.08 * rank(skills, "haste"));
        if (
          blade.ranged &&
          d < 4 &&
          Math.abs(e.x) < ARENA_HX - 1 &&
          Math.abs(e.z) < ARENA_HZ - 1
        ) {
          e.x -= ex * speed * 0.6 * DT;
          e.z -= ez * speed * 0.6 * DT;
        } else if (d > (blade.ranged ? attackReach * 0.7 : attackReach - 0.3)) {
          e.x += ex * speed * DT;
          e.z += ez * speed * DT;
        }
        if (e.cd <= 0 && d < (blade.ranged ? attackReach : 9)) {
          e.pattern++;
          e.hitDone = false;
          e.state = "windup";
          e.attackKind =
            !blade.ranged && d > attackReach + 0.5 ? "dash" : "swing";
          e.t =
            (d > attackReach + 0.5 ? 0.5 : 0.34) *
            (1 - 0.08 * rank(skills, "haste"));
          // Fix the attack kind and direction at the warning, never track the dodge.
          e.t = Math.max(e.t, 0.2);
        }
      } else if (e.state === "windup") {
        e.t -= DT;
        if (e.t <= 0) {
          if (e.attackKind === "dash") {
            e.state = "act";
            e.t = 0.2;
            if (rank(skills, "ash")) {
              w.events.push({ type: "nova", x: e.x, z: e.z, amount: 2.5 });
              if (d < 2.5) hurtPlayer(w, 18 * rank(skills, "ash"));
            }
          } else {
            const heavy = e.pattern % 3 === 0;
            if (blade.ranged) {
              fireWeapon(
                w,
                e.x,
                e.z,
                dirIndex(e.dx, e.dz),
                weaponId(e.weaponId),
                e.weaponLevel ?? 0,
                skills,
                heavy,
                (e.comboT ?? 0) > 0,
                "enemy",
              );
              e.state = "recover";
              e.comboT = 0;
              e.t = blade.swing;
              e.cd = blade.cooldown * (1 - 0.08 * rank(skills, "haste"));
              break;
            }
            const facing = d < 0.001 ? 1 : ex * e.dx + ez * e.dz;
            const damage = Math.round(
              (blade.damage + (e.weaponLevel ?? 0) * 2) *
                (heavy ? blade.heavy + 0.6 * rank(skills, "verdict") : 1) *
                ((e.comboT ?? 0) > 0 ? 1 + 0.25 * rank(skills, "coup") : 1),
            );
            const direct =
              d <= attackReach &&
              facing >= blade.arc - 0.12 * rank(skills, "reach");
            const shock =
              heavy &&
              e.weaponId === "tollkeeper" &&
              (p.x - e.x - e.dx * 1.5) ** 2 + (p.z - e.z - e.dz * 1.5) ** 2 <=
                2.5 ** 2;
            const pyre =
              direct && heavy && p.burnT > 0 ? 12 * rank(skills, "pyre") : 0;
            if (shock || pyre)
              w.events.push({
                type: "nova",
                x: e.x + e.dx * 1.5,
                z: e.z + e.dz * 1.5,
                amount: 2.5,
              });
            if (
              (direct || shock) &&
              hurtPlayer(
                w,
                (direct ? damage : 0) +
                  (shock ? 10 + (e.weaponLevel ?? 0) : 0) +
                  pyre,
              )
            ) {
              if (rank(skills, "ember")) {
                p.burnT = 3;
                p.burnCd = 0.5;
              }
              if (rank(skills, "blood"))
                e.hp = Math.min(e.maxHp, e.hp + 2 * rank(skills, "blood"));
            }
            e.state = "recover";
            e.comboT = 0;
            e.t = blade.swing;
            e.cd = blade.cooldown * (1 - 0.08 * rank(skills, "haste"));
          }
        }
      } else if (e.state === "act") {
        e.x += e.dx * 23 * DT;
        e.z += e.dz * 23 * DT;
        e.t -= DT;
        if (!e.hitDone && d < 1.3) {
          hurtPlayer(w, 18 + 6 * rank(skills, "ash"));
          e.hitDone = true;
        }
        if (e.t <= 0) {
          e.state = "recover";
          e.t = 0.5;
          e.cd = 0.6 * (1 - 0.12 * rank(skills, "ash"));
          e.comboT = 1;
          if (rank(skills, "afterimage")) {
            w.events.push({ type: "echo", x: e.x, z: e.z });
            if (d < 2.8) hurtPlayer(w, 12 * rank(skills, "afterimage"));
          }
        }
      } else {
        e.t -= DT;
        if (e.t <= 0) e.state = "seek";
      }
      break;
    }
    case "imp": {
      if (e.state === "seek") {
        e.dx = ex;
        e.dz = ez;
        e.x += ex * s.speed * DT;
        e.z += ez * s.speed * DT;
        if (d < reach + 0.75) {
          e.state = "windup";
          e.t = 0.42;
        }
      } else if (e.state === "windup") {
        e.t -= DT;
        if (e.t <= 0) {
          if (d < reach + 1.25) hurtPlayer(w, 10);
          e.state = "recover";
          e.t = 0.55;
        }
      } else {
        e.t -= DT;
        if (e.t <= 0) e.state = "seek";
      }
      break;
    }
    case "archer": {
      if (e.state === "seek") {
        e.dx = ex;
        e.dz = ez;
        if (d < 6) {
          e.x -= ex * s.speed * DT;
          e.z -= ez * s.speed * DT;
        } else if (d > 10.5) {
          e.x += ex * s.speed * DT;
          e.z += ez * s.speed * DT;
        }
        if (e.cd <= 0 && d < 16) {
          e.state = "windup";
          e.t = 0.5;
        }
      } else if (e.state === "windup") {
        e.dx = ex;
        e.dz = ez;
        e.t -= DT;
        if (e.t <= 0) {
          fireShot(w, e.x + ex * 0.7, e.z + ez * 0.7, ex, ez, 11.5, 9);
          e.state = "seek";
          e.cd = 1.7 + rand(w) * 0.7;
        }
      }
      break;
    }
    case "brute":
    case "warden": {
      const boss = e.kind === "warden";
      if (e.state === "seek") {
        e.dx = ex;
        e.dz = ez;
        e.x += ex * s.speed * DT;
        e.z += ez * s.speed * DT;
        if (e.cd <= 0 && d < (boss ? 12 : 7.5)) {
          e.state = "windup";
          e.t = boss ? 0.5 : 0.65;
          e.hitDone = false;
          e.pattern += 1;
        }
      } else if (e.state === "windup") {
        e.t -= DT;
        if (e.t <= 0) {
          if (boss && e.pattern % 3 === 0) {
            const n = e.hp < e.maxHp * 0.5 ? 18 : 12;
            const off = Math.floor(rand(w) * DIRS);
            for (let i = 0; i < n; i++) {
              const di = (off + Math.floor((i * DIRS) / n)) % DIRS;
              fireShot(
                w,
                e.x + DX[di] * e.r,
                e.z + DZ[di] * e.r,
                DX[di],
                DZ[di],
                8.5,
                12,
              );
            }
            e.state = "recover";
            e.t = 0.9;
            e.cd = 1.0;
          } else {
            e.state = "act";
            e.t = boss ? 0.6 : 0.55;
          }
        }
      } else if (e.state === "act") {
        e.t -= DT;
        const sp = boss ? 19 : 17;
        e.x += e.dx * sp * DT;
        e.z += e.dz * sp * DT;
        if (!e.hitDone && d < reach + 0.35) {
          hurtPlayer(w, boss ? 24 : 20);
          e.hitDone = true;
        }
        if (e.t <= 0) {
          e.state = "recover";
          e.t = boss ? 0.7 : 0.95;
          e.cd = boss ? 1.1 : 1.6;
          if (
            boss &&
            e.hp < e.maxHp * 0.5 &&
            e.pattern % 4 === 1 &&
            w.enemies.length < 9
          ) {
            spawnEnemy(w, "imp");
            spawnEnemy(w, "imp");
          }
        }
      } else {
        e.t -= DT;
        if (e.t <= 0) e.state = "seek";
      }
      break;
    }
  }
  clampArena(e, e.r);
}

export function step(w: World, input: Input): void {
  if (w.phase === "dead" || w.phase === "won") return;
  if (w.phase === "reward") {
    if (!Number.isInteger(input.choice) || !w.offers[(input.choice ?? 0) - 1])
      return;
    w.tick += 1;
    chooseSkill(w, input.choice!);
    return;
  }
  w.tick += 1;
  const p = w.player;

  stepPlayer(w, input);
  if (p.burnT > 0 && p.hp > 0) {
    p.burnT -= DT;
    p.burnCd -= DT;
    if (p.burnCd <= 0) {
      p.burnCd += 0.5;
      hurtPlayer(w, 2 * rank(w.enemies[0]?.skills ?? {}, "ember"), true);
    }
  }

  for (const e of w.enemies) {
    if (e.hp > 0 && e.burnT > 0) {
      e.burnT -= DT;
      e.burnCd -= DT;
      if (e.burnCd <= 0) {
        e.burnCd += 0.5;
        hurtEnemy(w, e, 2 * rank(p.skills, "ember"), true);
        w.events.push({ type: "burn", x: e.x, z: e.z });
      }
    }
    if (p.hp > 0) stepEnemy(w, e);
  }

  // keep enemies from stacking on each other
  for (let i = 0; i < w.enemies.length; i++) {
    const a = w.enemies[i];
    if (a.spawn > 0 || a.hp <= 0) continue;
    for (let j = i + 1; j < w.enemies.length; j++) {
      const b = w.enemies[j];
      if (b.spawn > 0 || b.hp <= 0) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const min = a.r + b.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) / 2;
      const nx = dx / d;
      const nz = dz / d;
      const wa = a.kind === "warden" || a.state === "act" ? 0 : 1;
      const wb = b.kind === "warden" || b.state === "act" ? 0 : 1;
      a.x -= nx * push * wa;
      a.z -= nz * push * wa;
      b.x += nx * push * wb;
      b.z += nz * push * wb;
    }
  }

  // shots
  for (const s of w.shots) {
    if (s.life <= 0) continue;
    s.x += s.vx * DT;
    s.z += s.vz * DT;
    s.life -= DT;
    if (s.side === "player") {
      for (const e of w.enemies) {
        if (e.hp <= 0 || e.spawn > 0 || s.hitIds?.includes(e.id)) continue;
        if ((s.x - e.x) ** 2 + (s.z - e.z) ** 2 > (e.r + 0.2) ** 2) continue;
        const burning = e.burnT > 0;
        hurtEnemy(w, e, s.dmg);
        if (rank(s.skills ?? {}, "ember")) e.burnT = 3;
        if (s.heavy && burning && rank(s.skills ?? {}, "pyre"))
          nova(w, e.x, e.z, 2.5, 12 * rank(s.skills ?? {}, "pyre"));
        (s.hitIds ??= []).push(e.id);
        s.pierce = (s.pierce ?? 1) - 1;
        if (s.pierce <= 0) {
          s.life = 0;
          break;
        }
      }
    }
    const dx = s.x - p.x;
    const dz = s.z - p.z;
    if (
      s.side !== "player" &&
      dx * dx + dz * dz < (P_R + 0.28) * (P_R + 0.28)
    ) {
      if (p.invuln <= 0) {
        const burning = p.burnT > 0;
        if (
          hurtPlayer(
            w,
            s.dmg +
              (s.heavy && burning ? 12 * rank(s.skills ?? {}, "pyre") : 0),
          ) &&
          rank(s.skills ?? {}, "ember")
        ) {
          p.burnT = 3;
          p.burnCd = 0.5;
        }
        s.life = 0;
      }
    }
    if (s.x < -ARENA_HX || s.x > ARENA_HX || s.z < -ARENA_HZ || s.z > ARENA_HZ)
      s.life = 0;
  }
  if (w.shots.length) w.shots = w.shots.filter((s) => s.life > 0);

  // deaths
  let died = false;
  for (const e of w.enemies) {
    if (e.hp <= 0) {
      died = true;
      p.coins += STATS[e.kind].coins;
      p.kills += 1;
      if (w.mode === "solo" && p.kills % 7 === 0)
        w.pickups.push({ id: w.nextId++, x: e.x, z: e.z, healing: 18 });
      if (p.hp > 0)
        p.hp = Math.min(p.maxHp, p.hp + 2 * rank(p.skills, "blood"));
      w.events.push({
        type: "kill",
        x: e.x,
        z: e.z,
        kind: e.kind,
        amount: STATS[e.kind].coins,
      });
    }
  }
  if (died) w.enemies = w.enemies.filter((e) => e.hp > 0);

  for (const item of w.pickups) {
    if (
      p.hp > 0 &&
      p.hp < p.maxHp &&
      (p.x - item.x) ** 2 + (p.z - item.z) ** 2 < 1.2 ** 2
    ) {
      const restored = Math.min(
        p.maxHp - p.hp,
        Math.round(item.healing * (1 + 0.5 * rank(p.skills, "mercy"))),
      );
      p.hp += restored;
      item.healing = 0;
      w.events.push({ type: "heal", x: p.x, z: p.z, amount: restored });
    }
  }
  w.pickups = w.pickups.filter((item) => item.healing > 0);

  // waves and floors
  if (w.mode === "duel") {
    if (w.phase === "fight" && !w.enemies.length) {
      w.phase = "won";
      w.shots = [];
      w.events.push({ type: "won", x: p.x, z: p.z });
    } else if (w.phase === "fight" && w.tick >= DUEL_TICKS) {
      p.hp = 0;
      w.phase = "dead";
      w.events.push({ type: "dead", x: p.x, z: p.z });
    }
    return;
  }
  if (w.phase === "fight") {
    if (w.spawnDelay > 0) {
      w.spawnDelay -= DT;
      if (w.spawnDelay <= 0) spawnWave(w);
    } else if (w.enemies.length === 0) {
      if (w.wave + 1 < w.wavesInFloor) {
        w.wave += 1;
        w.spawnDelay = 0.9;
      } else {
        offerSkills(w);
      }
    }
  } else if (w.phase === "cleared") {
    const dx = p.x - PORTAL.x;
    const dz = p.z - PORTAL.z;
    if (dx * dx + dz * dz < PORTAL.r * PORTAL.r) {
      w.floor += 1;
      w.pickups = [];
      w.wave = 0;
      w.wavesInFloor = wavesFor(w.floor);
      w.spawnDelay = 1.0;
      w.phase = "fight";
      p.x = 0;
      p.z = ARENA_HZ - 2.5;
      p.hp = Math.min(p.maxHp, p.hp + 20);
      w.events.push({ type: "floor", x: p.x, z: p.z, amount: w.floor });
    }
  }
}
