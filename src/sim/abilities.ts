import { techniqueId, TECHNIQUES, type TechniqueId } from "./techniques.ts";
import { rank, type Skills } from "./skills.ts";

// A core is an attunement of a paid skill, not a second currency or free unlock.
export const CORE_IDS = ["ember", "ash", "iron"] as const;
export type CoreId = (typeof CORE_IDS)[number];
export const SPELL_IDS = ["lance", "nova-spell", "siphon-spell"] as const;
export type SpellId = typeof SPELL_IDS[number];
export const SPELLS: Record<SpellId, { name: string; skill: "ember" | "nova-spell" | "siphon-spell"; description: string }> = {
  lance: { name: "Soul Lance", skill: "ember", description: "A piercing soul lance; staves release three. Follow with a weapon hit for +25% damage." },
  "nova-spell": { name: "Cinder Circle", skill: "nova-spell", description: "An eruption within four steps ignites nearby enemies. Follow with a weapon hit for +25% damage." },
  "siphon-spell": { name: "Blood Thread", skill: "siphon-spell", description: "Siphon a narrow seven-step lane, healing six life per victim. Follow with a weapon hit for +25% damage." },
};
export const spellId = (v: unknown): SpellId => SPELL_IDS.includes(v as SpellId) ? v as SpellId : "lance";
export const isSpell = (v: unknown): v is SpellId => SPELL_IDS.includes(v as SpellId);
export const availableSpell = (v: unknown, skills: Skills) => rank(skills, SPELLS[spellId(v)].skill) > 0;
export type AbilityId = SpellId | CoreId | TechniqueId;
export const abilityDuration = (id: AbilityId) => techniqueId(id) ? TECHNIQUES[id as TechniqueId].duration : isSpell(id) ? CAST_TIME : CORE_TIME;
export const abilityContact = (id: AbilityId) => techniqueId(id) ? TECHNIQUES[id as TechniqueId].contact : isSpell(id) ? CAST_CONTACT : CORE_CONTACT;
export const CORES: Record<
  CoreId,
  { name: string; description: string; color: number }
> = {
  ember: {
    name: "Furnace Heart",
    description:
      "Three expanding fire waves follow you, reaching 5.5 steps. Funeral Pyre strengthens each wave.",
    color: 0xca7545,
  },
  ash: {
    name: "Reaping Orbit",
    description:
      "Six sweeping cuts orbit you for 3 seconds. Ashen Echo strengthens each cut.",
    color: 0x91adb7,
  },
  iron: {
    name: "Sanguine Covenant",
    description:
      "Reclaim life from nearby enemies, then take 45% less damage for 5 seconds. Stolen Mercy strengthens the siphon.",
    color: 0xb26477,
  },
};
export const coreId = (value: unknown): CoreId | null =>
  CORE_IDS.includes(value as CoreId) ? (value as CoreId) : null;
export const availableCore = (
  value: unknown,
  skills: Skills,
): CoreId | null => {
  const id = coreId(value);
  return id && rank(skills, id) ? id : null;
};
export const CAST_TIME = 0.7;
export const CAST_CONTACT = 0.38;
export const CORE_TIME = 1.05;
export const CORE_CONTACT = 0.65;
export const spellCooldown = (skills: Skills) =>
  5 - 0.4 * rank(skills, "haste");
export interface AbilityState {
  core: CoreId | null;
  spell: SpellId;
  techniqueCd: number[];
  charge: number;
  castT: number;
  castId: AbilityId | null;
  castAim: number;
  castN: number;
  castPending: boolean;
  spellCd: number;
  wardT: number;
  weaveT: number;
}
export const abilityState = (core: unknown, skills: Skills, spell: unknown = "lance"): AbilityState => ({
  core: availableCore(core, skills),
  spell: spellId(spell),
  techniqueCd: [0, 0, 0, 0],
  charge: 0,
  castT: 0,
  castId: null,
  castAim: 0,
  castN: 0,
  castPending: false,
  spellCd: 0,
  wardT: 0,
  weaveT: 0,
});
