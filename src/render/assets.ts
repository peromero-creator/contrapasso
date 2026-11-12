import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

interface ModelSpec {
  file: string;
  height: number;
  rotationY: number;
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

  constructor(template: GLTF, height: number, rotationY: number) {
    this.content = clone(template.scene);
    this.content.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      const copy = (material: THREE.Material) => {
        const m = material.clone();
        this.allMaterials.add(m);
        if (m instanceof THREE.MeshStandardMaterial)
          this.materials.push({ material: m, base: m.emissive.clone() });
        return m;
      };
      node.material = Array.isArray(node.material)
        ? node.material.map(copy)
        : copy(node.material);
    });
    const fit = new THREE.Group();
    fit.add(this.content);
    fit.rotation.y = (rotationY * Math.PI) / 180;
    const box = new THREE.Box3().setFromObject(fit);
    const scale = height / Math.max(0.01, box.getSize(new THREE.Vector3()).y);
    fit.scale.setScalar(scale);
    fit.updateMatrixWorld(true);
    box.setFromObject(fit);
    const center = box.getCenter(new THREE.Vector3());
    fit.position.set(-center.x, -box.min.y, -center.z);
    this.root.add(fit);
    this.mixer = new THREE.AnimationMixer(this.content);
    for (const clip of template.animations)
      this.actions.set(clip.name.toLowerCase(), this.mixer.clipAction(clip));
  }
  play(state: string) {
    const next =
      this.actions.get(state) ??
      this.actions.get("idle") ??
      this.actions.values().next().value;
    if (!next || next === this.active) return;
    this.active?.fadeOut(0.07);
    next.reset().fadeIn(0.07);
    const once =
      ["attack", "dash", "death"].includes(state) &&
      this.actions.get(state) === next;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    const duration = state === "attack" ? 0.2 : state === "dash" ? 0.16 : 0;
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
    const model = new AnimatedModel(
      template,
      height ?? spec.height,
      spec.rotationY ?? 90,
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
