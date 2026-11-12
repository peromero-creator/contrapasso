import { rank, type Skills } from "./skills.ts";

// A core is an attunement of a paid skill, not a second currency or free unlock.
export const CORE_IDS = ["ember", "ash", "iron"] as const;
export type CoreId = (typeof CORE_IDS)[number];
export type AbilityId = "lance" | CoreId;
export const CORES: Record<
  CoreId,
  { name: string; description: string; color: number }
> = {
  ember: {
    name: "Furnace Heart",
    description:
      "Three expanding eruptions ignite everything within 5.5 steps. Funeral Pyre strengthens each eruption.",
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
export const abilityState = (core: unknown, skills: Skills): AbilityState => ({
  core: availableCore(core, skills),
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
