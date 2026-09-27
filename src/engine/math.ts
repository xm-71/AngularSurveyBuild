import { Quaternion, Vector3 } from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const saturate = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, x: number): number => (x - a) / (b - a);
export const fract = (x: number): number => x - Math.floor(x);

export function smoothstep(a: number, b: number, x: number): number {
  const t = saturate((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing factor. */
export const dampFactor = (lambda: number, dt: number): number => 1 - Math.exp(-lambda * dt);
export const damp = (a: number, b: number, lambda: number, dt: number): number => lerp(a, b, dampFactor(lambda, dt));

export function dampVec3(v: Vector3, target: Vector3, lambda: number, dt: number): Vector3 {
  return v.lerp(target, dampFactor(lambda, dt));
}

export function dampQuat(q: Quaternion, target: Quaternion, lambda: number, dt: number): Quaternion {
  return q.slerp(target, dampFactor(lambda, dt));
}

export function moveToward(a: number, b: number, maxDelta: number): number {
  if (Math.abs(b - a) <= maxDelta) return b;
  return a + Math.sign(b - a) * maxDelta;
}

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Any unit vector perpendicular to n. */
export function anyPerpendicular(n: Vector3, out: Vector3): Vector3 {
  if (Math.abs(n.y) < 0.9) out.set(0, 1, 0);
  else out.set(1, 0, 0);
  return out.cross(n).normalize();
}

/** Project v onto the plane with normal n (n must be unit length). */
export function projectOnPlane(v: Vector3, n: Vector3, out: Vector3): Vector3 {
  const d = v.dot(n);
  return out.set(v.x - n.x * d, v.y - n.y * d, v.z - n.z * d);
}

/** Builds a quaternion from forward (-Z) and up (+Y) directions. */
const _m = { x: new Vector3(), y: new Vector3(), z: new Vector3() };
export function quatFromForwardUp(forward: Vector3, up: Vector3, out: Quaternion): Quaternion {
  const z = _m.z.copy(forward).multiplyScalar(-1).normalize();
  const x = _m.x.crossVectors(up, z);
  if (x.lengthSq() < 1e-10) anyPerpendicular(z, x);
  x.normalize();
  const y = _m.y.crossVectors(z, x);
  // rotation matrix columns x, y, z -> quaternion
  const m00 = x.x, m01 = y.x, m02 = z.x;
  const m10 = x.y, m11 = y.y, m12 = z.y;
  const m20 = x.z, m21 = y.z, m22 = z.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    out.set((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s);
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    out.set(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    out.set((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    out.set((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
  }
  return out.normalize();
}

/** Ray/sphere intersection. Returns [t0, t1] or null. rd must be normalized. */
export function raySphere(ro: Vector3, rd: Vector3, center: Vector3, radius: number): [number, number] | null {
  const ox = ro.x - center.x, oy = ro.y - center.y, oz = ro.z - center.z;
  const b = ox * rd.x + oy * rd.y + oz * rd.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100_000) return `${(m / 1000).toFixed(1)} km`;
  if (m < 10_000_000) return `${Math.round(m / 1000)} km`;
  return `${(m / 1_000_000).toFixed(1)} Mm`;
}

export function formatSpeed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} m/s`;
  return `${(ms / 1000).toFixed(1)} km/s`;
}

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
