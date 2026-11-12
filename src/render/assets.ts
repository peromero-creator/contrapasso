import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

interface ModelSpec {
  file: string;
  height: number;
  rotationY: number;
  /** Seconds of a clip to keep, per state: { attack: [0.35, 0.85] }. */
  windows?: Record<string, [number, number]>;
}

/** Keep animated characters on their simulation position and trim clips to the part that reads at game speed. */
function prepareClips(
  clips: THREE.AnimationClip[],
  windows: Record<string, [number, number]> = {},
): THREE.AnimationClip[] {
  return clips.map((source) => {
    let clip = source.clone();
    for (const track of clip.tracks) {
      if (!/^(hips|pelvis|root)\.position$/i.test(track.name)) continue;
      const v = track.values;
      for (let i = 3; i < v.length; i += 3) {
        v[i] = v[0];
        v[i + 2] = v[2];
      }
    }
    const window = windows[clip.name.toLowerCase()];
    if (window)
      clip = THREE.AnimationUtils.subclip(
        clip,
        clip.name,
        Math.round(window[0] * 30),
        Math.round(window[1] * 30),
        30,
      );
    return clip;
  });
}
interface Manifest {
  version: number;
  models: Record<string, ModelSpec>;
  floors: Record<string, string>;
}

export class AnimatedModel {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private active: THREE.AnimationAction | null = null;
  private materials: {
    material: THREE.MeshStandardMaterial;
    base: THREE.Color;
  }[] = [];
  private allMaterials = new Set<THREE.Material>();
  private content: THREE.Object3D;

  constructor(
    template: GLTF,
    height: number,
    rotationY: number,
    clips: THREE.AnimationClip[] = template.animations,
  ) {
    this.content = clone(template.scene);
    this.content.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      // Skinned bounds are only valid for the bind pose; a handful of actors is cheap to always draw.
      if (node instanceof THREE.SkinnedMesh) node.frustumCulled = false;
      const copy = (material: THREE.Material) => {
        const m = material.clone();
        this.allMaterials.add(m);
        if (m instanceof THREE.MeshStandardMaterial) {
          // matte: no environment map exists, so metal would render black
          m.metalness = 0;
          m.roughness = 1;
          this.materials.push({ material: m, base: m.emissive.clone() });
        }
        return m;
      };
      node.material = Array.isArray(node.material)
        ? node.material.map(copy)
        : copy(node.material);
    });
    const fit = new THREE.Group();
    fit.add(this.content);
    fit.rotation.y = (rotationY * Math.PI) / 180;
    // Bones must have world matrices before a skinned mesh can be measured.
    fit.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(fit, true);
    const scale = height / Math.max(0.01, box.getSize(new THREE.Vector3()).y);
    fit.scale.setScalar(scale);
    fit.updateMatrixWorld(true);
    box.setFromObject(fit, true);
    const center = box.getCenter(new THREE.Vector3());
    fit.position.set(-center.x, -box.min.y, -center.z);
    this.root.add(fit);
    this.addOutline(box.getSize(new THREE.Vector3()).length());
    this.mixer = new THREE.AnimationMixer(this.content);
    for (const clip of clips)
      this.actions.set(clip.name.toLowerCase(), this.mixer.clipAction(clip));
  }
  /** Dark ink line around a skinned figure (inverted hull), for the illustrated 2.5D look. */
  private addOutline(worldDiagonal: number) {
    const skinned: THREE.SkinnedMesh[] = [];
    this.content.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) skinned.push(node);
    });
    for (const mesh of skinned) {
      mesh.geometry.computeBoundingBox();
      const local = mesh.geometry
        .boundingBox!.getSize(new THREE.Vector3())
        .length();
      const width = (0.035 * local) / Math.max(0.001, worldDiagonal);
      const ink = new THREE.MeshBasicMaterial({
        color: 0x120a0a,
        side: THREE.BackSide,
      });
      ink.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n  transformed += normalize(objectNormal) * ${width.toFixed(6)};`,
        );
      };
      this.allMaterials.add(ink);
      const hull = new THREE.SkinnedMesh(mesh.geometry, ink);
      hull.bind(mesh.skeleton, mesh.bindMatrix);
      hull.position.copy(mesh.position);
      hull.quaternion.copy(mesh.quaternion);
      hull.scale.copy(mesh.scale);
      hull.frustumCulled = false;
      mesh.parent?.add(hull);
    }
  }
  /** A skeleton bone by name, for attaching held items. */
  bone(name: string): THREE.Object3D | null {
    let found: THREE.Object3D | null = null;
    this.content.traverse((node) => {
      if (!found && node.name === name) found = node;
    });
    return found;
  }
  play(state: string, seconds?: number, restart = false) {
    const next =
      this.actions.get(state) ??
      this.actions.get("idle") ??
      this.actions.values().next().value;
    if (!next || (next === this.active && !restart)) return;
    this.active?.fadeOut(0.07);
    next.reset().fadeIn(0.07);
    const once =
      (state.startsWith("attack") || ["dash", "death"].includes(state)) &&
      this.actions.get(state) === next;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    const duration =
      seconds ?? (state === "attack" ? 0.2 : state === "dash" ? 0.16 : 0);
    next.setEffectiveTimeScale(
      duration && once ? next.getClip().duration / duration : 1,
    );
    next.play();
    this.active = next;
  }
  tint(color: number) {
    for (const m of this.materials)
      m.material.color.multiply(new THREE.Color(color));
  }
  flash(color: number | null) {
    for (const m of this.materials)
      m.material.emissive.copy(
        color === null ? m.base : new THREE.Color(color),
      );
  }
  update(dt: number) {
    this.mixer.update(dt);
  }
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.content);
    for (const material of this.allMaterials) material.dispose();
    const skeletons = new Set<THREE.Skeleton>();
    this.content.traverse((node) => {
      if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
    });
    for (const skeleton of skeletons) skeleton.dispose();
  }
}

export class ModelLibrary {
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private models = new Map<string, Promise<GLTF | null>>();
  private floors = new Map<string, Promise<THREE.Texture | null>>();
  private clips = new Map<string, THREE.AnimationClip[]>();
  private manifest: Promise<Manifest> = fetch("/assets/manifest.json")
    .then(async (r) => {
      if (!r.ok) throw new Error("No asset manifest");
      const data = await r.json();
      if (data.version !== 1) throw new Error("Unsupported assets");
      return data;
    })
    .catch(() => ({ version: 1, models: {}, floors: {} }));

  async create(kind: string, height?: number): Promise<AnimatedModel | null> {
    const manifest = await this.manifest;
    const spec =
      manifest.models[kind] ??
      (kind === "warden" || kind === "champion"
        ? manifest.models.hero
        : undefined);
    if (!spec || !spec.file.startsWith("/assets/")) return null;
    if (!this.models.has(spec.file))
      this.models.set(
        spec.file,
        this.loader.loadAsync(spec.file).catch(() => null),
      );
    const template = await this.models.get(spec.file)!;
    if (!template) return null;
    if (!this.clips.has(spec.file))
      this.clips.set(
        spec.file,
        prepareClips(template.animations, spec.windows),
      );
    const model = new AnimatedModel(
      template,
      height ?? spec.height,
      spec.rotationY ?? 90,
      this.clips.get(spec.file),
    );
    if (kind === "warden") model.tint(0x9c719e);
    if (kind === "champion") model.tint(0xbd6970);
    return model;
  }
  async floor(name: string): Promise<THREE.Texture | null> {
    const path = (await this.manifest).floors[name];
    if (!path || !path.startsWith("/assets/")) return null;
    if (!this.floors.has(path))
      this.floors.set(
        path,
        new THREE.TextureLoader()
          .loadAsync(path)
          .then((texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            return texture;
          })
          .catch(() => null),
      );
    return this.floors.get(path)!;
  }
}
