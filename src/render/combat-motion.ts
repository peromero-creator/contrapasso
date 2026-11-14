import { weapon, type WeaponId } from '../sim/weapons.ts';
import { abilityContact, abilityDuration, type AbilityId } from '../sim/abilities.ts';
import { familyOf, techniqueId, TECHNIQUES, type Family } from '../sim/techniques.ts';

/** `tail` is presentation only: the follow-through may keep playing into the recovery
 * window after the authoritative swing has ended, so chained strikes flow into each other. */
export interface CombatMotion { weapon: WeaponId; elapsed: number; combo: number; ability?: AbilityId | null; tail?: number }
/** Longest stretch of recovery, in seconds, that a follow-through is carried across.
 * Kept short for the heavy hammer so its frozen clip tail does not read as a held pose. */
export const CARRY_LIMIT = .14;
/** Techniques, spells and ultimates settle over this long after their cast time ends. */
export const SKILL_CARRY = .18;
export const skillTail = (id: AbilityId) => abilityDuration(id) + SKILL_CARRY;
export type JointPose = Record<string, [number, number, number]>;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
/** Contact stays at the authoritative time; only the presentation clock is warped. */
/** Where each trimmed clip actually lands its blow, measured on the hand's path through the source animation. */
export const clipContact = (clip?: string) => ({
  'attack': .44, 'attack-dagger': .3, 'attack-spear': .3, 'attack-hammer': .83, 'attack-axe': .72,
  'attack-crossbow': .5, 'attack-staff': .55, 'cast': .55,
  'attack-vault': .44, 'ultimate-slam': .35, 'ultimate': .6, 'ultimate-iron': .42, 'attack-axe-heavy': .56,
}[clip ?? ''] ?? .58);
/** Share of the way to the blow at which a clip is fully drawn back; the gather settles there. */
const clipApex = (clip?: string) => clip === 'attack-hammer' ? .4 : .62;
/** Instant weapons resolve on the press, so the drawn blow has to arrive within a few frames of it. */
const INSTANT_LEAD = .11;
/** Seconds from the start of a motion to the blow that is drawn. */
export function strikeTime(m: CombatMotion, clip?: string) {
  if (m.ability) return abilityContact(m.ability);
  const spec = weapon(m.weapon);
  return spec.impactDelay || Math.min(clipContact(clip) * spec.swing, INSTANT_LEAD);
}
export function motionClock(m: CombatMotion, clip?: string) {
  const spec = weapon(m.weapon), duration = m.ability ? abilityDuration(m.ability) : spec.swing;
  const contact = m.ability ? abilityContact(m.ability) : spec.impactDelay;
  const t = clamp(m.elapsed / duration), tail = Math.max(duration, m.tail ?? duration);
  if (!contact) {
    // Instant weapons whip to the drawn blow right behind the press, then spend the rest
    // of the swing and the carried recovery on a long, easing follow-through.
    const at = strikeTime(m, clip), strike = clipContact(clip);
    if (m.elapsed <= at) return strike * Math.pow(clamp(m.elapsed / at), 1.5);
    const q = clamp((m.elapsed - at) / Math.max(.02, tail - at));
    return strike + (1 - strike) * (1 - (1 - q) * (1 - q));
  }
  const c = contact / duration, strike = clipContact(clip);
  const family=familyOf(m.weapon),heavy=family==='hammer'||family==='axe';
  const gather=heavy?.78:family==='dagger'?.55:family==='spear'?.62:.72;
  if(t <= c) {
    const q=t/c;
    // Settle into a readable silhouette, then accelerate through the final swing.
    const apex=clipApex(clip);
    return strike * (apex*smooth(q/gather) + (1-apex)*Math.pow(clamp((q-gather)/(1-gather)),2));
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
  'hammer-1': .55, 'hammer-4': .8, 'sword-4': .9, 'axe-1': .4, 'axe-4': 1, 'ember': .6,
  'sword-2': .3, 'spear-2': .3, 'dagger-1': .24, 'crossbow-3': .28,
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

/** Mirrors the simulation's spacing between repeated contacts of one technique. */
const PULSE_GAP = .28;
/** Which repeated contact a cast has reached, among those that land while it is on screen. */
export function pulseBeat(m: CombatMotion) {
  const id = techniqueId(m.ability), spec = id ? TECHNIQUES[id] : null;
  if (!spec || !spec.pulses || spec.pulses < 2 || m.elapsed < spec.contact) return null;
  const end = Math.max(spec.duration, m.tail ?? spec.duration);
  const shown = Math.min(spec.pulses, 1 + Math.floor((end - .06 - spec.contact) / PULSE_GAP + 1e-9));
  if (shown < 2) return null;
  const index = Math.min(shown - 1, Math.floor((m.elapsed - spec.contact) / PULSE_GAP + 1e-9));
  const start = spec.contact + index * PULSE_GAP, last = index === shown - 1;
  return { index, shown, last, frac: clamp((m.elapsed - start) / (last ? Math.max(.06, end - start) : PULSE_GAP)) };
}

/** Whole-body commitment to one blow. Angles in radians, distances in metres along the aim,
 * compression as a fraction of height. Positive yaw follows a right-handed forehand. */
interface BodyStyle {
  /** Turn wound against the blow, then thrown through it. */ coil: number; swing: number;
  /** Lean away while gathering, then into the blow. */ rear: number; lean: number;
  /** Ground given while gathering, then taken with the blow. */ back: number; step: number;
  /** Compression while gathering, released into the blow, and again on impact. */ crouch: number; drop: number;
  /** Shoulder dip through the blow. */ roll: number;
  /** Ground given back after the blow: recoil or a pull. */ kick: number;
  /** Full turns between repeated contacts. */ spin: number;
}
const style = (s: Partial<BodyStyle>): BodyStyle => ({ coil: 0, swing: 0, rear: 0, lean: 0, back: 0, step: 0, crouch: 0, drop: 0, roll: 0, kick: 0, spin: 0, ...s });
/** Chain steps one to three for each weapon family. */
const STRIKES: Record<Family, [BodyStyle, BodyStyle, BodyStyle]> = {
  sword: [
    style({ coil: .4, swing: .5, rear: .05, lean: .12, back: .04, step: .16 }),
    style({ coil: -.15, swing: -.1, rear: .06, lean: .2, back: .08, step: .3, crouch: .04 }),
    style({ coil: .7, swing: .85, rear: .12, lean: .26, back: .06, step: .26, drop: .1 }),
  ],
  // Overhead slams: the weight is in the lean and the landing, not in a turn.
  hammer: [
    style({ coil: .15, swing: .2, rear: .2, lean: .3, back: .05, step: .1, drop: .1 }),
    style({ coil: -.25, swing: -.3, rear: .16, lean: .26, step: .14, roll: .14, drop: .08 }),
    style({ coil: .25, swing: .3, rear: .3, lean: .42, back: .08, step: .16, drop: .16 }),
  ],
  dagger: [
    style({ coil: .3, swing: .4, lean: .12, step: .14 }),
    style({ coil: -.4, swing: -.5, lean: .1, step: .1, roll: -.12 }),
    style({ coil: .5, swing: .7, rear: .05, lean: .32, back: .05, step: .36, crouch: .06, drop: .04 }),
  ],
  crossbow: [
    style({ lean: .05, crouch: .03, kick: .07 }),
    style({ coil: -.12, swing: -.1, lean: .05, crouch: .03, kick: .07 }),
    style({ lean: .1, crouch: .1, kick: .16 }),
  ],
  staff: [
    style({ coil: .12, swing: .16, lean: .1, step: .06 }),
    style({ coil: -.2, swing: -.24, lean: .08, step: .05 }),
    style({ coil: .35, swing: .45, rear: .08, lean: .16, step: .1, drop: .05 }),
  ],
  // Two overhead chops, then the clip's own full turn (which sweeps left to right).
  axe: [
    style({ coil: .15, swing: .2, rear: .2, lean: .32, back: .05, step: .12, drop: .1 }),
    style({ coil: -.2, swing: -.25, rear: .16, lean: .28, step: .14, roll: .1, drop: .08 }),
    style({ coil: -.15, swing: -.25, rear: .08, lean: .22, back: .06, step: .2, drop: .12 }),
  ],
  spear: [
    style({ coil: -.12, swing: -.08, rear: .05, lean: .16, back: .1, step: .26 }),
    style({ coil: .18, swing: .2, rear: .05, lean: .18, back: .08, step: .24, roll: .08 }),
    style({ rear: .1, lean: .3, back: .18, step: .42, crouch: .08, drop: .04 }),
  ],
};
/** One signature per technique, spell and core, so no two share a silhouette. */
const SKILLS: Record<AbilityId, BodyStyle> = {
  'sword-1': style({ coil: .95, swing: 1.1, rear: .08, lean: .16, back: .06, step: .2, roll: .1 }),
  'sword-2': style({ coil: -.2, swing: -.1, rear: .1, lean: .42, back: .12, step: .3, crouch: .14, drop: .04 }),
  'sword-3': style({ coil: .5, swing: .4, lean: .14, crouch: .05, spin: 1 }),
  'sword-4': style({ coil: .2, swing: .2, rear: .3, lean: .5, back: .1, step: .2, drop: .2 }),
  'hammer-1': style({ rear: .28, lean: .44, step: .06, drop: .2 }),
  'hammer-2': style({ coil: .2, swing: .25, rear: .24, lean: .4, back: .1, step: .32, drop: .14 }),
  'hammer-3': style({ rear: .1, lean: .06, crouch: .16, drop: .14 }),
  'hammer-4': style({ rear: .32, lean: .46, drop: .22 }),
  'dagger-1': style({ coil: .3, swing: .5, rear: .04, lean: .46, back: .06, step: .3, crouch: .16, roll: .18 }),
  'dagger-2': style({ coil: .6, swing: .7, lean: .08, kick: .1 }),
  'dagger-3': style({ coil: -.8, swing: -.95, lean: .2, step: .1, crouch: .2 }),
  'dagger-4': style({ coil: .4, swing: .35, lean: .16, crouch: .08, spin: 1 }),
  'crossbow-1': style({ lean: .12, crouch: .16, kick: .26 }),
  'crossbow-2': style({ coil: .5, swing: .5, crouch: .06, kick: .1 }),
  'crossbow-3': style({ rear: .22, lean: -.1, crouch: .05, kick: .12 }),
  'crossbow-4': style({ lean: .1, crouch: .14, kick: .12 }),
  'staff-1': style({ coil: .25, swing: .3, lean: .16, back: .05, step: .12 }),
  'staff-2': style({ rear: .12, lean: .22, crouch: .06, drop: .16 }),
  'staff-3': style({ coil: -.3, swing: -.3, rear: .2, lean: -.14, kick: .1 }),
  'staff-4': style({ coil: .2, swing: .25, rear: .1, lean: .2, step: .14, drop: .06 }),
  'axe-1': style({ coil: -.3, swing: -.4, rear: .08, lean: .22, back: .06, step: .2, roll: -.1, drop: .08 }),
  'axe-2': style({ coil: -.7, swing: -.5, roll: -.1 }),
  'axe-3': style({ coil: -.3, swing: -.3, lean: .12, crouch: .06, spin: -1 }),
  'axe-4': style({ coil: .25, swing: .3, rear: .36, lean: .55, back: .1, step: .2, drop: .26 }),
  'spear-1': style({ coil: -.1, swing: -.06, rear: .08, lean: .24, back: .2, step: .38 }),
  'spear-2': style({ rear: .12, lean: .46, back: .1, step: .3, crouch: .16, roll: .1 }),
  'spear-3': style({ coil: .7, swing: .5, lean: .1, crouch: .05, spin: 1 }),
  'spear-4': style({ rear: .08, lean: .2, back: .14, step: .3, crouch: .06 }),
  'lance': style({ coil: .2, swing: .25, lean: .14, back: .05, step: .1 }),
  'nova-spell': style({ rear: .14, lean: .2, crouch: .1, drop: .14 }),
  'siphon-spell': style({ coil: -.2, swing: -.2, rear: .06, lean: -.16, kick: .12 }),
  'ember': style({ rear: .26, lean: .42, drop: .2 }),
  'ash': style({ lean: .08, crouch: .04 }),
  'iron': style({ rear: .1, lean: .05, crouch: .18, drop: .16 }),
};
export const bodyStyle = (m: CombatMotion): BodyStyle =>
  m.ability ? SKILLS[m.ability] : STRIKES[familyOf(m.weapon)][(Math.max(1, m.combo) - 1) % 3];

/** Wind into the coil, hold it, then whip out of it just before the blow. */
const gatherCurve = (u: number) => smooth(u / .55) * (1 - Math.pow(clamp((u - .6) / .4), 2));
/** The blow carries the body past the contact, then lets it settle. */
const throwCurve = (r: number) => (1 - Math.pow(1 - clamp(r / .22), 2)) * (1 - smooth((r - .3) / .7));
/** Sharp in, slower out: compression on impact, and recoil after a release. */
const hitCurve = (r: number, span = .55) => Math.sin(Math.PI * Math.sqrt(clamp(r / span)));
const wrapTurn = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

export interface BodyPose { yaw: number; lean: number; roll: number; advance: number; squash: number }
/** What the whole figure does around the clip: it gathers before a blow, travels with it and
 * takes the impact. Presentation only: the simulation position and hit areas are untouched,
 * and every value returns to rest by the end of the carried follow-through. */
export function combatBody(m?: CombatMotion, clip?: string): BodyPose {
  if (!m) return { yaw: 0, lean: 0, roll: 0, advance: 0, squash: 0 };
  const s = bodyStyle(m), spec = weapon(m.weapon);
  const duration = m.ability ? abilityDuration(m.ability) : spec.swing, tail = Math.max(duration, m.tail ?? duration);
  // The body follows the blow that is actually drawn, which instant weapons land just after the press.
  const at = strikeTime(m, clip);
  // A wind-up shorter than a blink cannot carry a full coil without reading as a twitch.
  const reach = clamp(at / .18), beat = pulseBeat(m);
  const u = clamp(m.elapsed / at), r = clamp((m.elapsed - at) / Math.max(.05, tail - at));
  let gather = 0, thrown = 0, hit = 0, recoil = 0, low = 0, turns = 0;
  if (m.elapsed < at) {
    // Sink while gathering and rise into the blow, so the contact frame itself is undistorted.
    gather = reach * gatherCurve(u); low = smooth(u / .35) * (1 - Math.pow(clamp((u - .7) / .3), 2));
    // Reaping Orbit is cast through one full turn; an aimed staff keeps its lane instead.
    if (m.ability === 'ash' && familyOf(m.weapon) !== 'staff') turns = smooth(u);
  } else if (beat && !beat.last) {
    // Between repeated contacts: ride the blow out, gather again, strike on the next beat.
    const f = beat.frac;
    gather = .7 * smooth((f - .4) / .25) * (1 - Math.pow(clamp((f - .7) / .3), 2));
    thrown = (1 - Math.pow(1 - clamp(f / .18), 2)) * (1 - smooth((f - .2) / .3));
    hit = hitCurve(f, .4); recoil = hitCurve(f, .6); low = Math.pow(Math.sin(Math.PI * f), 2);
    // Slower through each contact, faster between them.
    turns = beat.index + f - .55 / (Math.PI * 2) * Math.sin(Math.PI * 2 * f);
  } else {
    const q = beat ? beat.frac : r;
    thrown = throwCurve(q); hit = hitCurve(q); recoil = hitCurve(q, .8);
    turns = beat ? beat.index : 0;
  }
  const pose: BodyPose = {
    yaw: wrapTurn(-s.coil * gather + s.swing * thrown + (s.spin || (m.ability === 'ash' ? 1 : 0)) * turns * Math.PI * 2),
    lean: -s.rear * gather + s.lean * thrown,
    roll: s.roll * (thrown - .5 * gather),
    advance: -s.back * gather + s.step * thrown - s.kick * recoil,
    squash: s.crouch * low + s.drop * hit,
  };
  if (m.ability === 'axe-2') {
    // Gallows Hook reaches out to catch, then hauls back with the whole body.
    const out = smooth(u) * (1 - smooth(r / .3)), haul = Math.sin(Math.PI * clamp((r - .08) / .7));
    pose.advance = .3 * out - .3 * haul; pose.lean = .18 * out - .24 * haul;
  }
  return pose;
}

/** Clip time for the figure. A technique with repeated contacts is struck once per contact:
 * carry through, draw back and land again, rather than one swing and a held pose. */
export function swingClock(m: CombatMotion, clip?: string) {
  const beat = pulseBeat(m);
  if (!beat) return motionClock(m, clip);
  const strike = clipContact(clip);
  if (beat.last) return strike + (1 - strike) * smooth(beat.frac);
  // A turning cut keeps the arm extended; a chop or thrust is drawn most of the way back.
  const turning = !!bodyStyle(m).spin, out = strike + (1 - strike) * (turning ? .22 : .4), back = strike * (turning ? .88 : .5), f = beat.frac;
  if (f < .3) return strike + (out - strike) * (1 - Math.pow(1 - f / .3, 2));
  if (f < .68) return out + (back - out) * smooth((f - .3) / .38);
  return back + (strike - back) * Math.pow((f - .68) / .32, 2);
}

function motionRecovery(m:CombatMotion,duration:number) {
  const extended=!!m.ability;
  return {start:duration-(extended?.2:.12),length:extended?.2+SKILL_CARRY:.12};
}

/** Staff choreography in actor-local space (+X is the committed aim). */
export function staffGesture(m: CombatMotion) {
  const duration=m.ability?abilityDuration(m.ability):weapon(m.weapon).swing;
  const contact=m.ability?abilityContact(m.ability):duration*.35;
  const q=clamp(m.elapsed/contact), beat=pulseBeat(m);
  // Each ring or wave is driven out of the staff again: draw back, then snap onto the next beat.
  const snap=beat&&!beat.last?1-.6*Math.pow(Math.sin(Math.PI*Math.pow(beat.frac,1.4)),2):smooth((q-.65)/.35);
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
  const q=clamp(m.elapsed/contact),beat=pulseBeat(m);
  // Repeated thrusts are each drawn back and driven again; only the last one recovers.
  const drive=beat&&!beat.last?1-.8*Math.pow(Math.sin(Math.PI*Math.pow(beat.frac,1.4)),2):smooth((q-.5)/.5);
  const recover=beat?(beat.last?smooth(beat.frac):0):smooth((m.elapsed-contact)/(duration-contact));
  const end=beat?Math.max(duration,m.tail??duration):duration;
  const weight=smooth(m.elapsed/.07)*(1-smooth((m.elapsed-end+.09)/.09));
  return {target:[.2+.5*drive-.18*recover,1.2,.1] as [number,number,number],direction:[1,.025,0] as [number,number,number],weight,support:spear,supportOffset:-.32};
}
export function crossbowRecoil(m:CombatMotion) {
  if(m.weapon!=='gravewhisper')return 0;
  // Every volley kicks, not only the first.
  const contact=(m.ability?abilityContact(m.ability):0)+(pulseBeat(m)?.index??0)*PULSE_GAP;
  const t=clamp((m.elapsed-contact)/.16);
  return .12*Math.sin(Math.PI*t)*(1-t);
}
