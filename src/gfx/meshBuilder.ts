import { BufferAttribute, BufferGeometry, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RGB } from '../engine/color';

// Assembles flat-shaded low-poly models from primitives with per-part colour and glow.

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();
const _p = new Vector3();

export function mat(
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] | number = 1,
): Matrix4 {
  const s = typeof scale === 'number' ? [scale, scale, scale] : scale;
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
  return new Matrix4().compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(s[0], s[1], s[2]));
}

export class MeshBuilder {
  private parts: BufferGeometry[] = [];

  add(geo: BufferGeometry, color: RGB, m?: Matrix4, glow = 0): this {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) g.applyMatrix4(m);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position') g.deleteAttribute(name);
    }
    g.computeVertexNormals();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const gl = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      col[i * 3] = color[0];
      col[i * 3 + 1] = color[1];
      col[i * 3 + 2] = color[2];
      gl[i] = glow;
    }
    g.setAttribute('aColor', new BufferAttribute(col, 3));
    g.setAttribute('aGlow', new BufferAttribute(gl, 1));
    this.parts.push(g);
    geo.dispose();
    return this;
  }

  /** Mirror the last `count` parts across the X axis (for symmetric models). */
  mirrorX(count: number): this {
    const src = this.parts.slice(-count);
    for (const p of src) {
      const g = p.clone();
      g.applyMatrix4(_m.makeScale(-1, 1, 1));
      // flip winding after the mirror
      const pos = g.attributes.position as BufferAttribute;
      for (let i = 0; i < pos.count; i += 3) {
        for (const attr of Object.values(g.attributes) as BufferAttribute[]) {
          const k = attr.itemSize;
          for (let c = 0; c < k; c++) {
            const a = attr.array[(i + 1) * k + c];
            attr.array[(i + 1) * k + c] = attr.array[(i + 2) * k + c];
            attr.array[(i + 2) * k + c] = a;
          }
        }
      }
      g.computeVertexNormals();
      this.parts.push(g);
    }
    return this;
  }

  get count(): number {
    return this.parts.length;
  }

  build(): BufferGeometry {
    const merged = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

/** Displace vertices of a geometry with a function (used for rocks). */
export function displace(geo: BufferGeometry, fn: (x: number, y: number, z: number) => number): BufferGeometry {
  const pos = geo.attributes.position as BufferAttribute;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const l = v.length();
    if (l < 1e-6) continue;
    const k = fn(v.x / l, v.y / l, v.z / l);
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  return geo;
}
