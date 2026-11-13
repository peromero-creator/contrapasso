import * as T from 'three';

/** Keep one compiled material owner alive after short-lived effects are disposed.
 * Otherwise a spell can drop its last program reference and recompile next cast.
 * Only used before a run; this scene is never drawn or updated during combat. */
export function programSamples(sources: T.Object3D[]) {
  const samples = new T.Scene();
  const materials = new Map<T.Material, T.Material>();
  const copyMaterial = (source: T.Material) => {
    let copy = materials.get(source);
    if (!copy) {
      copy = source.clone();
      // Three's Material.clone deliberately does not copy shader callbacks.
      copy.onBeforeCompile = source.onBeforeCompile;
      copy.customProgramCacheKey = source.customProgramCacheKey;
      materials.set(source, copy);
    }
    return copy;
  };
  for (const source of sources) source.traverse(node => {
    if (!(node instanceof T.Mesh || node instanceof T.Sprite)) return;
    const copy = node.clone(false);
    copy.material = Array.isArray(node.material) ? node.material.map(copyMaterial) : copyMaterial(node.material);
    samples.add(copy);
  });
  return samples;
}
