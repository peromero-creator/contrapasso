import type { CombatMotion } from './combat-motion.ts';

/** Interpolate between authoritative ticks; never predict a hit or change a replay. */
export class PresentationSample {
  private tick = -1;
  private previous = { x: 0, z: 0, elapsed: 0, action: '' };
  private current = { ...this.previous };
  sample(tick: number, x: number, z: number, action: string, motion: CombatMotion | undefined, alpha: number, reset = false) {
    const next = { x, z, action, elapsed: motion?.elapsed ?? 0 };
    if (reset || tick < this.tick || this.tick < 0) this.previous = this.current = next;
    else if (tick !== this.tick) { this.previous = this.current; this.current = next; }
    this.tick = tick;
    const t = Math.max(0, Math.min(1, alpha));
    const elapsed = this.previous.action === action ? this.previous.elapsed : 0;
    return {
      x: this.previous.x + (this.current.x-this.previous.x)*t,
      z: this.previous.z + (this.current.z-this.previous.z)*t,
      // Recovery may be advanced by the render clock. Hold the tick's endpoint
      // steady or a 120 Hz screen alternates a double step with a repeated pose.
      motion: motion ? { ...motion, elapsed: elapsed+(this.current.elapsed-elapsed)*t } : undefined,
    };
  }
}
