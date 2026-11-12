export const SKILL_IDS = ["ember", "reach", "verdict", "haste", "ash", "iron", "blood", "reprisal", "pyre", "afterimage", "coup", "mercy"] as const;
export type SkillId = typeof SKILL_IDS[number];
export type Skills = Partial<Record<SkillId, number>>;
export const MAX_SKILL_RANK = 3;

export const SKILLS: Record<SkillId, { name: string; icon: string; description: string; rank: string; bossPattern: string; cost: number }> = {
  ember: { name: "Ember Edge", icon: "✦", description: "Weapon hits ignite enemies. Q casts a piercing Soul Lance; a staff casts three. Unlocks the Furnace Heart core.", rank: "+4 burn damage per second", bossPattern: "burning-cleave", cost: 45 },
  reach: { name: "Gravespan", icon: "⌁", description: "A longer reach. A wider arc. Leave nowhere to hide.", rank: "+0.6 blade reach and a wider arc", bossPattern: "wide-cleave", cost: 45 },
  verdict: { name: "Third Verdict", icon: "Ⅲ", description: "Every third swing strikes harder and pushes further.", rank: "+60% base damage on third swings", bossPattern: "triple-cleave", cost: 60 },
  ash: { name: "Ash Step", icon: "↯", description: "Dashing erupts in ash. Unlocks the Reaping Orbit core.", rank: "18 dash burst damage; −12% dash cooldown", bossPattern: "explosive-dash", cost: 60 },
  blood: { name: "Blood Tithe", icon: "◆", description: "Each fallen enemy gives a little life back.", rank: "+2 life on kill", bossPattern: "siphon", cost: 75 },
  iron: { name: "Iron Vow", icon: "⬡", description: "A body forged to endure. Unlocks the Sanguine Covenant core.", rank: "+20 maximum life; −10% incoming damage", bossPattern: "armored-charge", cost: 60 },
  haste: { name: "Restless", icon: "»", description: "Move faster. Recover your blade sooner.", rank: "+8% movement speed; −8% attack cooldown", bossPattern: "quick-combo", cost: 60 },
  pyre: { name: "Funeral Pyre", icon: "✦", description: "Heavy strikes detonate burning victims in a burst of ash.", rank: "12 burst damage per burning target on a heavy strike", bossPattern: "pyre-cleave", cost: 90 },
  afterimage: { name: "Ashen Echo", icon: "↯", description: "An aftershock blooms where your dash ends.", rank: "12 landing burst damage; clears nearby shots", bossPattern: "echo-dash", cost: 75 },
  coup: { name: "Last Rites", icon: "Ⅲ", description: "Dash, turn, strike. Your next attack within one second hits harder.", rank: "+25% damage on the first strike after dashing", bossPattern: "dash-combo", cost: 90 },
  mercy: { name: "Stolen Mercy", icon: "◆", description: "Gather more life from the fallen. Each vessel gives more healing.", rank: "+50% healing from blood vessels", bossPattern: "blood-vessel", cost: 90 },
  reprisal: { name: "Reprisal", icon: "✳", description: "Taking a hit sends a shock through nearby enemies.", rank: "16 retaliation damage; clears nearby shots", bossPattern: "retaliation-ring", cost: 75 },
};

export function rank(skills: Skills, id: SkillId): number { return skills[id] ?? 0; }

export const SKILL_BRANCHES = [
  { id: "wrath", name: "The Pyre", subtitle: "Ignite · Reach · Detonate", skills: ["ember", "reach", "verdict", "pyre"] },
  { id: "veil", name: "The Veil", subtitle: "Move · Dash · Return", skills: ["haste", "ash", "afterimage", "coup"] },
  { id: "blood", name: "The Vessel", subtitle: "Endure · Reclaim · Restore", skills: ["iron", "blood", "reprisal", "mercy"] },
] as const;
export const PREREQUISITES: Partial<Record<SkillId, SkillId>> = {
  reach: "ember", verdict: "reach", pyre: "verdict",
  ash: "haste", afterimage: "ash", coup: "afterimage",
  blood: "iron", reprisal: "blood", mercy: "reprisal",
};
export const canLearn = (owned: readonly SkillId[], id: SkillId) =>
  !PREREQUISITES[id] || owned.includes(PREREQUISITES[id]!);
