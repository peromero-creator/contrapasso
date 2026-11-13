import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Bake only opaque, unanimated scenery; moving branches and async replacements
 * keep their own transforms. Geometry stays identical, draws are grouped by material. */
export function batchScenery(root: T.Object3D, moving: Set<T.Object3D>) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const groups = new Map<T.Material, T.Mesh[]>();
  const visit = (node: T.Object3D) => {
    if (moving.has(node)) return;
    if (node instanceof T.Mesh && !(node instanceof T.SkinnedMesh) && !Array.isArray(node.material) && !node.material.transparent && !node.children.length) {
      const list = groups.get(node.material) ?? [];
      list.push(node); groups.set(node.material, list);
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  const removed = new Set<T.BufferGeometry>();
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(mesh => {
      const copy = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      copy.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
      return copy;
    });
    const merged = mergeGeometries(geometries);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) continue;
    for (const mesh of meshes) { mesh.removeFromParent(); removed.add(mesh.geometry); }
    const batch = new T.Mesh(merged, material);
    batch.name = 'scenery-batch'; root.add(batch);
  }
  // Some procedural primitives may be shared with excluded moving pieces.
  root.traverse(node => { if (node instanceof T.Mesh) removed.delete(node.geometry); });
  for (const geometry of removed) geometry.dispose();
}
