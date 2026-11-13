import * as T from 'three';
import { ARENA_HX, ARENA_HZ, type Enemy } from '../sim/world.ts';

/** Presentation of existing Solo rules, not a second damage system. Archer aim
 * tracks during its windup; charge directions are already locked by the sim. */
export function enemyThreat(e: Enemy) {
  if (e.hp <= 0 || e.spawn > 0 || e.state !== 'windup' || e.kind === 'champion') return null;
  const duration = e.kind === 'imp' ? .42 : e.kind === 'brute' ? .65 : .5;
  const progress = Math.max(0, Math.min(1, 1 - e.t / duration));
  if (e.kind === 'imp') return { shape: 'circle' as const, progress, radius: e.r + .5 + 1.25, length: 0, width: 0 };
  // A radial volley has no fixed lane: its random offset is chosen at release.
  if (e.kind === 'warden' && e.pattern % 3 === 0)
    return { shape: 'burst' as const, progress, radius: e.r + .85, length: 0, width: 0 };
  if (e.kind === 'archer') return { shape: 'aim' as const, progress, radius: 0, length: 12, width: .10 };
  const reach = e.r + .5 + .35;
  let length = e.kind === 'warden' ? 19 * .6 : 17 * .55;
  if (Math.abs(e.dx) > .0001) length = Math.min(length, Math.max(0, ((e.dx > 0 ? ARENA_HX - e.r : -ARENA_HX + e.r) - e.x) / e.dx));
  if (Math.abs(e.dz) > .0001) length = Math.min(length, Math.max(0, ((e.dz > 0 ? ARENA_HZ - e.r : -ARENA_HZ + e.r) - e.z) / e.dz));
  return { shape: 'charge' as const, progress, radius: reach, length, width: reach * 2 };
}

// Shared flat silhouettes: no lights, textures or per-frame geometry allocation.
const lane = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(.5, 0, 0);
const ring = new T.RingGeometry(.965, 1, 64).rotateX(-Math.PI / 2);
const disc = new T.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
const laneEdges = new T.BufferGeometry(), edgeVertices: number[] = [];
for (const [x0,z0,x1,z1] of [[0,-.5,1,-.485],[0,.485,1,.5],[0,-.5,.006,.5],[.994,-.5,1,.5]])
  for (const [x,z] of [[x0,z0],[x1,z0],[x1,z1],[x0,z0],[x1,z1],[x0,z1]]) edgeVertices.push(x,0,z);
laneEdges.setAttribute('position',new T.Float32BufferAttribute(edgeVertices,3));
const arrow = new T.BufferGeometry();
arrow.setAttribute('position', new T.Float32BufferAttribute([0,0,-.36, .35,0,0, 0,0,.36, .08,0,0],3));
arrow.setIndex([0,1,3,1,2,3]);
const rays = new T.BufferGeometry(), rayVertices: number[] = [];
for (let i = 0; i < 8; i++) {
  const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
  for (const [x,z] of [[1.05,-.07],[1.3,0],[1.05,.07]]) rayVertices.push(x*c-z*s,0,x*s+z*c);
}
rays.setAttribute('position',new T.Float32BufferAttribute(rayVertices,3));
const paint = (opacity: number) => new T.MeshBasicMaterial({ color: 0xb97660, transparent: true, opacity, depthWrite: false, side: T.DoubleSide, forceSinglePass: true, toneMapped: false });

export class EnemyThreat {
  readonly root = new T.Group();
  private fill = new T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>(lane, paint(.09));
  private border = new T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>(ring, paint(.45));
  private tip = new T.Mesh(arrow, paint(.65));
  constructor() {
    this.root.name = 'enemy-threat';
    this.root.add(this.fill, this.border, this.tip);
    this.root.visible = false;
    this.fill.position.y = .045;
    this.border.position.y = .05;
    this.tip.position.y = .055;
  }
  sync(e: Enemy, position: { x: number; z: number }) {
    const cue = enemyThreat(e);
    this.root.visible = !!cue;
    if (!cue) return;
    this.root.position.set(position.x, 0, position.z);
    this.root.rotation.y = -Math.atan2(e.dz, e.dx);
    const p = cue.progress;
    // One continuous fill, no late flash or sinusoidal blinking.
    this.fill.material.opacity = cue.shape === 'aim' ? .22 + .28 * p : .06 + .08 * p;
    this.border.material.opacity = .28 + .28 * p;
    this.tip.material.opacity = .40 + .28 * p;
    this.tip.visible = cue.shape !== 'circle';
    this.tip.geometry = cue.shape === 'burst' ? rays : arrow;
    this.border.visible = cue.shape !== 'aim';
    this.fill.visible = cue.shape !== 'burst';
    this.border.geometry = cue.shape === 'charge' ? laneEdges : ring;
    this.fill.geometry = cue.shape === 'circle' ? disc : lane;
    this.border.position.x = this.fill.position.x = 0;
    if (cue.shape === 'charge' || cue.shape === 'aim') {
      this.fill.scale.set(cue.length * (.12 + .88 * p), 1, cue.width);
      // Thin edges and a spearhead identify the lane without a solid red slab.
      this.border.scale.set(cue.length, 1, cue.width);
      this.tip.position.x = cue.length;
      this.tip.scale.setScalar(cue.shape === 'aim' ? .6 : 1);
    } else {
      this.border.scale.setScalar(cue.radius);
      this.fill.scale.setScalar(cue.radius * (.3 + .7 * p));
      this.tip.position.x = 0;
      this.tip.scale.setScalar(cue.radius);
      this.root.rotation.y = 0;
    }
  }
  clear() { this.root.visible = false; }
  dispose() {
    this.root.removeFromParent();
    this.fill.material.dispose(); this.border.material.dispose(); this.tip.material.dispose();
  }
}
