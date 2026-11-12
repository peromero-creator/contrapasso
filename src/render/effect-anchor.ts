import type { SimEvent, World } from '../sim/world.ts';
import { familyOf, techniqueId, TECHNIQUES } from '../sim/techniques.ts';
import type { WeaponId } from '../sim/weapons.ts';

/** Ground impacts and released projectiles keep their world position. Windup,
 * moving blade trails and Reaping Orbit belong to the wielder. */
export function attachmentFor(e: SimEvent, weapon: WeaponId) {
  if (e.stage === 'charge' && e.ability) return 'charge';
  if (e.ability === 'ash' && e.stage === 'pulse') return 'wielder';
  if (e.type === 'swing' && familyOf(weapon) !== 'hammer') return 'wielder';
  const id = techniqueId(e.ability);
  if (id && e.stage === 'pulse' && !id.startsWith('hammer') && !id.startsWith('staff') && TECHNIQUES[id].pattern !== 'fan') return 'wielder';
  return null;
}
export class EffectAnchor {
  private enemyId?: number;
  private castN?: number;
  readonly event: SimEvent;
  readonly mode: 'charge' | 'wielder';
  constructor(event: SimEvent, mode: 'charge' | 'wielder') { this.event=event;this.mode=mode; }
  sample(w: World) {
    const actor = this.event.side === 'enemy'
      ? w.enemies.find(e => this.enemyId === undefined ? e.kind === 'champion' : e.id === this.enemyId)
      : w.player;
    if (!actor || actor.hp <= 0 || w.phase !== 'fight') return null;
    if ('id' in actor) this.enemyId = actor.id;
    const ability = 'ability' in actor ? actor.ability : w.player;
    if (this.mode === 'charge') {
      if (!ability || ability.castId !== this.event.ability || !ability.castPending || ability.castT <= 0) return null;
      this.castN ??= ability.castN;
      if (this.castN !== ability.castN) return null;
    }
    return actor;
  }
}
