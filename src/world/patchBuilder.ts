import { faceToDir, nodeSize } from './cubeSphere';
import type { TerrainGenerator } from './terrain';

export interface PatchJob {
  planetId: string;
  face: number;
  level: number;
  x: number;
  y: number;
  res: number;
}

export interface PatchResult {
  origin: [number, number, number];
  positions: Float32Array;
  normals: Int8Array;
  colors: Uint8Array;
  minH: number;
  maxH: number;
  bcenter: [number, number, number];
  bradius: number;
  water: Float32Array | null;
  waterDepth: Float32Array | null;
}

export function patchVertexCount(res: number): number {
  return (res + 1) * (res + 1) + 4 * (res + 1);
}

/** Border ring in counter-clockwise order (seen from outside): returns grid indices. */
export function borderIndices(res: number): number[] {
  const N = res;
  const W = N + 1;
  const out: number[] = [];
  for (let i = 0; i <= N; i++) out.push(0 * W + i); // bottom, +u
  for (let j = 0; j <= N; j++) out.push(j * W + N); // right, +v
  for (let i = N; i >= 0; i--) out.push(N * W + i); // top, -u
  for (let j = N; j >= 0; j--) out.push(j * W + 0); // left, -v
  return out;
}

/** Shared index buffer for every patch of a given resolution (grid + skirts). */
export function buildPatchIndices(res: number): Uint16Array | Uint32Array {
  const N = res;
  const W = N + 1;
  const tris: number[] = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * W + i;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      // alternate the diagonal for a more even look
      if ((i + j) % 2 === 0) {
        tris.push(a, b, c, b, d, c);
      } else {
        tris.push(a, b, d, a, d, c);
      }
    }
  }
  const border = borderIndices(N);
  const base = W * W;
  for (let e = 0; e < 4; e++) {
    for (let k = 0; k < N; k++) {
      const bi = e * W + k;
      const g0 = border[bi];
      const g1 = border[bi + 1];
      const s0 = base + bi;
      const s1 = base + bi + 1;
      tris.push(g0, s0, g1, g1, s0, s1);
    }
  }
  const V = patchVertexCount(N);
  return V > 65535 ? new Uint32Array(tris) : new Uint16Array(tris);
}

const colorTmp = new Float64Array(5);

export function buildPatch(gen: TerrainGenerator, job: PatchJob): PatchResult {
  const N = job.res;
  const E = N + 3;
  const W = N + 1;
  const R = gen.radius;
  const size = 2 / Math.pow(2, job.level);
  const s0 = -1 + job.x * size;
  const t0 = -1 + job.y * size;

  // Patch origin: center direction scaled to the base radius.
  const cdir = new Float64Array(3);
  faceToDir(job.face, s0 + size * 0.5, t0 + size * 0.5, cdir);
  const ox = cdir[0] * R, oy = cdir[1] * R, oz = cdir[2] * R;

  // Extended grid (one-vertex ring) of directions, heights and positions.
  const dirs = new Float64Array(E * E * 3);
  const hts = new Float64Array(E * E);
  const pos = new Float64Array(E * E * 3);
  let minH = Infinity;
  let maxH = -Infinity;
  for (let j = 0; j < E; j++) {
    const t = t0 + ((j - 1) / N) * size;
    for (let i = 0; i < E; i++) {
      const s = s0 + ((i - 1) / N) * size;
      const k = j * E + i;
      faceToDir(job.face, s, t, dirs, k * 3);
      const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
      const h = gen.height(dx, dy, dz);
      hts[k] = h;
      const r = R + h;
      pos[k * 3] = dx * r;
      pos[k * 3 + 1] = dy * r;
      pos[k * 3 + 2] = dz * r;
      if (i >= 1 && i <= N + 1 && j >= 1 && j <= N + 1) {
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
  }

  const V = patchVertexCount(N);
  const positions = new Float32Array(V * 3);
  const normals = new Int8Array(V * 4);
  const colors = new Uint8Array(V * 4);

  let bminX = Infinity, bminY = Infinity, bminZ = Infinity;
  let bmaxX = -Infinity, bmaxY = -Infinity, bmaxZ = -Infinity;

  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const v = j * W + i;
      const k = (j + 1) * E + (i + 1);
      const px = pos[k * 3] - ox, py = pos[k * 3 + 1] - oy, pz = pos[k * 3 + 2] - oz;
      positions[v * 3] = px;
      positions[v * 3 + 1] = py;
      positions[v * 3 + 2] = pz;
      if (px < bminX) bminX = px;
      if (py < bminY) bminY = py;
      if (pz < bminZ) bminZ = pz;
      if (px > bmaxX) bmaxX = px;
      if (py > bmaxY) bmaxY = py;
      if (pz > bmaxZ) bmaxZ = pz;

      // Normal from central differences on the extended grid.
      const kr = k + 1, kl = k - 1, ku = k + E, kd = k - E;
      const ux = pos[kr * 3] - pos[kl * 3], uy = pos[kr * 3 + 1] - pos[kl * 3 + 1], uz = pos[kr * 3 + 2] - pos[kl * 3 + 2];
      const vx = pos[ku * 3] - pos[kd * 3], vy = pos[ku * 3 + 1] - pos[kd * 3 + 1], vz = pos[ku * 3 + 2] - pos[kd * 3 + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
      let slope = nx * dx + ny * dy + nz * dz;
      if (slope < 0) {
        nx = -nx; ny = -ny; nz = -nz; slope = -slope;
      }
      gen.color(dx, dy, dz, hts[k], slope, colorTmp);
      normals[v * 4] = Math.round(nx * 127);
      normals[v * 4 + 1] = Math.round(ny * 127);
      normals[v * 4 + 2] = Math.round(nz * 127);
      normals[v * 4 + 3] = Math.round(Math.min(1, Math.max(0, colorTmp[3])) * 127);
      colors[v * 4] = Math.round(Math.min(1, Math.max(0, colorTmp[0])) * 255);
      colors[v * 4 + 1] = Math.round(Math.min(1, Math.max(0, colorTmp[1])) * 255);
      colors[v * 4 + 2] = Math.round(Math.min(1, Math.max(0, colorTmp[2])) * 255);
      colors[v * 4 + 3] = Math.round(Math.min(1, Math.max(0, colorTmp[4])) * 255);
    }
  }

  // Skirts: border vertices pushed toward the planet center to hide LOD cracks.
  const border = borderIndices(N);
  const sizeM = nodeSize(R, job.level);
  const skirt = sizeM * 0.06 + (maxH - minH) * 0.1 + 2;
  const base = W * W;
  for (let b = 0; b < border.length; b++) {
    const g = border[b];
    const gi = g % W;
    const gj = Math.floor(g / W);
    const k = (gj + 1) * E + (gi + 1);
    const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
    const r = R + hts[k] - skirt;
    const v = base + b;
    positions[v * 3] = dx * r - ox;
    positions[v * 3 + 1] = dy * r - oy;
    positions[v * 3 + 2] = dz * r - oz;
    for (let c = 0; c < 4; c++) {
      normals[v * 4 + c] = normals[g * 4 + c];
      colors[v * 4 + c] = colors[g * 4 + c];
    }
  }

  // Liquid surface for patches that dip below sea level.
  let water: Float32Array | null = null;
  let waterDepth: Float32Array | null = null;
  if (gen.hasSea && minH < gen.sea) {
    water = new Float32Array(V * 3);
    waterDepth = new Float32Array(V);
    const rs = R + gen.sea;
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const v = j * W + i;
        const k = (j + 1) * E + (i + 1);
        water[v * 3] = dirs[k * 3] * rs - ox;
        water[v * 3 + 1] = dirs[k * 3 + 1] * rs - oy;
        water[v * 3 + 2] = dirs[k * 3 + 2] * rs - oz;
        waterDepth[v] = gen.sea - hts[k];
      }
    }
    const wskirt = sizeM * 0.01 + 1;
    for (let b = 0; b < border.length; b++) {
      const g = border[b];
      const gi = g % W;
      const gj = Math.floor(g / W);
      const k = (gj + 1) * E + (gi + 1);
      const v = base + b;
      const r = rs - wskirt;
      water[v * 3] = dirs[k * 3] * r - ox;
      water[v * 3 + 1] = dirs[k * 3 + 1] * r - oy;
      water[v * 3 + 2] = dirs[k * 3 + 2] * r - oz;
      waterDepth[v] = waterDepth[g];
    }
  }

  const bcx = (bminX + bmaxX) / 2, bcy = (bminY + bmaxY) / 2, bcz = (bminZ + bmaxZ) / 2;
  let bradius = 0;
  for (let v = 0; v < V; v++) {
    const dx = positions[v * 3] - bcx, dy = positions[v * 3 + 1] - bcy, dz = positions[v * 3 + 2] - bcz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > bradius) bradius = d;
  }
  bradius = Math.sqrt(bradius);
  if (water) {
    // water sits at sea level which may be above the terrain maximum
    const wr = R + gen.sea;
    const extra = Math.max(0, wr - (R + maxH));
    bradius += extra;
  }

  return {
    origin: [ox, oy, oz],
    positions,
    normals,
    colors,
    minH,
    maxH,
    bcenter: [bcx, bcy, bcz],
    bradius,
    water,
    waterDepth,
  };
}

export function patchTransferables(r: PatchResult): ArrayBuffer[] {
  const t: ArrayBuffer[] = [r.positions.buffer as ArrayBuffer, r.normals.buffer as ArrayBuffer, r.colors.buffer as ArrayBuffer];
  if (r.water) t.push(r.water.buffer as ArrayBuffer);
  if (r.waterDepth) t.push(r.waterDepth.buffer as ArrayBuffer);
  return t;
}
