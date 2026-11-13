import type { WeaponId } from '../sim/weapons.ts';
import { familyOf } from '../sim/techniques.ts';

export interface RestPose { wounded?: number; inspect?: number; weapon?: WeaponId }
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const ease = (n: number) => { const t=clamp(n); return t*t*t*(t*(t*6-15)+10); };
/** One quiet glance in twelve seconds. The quintic edges have zero velocity. */
export function inspectionWeight(seconds: number) {
  const t=seconds%12-8;
  return t<0 ? 0 : ease(t/.9)*(1-ease((t-2)/1.2));
}
/** Additive idle accents only; feet and weapon mounts keep the sampled rig pose. */
export function restPose({wounded=0,inspect=0,weapon='starter'}:RestPose): Record<string,[number,number,number]> {
  const hurt=clamp(wounded), look=clamp(inspect), family=familyOf(weapon);
  const long=family==='staff'||family==='spear'||family==='hammer';
  return {
    Spine:[.16*hurt-.035*look,-.09*look,.025*hurt],
    Head:[.12*hurt+.06*look,-.24*look,-.04*look],
    RightArm:[0,0,-(long?.2:.32)*look],
    RightForeArm:[0,-(long?.1:.15)*look,0],
  };
}
