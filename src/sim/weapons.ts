/** Shared, deterministic weapon rules. NFT metadata selects these identities. */
export const WEAPON_IDS = ["starter", "cinder-requiem", "tollkeeper", "widows-fang", "gravewhisper", "vesper-reed"] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];
export const WEAPONS: Record<WeaponId, {
  name: string; className: string; description: string; damage: number;
  reach: number; arc: number; cooldown: number; swing: number; lunge: number;
  ranged?: "bolt" | "soul"; projectileSpeed?: number;
  heavy: number; knock: number; model: string; height: number; color: number;
}> = {
  starter: { name: "Cinder Blade", className: "Arming sword", description: "A balanced blade. Every third strike hits harder.", damage: 30, reach: 2.7, arc: .34, cooldown: .3, swing: .2, lunge: .55, heavy: 1.6, knock: 1, model: "", height: 1.55, color: 0xd7b987 },
  "cinder-requiem": { name: "Cinder Requiem", className: "Long sword", description: "Long sweeping cuts. Extra reach, slower recovery.", damage: 32, reach: 3.4, arc: .2, cooldown: .4, swing: .27, lunge: .4, heavy: 1.7, knock: 1.1, model: "sword", height: 1.85, color: 0xff813c },
  tollkeeper: { name: "Tollkeeper", className: "War hammer", description: "Slow crushing blows. Every third strike breaks in a shockwave.", damage: 49, reach: 2.6, arc: .5, cooldown: .62, swing: .4, lunge: .25, heavy: 1.9, knock: 1.8, model: "hammer", height: 1.65, color: 0xe6bb63 },
  "widows-fang": { name: "Widow’s Fang", className: "Dagger", description: "Rapid close cuts. A third strike lunges through the opening.", damage: 19, reach: 1.9, arc: .55, cooldown: .2, swing: .14, lunge: .65, heavy: 1.5, knock: .4, model: "dagger", height: .95, color: 0xa4dfbf },
  gravewhisper: { name: "Gravewhisper", className: "Hand crossbow", description: "A deliberate long-range bolt. Every third shot pierces a second target.", damage: 31, reach: 11, arc: .96, cooldown: .65, swing: .32, lunge: 0, heavy: 1.45, knock: .5, model: "crossbow", height: .28, color: 0xb9b29c, ranged: "bolt", projectileSpeed: 25 },
  "vesper-reed": { name: "Vesper Reed", className: "Soul staff", description: "Quiet soul darts. Every third cast releases a three-way fan.", damage: 22, reach: 8.5, arc: .96, cooldown: .48, swing: .34, lunge: 0, heavy: 1.15, knock: .3, model: "staff", height: 1.9, color: 0x9baba6, ranged: "soul", projectileSpeed: 17 },
};
export const weaponId = (id?: string | null): WeaponId => WEAPON_IDS.includes(id as WeaponId) ? id as WeaponId : "starter";
export const weapon = (id?: string | null) => WEAPONS[weaponId(id)];
