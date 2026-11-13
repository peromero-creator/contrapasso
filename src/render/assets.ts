import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

import { abilityContact, abilityDuration } from "../sim/abilities.ts";
import { clipContact, combatLift, combatPose, motionClock, staffGesture, piercingGesture, crossbowRecoil, type CombatMotion } from "./combat-motion.ts";

import { PoseTransition } from "./pose-transition.ts";

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

const fitBounds = new WeakMap<GLTF, Map<number, THREE.Box3>>();

export class AnimatedModel {
  private lastFlash: number | null | undefined;
  private presentation = new THREE.Group();
  private staffFocus: THREE.Group | null = null;
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
  private posed = new Map<THREE.Object3D, THREE.Quaternion>();
  private joints = new Map<string, THREE.Object3D>();
  private transition: PoseTransition;

  constructor(
    template: GLTF,
    height: number,
    rotationY: number,
    clips: THREE.AnimationClip[] = template.animations,
  ) {
    this.content = clone(template.scene);
    this.content.traverse((node) => {
      if(node.name && !this.joints.has(node.name))this.joints.set(node.name,node);
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = true;
      node.receiveShadow = true;
      // Skinned bounds are only valid for the bind pose; a handful of actors is cheap to always draw.
      if (node instanceof THREE.SkinnedMesh) {
        node.frustumCulled = false;
        // WebGLRenderer still computes a skinned sphere for depth sorting even
        // with frustum culling off. Scanning every posed vertex on first draw
        // stalls each new actor/echo. The bind-pose center is sufficient for
        // sorting; actors are not culled or picked through this approximate bound.
        if (!node.geometry.boundingSphere) node.geometry.computeBoundingSphere();
        node.boundingSphere = node.geometry.boundingSphere!.clone();
      }
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
    // A template's bind-pose bounds do not change between spawns. Measuring every
    // skinned vertex twice per actor used to stall enemy waves and summoned guards.
    let rotations = fitBounds.get(template);
    if (!rotations) { rotations = new Map(); fitBounds.set(template, rotations); }
    let bounds = rotations.get(rotationY);
    if (!bounds) {
      fit.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(fit, true);
      rotations.set(rotationY, bounds);
    }
    const scale = height / Math.max(0.01, bounds.getSize(new THREE.Vector3()).y);
    fit.scale.setScalar(scale);
    const box = bounds.clone();
    box.min.multiplyScalar(scale); box.max.multiplyScalar(scale);
    const center = box.getCenter(new THREE.Vector3());
    fit.position.set(-center.x, -box.min.y, -center.z);
    this.presentation.add(fit);
    this.root.add(this.presentation);
    const animated = new Set<THREE.Object3D>();
    this.content.traverse(node => { if (node instanceof THREE.Bone) animated.add(node); });
    for (const clip of clips) for (const track of clip.tracks) {
      const node = this.joints.get(THREE.PropertyBinding.parseTrackName(track.name).nodeName);
      if (node) animated.add(node);
    }
    animated.add(this.presentation);
    this.transition = new PoseTransition([...animated]);
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
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const local = mesh.geometry
        .boundingBox!.getSize(new THREE.Vector3())
        .length();
      const width = (0.035 * local) / Math.max(0.001, worldDiagonal);
      const ink = new THREE.MeshBasicMaterial({
        color: 0x120a0a,
        side: THREE.BackSide,
      });
      ink.onBeforeCompile = (shader) => {
        // Width is per material. Baking a captured constant into identical shader
        // callbacks lets the program cache reuse another model's outline width.
        shader.uniforms.inkWidth = { value: width };
        shader.vertexShader = "uniform float inkWidth;\n" + shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\n  transformed += normalize(objectNormal) * inkWidth;`,
        );
      };
      this.allMaterials.add(ink);
      const hull = new THREE.SkinnedMesh(mesh.geometry, ink);
      hull.bind(mesh.skeleton, mesh.bindMatrix);
      hull.position.copy(mesh.position);
      hull.quaternion.copy(mesh.quaternion);
      hull.scale.copy(mesh.scale);
      hull.frustumCulled = false;
      hull.boundingSphere = mesh.boundingSphere!.clone();
      mesh.parent?.add(hull);
    }
  }
  /** A skeleton bone by name, for attaching held items. */
  bone(name: string): THREE.Object3D | null {
    return this.joints.get(name) ?? null;
  }
  play(state: string, seconds?: number, restart = false, skillBridge?: number) {
    const next =
      this.actions.get(state) ??
      this.actions.get("idle") ??
      this.actions.values().next().value;
    if (!next || (next === this.active && !restart)) return;
    if (this.active) {
      const action = (name: string) => name.startsWith("attack") || name.startsWith("ultimate") || name === "cast";
      const leaving = action(this.active.getClip().name.toLowerCase()), length = seconds ?? .4;
      if (state === "dash") this.transition.begin(.045);
      else if (state === "run" || state === "idle") this.transition.begin(leaving ? (state === "idle" ? .22 : .18) : .12);
      // Chained strikes and strike-to-skill: carry the previous follow-through into the new
      // wind-up, but always arrive before the blow lands so the contact pose stays crisp.
      // Heavy two-handed clips end far from their next wind-up and gather for longer, so they
      // get a longer bridge; the grip is reseated through both palms after every blend.
      else if (leaving && skillBridge !== undefined) this.transition.begin(skillBridge);
      else if (leaving) {
        const heavy = ["attack-hammer", "attack-axe", "attack-axe-heavy", "ultimate-slam", "ultimate-iron"].includes(state);
        this.transition.begin(Math.min(Math.max(.06, length * (heavy ? .48 : .38)), heavy ? .19 : .1, Math.max(.05, clipContact(state) * length)));
      }
      else this.transition.begin(Math.min(.08, length * .2));
    }
    this.transition.restore();
    // Restore procedural corrections before unbinding the previous action.
    for (const [joint, base] of this.posed) joint.quaternion.copy(base);
    this.posed.clear();
    this.mixer.stopAllAction();
    next.reset().setEffectiveWeight(1);
    const once =
      (state.startsWith("attack") ||
        ["dash", "death", "cast"].includes(state) ||
        state.startsWith("ultimate")) &&
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
    if (color === this.lastFlash) return;
    this.lastFlash = color;
    for (const m of this.materials) {
      if (color === null) m.material.emissive.copy(m.base);
      else m.material.emissive.setHex(color);
    }
  }
  update(dt: number, motion?: CombatMotion, air = 0, clipProgress?: number) {
    this.transition.restore();
    // Restore before sampling: additive accents never accumulate on idle or a new clip.
    for (const [joint, base] of this.posed) joint.quaternion.copy(base);
    this.posed.clear();
    if(this.staffFocus)this.staffFocus.visible=false;
    this.presentation.position.y = combatLift(motion) + air;
    if (clipProgress !== undefined && this.active) {
      this.active.time = Math.max(0, Math.min(1, clipProgress)) * this.active.getClip().duration;
      this.mixer.update(0); this.transition.apply(dt); return;
    }
    if (!motion || !this.active) { this.mixer.update(dt); this.transition.apply(dt); return; }
    this.active.time = motionClock(motion, this.active.getClip().name) * this.active.getClip().duration;
    this.mixer.update(0);
    for (const [name, angles] of Object.entries(combatPose(motion))) {
      const joint = this.bone(name);
      if (!joint) continue;
      this.posed.set(joint, joint.quaternion.clone());
      joint.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...angles)));
    }
    this.aimVaultBlade(motion);
    this.aimHeldWeapon(motion);
    this.alignHeavyGrip(motion);
    this.transition.apply(dt);
    // A blend moves both hands; seat the shaft through both palms again in the pose actually shown.
    this.alignHeavyGrip(motion);
    this.updateStaffFocus(motion);
  }
  /** Gathering pigment is attached to the actual staff crown, never the actor origin. */
  private updateStaffFocus(motion: CombatMotion) {
    if(motion.weapon!=='vesper-reed'||!motion.ability)return;
    const contact=abilityContact(motion.ability),time=motion.elapsed;
    if(time>contact+.16)return;
    const hand=this.bone('RightHand');if(!hand)return;
    if(!this.staffFocus) {
      this.staffFocus=new THREE.Group();this.staffFocus.name="staff-charge";this.root.add(this.staffFocus);
      for(let i=0;i<3;i++) {
        const mat=new THREE.MeshBasicMaterial({color:i===1?0xb8aa80:0x86a9a4,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
        this.allMaterials.add(mat);
        const arc=new THREE.Mesh(new THREE.TorusGeometry(.16+i*.045,.012,3,24,Math.PI*1.3),mat);
        arc.rotation.z=i*Math.PI*2/3;this.staffFocus.add(arc);
      }
    }
    this.root.updateWorldMatrix(true,true);
    const axis=new THREE.Vector3(0,0,1).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
    const tip=hand.getWorldPosition(new THREE.Vector3()).addScaledVector(axis,1.65);
    this.staffFocus.position.copy(this.root.worldToLocal(tip));
    const localAxis=axis.transformDirection(this.root.matrixWorld.clone().invert());
    this.staffFocus.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),localAxis);
    const before=Math.min(1,time/contact),after=Math.max(0,(time-contact)/.16);
    this.staffFocus.visible=true;this.staffFocus.scale.setScalar(.75+.25*before+after*.8);
    this.staffFocus.children.forEach((node,i)=>{
      const arc=node as THREE.Mesh<THREE.TorusGeometry,THREE.MeshBasicMaterial>;
      arc.rotation.z=i*Math.PI*2/3-time*2;
      const warm=['staff-2','ember','nova-spell'].includes(motion.ability!);
      const blood=motion.ability==='iron'||motion.ability==='siphon-spell';
      arc.material.color.setHex(i===1?0xb8aa80:warm?0xb77d53:blood?0xac7482:0x86a9a4);
      arc.material.opacity=.38*Math.sin(Math.PI*.5*before)*(1-after);
    });
  }
  private aimVaultBlade(motion: CombatMotion) {
    if(motion.ability!=='sword-4')return;
    const hand=this.bone('RightHand');if(!hand?.parent)return;
    const contact=abilityContact(motion.ability), t=motion.elapsed/contact;
    const turn=Math.max(0,Math.min(1,(t-.65)/.35));
    const weight=Math.max(0,Math.min(1,motion.elapsed/.12)*Math.min(1,(abilityDuration(motion.ability)-motion.elapsed)/.12));
    if(weight<=0)return;
    this.root.updateWorldMatrix(true,true);
    const target=new THREE.Vector3(.65,1-turn*1.85,0).normalize().transformDirection(this.root.matrixWorld);
    const world=hand.getWorldQuaternion(new THREE.Quaternion());
    const axis=new THREE.Vector3(0,0,1).applyQuaternion(world);
    const local=hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(new THREE.Quaternion().setFromUnitVectors(axis,target).multiply(world));
    if(!this.posed.has(hand))this.posed.set(hand,hand.quaternion.clone());
    hand.quaternion.slerp(local,weight);hand.updateWorldMatrix(false,true);
  }
  /** Heavy two-hand clips carry one shaft through both palms, rather than a dangling prop. */
  private alignHeavyGrip(motion: CombatMotion) {
    const state=this.active?.getClip().name;
    if(!['attack-hammer','attack-axe','ultimate-iron','ultimate-slam'].includes(state ?? ''))return;
    if(motion.weapon!=='tollkeeper' && motion.weapon!=='guillotine-hymn')return;
    const right=this.bone('RightHand'),left=this.bone('LeftHand');
    if(!right||!left)return;
    this.root.updateWorldMatrix(true,true);
    const axis=new THREE.Vector3(0,0,1).applyQuaternion(right.getWorldQuaternion(new THREE.Quaternion()));
    const shaft=left.getWorldPosition(new THREE.Vector3()).sub(right.getWorldPosition(new THREE.Vector3())).normalize();
    if(state==='ultimate-slam')shaft.negate();
    if(!this.posed.has(right))this.posed.set(right,right.quaternion.clone());
    const world=right.getWorldQuaternion(new THREE.Quaternion());
    const parent=right.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    right.quaternion.copy(parent.multiply(new THREE.Quaternion().setFromUnitVectors(axis,shaft).multiply(world)));
    right.updateWorldMatrix(false,true);
  }
  /** Keep ranged releases in front of the caster while preserving the animated windup. */
  private aimHeldWeapon(motion: CombatMotion) {
    const piercing=piercingGesture(motion);
    const ranged = !!piercing || motion.weapon === 'vesper-reed' || motion.weapon === 'gravewhisper';
    const directed = !!piercing || motion.weapon === 'vesper-reed' || !motion.ability || motion.ability === 'lance' || motion.ability === 'staff-1' || motion.ability === 'staff-4' || motion.ability.startsWith('crossbow-');
    if (!ranged || !directed) return;
    const hand=this.bone('RightHand'), upper=this.bone('RightArm'), fore=this.bone('RightForeArm');
    if(!hand||!upper||!fore)return;
    const phase=motionClock(motion,this.active?.getClip().name);
    const gesture=motion.weapon==='vesper-reed'?staffGesture(motion):piercing;
    const weight=gesture?.weight ?? Math.min(1,phase/.4)*Math.min(1,(1-phase)/.22);
    if(weight<=0)return;
    const recoil=crossbowRecoil(motion);
    const localTarget=gesture?new THREE.Vector3(...gesture.target):new THREE.Vector3(.65-recoil,1.3+recoil*.4,.12);
    this.root.updateWorldMatrix(true,true);
    const target=this.root.localToWorld(localTarget);
    const rotateWorld=(joint:THREE.Object3D,delta:THREE.Quaternion,blend:number)=>{
      if(!this.posed.has(joint))this.posed.set(joint,joint.quaternion.clone());
      const world=joint.getWorldQuaternion(new THREE.Quaternion());
      const parent=joint.parent!.getWorldQuaternion(new THREE.Quaternion());
      const desired=parent.invert().multiply(delta.multiply(world));
      joint.quaternion.slerp(desired,blend);joint.updateWorldMatrix(false,true);
    };
    // Two short CCD passes, using actual rig segment lengths rather than stretched limbs.
    for(let pass=0;pass<2;pass++)for(const joint of [fore,upper]) {
      const origin=joint.getWorldPosition(new THREE.Vector3());
      const from=hand.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
      const to=target.clone().sub(origin).normalize();
      rotateWorld(joint,new THREE.Quaternion().setFromUnitVectors(from,to),weight);
    }
    const forward=(gesture?new THREE.Vector3(...gesture.direction):new THREE.Vector3(1,.04+recoil*.8,0)).normalize().transformDirection(this.root.matrixWorld);
    const heldAxis=(motion.weapon === 'gravewhisper' ? new THREE.Vector3(-1,0,0) : new THREE.Vector3(0,0,1)).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
    rotateWorld(hand,new THREE.Quaternion().setFromUnitVectors(heldAxis,forward),weight);
    // The supporting palm follows the real shaft. Rotate joints only; never stretch bones.
    if(gesture?.support) {
      const left=this.bone('LeftHand'), lower=this.bone('LeftForeArm'), shoulder=this.bone('LeftArm');
      if(left&&lower&&shoulder) {
        const grip=hand.getWorldPosition(new THREE.Vector3()).addScaledVector(forward,gesture.supportOffset);
        for(let pass=0;pass<3;pass++)for(const joint of [lower,shoulder]) {
          const origin=joint.getWorldPosition(new THREE.Vector3());
          const from=left.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
          const to=grip.clone().sub(origin).normalize();
          rotateWorld(joint,new THREE.Quaternion().setFromUnitVectors(from,to),weight*.8);
        }
      }
    }
  }
  dispose() {
    this.staffFocus?.traverse(n=>{if(n instanceof THREE.Mesh)n.geometry.dispose();});
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
