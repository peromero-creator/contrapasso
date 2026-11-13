import { abilityContact, abilityDuration } from '../sim/abilities.ts';
import type { SimEvent, World } from '../sim/world.ts';
import { techniqueId, TECHNIQUES } from '../sim/techniques.ts';
import type { WeaponId } from '../sim/weapons.ts';

/** Passive nova pulses have no caster side; active cores do. Keep their short
 * echo treatment instead of promoting every passive proc to an ultimate. */
export function isPassivePulse(e: SimEvent) {
  return e.type === 'ability' && e.stage === 'pulse' && e.side === undefined &&
    (e.ability === 'ember' || e.ability === 'ash' || e.ability === 'iron');
}

/** Active auras and weapon strokes stay with their wielder. Only released
 * projectiles and passive explosions on a victim keep their impact origin. */
export function attachmentFor(e: SimEvent, weapon: WeaponId) {
  if (e.type === 'echo' && e.followsCaster) return 'wielder';
  if (isPassivePulse(e)) return e.followsCaster ? 'wielder' : null;
  if (e.stage === 'charge' && e.ability) return 'charge';
  if (['ember', 'ash', 'iron'].includes(e.ability ?? '') && e.stage === 'pulse') return 'wielder';
  if (e.type === 'swing') return 'wielder';
  if ((e.ability === 'nova-spell' || e.ability === 'siphon-spell') && e.stage === 'release') return 'wielder';
  const id = techniqueId(e.ability);
  if (id && e.stage === 'pulse' && TECHNIQUES[id].pattern !== 'fan') return 'wielder';
  return null;
}
export class EffectAnchor {
  private enemyId?: number;
  private castN?: number;
  readonly event: SimEvent;
  readonly mode: 'charge' | 'wielder';
  constructor(event: SimEvent, mode: 'charge' | 'wielder') { this.event=event;this.mode=mode; }
  /** Windups follow the simulation clock, including hit-stop and slow motion. */
  chargeRemaining(w: World) {
    const actor = this.sample(w);
    if (!actor || this.mode !== 'charge' || !this.event.ability) return null;
    const cast = 'ability' in actor ? actor.ability : w.player;
    return Math.max(.001, abilityContact(this.event.ability) - (abilityDuration(this.event.ability) - cast!.castT));
  }
  position(w: World, hero?: { x: number; z: number }) {
    const actor = this.sample(w);
    return actor && this.event.side !== 'enemy' && hero ? hero : actor;
  }
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
