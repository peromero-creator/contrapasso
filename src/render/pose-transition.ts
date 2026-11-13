import { Object3D, Quaternion, Vector3 } from 'three';

/** Offset still to close at time t, for a blend of length t1 that starts x0 away from the new
 * pose while moving along that offset at v0 (negative closes it, positive is still opening).
 * A quintic with no initial acceleration: at rest it is a plain smooth crossfade, and with
 * momentum it lets the limb keep travelling before it settles, instead of stopping dead. */
function remaining(x0: number, v0: number, t1: number, t: number) {
  if (t >= t1) return 0;
  const a = -(6 * v0 * t1 + 12 * x0) / (2 * t1 ** 5), b = (16 * v0 * t1 + 30 * x0) / (2 * t1 ** 4), c = -(12 * v0 * t1 + 20 * x0) / (2 * t1 ** 3);
  return ((a * t + b) * t + c) * t * t * t + v0 * t + x0;
}
/** Keep the curve monotonic toward the target and its outward carry small. */
function shape(x0: number, v0: number, duration: number): [number, number] {
  if (x0 < 1e-7) return [0, duration];
  if (v0 > .6 * x0 / duration) return [.6 * x0 / duration, duration];
  // Already closing fast: arrive sooner along the existing motion rather than overshoot.
  if (v0 < -2.5 * x0 / duration) return [v0, 2.5 * x0 / -v0];
  return [v0, duration];
}
const delta = new Quaternion(), turn = new Quaternion();

/** Reuse the displayed pose across interruptions, including a restart of the same clip.
 * The displayed motion is carried too, so chained strikes and strike-to-skill changes keep
 * their momentum. Only rig transforms are cached; held meshes remain children of their hands. */
export class PoseTransition {
  private age = 0;
  private duration = 0;
  private restorePending = false;
  private primed = true;
  private shownDt = 0;
  private entries;
  constructor(nodes: Object3D[]) {
    this.entries = nodes.map(node => ({ node,
      fromP: new Vector3(), fromQ: new Quaternion(), fromS: new Vector3(),
      rawP: new Vector3(), rawQ: new Quaternion(), rawS: new Vector3(),
      // The last two poses actually shown, for the motion a new blend inherits.
      shownP: new Vector3(), shownQ: new Quaternion(), beforeP: new Vector3(), beforeQ: new Quaternion(),
      velP: new Vector3(), velQ: new Vector3(),
      dirP: new Vector3(), axisQ: new Vector3(),
      offP: 0, speedP: 0, lengthP: 0, offQ: 0, speedQ: 0, lengthQ: 0,
    }));
  }
  begin(duration: number) {
    this.age = 0;
    this.duration = duration;
    this.primed = false;
    // play() stops the old action after this snapshot, restoring its bindings.
    this.restorePending = false;
    const moving = this.shownDt > 1e-4, rate = moving ? 1 / this.shownDt : 0;
    for (const e of this.entries) {
      e.fromP.copy(e.node.position); e.fromQ.copy(e.node.quaternion); e.fromS.copy(e.node.scale);
      if (!moving) { e.velP.set(0, 0, 0); e.velQ.set(0, 0, 0); continue; }
      e.velP.subVectors(e.shownP, e.beforeP).multiplyScalar(rate);
      // Angular velocity in the parent frame, as a rotation vector per second.
      delta.copy(e.beforeQ).invert().premultiply(e.shownQ);
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
      const half = Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z);
      if (half < 1e-9) e.velQ.set(0, 0, 0);
      else e.velQ.set(delta.x, delta.y, delta.z).multiplyScalar(2 * Math.atan2(half, delta.w) / half * rate);
    }
    this.shownDt = 0;
  }
  restore() {
    if (!this.restorePending) return;
    for (const e of this.entries) {
      e.node.position.copy(e.rawP); e.node.quaternion.copy(e.rawQ); e.node.scale.copy(e.rawS);
    }
    this.restorePending = false;
  }
  apply(dt: number) {
    const step = Math.max(0, dt);
    if (this.age < this.duration) {
      this.age = Math.min(this.duration, this.age + step);
      const t = this.age;
      if (!this.primed) {
        // The first sample of the new clip defines how far each joint has to travel.
        for (const e of this.entries) {
          e.dirP.subVectors(e.fromP, e.node.position);
          const far = e.dirP.length();
          if (far > 1e-7) e.dirP.multiplyScalar(1 / far);
          [e.speedP, e.lengthP] = shape(far, e.velP.dot(e.dirP), this.duration);
          e.offP = far;
          delta.copy(e.node.quaternion).invert().premultiply(e.fromQ);
          if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
          const half = Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z);
          const angle = half < 1e-9 ? 0 : 2 * Math.atan2(half, delta.w);
          if (angle > 0) e.axisQ.set(delta.x, delta.y, delta.z).multiplyScalar(1 / half);
          [e.speedQ, e.lengthQ] = shape(angle, e.velQ.dot(e.axisQ), this.duration);
          e.offQ = angle;
        }
        this.primed = true;
      }
      if (t < this.duration) {
        const fade = 1 - t / this.duration, scale = fade * fade * (3 - 2 * fade);
        for (const e of this.entries) {
          e.rawP.copy(e.node.position); e.rawQ.copy(e.node.quaternion); e.rawS.copy(e.node.scale);
          if (e.offP > 0) e.node.position.addScaledVector(e.dirP, remaining(e.offP, e.speedP, e.lengthP, t));
          if (e.offQ > 0) e.node.quaternion.premultiply(turn.setFromAxisAngle(e.axisQ, remaining(e.offQ, e.speedQ, e.lengthQ, t)));
          e.node.scale.lerpVectors(e.rawS, e.fromS, scale);
        }
        this.restorePending = true;
      }
    }
    // Remember what was shown, so the next interruption can inherit its motion.
    for (const e of this.entries) {
      e.beforeP.copy(e.shownP); e.beforeQ.copy(e.shownQ);
      e.shownP.copy(e.node.position); e.shownQ.copy(e.node.quaternion);
    }
    this.shownDt = step;
  }
}
