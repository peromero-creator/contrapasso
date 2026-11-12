import { Object3D, Quaternion, Vector3 } from 'three';

/** Reuse the displayed pose across interruptions, including a restart of the same clip.
 * Only rig transforms are cached; held meshes remain children of their actual hands. */
export class PoseTransition {
  private age = 0;
  private duration = 0;
  private restorePending = false;
  private entries;
  constructor(nodes: Object3D[]) {
    this.entries = nodes.map(node => ({ node,
      fromP: new Vector3(), fromQ: new Quaternion(), fromS: new Vector3(),
      rawP: new Vector3(), rawQ: new Quaternion(), rawS: new Vector3(),
    }));
  }
  begin(duration: number) {
    this.age = 0;
    this.duration = duration;
    // play() stops the old action after this snapshot, restoring its bindings.
    this.restorePending = false;
    for (const e of this.entries) {
      e.fromP.copy(e.node.position); e.fromQ.copy(e.node.quaternion); e.fromS.copy(e.node.scale);
    }
  }
  restore() {
    if (!this.restorePending) return;
    for (const e of this.entries) {
      e.node.position.copy(e.rawP); e.node.quaternion.copy(e.rawQ); e.node.scale.copy(e.rawS);
    }
    this.restorePending = false;
  }
  apply(dt: number) {
    if (this.age >= this.duration) return;
    this.age = Math.min(this.duration, this.age + Math.max(0, dt));
    const t = this.age / this.duration, weight = t * t * (3 - 2 * t);
    if (weight === 1) return;
    for (const e of this.entries) {
      e.rawP.copy(e.node.position); e.rawQ.copy(e.node.quaternion); e.rawS.copy(e.node.scale);
      e.node.position.lerpVectors(e.fromP, e.rawP, weight);
      e.node.quaternion.slerpQuaternions(e.fromQ, e.rawQ, weight);
      e.node.scale.lerpVectors(e.fromS, e.rawS, weight);
    }
    this.restorePending = true;
  }
}
