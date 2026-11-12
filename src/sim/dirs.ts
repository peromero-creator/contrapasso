// Direction table shared by the browser and the referee server.
// Values are rounded so every JS engine produces the same numbers.
export const DIRS = 1024;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
export const DX = new Float64Array(DIRS);
export const DZ = new Float64Array(DIRS);
for (let i = 0; i < DIRS; i++) {
  const a = (i / DIRS) * Math.PI * 2;
  DX[i] = r6(Math.cos(a));
  DZ[i] = r6(Math.sin(a));
}

/** Input side only: nearest direction index for a vector on the ground plane. */
export function dirIndex(x: number, z: number): number {
  const a = Math.atan2(z, x);
  return ((Math.round((a / (Math.PI * 2)) * DIRS) % DIRS) + DIRS) % DIRS;
}

export const dirAngle = (i: number) => (i / DIRS) * Math.PI * 2;
