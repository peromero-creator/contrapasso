import * as THREE from "three";
import { ModelLibrary, type AnimatedModel } from "./assets";
import { weapon, weaponId, type WeaponId } from "../sim/weapons";
import { attackClip, orientWeapon } from "./weapon-pose";

const models = new ModelLibrary();
const portraits = new Map<WeaponId, Promise<string>>();
let queue = Promise.resolve("");
const empty =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="640"><rect width="512" height="640" fill="#191714"/><path d="M160 520V190a96 96 0 0 1 192 0v330" fill="none" stroke="#504330" stroke-width="4"/></svg>',
  );
function chamber() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#191714");
  scene.add(new THREE.HemisphereLight(0xe2d6bc, 0x2e2020, 2));
  const key = new THREE.DirectionalLight(0xffddad, 4);
  key.position.set(-3, 5, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa6b9c1, 2);
  rim.position.set(4, 3, -2);
  scene.add(rim);
  const stone = new THREE.MeshStandardMaterial({
    color: 0x39312a,
    roughness: 1,
  });
  const bronze = new THREE.MeshStandardMaterial({
    color: 0x756147,
    roughness: 0.9,
  });
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.65, 0.16, 12),
    stone,
  );
  pedestal.position.y = -0.14;
  scene.add(pedestal);
  for (const x of [-1.55, 1.55]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.5, 0.22), stone);
    col.position.set(x, 1.6, -0.8);
    scene.add(col);
  }
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(1.55, 0.055, 5, 48, Math.PI),
    bronze,
  );
  arch.position.set(0, 3.3, -0.8);
  scene.add(arch);
  const seal = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.28, 64), bronze);
  seal.rotation.x = -Math.PI / 2;
  seal.position.y = -0.045;
  scene.add(seal);
  return scene;
}
async function portrait(id: WeaponId) {
  if (portraits.has(id)) return portraits.get(id)!;
  const promise = queue
    .then(async () => {
      const spec = weapon(id),
        model = await models.create(spec.model, spec.height);
      if (!model) return empty;
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(512, 640);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = chamber(),
        camera = new THREE.OrthographicCamera(
          -1.7,
          1.7,
          2.125,
          -2.125,
          0.1,
          30,
        );
      const item = new THREE.Group();
      item.add(model.root);
      scene.add(item);
      model.root.rotation.z = spec.ranged === "bolt" ? -0.15 : -0.22;
      model.root.rotation.y = spec.ranged === "bolt" ? -0.6 : -0.35;
      item.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(item),
        size = box.getSize(new THREE.Vector3());
      item.scale.setScalar(Math.min(2.65 / size.y, 2.3 / size.x));
      item.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(item);
      const center = box.getCenter(new THREE.Vector3());
      item.position.set(-center.x, 0.38 - box.min.y, -center.z);
      camera.position.set(0, 2.6, 8);
      camera.lookAt(0, 1.6, 0);
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL("image/webp", 0.94);
      model.dispose();
      scene.remove(item);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      return url;
    })
    .catch(() => empty);
  portraits.set(id, promise);
  queue = promise;
  return promise;
}
export function relicImage(id: WeaponId, alt = "") {
  return `<img data-relic-art="${id}" src="${empty}" alt="${alt}"/>`;
}
export function paintRelics(root: ParentNode = document) {
  for (const img of root.querySelectorAll<HTMLImageElement>(
    "img[data-relic-art]",
  )) {
    const id = weaponId(img.dataset.relicArt);
    void portrait(id).then((url) => {
      if (img.isConnected && img.dataset.relicArt === id) img.src = url;
    });
  }
}

/** Cosmetic preview only; no simulation, wallet, rewards or audio. */
export class RelicStage {
  private renderer: THREE.WebGLRenderer;
  private scene = chamber();
  private camera = new THREE.PerspectiveCamera(37, 1, 0.1, 30);
  private hero: AnimatedModel | null = null;
  private blade: AnimatedModel | null = null;
  private grip = new THREE.Group();
  private identity: WeaponId = "starter";
  private generation = 0;
  private timer = 0;
  private combo = 0;
  private playing = false;
  private last = 0;
  private ready: Promise<void>;
  constructor(
    private canvas: HTMLCanvasElement,
    private label: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.camera.position.set(3.5, 2.8, 5.5);
    this.camera.lookAt(0.25, 1.1, 0);
    this.ready = models.create("hero", 2.2).then((hero) => {
      if (!hero) {
        this.label.textContent = "Preview unavailable";
        return;
      }
      this.hero = hero;
      this.scene.add(hero.root);
      hero.root.rotation.y = -0.35;
      const hand = hero.bone("RightHand");
      if (hand) {
        hero.root.updateWorldMatrix(true, true);
        const s = hand.getWorldScale(new THREE.Vector3());
        this.grip.scale.set(1 / s.x, 1 / s.y, 1 / s.z);
        this.grip.rotation.y = -Math.PI / 2;
        hand.add(this.grip);
      }
      hero.play("idle");
    });
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }
  async select(id: WeaponId) {
    if (id === this.identity && this.blade) return;
    this.identity = id;
    const revision = ++this.generation;
    this.label.textContent = "Loading moves…";
    await this.ready;
    const spec = weapon(id),
      blade = await models.create(spec.model, spec.height);
    if (revision !== this.generation) {
      blade?.dispose();
      return;
    }
    if (this.blade) {
      this.grip.remove(this.blade.root);
      this.blade.dispose();
    }
    this.blade = blade;
    if (blade) {
      orientWeapon(blade.root, spec);
      this.grip.add(blade.root);
    }
    this.timer = 0;
    this.combo = 0;
    this.playing = false;
    this.hero?.play("idle");
    this.label.textContent = blade
      ? "SILENT MOVES PREVIEW"
      : "Model unavailable";
  }
  private tick(time: number) {
    requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, (time - this.last) / 1000 || 0);
    this.last = time;
    if (!this.canvas.checkVisibility() || document.hidden) return;
    const width = this.canvas.clientWidth,
      height = this.canvas.clientHeight;
    if (!width || !height || !this.hero || !this.blade) return;
    if (
      this.renderer.domElement.width !==
        Math.round(width * this.renderer.getPixelRatio()) ||
      this.renderer.domElement.height !==
        Math.round(height * this.renderer.getPixelRatio())
    ) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.playing) {
        this.hero.play("idle");
        this.timer = 0.8;
        this.playing = false;
      } else {
        this.combo++;
        this.hero.play(
          attackClip(this.identity, this.combo),
          weapon(this.identity).swing,
        );
        this.timer = weapon(this.identity).swing;
        this.playing = true;
        this.label.textContent = `${this.combo % 3 === 0 ? "III · FINISHER" : this.combo % 3 === 1 ? "I · OPENING" : "II · FOLLOW-UP"}`;
      }
    }
    this.hero.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
