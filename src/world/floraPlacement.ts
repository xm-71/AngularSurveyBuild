import { hash2, hash5, Rng } from '../engine/rng';
import { faceToDir, nodeSize } from './cubeSphere';
import type { TerrainGenerator } from './terrain';

export interface FloraJob {
  planetId: string;
  face: number;
  level: number;
  x: number;
  y: number;
  density: number;
  grass: boolean;
}

/** x, y, z (relative to origin), species, scale, rotation, r, g, b */
export const FLORA_STRIDE = 9;

export interface FloraResult {
  origin: [number, number, number];
  data: Float32Array;
  ids: Uint32Array;
  count: number;
}

const colorTmp = new Float64Array(5);
const tmpA = new Float64Array(3);
const tmpB = new Float64Array(3);
const tmpC = new Float64Array(3);

export function buildFloraCell(gen: TerrainGenerator, job: FloraJob): FloraResult {
  const P = gen.params;
  const R = gen.radius;
  const size = 2 / Math.pow(2, job.level);
  const s0 = -1 + job.x * size;
  const t0 = -1 + job.y * size;
  const cdir = new Float64Array(3);
  faceToDir(job.face, s0 + size / 2, t0 + size / 2, cdir);
  const ox = cdir[0] * R, oy = cdir[1] * R, oz = cdir[2] * R;
  const sizeM = nodeSize(R, job.level);
  const area = sizeM * sizeM;
  const cellSeed = hash5(P.seed, job.face, job.level, job.x, job.y);
  // parameter-space step of roughly 1.5 m for slope estimation
  const delta = 1.5 / (R * Math.PI * 0.25);

  const out: number[] = [];
  const ids: number[] = [];

  for (let si = 0; si < P.flora.length; si++) {
    const sp = P.flora[si];
    const isGrass = sp.kind === 'grass';
    if (isGrass && !job.grass) continue;
    const sr = new Rng(hash2(cellSeed, si * 131 + 7));
    const expected = (sp.density * area) / 1000;
    const maxCount = Math.min(isGrass ? 1400 : 400, Math.floor(expected) + (sr.next() < expected % 1 ? 1 : 0));
    if (maxCount <= 0) continue;
    const nClusters = 1 + Math.floor(sr.next() * 3);
    const clusters: number[] = [];
    for (let c = 0; c < nClusters; c++) clusters.push(sr.next(), sr.next());
    const clusterRadius = 0.08 + sr.next() * 0.15;
    const living = sp.resource === 'carbon' || isGrass || sp.kind === 'oxygenPlant';

    for (let c = 0; c < maxCount; c++) {
      const r = new Rng(hash2(cellSeed, (si << 16) + c));
      const keep = r.next();
      let u: number, v: number;
      if (r.next() < sp.cluster) {
        const k = Math.floor(r.next() * nClusters);
        u = clusters[k * 2] + r.gaussian() * clusterRadius;
        v = clusters[k * 2 + 1] + r.gaussian() * clusterRadius;
      } else {
        u = r.next();
        v = r.next();
      }
      const scaleRnd = r.next();
      const rot = r.next() * Math.PI * 2;
      const tintRnd = r.next();
      const moistRnd = r.next();
      if (keep > job.density) continue;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const s = s0 + u * size;
      const t = t0 + v * size;
      faceToDir(job.face, s, t, tmpA);
      const dx = tmpA[0], dy = tmpA[1], dz = tmpA[2];
      const h = gen.height(dx, dy, dz);
      if (gen.hasSea && h < gen.sea + 0.4) continue;
      const m = gen.moisture(dx, dy, dz);
      const edge = 0.08 * (moistRnd - 0.5);
      if (m < sp.moistMin + edge || m > sp.moistMax + edge) continue;
      if (living) {
        const cold = gen.coldness(dy, h - (gen.hasSea ? gen.sea : 0));
        if (cold > 0.62 && sp.kind !== 'conifer') continue;
      }

      // slope from two neighbouring samples
      faceToDir(job.face, s + delta, t, tmpB);
      faceToDir(job.face, s, t + delta, tmpC);
      const hb = gen.height(tmpB[0], tmpB[1], tmpB[2]);
      const hc = gen.height(tmpC[0], tmpC[1], tmpC[2]);
      const r0 = R + h, rb = R + hb, rc = R + hc;
      const ax = tmpB[0] * rb - dx * r0, ay = tmpB[1] * rb - dy * r0, az = tmpB[2] * rb - dz * r0;
      const bx = tmpC[0] * rc - dx * r0, by = tmpC[1] * rc - dy * r0, bz = tmpC[2] * rc - dz * r0;
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const slope = Math.abs(nx * dx + ny * dy + nz * dz);
      if (slope < sp.slopeMax) continue;

      const scale = sp.scaleMin + (sp.scaleMax - sp.scaleMin) * Math.pow(scaleRnd, 1.5);
      let cr = 1, cg = 1, cb = 1;
      if (isGrass) {
        gen.color(dx, dy, dz, h, slope, colorTmp);
        cr = colorTmp[0];
        cg = colorTmp[1];
        cb = colorTmp[2];
        if (colorTmp[3] > 0.5 || colorTmp[4] > 0.5) continue; // no grass on rock or snow
      } else {
        const tv = 0.88 + tintRnd * 0.24;
        cr = cg = cb = tv;
      }
      out.push(dx * r0 - ox, dy * r0 - oy, dz * r0 - oz, si, scale, rot, cr, cg, cb);
      ids.push(((si & 0xff) << 20) | (c & 0xfffff));
    }
  }

  return {
    origin: [ox, oy, oz],
    data: new Float32Array(out),
    ids: new Uint32Array(ids),
    count: ids.length,
  };
}
