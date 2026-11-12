import type { NftToken } from '../shared/protocol.ts';
import { weaponId, type WeaponId } from '../sim/weapons.ts';
export interface LoadoutWeapon { tokenId: string; identity: WeaponId; level: number; kills: number; blocked: boolean }
/** Display only owned inventory; the server rechecks ownership when equipping. */
export function loadoutWeapons(tokens: NftToken[], championId: string): LoadoutWeapon[] {
  return tokens.filter(t=>t.extra.kind==='weapon' && (!t.extra.bound || t.extra.championId===championId)).map(t=>({
    tokenId:t.tokenId, identity:weaponId(String(t.extra.weaponId ?? t.extra.collection ?? 'starter')),
    level:Number(t.extra.level ?? 0), kills:Number(t.extra.kills ?? 0),
    blocked:!!t.extra.listing || !!t.extra.equippedTo && t.extra.equippedTo!==championId,
  }));
}
