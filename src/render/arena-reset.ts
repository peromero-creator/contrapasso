import * as THREE from 'three';

/** Clear one arena's short-lived visuals while retaining pooled/shared geometry. */
export function clearTransientEffects(
  scene: THREE.Scene,
  pools: readonly (readonly { life: number; mesh: THREE.Object3D }[])[],
  texts: { sprite: THREE.Sprite }[],
  echoes: { root: THREE.Object3D }[],
) {
  for (const pool of pools)
    for (const item of pool) { item.life = 0; item.mesh.visible = false; }
  for (const text of texts) {
    scene.remove(text.sprite);
    text.sprite.material.map?.dispose();
    text.sprite.material.dispose();
  }
  texts.length = 0;
  for (const echo of echoes) {
    echo.root.traverse(node => {
      if (node instanceof THREE.Mesh)
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
    });
    scene.remove(echo.root);
  }
  echoes.length = 0;
}
