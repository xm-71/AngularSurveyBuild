// Cube-sphere parameterisation: 6 faces, each with (s, t) in [-1, 1].
// Face axes are chosen so that u x v = n (outward), which keeps triangle winding
// consistent on every face.

export interface FaceAxes {
  n: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
}

export const FACES: FaceAxes[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

/**
 * Maps face coordinates to a unit direction (writes into out[o..o+2]).
 * Coordinates outside [-1, 1] wrap onto the neighbouring face, which is used for
 * the one-vertex border ring needed for seamless normals.
 */
export function faceToDir(face: number, s: number, t: number, out: Float64Array | number[], o = 0): void {
  const f = FACES[face];
  let x = f.n[0] + s * f.u[0] + t * f.v[0];
  let y = f.n[1] + s * f.u[1] + t * f.v[1];
  let z = f.n[2] + s * f.u[2] + t * f.v[2];
  const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  x /= m;
  y /= m;
  z /= m;
  const x2 = x * x, y2 = y * y, z2 = z * z;
  let sx = x * Math.sqrt(Math.max(0, 1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3));
  let sy = y * Math.sqrt(Math.max(0, 1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3));
  let sz = z * Math.sqrt(Math.max(0, 1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3));
  const l = Math.sqrt(sx * sx + sy * sy + sz * sz);
  sx /= l;
  sy /= l;
  sz /= l;
  out[o] = sx;
  out[o + 1] = sy;
  out[o + 2] = sz;
}

/** Inverse mapping: unit direction -> [face, s, t] (approximate inverse of the spherified cube). */
export function dirToFace(x: number, y: number, z: number): [number, number, number] {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let face: number;
  if (ax >= ay && ax >= az) face = x > 0 ? 0 : 1;
  else if (ay >= az) face = y > 0 ? 2 : 3;
  else face = z > 0 ? 4 : 5;
  const f = FACES[face];
  // Initial guess: gnomonic projection, then refine with a few Newton-free fixed-point steps.
  const dn = x * f.n[0] + y * f.n[1] + z * f.n[2];
  let s = (x * f.u[0] + y * f.u[1] + z * f.u[2]) / dn;
  let t = (x * f.v[0] + y * f.v[1] + z * f.v[2]) / dn;
  const tmp = [0, 0, 0];
  for (let i = 0; i < 6; i++) {
    faceToDir(face, s, t, tmp);
    const dn2 = tmp[0] * f.n[0] + tmp[1] * f.n[1] + tmp[2] * f.n[2];
    const s2 = (tmp[0] * f.u[0] + tmp[1] * f.u[1] + tmp[2] * f.u[2]) / dn2;
    const t2 = (tmp[0] * f.v[0] + tmp[1] * f.v[1] + tmp[2] * f.v[2]) / dn2;
    const sg = (x * f.u[0] + y * f.u[1] + z * f.u[2]) / dn;
    const tg = (x * f.v[0] + y * f.v[1] + z * f.v[2]) / dn;
    s += sg - s2;
    t += tg - t2;
  }
  return [face, Math.max(-1, Math.min(1, s)), Math.max(-1, Math.min(1, t))];
}

/** Arc length (m) of one side of a node at the given level on a sphere of radius r. */
export function nodeSize(radius: number, level: number): number {
  return (radius * Math.PI * 0.5) / Math.pow(2, level);
}
