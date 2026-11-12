import { techniqueId, weaponTechniques } from "./techniques.ts";
import { coreId, spellId, type SpellId, type CoreId } from "./abilities.ts";
import { weaponId, type WeaponId } from "./weapons.ts";
import { SKILL_IDS, type Skills } from "./skills.ts";

export interface CombatBuild {
  skills: Skills;
  core?: CoreId | null;
  spell?: SpellId;
  weaponLevel: number;
  weaponId?: WeaponId;
  armorLevel: number;
}
export const DUEL_STAKE = 10;
export const MAX_GEAR_LEVEL = 9;
export type GearSlot = "weapon" | "armor";
/** Coin burned by one "+" attempt on gear that is currently at `level`. */
export const upgradeCost = (level: number) => 15 + 10 * level;
/** Percent chance that the attempt succeeds. A failed attempt burns only the coin. */
export const upgradeChance = (level: number) =>
  level < 3 ? 100 : level < 6 ? 85 : 70;
export const DUEL_TICKS = 90 * 60;
export const copyBuild = (build: CombatBuild): CombatBuild => ({
  skills: { ...build.skills },
  core: coreId(build.core),
  spell: spellId(build.spell),
  weaponLevel: build.weaponLevel,
  weaponId: weaponId(build.weaponId),
  armorLevel: build.armorLevel,
});
export const sameBuild = (a: CombatBuild, b: CombatBuild) =>
  coreId(a.core) === coreId(b.core) &&
  spellId(a.spell) === spellId(b.spell) &&
  weaponId(a.weaponId) === weaponId(b.weaponId) &&
  a.weaponLevel === b.weaponLevel &&
  a.armorLevel === b.armorLevel &&
  SKILL_IDS.every((id) => (a.skills[id] ?? 0) === (b.skills[id] ?? 0));
export const buildPower = (build: CombatBuild) =>
  20 +
  SKILL_IDS.filter(id => !techniqueId(id) || weaponTechniques(weaponId(build.weaponId)).includes(id as import("./techniques.ts").TechniqueId)).filter(id => !id.endsWith("-spell") || id === spellId(build.spell)).reduce((n, id) => n + 2 * (build.skills[id] ?? 0), 0) +
  2 * (build.weaponLevel + build.armorLevel);
export const fairMatch = (a: CombatBuild, b: CombatBuild) =>
  Math.abs(buildPower(a) - buildPower(b)) <=
  Math.max(6, Math.floor(buildPower(a) * 0.35));
