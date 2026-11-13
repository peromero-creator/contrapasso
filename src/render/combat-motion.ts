import { weapon, type WeaponId } from '../sim/weapons.ts';
import { abilityContact, abilityDuration, type AbilityId } from '../sim/abilities.ts';
import { familyOf, techniqueId, TECHNIQUES } from '../sim/techniques.ts';

/** `tail` is presentation only: the follow-through may keep playing into the recovery
 * window after the authoritative swing has ended, so chained strikes flow into each other. */
export interface CombatMotion { weapon: WeaponId; elapsed: number; combo: number; ability?: AbilityId | null; tail?: number }
/** Longest stretch of recovery, in seconds, that a follow-through is carried across. */
export const CARRY_LIMIT = .22;
/** Techniques, spells and ultimates settle over this long after their cast time ends. */
export const SKILL_CARRY = .18;
export const skillTail = (id: AbilityId) => abilityDuration(id) + SKILL_CARRY;
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
  const t = clamp(m.elapsed / duration), tail = Math.max(duration, m.tail ?? duration);
  if (!contact) {
    // Instant weapons keep their original pace up to the visible strike; only the
    // follow-through eases out across the carried recovery.
    const at = clipContact(clip) * duration;
    if (tail <= duration || m.elapsed <= at) return t;
    const q = clamp((m.elapsed - at) / (tail - at));
    return at / duration + (1 - at / duration) * (1 - (1 - q) * (1 - q));
  }
  const c = contact / duration, strike = clipContact(clip);
  const family=familyOf(m.weapon),heavy=family==='hammer'||family==='axe';
  const gather=heavy?.78:family==='dagger'?.55:family==='spear'?.62:.72;
  if(t <= c) {
    const q=t/c;
    // Settle into a readable silhouette, then accelerate through the final swing.
    return strike * (.62*smooth(q/gather) + .38*Math.pow(clamp((q-gather)/(1-gather)),2));
  }
  const hold=Math.min(heavy?.06:family==='dagger'||family==='crossbow'?.012:family==='spear'?.018:.045, (duration-contact)*.16);
  return strike+(1-strike)*smooth((m.elapsed-contact-hold)/(tail-contact-hold));
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
    case 'hammer': bow = -.22 * wind + .3 * release; arm = -.2 * wind; twist=-.08*wind; break;
    case 'dagger': twist = side * (.24*wind-.28*release); wrist = side * .22 * release; bow=.12*release; break;
    case 'crossbow': bow = -.07 * release; arm = -.1 * release; break;
    case 'staff': twist = side * .12 * envelope; arm = -.18 * wind + .12 * release; wrist = .12 * envelope; break;
    case 'axe': twist = side * (.27 * wind - .32 * release); bow = -.12*wind+.2*release; break;
    case 'spear': twist = -.19 * wind + .22 * release; bow = -.08*wind+.16*release; break;
  }
  if (m.ability === 'sword-4') { bow=-.12*wind+.24*release; arm=-.85*wind+.16*release; wrist=-.3*wind; }
  if (m.ability === 'ember') { bow = -.14 * wind + .16 * release; arm = -.22 * envelope; }
  if (m.ability === 'ash') twist = .28 * envelope;
  if (m.ability === 'iron') { bow = .2 * release; arm = -.16 * wind; }
  if (f === 'staff' && m.ability) {
    const harvest = m.ability === 'staff-3' || m.ability === 'iron';
    const ground = m.ability === 'staff-2' || m.ability === 'ember' || m.ability === 'nova-spell';
    twist = harvest ? -.24 * wind + .3 * release : ground ? -.18 * wind : -.22 * wind + .18 * release;
    bow = harvest ? .12 * wind - .12 * release : ground ? -.2 * wind + .28 * release : -.1 * wind + .16 * release;
  }
  return { Spine: [bow, twist * finisher, 0], RightArm: [0, 0, arm * finisher], RightForeArm: [0, wrist, 0] };
}
export function previewVolley(id: AbilityId, identity: WeaponId) {
  const t = techniqueId(id);
  if (t && TECHNIQUES[t].pattern === 'fan') return { count: TECHNIQUES[t].spread ?? 1, step: 30 * Math.PI * 2 / 1024, speed: 22, reach: TECHNIQUES[t].reach };
  if (id === 'lance') return { count: identity === 'vesper-reed' ? 3 : 1, step: 28 * Math.PI * 2 / 1024, speed: 14, reach: 11.2 };
  return null;
}

/** Techniques that leave the ground: slams land on the contact frame, lunges arc through it. */
const LEAPS: Partial<Record<AbilityId, number>> = {
  'hammer-1': .55, 'hammer-2': .4, 'hammer-4': .8, 'sword-4': .9, 'axe-1': .4, 'axe-4': 1, 'ember': .6,
  'sword-2': .3, 'spear-2': .3, 'dagger-1': .24,
};
/** Rise, hang, then drop hard: the peak sits late so the fall reads as weight. */
const leapArc = (q: number) => Math.sin(Math.PI * Math.pow(clamp(q), 1.5));
/** Cosmetic elevation only: collision, targeting and vulnerability stay on the ground. */
export function combatLift(m?: CombatMotion) {
  if (!m) return 0;
  if (m.ability) {
    const height = LEAPS[m.ability];
    return height ? height * leapArc(m.elapsed / abilityContact(m.ability)) : 0;
  }
  // Every third strike of a melee chain is a leaping blow.
  const spec = weapon(m.weapon);
  if (m.combo % 3 !== 0 || spec.ranged) return 0;
  const family = familyOf(m.weapon);
  const height = family === 'hammer' ? .5 : family === 'axe' ? .55 : family === 'sword' ? .32 : family === 'dagger' ? .22 : .16;
  // Delayed weapons land on the blow; instant ones strike rising and land in recovery.
  return height * (spec.impactDelay ? leapArc(m.elapsed / spec.impactDelay) : Math.sin(Math.PI * Math.pow(clamp(m.elapsed / spec.swing), .8)));
}

function motionRecovery(m:CombatMotion,duration:number) {
  const extended=!!m.ability;
  return {start:duration-(extended?.2:.12),length:extended?.2+SKILL_CARRY:.12};
}

/** Staff choreography in actor-local space (+X is the committed aim). */
export function staffGesture(m: CombatMotion) {
  const duration=m.ability?abilityDuration(m.ability):weapon(m.weapon).swing;
  const contact=m.ability?abilityContact(m.ability):duration*.35;
  const q=clamp(m.elapsed/contact), snap=smooth((q-.65)/.35);
  const recovery=smooth((m.elapsed-contact)/(duration-contact));
  // Release the aimed hand through recovery; a short IK fade can whip the wrist
  // back to the source clip even when its animation clock is continuous.
  const settle=motionRecovery(m,duration);
  const weight=smooth(m.elapsed/.09)*(1-smooth((m.elapsed-settle.start)/settle.length));
  const ground=['staff-2','ember','nova-spell'].includes(m.ability??'');
  const harvest=['staff-3','iron'].includes(m.ability??'');
  const orbit=m.ability==='ash';
  const direction: [number,number,number]=ground?[.38+.32*snap, .92-1.63*snap, 0]
    :harvest?[.18-.3*snap,1,.12*Math.sin(q*Math.PI)]
    :orbit?[.3,.94,.2*Math.sin(q*Math.PI)]
    :[.35+.65*snap,.94*(1-snap)+.04*snap,0];
  const target: [number,number,number]=ground?[.5,1.6-.25*snap,.12]
    :harvest?[.45-.22*snap,1.25+.23*snap,.18]
    :orbit?[.35,1.55,.15]
    :[.25+.4*snap-.1*recovery,1.32,.12];
  return {direction,target,weight,support:!harvest&&!orbit,supportOffset:.32};
}

/** A thrust keeps the tip in the committed lane while the back hand carries the shaft. */
export function piercingGesture(m:CombatMotion) {
  const family=familyOf(m.weapon),id=m.ability;
  const spear=family==='spear'&&(!id||id==='spear-1'||id==='spear-2'||id==='spear-4');
  const stab=id==='sword-2'||id==='dagger-1'||id==='dagger-2';
  if(!spear&&!stab)return null;
  const duration=id?abilityDuration(id):weapon(m.weapon).swing,contact=id?abilityContact(id):weapon(m.weapon).impactDelay!;
  const q=clamp(m.elapsed/contact),drive=smooth((q-.5)/.5),recover=smooth((m.elapsed-contact)/(duration-contact));
  const weight=smooth(m.elapsed/.07)*(1-smooth((m.elapsed-duration+.09)/.09));
  return {target:[.2+.5*drive-.18*recover,1.2,.1] as [number,number,number],direction:[1,.025,0] as [number,number,number],weight,support:spear,supportOffset:-.32};
}
export function crossbowRecoil(m:CombatMotion) {
  if(m.weapon!=='gravewhisper')return 0;
  const contact=m.ability?abilityContact(m.ability):0;
  const t=clamp((m.elapsed-contact)/.16);
  return .12*Math.sin(Math.PI*t)*(1-t);
}
