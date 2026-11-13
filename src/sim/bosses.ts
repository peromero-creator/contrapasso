/** Boss identity and attack geometry shared by simulation, tells and HUD. */
export const BOSS_IDS = ['warden', 'witness', 'cantor'] as const;
export type BossId = typeof BOSS_IDS[number];
export type BossMove = 'charge' | 'burst' | 'gaze' | 'fan' | 'slam';
export const BOSSES = {
  warden: { name: 'The Warden', color: 0xb88d64 },
  witness: { name: 'The Hollow Witness', color: 0x9aaea0 },
  cantor: { name: 'The Cinder Cantor', color: 0xc08368 },
} as const;
type State = { boss?: BossId; pattern: number };
export function bossMove(e: State): BossMove {
  const cycle = e.pattern % 3;
  if (e.boss === 'witness') return cycle === 0 ? 'burst' : 'gaze';
  if (e.boss === 'cantor') return cycle === 1 ? 'fan' : cycle === 2 ? 'slam' : 'charge';
  return cycle === 0 ? 'burst' : 'charge';
}
export function bossWindup(e: State) {
  if (!e.boss || e.boss === 'warden') return .5;
  return bossMove(e) === 'slam' ? .95 : bossMove(e) === 'gaze' ? .85 : .75;
}
export const GAZE_LENGTH = 15;
export const GAZE_HALF_WIDTH = .85;
export const SLAM_RADIUS = 4.8;
/** Center of the hero is used by damage and by the floor warning alike. */
export function gazeHits(e: {x:number;z:number;dx:number;dz:number}, p:{x:number;z:number}) {
  const x=p.x-e.x,z=p.z-e.z,along=x*e.dx+z*e.dz,across=x*e.dz-z*e.dx;
  return along >= 0 && along <= GAZE_LENGTH && Math.abs(across) <= GAZE_HALF_WIDTH;
}
