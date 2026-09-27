import { Simplex } from '../engine/noise';
import { hash4, hashFloat, hashInt } from '../engine/rng';
import type { PlanetParams, TerrainShape, Palette } from './planetTypes';

// The planet surface function. It is evaluated identically on the main thread
// (collisions, placement) and in the generator workers (meshes), so gameplay always
// matches what is drawn.

function sstep(a: number, b: number, x: number): number {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export class TerrainGenerator {
  readonly params: PlanetParams;
  readonly radius: number;
  readonly sea: number;
  readonly hasSea: boolean;
  private n: Simplex;
  private o: Float64Array;
  private s: TerrainShape;
  private pal: Palette;
  private refLevel: number;

  constructor(params: PlanetParams) {
    this.params = params;
    this.radius = params.radius;
    this.hasSea = params.seaLevel !== null;
    this.sea = params.seaLevel ?? -1e9;
    this.n = new Simplex(params.seed);
    this.s = params.shape;
    this.pal = params.palette;
    this.o = new Float64Array(48);
    let h = params.seed >>> 0;
    for (let i = 0; i < this.o.length; i++) {
      h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) + 0x6b43a9b5;
      this.o[i] = ((h >>> 0) / 4294967296) * 200 - 100;
    }
    this.refLevel = params.seaLevel ?? (params.minHeight * 0.6 + params.maxHeight * 0.4);
  }

  /** Terrain height in meters above the base radius, for a unit direction. */
  height(dx: number, dy: number, dz: number): number {
    const s = this.s;
    const n = this.n;
    const o = this.o;
    let qx = dx, qy = dy, qz = dz;
    if (s.warp > 0) {
      const f = 1.7;
      qx += n.noise3(dx * f + o[0], dy * f + o[1], dz * f + o[2]) * s.warp;
      qy += n.noise3(dx * f + o[3], dy * f + o[4], dz * f + o[5]) * s.warp;
      qz += n.noise3(dx * f + o[6], dy * f + o[7], dz * f + o[8]) * s.warp;
    }
    const cf = s.contFreq;
    const c = n.fbm(qx * cf + o[9], qy * cf + o[10], qz * cf + o[11], s.contOctaves, 2.0, 0.5) + s.contBias;
    let h = c * s.contAmp;

    const mm = sstep(-0.08, 0.28, c + 0.3 * n.noise3(qx * 2.3 + o[12], qy * 2.3 + o[13], qz * 2.3 + o[14]));
    if (s.mountAmp > 0 && mm > 0) {
      const mf = s.mountFreq;
      const r = n.ridged(qx * mf + o[15], qy * mf + o[16], qz * mf + o[17], 5, 2.05, 0.5, s.mountSharp);
      h += r * r * s.mountAmp * mm;
    }

    const hf = s.hillFreq;
    h += n.fbm(qx * hf + o[18], qy * hf + o[19], qz * hf + o[20], 4, 2.1, 0.5) * s.hillAmp * (0.35 + 0.65 * mm);

    if (s.canyon > 0) {
      const kf = cf * 3.1;
      const v = Math.abs(n.fbm(qx * kf + o[21], qy * kf + o[22], qz * kf + o[23], 3, 2.0, 0.5));
      const carve = 1 - sstep(0.0, 0.05 + 0.08 * s.canyon, v);
      h -= carve * s.canyonDepth * sstep(-0.15, 0.1, c);
    }

    if (s.plateau > 0 && h > s.plateau) h = s.plateau + (h - s.plateau) * 0.1;

    if (s.terraceStep > 0) {
      const t = h / s.terraceStep;
      const fl = Math.floor(t);
      const fr = t - fl;
      const k = 1 + s.terraceSharp * 7;
      const shaped = fr < 0.5 ? 0.5 * Math.pow(2 * fr, k) : 1 - 0.5 * Math.pow(2 * (1 - fr), k);
      h = (fl + shaped) * s.terraceStep;
    }

    if (s.spires > 0) {
      const sf = s.hillFreq * 1.3;
      const v = n.noise3(dx * sf + o[24], dy * sf + o[25], dz * sf + o[26]);
      if (v > 0.45) {
        const t = (v - 0.45) / 0.55;
        h += t * t * (3 - 2 * t) * s.spireHeight * s.spires;
      }
    }

    if (s.craterDensity > 0) h += this.craters(dx, dy, dz);

    const df = s.detailFreq;
    h += n.fbm(dx * df + o[27], dy * df + o[28], dz * df + o[29], 4, 2.3, 0.45) * s.detailAmp;
    return h;
  }

  private craters(x: number, y: number, z: number): number {
    const s = this.s;
    let total = 0;
    for (let scale = 0; scale < 2; scale++) {
      const F = scale === 0 ? 14 : 45;
      const depth = s.craterDepth * (scale === 0 ? 1 : 0.35);
      const px = x * F, py = y * F, pz = z * F;
      const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          for (let c = -1; c <= 1; c++) {
            const cx = ix + a, cy = iy + b, cz = iz + c;
            const hh = hash4(cx, cy, cz, (this.params.seed + scale * 7919) | 0);
            if (hashFloat(hh) > s.craterDensity) continue;
            const fx = cx + hashFloat(hashInt(hh + 1));
            const fy = cy + hashFloat(hashInt(hh + 2));
            const fz = cz + hashFloat(hashInt(hh + 3));
            const r = 0.18 + 0.32 * hashFloat(hashInt(hh + 4));
            const ddx = px - fx, ddy = py - fy, ddz = pz - fz;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 > r * r * 2.6) continue;
            const t = Math.sqrt(d2) / r;
            const bowl = t < 1 ? t * t - 1 : 0;
            const e = (t - 1) / 0.28;
            const rim = Math.exp(-e * e) * 0.3;
            total += (bowl + rim) * depth * r;
          }
        }
      }
    }
    return total;
  }

  /** Moisture 0..1, drives vegetation and ground color variation. */
  moisture(dx: number, dy: number, dz: number): number {
    const o = this.o;
    const v = this.n.fbm(dx * 3.2 + o[30], dy * 3.2 + o[31], dz * 3.2 + o[32], 3, 2.2, 0.5);
    const m = 0.5 + v * 0.9 + this.params.moistureBias;
    return m < 0 ? 0 : m > 1 ? 1 : m;
  }

  /** Coldness 0..1+ (snow where > ~0.5). */
  coldness(dy: number, hRel: number): number {
    const lat = Math.abs(dy);
    return lat * lat * this.params.polarCaps * 1.4 + Math.max(0, hRel) / this.params.snowLine;
  }

  /**
   * Surface color (sRGB 0..1) and rockiness for a vertex.
   * slope = dot(normal, up) (1 = flat).
   */
  color(dx: number, dy: number, dz: number, h: number, slope: number, out: Float64Array): void {
    const P = this.pal;
    const n = this.n;
    const o = this.o;
    const m = this.moisture(dx, dy, dz);
    const hRel = h - this.refLevel;
    const vn = n.noise3(dx * 90 + o[33], dy * 90 + o[34], dz * 90 + o[35]);
    const fine = n.noise3(dx * 700 + o[36], dy * 700 + o[37], dz * 700 + o[38]);

    let r: number, g: number, b: number;
    // lowland blend by moisture
    const mt = sstep(0.3, 0.7, m + vn * 0.12);
    r = P.low1[0] + (P.low2[0] - P.low1[0]) * mt;
    g = P.low1[1] + (P.low2[1] - P.low1[1]) * mt;
    b = P.low1[2] + (P.low2[2] - P.low1[2]) * mt;

    // highlands
    const span = Math.max(50, this.params.maxHeight - this.refLevel);
    const ht = sstep(0.25, 0.65, hRel / span + vn * 0.08);
    r += (P.high[0] - r) * ht;
    g += (P.high[1] - g) * ht;
    b += (P.high[2] - b) * ht;

    // beaches and sea floor
    if (this.hasSea) {
      const d = h - this.sea;
      if (d < 0) {
        const t = sstep(0, 40, -d);
        r = P.beach[0] + (P.seabed[0] - P.beach[0]) * t;
        g = P.beach[1] + (P.seabed[1] - P.beach[1]) * t;
        b = P.beach[2] + (P.seabed[2] - P.beach[2]) * t;
      } else {
        const t = sstep(1.5, 5 + vn * 3, d);
        r = P.beach[0] + (r - P.beach[0]) * t;
        g = P.beach[1] + (g - P.beach[1]) * t;
        b = P.beach[2] + (b - P.beach[2]) * t;
      }
    }

    // rock on steep slopes, with height strata
    const rock = sstep(0.86, 0.66, slope + fine * 0.03);
    if (rock > 0) {
      const strata = 0.5 + 0.5 * Math.sin(h * 0.09 + vn * 2.5);
      const rr = P.rock1[0] + (P.rock2[0] - P.rock1[0]) * strata;
      const rg = P.rock1[1] + (P.rock2[1] - P.rock1[1]) * strata;
      const rb = P.rock1[2] + (P.rock2[2] - P.rock1[2]) * strata;
      r += (rr - r) * rock;
      g += (rg - g) * rock;
      b += (rb - b) * rock;
    }

    // snow / peak cover on flatter cold ground
    const cold = this.coldness(dy, hRel) + vn * 0.15;
    const snow = sstep(0.45, 0.62, cold) * sstep(0.55, 0.8, slope);
    if (snow > 0) {
      r += (P.peak[0] - r) * snow;
      g += (P.peak[1] - g) * snow;
      b += (P.peak[2] - b) * snow;
    }

    const v = 1 + fine * 0.07;
    out[0] = r * v;
    out[1] = g * v;
    out[2] = b * v;
    out[3] = rock;
    out[4] = snow;
  }

  /** Height of the walkable surface (sea surface counts when frozen). */
  groundHeight(dx: number, dy: number, dz: number): number {
    const h = this.height(dx, dy, dz);
    if (this.hasSea && this.params.liquid === 'ice' && h < this.sea) return this.sea;
    return h;
  }
}
