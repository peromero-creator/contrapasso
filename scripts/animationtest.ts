import assert from "node:assert/strict";
import * as THREE from "three";
import { AnimatedModel } from "../src/render/assets.ts";
const scene = new THREE.Group(),
  mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  );
mesh.name = "blade";
scene.add(mesh);
const clip = new THREE.AnimationClip("attack", 1, [
  new THREE.NumberKeyframeTrack("blade.rotation[x]", [0, 1], [0, 1]),
]);
const model = new AnimatedModel({ scene, animations: [clip] } as any, 1, 0);
model.play("attack", 0.2);
model.update(0.25);
const blade = model.root.getObjectByName("blade")!;
assert.ok(blade.rotation.x > 0.95);
model.play("attack", 0.2, true);
model.update(0.05);
assert.ok(
  blade.rotation.x < 0.5,
  "back-to-back attack restarts instead of freezing on final pose",
);
model.update(0.2);
assert.ok(blade.rotation.x > 0.95);
model.dispose();
mesh.geometry.dispose();
mesh.material.dispose();
console.log(
  "Animation: PASS (back-to-back attack restarts at gameplay duration)",
);
