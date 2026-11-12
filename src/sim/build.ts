import { SKILL_IDS, type Skills } from "./skills.ts";

export interface CombatBuild {
  skills: Skills;
  weaponLevel: number;
  armorLevel: number;
}
export const DUEL_STAKE = 10;
export const DUEL_TICKS = 90 * 60;
export const copyBuild = (build: CombatBuild): CombatBuild => ({
  skills: { ...build.skills },
  weaponLevel: build.weaponLevel,
  armorLevel: build.armorLevel,
});
export const sameBuild = (a: CombatBuild, b: CombatBuild) =>
  a.weaponLevel === b.weaponLevel &&
  a.armorLevel === b.armorLevel &&
  SKILL_IDS.every((id) => (a.skills[id] ?? 0) === (b.skills[id] ?? 0));
export const buildPower = (build: CombatBuild) =>
  20 +
  SKILL_IDS.reduce((n, id) => n + 2 * (build.skills[id] ?? 0), 0) +
  2 * (build.weaponLevel + build.armorLevel);
export const fairMatch = (a: CombatBuild, b: CombatBuild) =>
  Math.abs(buildPower(a) - buildPower(b)) <=
  Math.max(6, Math.floor(buildPower(a) * 0.35));
