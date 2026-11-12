// Deterministic combat simulation. No DOM, no three.js, no Math.random, no trig:
// the same inputs and seed always give the same run, so a server can replay it.
import { DX, DZ, DIRS } from "./dirs.ts";

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const ARENA_HX = 15;
export const ARENA_HZ = 9.5;
export const FLOORS = 5;
export const PORTAL = { x: 0, z: -ARENA_HZ + 1.6, r: 1.5 };

export interface Input {
  /** direction index to move in, or -1 to stand still */
  move: number;
  /** direction index the hero faces */
  aim: number;
  attack: boolean;
  dash: boolean;
}

export type EnemyKind = "imp" | "archer" | "brute" | "warden";
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
}

export interface Shot {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  life: number;
  dmg: number;
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
}

export type Phase = "fight" | "cleared" | "dead" | "won";

export interface SimEvent {
  type: "swing" | "hit" | "kill" | "hurt" | "dash" | "shot" | "spawn" | "cleared" | "floor" | "won" | "dead";
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
}

const STATS: Record<EnemyKind, { hp: number; r: number; speed: number; coins: number }> = {
  imp: { hp: 55, r: 0.55, speed: 4.4, coins: 3 },
  archer: { hp: 40, r: 0.5, speed: 3.2, coins: 4 },
  brute: { hp: 170, r: 0.95, speed: 2.5, coins: 9 },
  warden: { hp: 900, r: 1.5, speed: 3.1, coins: 60 },
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

export function createWorld(seed: number): World {
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
      hp: 100,
      maxHp: 100,
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
    },
    enemies: [],
    shots: [],
    events: [],
    nextId: 1,
  };
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
  push("brute", floor >= 3 ? Math.floor((floor - 1 + wave) / 2) : floor === 2 && wave === 1 ? 1 : 0);
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
  });
  w.events.push({ type: "spawn", x, z, kind });
}

function spawnWave(w: World) {
  const last = w.wave === w.wavesInFloor - 1;
  for (const k of waveSpec(w.floor, w.wave, last)) spawnEnemy(w, k);
}

function hurtPlayer(w: World, dmg: number) {
  const p = w.player;
  if (p.invuln > 0 || w.phase !== "fight") return;
  p.hp -= dmg;
  p.invuln = 0.55;
  p.flash = 0.25;
  w.events.push({ type: "hurt", x: p.x, z: p.z, amount: dmg });
  if (p.hp <= 0) {
    p.hp = 0;
    w.phase = "dead";
    w.events.push({ type: "dead", x: p.x, z: p.z });
  }
}

function clampArena(o: { x: number; z: number }, r: number) {
  if (o.x < -ARENA_HX + r) o.x = -ARENA_HX + r;
  if (o.x > ARENA_HX - r) o.x = ARENA_HX - r;
  if (o.z < -ARENA_HZ + r) o.z = -ARENA_HZ + r;
  if (o.z > ARENA_HZ - r) o.z = ARENA_HZ - r;
}

function fireShot(w: World, x: number, z: number, dx: number, dz: number, speed: number, dmg: number) {
  w.shots.push({ id: w.nextId++, x, z, vx: dx * speed, vz: dz * speed, life: 3.2, dmg });
  w.events.push({ type: "shot", x, z });
}

function melee(w: World) {
  const p = w.player;
  const ax = DX[p.aim];
  const az = DZ[p.aim];
  const heavy = p.swingN % 3 === 0;
  const dmg = heavy ? Math.round(MELEE_DMG * 1.6) : MELEE_DMG;
  for (const e of w.enemies) {
    if (e.spawn > 0) continue;
    const ex = e.x - p.x;
    const ez = e.z - p.z;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d > MELEE_RANGE + e.r) continue;
    if (d > 0.001 && (ex * ax + ez * az) / d < MELEE_COS) continue;
    e.hp -= dmg;
    e.flash = 0.14;
    const kb = e.kind === "warden" ? 0 : e.kind === "brute" ? 0.35 : heavy ? 1.4 : 0.8;
    if (e.state !== "act") {
      e.x += ax * kb;
      e.z += az * kb;
    }
    w.events.push({ type: "hit", x: e.x, z: e.z, kind: e.kind, amount: dmg });
  }
}

function stepPlayer(w: World, input: Input) {
  const p = w.player;
  if (p.attackCd > 0) p.attackCd -= DT;
  if (p.dashCd > 0) p.dashCd -= DT;
  if (p.invuln > 0) p.invuln -= DT;
  if (p.flash > 0) p.flash -= DT;
  if (p.swingT > 0) p.swingT -= DT;

  if (input.dash && p.dashCd <= 0 && p.dashT <= 0) {
    p.dashDir = input.move >= 0 ? input.move : input.aim;
    p.dashT = DASH_TIME;
    p.dashCd = DASH_CD;
    if (p.invuln < DASH_TIME + 0.08) p.invuln = DASH_TIME + 0.08;
    p.swingT = 0;
    w.events.push({ type: "dash", x: p.x, z: p.z, dir: p.dashDir });
  }

  if (p.dashT > 0) {
    p.dashT -= DT;
    p.x += DX[p.dashDir] * DASH_SPEED * DT;
    p.z += DZ[p.dashDir] * DASH_SPEED * DT;
  } else {
    if (p.swingT <= 0) p.aim = input.aim;
    if (input.attack && p.attackCd <= 0) {
      p.aim = input.aim;
      p.swingN += 1;
      p.swingT = SWING_TIME;
      p.attackCd = ATTACK_CD + (p.swingN % 3 === 0 ? 0.16 : 0);
      p.x += DX[p.aim] * 0.55;
      p.z += DZ[p.aim] * 0.55;
      w.events.push({ type: "swing", x: p.x, z: p.z, dir: p.aim, amount: p.swingN % 3 === 0 ? 2 : 1 });
      melee(w);
    }
    if (input.move >= 0) {
      const slow = p.swingT > 0 ? 0.3 : 1;
      p.x += DX[input.move] * P_SPEED * slow * DT;
      p.z += DZ[input.move] * P_SPEED * slow * DT;
    }
  }
  clampArena(p, P_R);
}

function stepEnemy(w: World, e: Enemy) {
  const p = w.player;
  const s = STATS[e.kind];
  if (e.flash > 0) e.flash -= DT;
  if (e.spawn > 0) {
    e.spawn -= DT;
    return;
  }
  if (e.cd > 0) e.cd -= DT;
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
    case "imp": {
      if (e.state === "seek") {
        e.dx = ex;
        e.dz = ez;
        e.x += ex * s.speed * DT;
        e.z += ez * s.speed * DT;
        if (d < reach + 0.75) {
          e.state = "windup";
          e.t = 0.34;
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
              fireShot(w, e.x + DX[di] * e.r, e.z + DZ[di] * e.r, DX[di], DZ[di], 8.5, 12);
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
          if (boss && e.hp < e.maxHp * 0.5 && e.pattern % 4 === 1 && w.enemies.length < 9) {
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
  w.tick += 1;
  if (w.phase === "dead" || w.phase === "won") return;
  const p = w.player;

  stepPlayer(w, input);

  for (const e of w.enemies) stepEnemy(w, e);

  // keep enemies from stacking on each other
  for (let i = 0; i < w.enemies.length; i++) {
    const a = w.enemies[i];
    if (a.spawn > 0) continue;
    for (let j = i + 1; j < w.enemies.length; j++) {
      const b = w.enemies[j];
      if (b.spawn > 0) continue;
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
    s.x += s.vx * DT;
    s.z += s.vz * DT;
    s.life -= DT;
    const dx = s.x - p.x;
    const dz = s.z - p.z;
    if (dx * dx + dz * dz < (P_R + 0.28) * (P_R + 0.28)) {
      if (p.invuln <= 0) {
        hurtPlayer(w, s.dmg);
        s.life = 0;
      }
    }
    if (s.x < -ARENA_HX || s.x > ARENA_HX || s.z < -ARENA_HZ || s.z > ARENA_HZ) s.life = 0;
  }
  if (w.shots.length) w.shots = w.shots.filter((s) => s.life > 0);

  // deaths
  let died = false;
  for (const e of w.enemies) {
    if (e.hp <= 0) {
      died = true;
      p.coins += STATS[e.kind].coins;
      p.kills += 1;
      w.events.push({ type: "kill", x: e.x, z: e.z, kind: e.kind, amount: STATS[e.kind].coins });
    }
  }
  if (died) w.enemies = w.enemies.filter((e) => e.hp > 0);

  // waves and floors
  if (w.phase === "fight") {
    if (w.spawnDelay > 0) {
      w.spawnDelay -= DT;
      if (w.spawnDelay <= 0) spawnWave(w);
    } else if (w.enemies.length === 0) {
      if (w.wave + 1 < w.wavesInFloor) {
        w.wave += 1;
        w.spawnDelay = 0.9;
      } else if (w.floor === FLOORS) {
        w.phase = "won";
        w.shots = [];
        w.events.push({ type: "won", x: p.x, z: p.z });
      } else {
        w.phase = "cleared";
        w.shots = [];
        w.events.push({ type: "cleared", x: PORTAL.x, z: PORTAL.z });
      }
    }
  } else if (w.phase === "cleared") {
    const dx = p.x - PORTAL.x;
    const dz = p.z - PORTAL.z;
    if (dx * dx + dz * dz < PORTAL.r * PORTAL.r) {
      w.floor += 1;
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
