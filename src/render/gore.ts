import * as THREE from "three";
import { ARENA_HX, ARENA_HZ } from "../sim/world.ts";

/** Cosmetic, bounded pools: never changes combat or uses additive light. */
export class Gore {
  private parts: {
    mesh: THREE.Object3D;
    color: THREE.Color;
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
  private batches: { mesh: THREE.InstancedMesh; alpha: THREE.InstancedBufferAttribute }[];
  constructor(scene: THREE.Scene) {
    this.batches = [this.clot, this.fragment].map(geometry => {
      const alpha = new THREE.InstancedBufferAttribute(new Float32Array(180), 1).setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('partAlpha', alpha);
      const material = new THREE.MeshStandardMaterial({color: 0xffffff, roughness: .72, metalness: 0, transparent: true});
      material.onBeforeCompile = shader => {
        shader.vertexShader = 'attribute float partAlpha; varying float vPartAlpha;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPartAlpha = partAlpha;');
        shader.fragmentShader = 'varying float vPartAlpha;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vPartAlpha;');
      };
      material.customProgramCacheKey = () => 'gore-instance-alpha';
      const mesh = new THREE.InstancedMesh(geometry, material, 180);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0; mesh.frustumCulled = false;
      scene.add(mesh);
      return { mesh, alpha };
    });
  }
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
        const mesh = new THREE.Object3D();
        p = {
          mesh,
          color: new THREE.Color(),
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
    p.color.setHex(
      chunk && Math.random() < 0.25
        ? 0x948576
        : Math.random() < 0.5
          ? 0x6e0c17
          : 0x9b1d28,
    );
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
    for (const batch of this.batches) batch.mesh.count = 0;
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
      if (p.life <= 0) continue;
      const batch = this.batches[p.chunk ? 1 : 0], index = batch.mesh.count++;
      p.mesh.updateMatrix();
      batch.mesh.setMatrixAt(index, p.mesh.matrix);
      batch.mesh.setColorAt(index, p.color);
      batch.alpha.setX(index, Math.min(1, p.life / (p.chunk ? 2 : .35)));
    }
    for (const batch of this.batches) {
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
      batch.alpha.needsUpdate = true;
    }
  }
  clear() {
    for (const batch of this.batches) batch.mesh.count = 0;
    for (const p of this.parts) {
      p.life = 0;
      p.mesh.visible = false;
    }
  }
}
