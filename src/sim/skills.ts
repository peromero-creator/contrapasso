export const SKILL_IDS = ["ember", "reach", "verdict", "ash", "blood", "iron", "haste", "reprisal"] as const;
export type SkillId = typeof SKILL_IDS[number];
export type Skills = Partial<Record<SkillId, number>>;
export const MAX_SKILL_RANK = 3;

export const SKILLS: Record<SkillId, { name: string; icon: string; description: string; rank: string; bossPattern: string; cost: number }> = {
  ember: { name: "Ember Edge", icon: "✦", description: "Your blade sets enemies alight for 3 seconds.", rank: "+4 burn damage per second", bossPattern: "burning-cleave", cost: 45 },
  reach: { name: "Gravespan", icon: "⌁", description: "A longer reach. A wider arc. Leave nowhere to hide.", rank: "+0.6 blade reach and a wider arc", bossPattern: "wide-cleave", cost: 45 },
  verdict: { name: "Third Verdict", icon: "Ⅲ", description: "Every third swing strikes harder and pushes further.", rank: "+60% base damage on third swings", bossPattern: "triple-cleave", cost: 60 },
  ash: { name: "Ash Step", icon: "↯", description: "Dashing erupts in ash. Return to the fight sooner.", rank: "18 dash burst damage; −12% dash cooldown", bossPattern: "explosive-dash", cost: 60 },
  blood: { name: "Blood Tithe", icon: "◆", description: "Each fallen enemy gives a little life back.", rank: "+2 life on kill", bossPattern: "siphon", cost: 75 },
  iron: { name: "Iron Vow", icon: "⬡", description: "A body forged to endure the descent.", rank: "+20 maximum life; −10% incoming damage", bossPattern: "armored-charge", cost: 60 },
  haste: { name: "Restless", icon: "»", description: "Move faster. Recover your blade sooner.", rank: "+8% movement speed; −8% attack cooldown", bossPattern: "quick-combo", cost: 60 },
  reprisal: { name: "Reprisal", icon: "✳", description: "Taking a hit sends a shock through nearby enemies.", rank: "16 retaliation damage; clears nearby shots", bossPattern: "retaliation-ring", cost: 75 },
};

export function rank(skills: Skills, id: SkillId): number { return skills[id] ?? 0; }
