import * as THREE from "three";
import { ARENA_HX, ARENA_HZ } from "../sim/world";

/** Cosmetic, bounded pools: never changes combat or uses additive light. */
export class Gore {
  private parts: {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    max: number;
    chunk: boolean;
    bounced: boolean;
  }[] = [];
  private clot = new THREE.IcosahedronGeometry(0.09, 0);
  private fragment = new THREE.TetrahedronGeometry(0.17, 0);
  constructor(private scene: THREE.Scene) {}
  spray(x: number, z: number, count: number, dx: number, dz: number) {
    const length = Math.hypot(dx, dz) || 1;
    for (let i = 0; i < count; i++)
      this.emit(x, z, false, dx / length, dz / length);
  }
  shatter(x: number, z: number, count: number) {
    for (let i = 0; i < count; i++) this.emit(x, z, true, 0, 0);
  }
  private emit(x: number, z: number, chunk: boolean, dx: number, dz: number) {
    let p = this.parts.find((p) => p.life <= 0);
    if (!p) {
      if (this.parts.length >= 180)
        p = this.parts.reduce((a, b) => (a.life < b.life ? a : b));
      else {
        const mesh = new THREE.Mesh(
          this.clot,
          new THREE.MeshStandardMaterial({
            color: 0x6e0c17,
            roughness: 0.72,
            metalness: 0,
            transparent: true,
          }),
        );
        this.scene.add(mesh);
        p = {
          mesh,
          vx: 0,
          vy: 0,
          vz: 0,
          life: 0,
          max: 0,
          chunk: false,
          bounced: false,
        };
        this.parts.push(p);
      }
    }
    const a = Math.random() * Math.PI * 2,
      speed = 1.3 + Math.random() * 3.5;
    p.vx = Math.cos(a) * speed + dx * 2.4;
    p.vz = Math.sin(a) * speed + dz * 2.4;
    p.vy = 2 + Math.random() * 3.6;
    p.chunk = chunk;
    p.bounced = false;
    p.life = p.max = chunk ? 12 + Math.random() * 7 : 1.1 + Math.random() * 0.6;
    p.mesh.geometry = chunk ? this.fragment : this.clot;
    p.mesh.material.color.setHex(
      chunk && Math.random() < 0.25
        ? 0x948576
        : Math.random() < 0.5
          ? 0x6e0c17
          : 0x9b1d28,
    );
    p.mesh.material.opacity = 1;
    p.mesh.scale.set(
      chunk ? 1.1 : 0.65,
      chunk ? 0.65 : 1.6,
      chunk ? 0.8 : 0.65,
    );
    p.mesh.position.set(x, 0.7 + Math.random() * 0.5, z);
    p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    p.mesh.visible = true;
  }
  update(dt: number) {
    for (const p of this.parts) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.mesh.position.y > 0.055 || p.vy > 0) {
        p.vy -= 16 * dt;
        p.mesh.position.x = Math.max(
          -ARENA_HX + 0.3,
          Math.min(ARENA_HX - 0.3, p.mesh.position.x + p.vx * dt),
        );
        p.mesh.position.z = Math.max(
          -ARENA_HZ + 0.3,
          Math.min(ARENA_HZ - 0.3, p.mesh.position.z + p.vz * dt),
        );
        p.mesh.position.y += p.vy * dt;
        p.mesh.rotation.x += dt * 5;
        p.mesh.rotation.z += dt * 3;
        if (p.mesh.position.y <= 0.055) {
          p.mesh.position.y = 0.055;
          if (p.chunk && !p.bounced) {
            p.vy = Math.abs(p.vy) * 0.22;
            p.vx *= 0.35;
            p.vz *= 0.35;
            p.bounced = true;
          } else {
            p.vy = 0;
            p.mesh.scale.y = p.chunk ? 0.45 : 0.18;
          }
        }
      }
      p.mesh.material.opacity = Math.min(
        1,
        Math.max(0, p.life / (p.chunk ? 2 : 0.35)),
      );
      if (p.life <= 0) p.mesh.visible = false;
    }
  }
  clear() {
    for (const p of this.parts) {
      p.life = 0;
      p.mesh.visible = false;
    }
  }
}
