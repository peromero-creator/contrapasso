import { weapon, type WeaponId } from '../sim/weapons.ts';
import { abilityContact, abilityDuration, type AbilityId } from '../sim/abilities.ts';
import { familyOf, techniqueId, TECHNIQUES } from '../sim/techniques.ts';

export interface CombatMotion { weapon: WeaponId; elapsed: number; combo: number; ability?: AbilityId | null }
export type JointPose = Record<string, [number, number, number]>;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
/** Contact stays at the authoritative time; only the presentation clock is warped. */
export const clipContact = (clip?: string) => ({
  'attack': .5, 'attack-dagger': .3, 'attack-spear': .3, 'attack-hammer': .58,
  'attack-crossbow': .5, 'attack-staff': .55, 'cast': .55,
  'attack-vault': .44, 'ultimate-slam': .35, 'ultimate': .6, 'ultimate-iron': .65, 'attack-axe-heavy': .52,
}[clip ?? ''] ?? .58);
export function motionClock(m: CombatMotion, clip?: string) {
  const spec = weapon(m.weapon), duration = m.ability ? abilityDuration(m.ability) : spec.swing;
  const contact = m.ability ? abilityContact(m.ability) : spec.impactDelay;
  const t = clamp(m.elapsed / duration);
  if (!contact) return t;
  const c = contact / duration, strike = clipContact(clip);
  if(t <= c) {
    const q=t/c;
    // Settle into a readable silhouette, then accelerate through the final swing.
    return strike * (.62*smooth(q/.72) + .38*Math.pow(clamp((q-.72)/.28),2));
  }
  const hold=Math.min(.045, (duration-contact)*.16);
  return strike+(1-strike)*smooth((m.elapsed-contact-hold)/(duration-contact-hold));
}
/** Small additive accents on the existing rig: no detached hand or scaled anatomy. */
export function combatPose(m: CombatMotion): JointPose {
  const f = familyOf(m.weapon), duration = m.ability ? abilityDuration(m.ability) : weapon(m.weapon).swing;
  const t = clamp(m.elapsed / duration), envelope = Math.sin(Math.PI * t);
  const contact = (m.ability ? abilityContact(m.ability) : weapon(m.weapon).impactDelay ?? duration * .35) / duration;
  const wind = Math.sin(Math.PI * clamp(t / contact)), release = Math.sin(Math.PI * clamp((t - contact) / (1 - contact)));
  const finisher = m.combo % 3 === 0 ? 1.25 : 1, side = m.combo % 3 === 2 ? -1 : 1;
  let twist = 0, bow = 0, arm = 0, wrist = 0;
  switch (f) {
    case 'sword': twist = side * (.12 * wind - .18 * release); arm = side * .12 * envelope; break;
    case 'hammer': bow = -.12 * wind + .2 * release; arm = -.14 * wind; break;
    case 'dagger': twist = side * .16 * envelope; wrist = side * .18 * release; break;
    case 'crossbow': bow = -.07 * release; arm = -.1 * release; break;
    case 'staff': twist = side * .12 * envelope; arm = -.18 * wind + .12 * release; wrist = .12 * envelope; break;
    case 'axe': twist = side * (.18 * wind - .22 * release); bow = .12 * release; break;
    case 'spear': twist = -.12 * wind + .14 * release; bow = .1 * release; break;
  }
  if (m.ability === 'sword-4') { bow=-.12*wind+.24*release; arm=-.85*wind+.16*release; wrist=-.3*wind; }
  if (m.ability === 'ember') { bow = -.14 * wind + .16 * release; arm = -.22 * envelope; }
  if (m.ability === 'ash') twist = .28 * envelope;
  if (m.ability === 'iron') { bow = .2 * release; arm = -.16 * wind; }
  return { Spine: [bow, twist * finisher, 0], RightArm: [0, 0, arm * finisher], RightForeArm: [0, wrist, 0] };
}
export function previewVolley(id: AbilityId, identity: WeaponId) {
  const t = techniqueId(id);
  if (t && TECHNIQUES[t].pattern === 'fan') return { count: TECHNIQUES[t].spread ?? 1, step: 30 * Math.PI * 2 / 1024, speed: 22, reach: TECHNIQUES[t].reach };
  if (id === 'lance') return { count: identity === 'vesper-reed' ? 3 : 1, step: 28 * Math.PI * 2 / 1024, speed: 14, reach: 11.2 };
  return null;
}

/** Cosmetic elevation only: collision, targeting and vulnerability stay on the ground. */
export function combatLift(m?: CombatMotion) {
  if(m?.ability!=='hammer-4')return 0;
  const t=clamp(m.elapsed/abilityContact(m.ability));
  return .75*Math.sin(Math.PI*t)**2;
}
