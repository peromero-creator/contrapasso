import type { WeaponId } from './weapons.ts';

export const FAMILIES = ['sword', 'hammer', 'dagger', 'crossbow', 'staff', 'axe', 'spear'] as const;
export type Family = typeof FAMILIES[number];
export type TechniqueId = `${Family}-${1 | 2 | 3 | 4}`;
export const FAMILY_NAMES: Record<Family, string> = { sword: 'Blades', hammer: 'War hammers', dagger: 'Daggers', crossbow: 'Crossbows', staff: 'Soul staves', axe: 'Executioner axes', spear: 'War spears' };
export const FAMILY_WEAPON: Record<Family, WeaponId> = { sword: 'cinder-requiem', hammer: 'tollkeeper', dagger: 'widows-fang', crossbow: 'gravewhisper', staff: 'vesper-reed', axe: 'guillotine-hymn', spear: 'acheron-needle' };
export const familyOf = (id: WeaponId): Family => id === 'starter' || id === 'cinder-requiem' ? 'sword' : id === 'tollkeeper' ? 'hammer' : id === 'widows-fang' ? 'dagger' : id === 'gravewhisper' ? 'crossbow' : id === 'vesper-reed' ? 'staff' : id === 'guillotine-hymn' ? 'axe' : 'spear';
export interface Technique {
  name: string; description: string; pattern: 'arc' | 'line' | 'burst' | 'fan';
  damage: number; reach: number; cooldown: number; duration: number; contact: number;
  pulses?: number; spread?: number; pierce?: number; dash?: number; heal?: number; ward?: number; pull?: boolean; execute?: boolean;
}
export const TECHNIQUES: Record<TechniqueId, Technique> = {
  'sword-1': { name: 'Crescent Requiem', description: 'A broad cut through the enemies ahead.', pattern: 'arc', damage: 48, reach: 4, cooldown: 5, duration: .55, contact: .22 },
  'sword-2': { name: 'Pilgrim’s Lunge', description: 'Advance three steps and drive a narrow cut through the line.', pattern: 'line', damage: 58, reach: 4.5, dash: 3, cooldown: 8, duration: .6, contact: .25 },
  'sword-3': { name: 'Ash Waltz', description: 'Three circling cuts follow your movement.', pattern: 'burst', damage: 22, reach: 3.5, pulses: 3, cooldown: 10, duration: .8, contact: .3 },
  'sword-4': { name: 'Final Absolution', description: 'A long execution cut. Double damage below 35% life.', pattern: 'line', damage: 82, reach: 6, execute: true, cooldown: 16, duration: 1, contact: .6 },
  'hammer-1': { name: 'Grave Bell', description: 'Crush the ground in a close shockwave.', pattern: 'burst', damage: 58, reach: 3, cooldown: 6, duration: .8, contact: .5 },
  'hammer-2': { name: 'Fault Line', description: 'Send a fracture through enemies in front of you.', pattern: 'line', damage: 66, reach: 7, cooldown: 9, duration: .85, contact: .5 },
  'hammer-3': { name: 'Stone Oath', description: 'Strike nearby enemies and gain a three-second ward.', pattern: 'burst', damage: 35, reach: 3.5, ward: 3, cooldown: 13, duration: .75, contact: .45 },
  'hammer-4': { name: 'Cathedral Fall', description: 'Three heavy aftershocks break the ground around you.', pattern: 'burst', damage: 38, reach: 4.5, pulses: 3, cooldown: 18, duration: 1.1, contact: .65 },
  'dagger-1': { name: 'Widow’s Crossing', description: 'Slip forward into a piercing close cut.', pattern: 'line', damage: 42, reach: 2.8, dash: 2.5, cooldown: 4, duration: .4, contact: .16 },
  'dagger-2': { name: 'Thorn Fan', description: 'Throw five short-lived blades in a fan.', pattern: 'fan', damage: 19, reach: 7, spread: 5, cooldown: 7, duration: .5, contact: .2 },
  'dagger-3': { name: 'Red Communion', description: 'A close sweep restores five life for each victim hit.', pattern: 'arc', damage: 36, reach: 2.8, heal: 5, cooldown: 10, duration: .5, contact: .2 },
  'dagger-4': { name: 'Mourning Dance', description: 'Four quick circular cuts follow you through the crowd.', pattern: 'burst', damage: 23, reach: 3, pulses: 4, cooldown: 15, duration: .8, contact: .25 },
  'crossbow-1': { name: 'Ossuary Bolt', description: 'A heavy bolt pierces four distinct targets.', pattern: 'fan', damage: 62, reach: 14, pierce: 4, cooldown: 5, duration: .65, contact: .32 },
  'crossbow-2': { name: 'Five Knells', description: 'Five bolts cover a wide firing lane.', pattern: 'fan', damage: 27, reach: 11, spread: 5, cooldown: 8, duration: .7, contact: .32 },
  'crossbow-3': { name: 'Parting Prayer', description: 'Retreat two steps and fire three bolts.', pattern: 'fan', damage: 30, reach: 10, spread: 3, dash: -2, cooldown: 10, duration: .6, contact: .3 },
  'crossbow-4': { name: 'Black Procession', description: 'Three volleys of three piercing bolts along your chosen aim.', pattern: 'fan', damage: 24, reach: 13, spread: 3, pierce: 2, pulses: 3, cooldown: 17, duration: .9, contact: .4 },
  'staff-1': { name: 'Vesper Choir', description: 'Three piercing soul darts from the staff.', pattern: 'fan', damage: 30, reach: 11, spread: 3, pierce: 2, cooldown: 5, duration: .7, contact: .38 },
  'staff-2': { name: 'Cinder Halo', description: 'Two rings of fire spread from your staff.', pattern: 'burst', damage: 31, reach: 4, pulses: 2, cooldown: 8, duration: .8, contact: .4 },
  'staff-3': { name: 'Soul Harvest', description: 'Pull nearby souls inward and restore six life per victim.', pattern: 'burst', damage: 34, reach: 4.5, heal: 6, pull: true, cooldown: 12, duration: .85, contact: .45 },
  'staff-4': { name: 'Astral Funeral', description: 'Three long waves of piercing souls, held to your chosen aim.', pattern: 'fan', damage: 32, reach: 13, spread: 3, pierce: 3, pulses: 3, cooldown: 18, duration: 1, contact: .5 },
  'axe-1': { name: 'Headsman’s Arc', description: 'A heavy sweeping cleave in front of you.', pattern: 'arc', damage: 64, reach: 3.7, cooldown: 6, duration: .8, contact: .45 },
  'axe-2': { name: 'Gallows Hook', description: 'A wide hook pulls surviving enemies close.', pattern: 'arc', damage: 43, reach: 5, pull: true, cooldown: 9, duration: .8, contact: .4 },
  'axe-3': { name: 'Carrion Wheel', description: 'Three wide cuts revolve around the wielder.', pattern: 'burst', damage: 30, reach: 4, pulses: 3, cooldown: 12, duration: .9, contact: .35 },
  'axe-4': { name: 'Last Sentence', description: 'A crushing execution. Double damage below 35% life.', pattern: 'arc', damage: 100, reach: 4, execute: true, cooldown: 18, duration: 1.15, contact: .7 },
  'spear-1': { name: 'River’s Tooth', description: 'A precise thrust through a long narrow lane.', pattern: 'line', damage: 50, reach: 6, cooldown: 5, duration: .55, contact: .2 },
  'spear-2': { name: 'Ferryman’s Advance', description: 'Lunge forward and impale the enemies beyond.', pattern: 'line', damage: 54, reach: 5, dash: 3, cooldown: 8, duration: .6, contact: .25 },
  'spear-3': { name: 'Bank Sweep', description: 'Sweep the shaft around you in two broad circles.', pattern: 'burst', damage: 32, reach: 4.2, pulses: 2, cooldown: 10, duration: .75, contact: .3 },
  'spear-4': { name: 'Nine Nails', description: 'Three piercing thrusts along a fixed, narrow lane.', pattern: 'line', damage: 40, reach: 7, pulses: 3, cooldown: 16, duration: .9, contact: .3 },
};
export const TECHNIQUE_IDS = Object.keys(TECHNIQUES) as TechniqueId[];
export const techniqueId = (value: unknown): TechniqueId | null => typeof value === 'string' && TECHNIQUE_IDS.includes(value as TechniqueId) ? value as TechniqueId : null;
export const weaponTechniques = (id: WeaponId): TechniqueId[] => [1, 2, 3, 4].map(n => `${familyOf(id)}-${n}` as TechniqueId);
export const techniqueParents = (id: TechniqueId): TechniqueId[] => {
  const family = id.split('-')[0] as Family, n = Number(id.slice(-1));
  return n === 1 ? [] : n === 4 ? [`${family}-2`, `${family}-3`] : [`${family}-1`];
};
export const techniqueCost = (id: TechniqueId) => [20, 35, 35, 60][Number(id.slice(-1)) - 1];
