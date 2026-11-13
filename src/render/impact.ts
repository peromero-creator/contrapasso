import * as THREE from "three";

/** Contact accents: a camera-facing flare and streaks thrown along the blow. Render-only. */
interface Flare { sprite: THREE.Sprite; life: number; size: number }
interface Streak { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; life: number; max: number; vx: number; vz: number; len: number }

const FLARE_TIME = 0.11;

function flareTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const core = g.createRadialGradient(64, 64, 0, 64, 64, 34);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.35, "rgba(255,255,255,.55)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = core;
  g.fillRect(0, 0, 128, 128);
  g.translate(64, 64);
  for (let i = 0; i < 4; i++) {
    const spike = g.createLinearGradient(0, 0, 62, 0);
    spike.addColorStop(0, "rgba(255,255,255,.95)");
    spike.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = spike;
    g.beginPath();
    g.moveTo(0, -4.5);
    g.lineTo(62, 0);
    g.lineTo(0, 4.5);
    g.fill();
    g.rotate(Math.PI / 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft round blot: dust when tinted dark, a halo when added as light. */
export function softTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const g = c.getContext("2d")!;
  const blot = g.createRadialGradient(48, 48, 0, 48, 48, 48);
  blot.addColorStop(0, "rgba(255,255,255,1)");
  blot.addColorStop(0.45, "rgba(255,255,255,.55)");
  blot.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = blot;
  g.fillRect(0, 0, 96, 96);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A shock ring: a hard bright lip that falls away inward, like ink pushed across stone. */
function ringTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const lip = g.createRadialGradient(128, 128, 60, 128, 128, 127);
  lip.addColorStop(0, "rgba(255,255,255,0)");
  lip.addColorStop(0.7, "rgba(255,255,255,0)");
  lip.addColorStop(0.9, "rgba(255,255,255,.16)");
  lip.addColorStop(0.955, "rgba(255,255,255,1)");
  lip.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = lip;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Puff { sprite: THREE.Sprite; life: number; max: number; vx: number; vz: number; size: number }
interface Ring { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; life: number; radius: number }
const RING_TIME = 0.42;

export class ImpactFx {
  private puffs: Puff[] = [];
  private rings: Ring[] = [];
  private soft = softTexture();
  private ringTex = ringTexture();
  private ringGeo = new THREE.PlaneGeometry(2, 2);
  private flares: Flare[] = [];
  private streaks: Streak[] = [];
  private tex = flareTexture();
  private geo = new THREE.PlaneGeometry(1, 0.085);
  constructor(private scene: THREE.Scene) {}

  hit(x: number, z: number, dx: number, dz: number, power: number, color: number, white = 0.18) {
    let f = this.flares.find((q) => q.life <= 0);
    if (!f && this.flares.length < 14) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.tex, transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      }));
      sprite.renderOrder = 18;
      this.scene.add(sprite);
      f = { sprite, life: 0, size: 1 };
      this.flares.push(f);
    }
    if (f) {
      f.life = FLARE_TIME;
      f.size = 1.9 * power;
      f.sprite.material.color.setHex(color).lerp(new THREE.Color(0xffffff), white);
      f.sprite.material.rotation = Math.random() * Math.PI;
      f.sprite.position.set(x - dx * 0.25, 1.15, z - dz * 0.25);
      f.sprite.visible = true;
    }
    const n = power > 1.2 ? 6 : 4;
    for (let i = 0; i < n; i++) {
      let s = this.streaks.find((q) => q.life <= 0);
      if (!s) {
        if (this.streaks.length >= 48) break;
        const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
          transparent: true, depthWrite: false, depthTest: false,
          blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
        }));
        mesh.renderOrder = 17;
        this.scene.add(mesh);
        s = { mesh, life: 0, max: 1, vx: 0, vz: 0, len: 1 };
        this.streaks.push(s);
      }
      const spread = (Math.random() - 0.5) * 1.5;
      const cs = Math.cos(spread), sn = Math.sin(spread);
      const ux = dx * cs - dz * sn, uz = dx * sn + dz * cs;
      const speed = (9 + Math.random() * 11) * power;
      s.vx = ux * speed;
      s.vz = uz * speed;
      s.len = (0.55 + Math.random() * 0.6) * power;
      s.max = s.life = 0.1 + Math.random() * 0.09;
      s.mesh.material.color.setHex(color).lerp(new THREE.Color(0xfff3dc), white * 0.7);
      s.mesh.position.set(x, 0.85 + Math.random() * 0.6, z);
      s.mesh.rotation.set(-Math.PI / 2, 0, Math.atan2(-uz, ux));
      s.mesh.visible = true;
    }
  }

  /** Dust kicked off the floor: soft blots that swell, drift and thin out. */
  puff(x: number, z: number, count: number, color: number, speed: number, size = 1) {
    for (let i = 0; i < count; i++) {
      let p = this.puffs.find((q) => q.life <= 0);
      if (!p) {
        if (this.puffs.length >= 56) return;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.soft, transparent: true, depthWrite: false, toneMapped: false }));
        this.scene.add(sprite);
        p = { sprite, life: 0, max: 1, vx: 0, vz: 0, size: 1 };
        this.puffs.push(p);
      }
      const a = Math.random() * Math.PI * 2, s = speed * (0.45 + Math.random() * 0.75);
      p.vx = Math.cos(a) * s;
      p.vz = Math.sin(a) * s;
      p.size = size * (0.7 + Math.random() * 0.6);
      p.max = p.life = 0.38 + Math.random() * 0.3;
      p.sprite.material.color.setHex(color);
      p.sprite.material.rotation = Math.random() * Math.PI;
      p.sprite.position.set(x + Math.cos(a) * 0.15, 0.16, z + Math.sin(a) * 0.15);
      p.sprite.visible = true;
    }
  }

  ring(x: number, z: number, radius: number, color = 0xffcd7e) {
    let r = this.rings.find((q) => q.life <= 0);
    if (!r) {
      if (this.rings.length >= 20) r = this.rings.reduce((a, b) => (a.life < b.life ? a : b));
      else {
        const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ map: this.ringTex, transparent: true, depthWrite: false, toneMapped: false }));
        mesh.rotation.x = -Math.PI / 2;
        this.scene.add(mesh);
        r = { mesh, life: 0, radius: 1 };
        this.rings.push(r);
      }
    }
    r.life = RING_TIME;
    r.radius = radius;
    r.mesh.material.color.setHex(color);
    r.mesh.position.set(x, 0.07, z);
    r.mesh.scale.setScalar(0.01);
    r.mesh.visible = true;
  }

  update(dt: number) {
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = Math.max(0, p.life / p.max);
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.position.y += dt * 0.5;
      p.vx *= 1 - Math.min(1, dt * 4);
      p.vz *= 1 - Math.min(1, dt * 4);
      p.sprite.scale.setScalar(p.size * (0.45 + 0.95 * (1 - k)));
      p.sprite.material.opacity = 0.5 * k;
      if (p.life <= 0) p.sprite.visible = false;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const k = Math.max(0, r.life / RING_TIME), out = 1 - k * k * k;
      r.mesh.scale.setScalar(Math.max(0.01, r.radius * out));
      r.mesh.material.opacity = 0.55 * k;
      if (r.life <= 0) r.mesh.visible = false;
    }
    for (const f of this.flares) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const k = Math.max(0, f.life / FLARE_TIME);
      const grow = 0.45 + 0.55 * (1 - k * k);
      f.sprite.scale.setScalar(f.size * grow);
      f.sprite.material.opacity = k * 0.72;
      if (f.life <= 0) f.sprite.visible = false;
    }
    for (const s of this.streaks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const k = Math.max(0, s.life / s.max);
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.z += s.vz * dt;
      s.vx *= 1 - Math.min(1, dt * 7);
      s.vz *= 1 - Math.min(1, dt * 7);
      s.mesh.scale.set(s.len * (0.35 + 0.65 * k), 0.5 + 0.5 * k, 1);
      s.mesh.material.opacity = k;
      if (s.life <= 0) s.mesh.visible = false;
    }
  }

  clear() {
    for (const p of this.puffs) { p.life = 0; p.sprite.visible = false; }
    for (const r of this.rings) { r.life = 0; r.mesh.visible = false; }
    for (const f of this.flares) { f.life = 0; f.sprite.visible = false; }
    for (const s of this.streaks) { s.life = 0; s.mesh.visible = false; }
  }
}
