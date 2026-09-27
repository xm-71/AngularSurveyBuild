import { Color, Group, InstancedBufferAttribute, InstancedMesh, Vector3, type ShaderMaterial } from 'three';
import { hash2, hashString } from '../engine/rng';
import type { QualityPreset } from '../engine/settings';
import { buildFloraModel, type FloraModel } from '../gfx/floraModels';
import type { GenPool, QueuedJob } from '../gfx/genPool';
import { createLitMaterial, type GlobalUniforms, type PlanetUniforms } from '../gfx/materials';
import { dirToFace, faceToDir, nodeSize } from '../world/cubeSphere';
import { FLORA_STRIDE, type FloraResult } from '../world/floraPlacement';
import type { FloraSpeciesDesc } from '../world/planetTypes';
import type { Planet } from './Planet';
import type { Collider } from './Player';

/** Render distance per kind, as a fraction of the quality's flora radius. */
const RENDER_REACH: Partial<Record<FloraSpeciesDesc['kind'], number>> = {
  bush: 0.5, rock: 0.4, sodiumPlant: 0.55, oxygenPlant: 0.55, cactus: 0.8, bulb: 0.75,
  tree: 1, conifer: 1, palm: 1, mushroom: 0.9, boulder: 0.8, spireRock: 1, crystal: 0.7, deposit: 1,
};

interface Cell {
  key: string;
  face: number;
  x: number;
  y: number;
  center: Vector3;
  origin: Vector3;
  data: Float32Array | null;
  ids: Uint32Array | null;
  hash: number;
  grass: boolean;
  job: QueuedJob | null;
  lastUsed: number;
}

interface SpeciesRender {
  desc: FloraSpeciesDesc;
  model: FloraModel;
  material: ShaderMaterial;
  mesh: InstancedMesh;
  capacity: number;
}

export interface FloraHit {
  cell: Cell;
  index: number;
  species: FloraSpeciesDesc;
  mineId: number;
  local: Vector3;
  dist: number;
  scale: number;
}

const _v = new Vector3();
const _up = new Vector3();
const _x = new Vector3();
const _z = new Vector3();
const _c = new Color();
const tmpDir = new Float64Array(3);

/** Streams procedural flora around the explorer and renders it with instancing. */
export class Flora {
  planet: Planet | null = null;
  readonly group = new Group();
  /** planetId -> mined instance ids */
  readonly mined = new Map<string, Set<number>>();
  private species: SpeciesRender[] = [];
  private cells = new Map<string, Cell>();
  private frame = 0;
  private lastCellCenter = new Vector3(1e9, 0, 0);
  private dirty = false;
  private anchor = new Vector3();
  private camLocal = new Vector3();
  private visibleNow = false;
  private sinceRebuild = 0;

  constructor(
    private pool: GenPool,
    private G: GlobalUniforms,
    private P: PlanetUniforms,
    private quality: QualityPreset,
  ) {
    this.group.matrixAutoUpdate = true;
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    const p = this.planet;
    this.setPlanet(null);
    this.setPlanet(p);
  }

  setPlanet(p: Planet | null): void {
    if (p === this.planet) return;
    for (const c of this.cells.values()) if (c.job) c.job.cancelled = true;
    this.cells.clear();
    for (const s of this.species) {
      s.mesh.removeFromParent();
      s.mesh.dispose();
      s.model.geometry.dispose();
      s.material.dispose();
    }
    this.species = [];
    this.group.removeFromParent();
    this.planet = p;
    this.lastCellCenter.set(1e9, 0, 0);
    if (!p) return;
    for (const desc of p.params.flora) {
      const model = buildFloraModel(desc, p.params.palette);
      const material = createLitMaterial(this.G, this.P, {
        vertexColors: true,
        glow: model.glow > 0,
        glowStrength: 1.8,
        wind: model.wind > 0 ? model.wind / (model.height * model.height) : 0,
        specular: desc.kind === 'crystal' || desc.kind === 'deposit' ? 0.8 : 0.08,
        doubleSide: desc.kind === 'grass' || desc.kind === 'palm' || desc.kind === 'bulb',
        translucency: desc.resource === 'carbon' || desc.kind === 'grass' ? 0.45 : 0,
        ambientBoost: 2.0,
      });
      const capacity = 256;
      const mesh = new InstancedMesh(model.geometry, material, capacity);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.species.push({ desc, model, material, mesh, capacity });
    }
    if (!this.mined.has(p.params.id)) this.mined.set(p.params.id, new Set());
    p.group.add(this.group);
  }

  /** Mined ids for the current planet. */
  private get minedSet(): Set<number> {
    return this.mined.get(this.planet!.params.id)!;
  }

  update(camWorld: Vector3, dt: number): void {
    const p = this.planet;
    if (!p) return;
    this.frame++;
    this.sinceRebuild += dt;
    p.toLocal(camWorld, this.camLocal);
    const alt = this.camLocal.length() - p.radius - p.params.maxHeight;
    const show = alt < 1500;
    if (show !== this.visibleNow) {
      this.visibleNow = show;
      this.group.visible = show;
    }
    if (!show) return;

    const level = p.params.floraLevel;
    const cellSize = nodeSize(p.radius, level);
    if (this.camLocal.distanceTo(this.lastCellCenter) > cellSize * 0.35) {
      this.lastCellCenter.copy(this.camLocal);
      this.refreshCells(level, cellSize);
    }
    if (this.dirty && (this.sinceRebuild > 0.25 || this.camLocal.distanceTo(this.anchor) > 400)) {
      this.dirty = false;
      this.sinceRebuild = 0;
      this.rebuild();
    }
    if (this.frame % 60 === 0) this.evict();
  }

  private refreshCells(level: number, cellSize: number): void {
    const p = this.planet!;
    const q = this.quality;
    const up = _up.copy(this.camLocal).normalize();
    const t1 = _x.set(0, 1, 0).cross(up);
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
    t1.normalize();
    const t2 = _z.crossVectors(up, t1);
    const radius = q.floraRadius;
    const step = cellSize * 0.5;
    const size = 2 / Math.pow(2, level);
    const n = Math.ceil(radius / step);
    const R = p.radius;
    const seen = new Set<string>();
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const dx = i * step, dy = j * step;
        if (dx * dx + dy * dy > (radius + step) * (radius + step)) continue;
        _v.copy(up).multiplyScalar(R).addScaledVector(t1, dx).addScaledVector(t2, dy).normalize();
        const [face, s, t] = dirToFace(_v.x, _v.y, _v.z);
        const cx = Math.min(Math.pow(2, level) - 1, Math.floor((s + 1) / size));
        const cy = Math.min(Math.pow(2, level) - 1, Math.floor((t + 1) / size));
        const key = `${face}:${cx}:${cy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let cell = this.cells.get(key);
        if (!cell) {
          faceToDir(face, -1 + (cx + 0.5) * size, -1 + (cy + 0.5) * size, tmpDir);
          const center = new Vector3(tmpDir[0], tmpDir[1], tmpDir[2]).multiplyScalar(R);
          cell = { key, face, x: cx, y: cy, center, origin: center.clone(), data: null, ids: null, hash: hashString(key), grass: false, job: null, lastUsed: this.frame };
          this.cells.set(key, cell);
        }
        cell.lastUsed = this.frame;
        const d = cell.center.distanceTo(this.camLocal);
        const wantGrass = q.grassRadius > 0 && d < q.grassRadius + cellSize * 0.8;
        if ((!cell.data && !cell.job) || (wantGrass && !cell.grass && !cell.job)) {
          this.request(cell, level, wantGrass, d);
        }
      }
    }
    this.dirty = true;
  }

  private request(cell: Cell, level: number, grass: boolean, dist: number): void {
    const p = this.planet!;
    cell.job = this.pool.requestFlora(
      { planetId: p.params.id, face: cell.face, level, x: cell.x, y: cell.y, density: this.quality.floraDensity, grass },
      dist / 100 + 0.5,
      (r: FloraResult) => {
        cell.job = null;
        if (this.cells.get(cell.key) !== cell) return;
        cell.data = r.data;
        cell.ids = r.ids;
        cell.origin.set(r.origin[0], r.origin[1], r.origin[2]);
        cell.grass = grass;
        this.dirty = true;
      },
    );
  }

  private evict(): void {
    for (const [k, c] of this.cells) {
      if (this.frame - c.lastUsed > 240) {
        if (c.job) c.job.cancelled = true;
        this.cells.delete(k);
      }
    }
  }

  private ensureCapacity(s: SpeciesRender, needed: number): void {
    if (needed <= s.capacity) return;
    let cap = s.capacity;
    while (cap < needed) cap *= 2;
    const mesh = new InstancedMesh(s.model.geometry, s.material, cap);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.frustumCulled = false;
    mesh.count = 0;
    s.mesh.removeFromParent();
    s.mesh.dispose();
    this.group.add(mesh);
    s.mesh = mesh;
    s.capacity = cap;
  }

  /** Rebuild instance buffers from the loaded cells. */
  private rebuild(): void {
    const q = this.quality;
    this.anchor.copy(this.camLocal);
    this.group.position.copy(this.anchor);
    const mined = this.minedSet;
    const counts = new Array(this.species.length).fill(0);
    const grassR2 = q.grassRadius * q.grassRadius;
    const reach2 = this.species.map((s) => {
      const r = q.floraRadius * (RENDER_REACH[s.desc.kind] ?? 1);
      return r * r;
    });

    // First pass: count to size buffers.
    const lists: { cell: Cell; i: number }[][] = this.species.map(() => []);
    for (const cell of this.cells.values()) {
      if (!cell.data || !cell.ids) continue;
      const d = cell.data;
      const ox = cell.origin.x - this.anchor.x, oy = cell.origin.y - this.anchor.y, oz = cell.origin.z - this.anchor.z;
      const n = cell.ids.length;
      for (let i = 0; i < n; i++) {
        const o = i * FLORA_STRIDE;
        const si = d[o + 3];
        const sp = this.species[si];
        if (!sp) continue;
        const x = d[o] + ox, y = d[o + 1] + oy, z = d[o + 2] + oz;
        const dist2 = x * x + y * y + z * z;
        if (sp.desc.kind === 'grass') {
          if (dist2 > grassR2) continue;
        } else if (dist2 > reach2[si]) continue;
        if (sp.desc.kind !== 'grass' && mined.has(hash2(cell.hash, cell.ids[i]))) continue;
        lists[si].push({ cell, i });
        counts[si]++;
      }
    }

    for (let si = 0; si < this.species.length; si++) {
      const s = this.species[si];
      this.ensureCapacity(s, counts[si]);
      const arr = s.mesh.instanceMatrix.array as Float32Array;
      const col = s.mesh.instanceColor!.array as Float32Array;
      let k = 0;
      for (const { cell, i } of lists[si]) {
        const d = cell.data!;
        const o = i * FLORA_STRIDE;
        const lx = d[o] + cell.origin.x, ly = d[o + 1] + cell.origin.y, lz = d[o + 2] + cell.origin.z;
        const scale = d[o + 4];
        const rot = d[o + 5];
        // Basis: Y = radial up, X/Z rotated about it.
        _up.set(lx, ly, lz).normalize();
        _x.set(0, 1, 0).cross(_up);
        if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
        _x.normalize();
        _z.crossVectors(_x, _up);
        const c = Math.cos(rot), sn = Math.sin(rot);
        const xx = _x.x * c + _z.x * sn, xy = _x.y * c + _z.y * sn, xz = _x.z * c + _z.z * sn;
        const zx = _z.x * c - _x.x * sn, zy = _z.y * c - _x.y * sn, zz = _z.z * c - _x.z * sn;
        const m = k * 16;
        arr[m] = xx * scale; arr[m + 1] = xy * scale; arr[m + 2] = xz * scale; arr[m + 3] = 0;
        arr[m + 4] = _up.x * scale; arr[m + 5] = _up.y * scale; arr[m + 6] = _up.z * scale; arr[m + 7] = 0;
        arr[m + 8] = zx * scale; arr[m + 9] = zy * scale; arr[m + 10] = zz * scale; arr[m + 11] = 0;
        arr[m + 12] = lx - this.anchor.x; arr[m + 13] = ly - this.anchor.y; arr[m + 14] = lz - this.anchor.z; arr[m + 15] = 1;
        if (s.model.instanceTint) {
          // grass takes the ground colour (sRGB -> linear) slightly brightened
          _c.setRGB(d[o + 6], d[o + 7], d[o + 8]);
          col[k * 3] = Math.pow(_c.r, 2.2) * 1.15;
          col[k * 3 + 1] = Math.pow(_c.g, 2.2) * 1.15;
          col[k * 3 + 2] = Math.pow(_c.b, 2.2) * 1.15;
        } else {
          col[k * 3] = d[o + 6];
          col[k * 3 + 1] = d[o + 7];
          col[k * 3 + 2] = d[o + 8];
        }
        k++;
      }
      s.mesh.count = k;
      s.mesh.instanceMatrix.needsUpdate = true;
      s.mesh.instanceColor!.needsUpdate = true;
    }
  }

  /** Nearby cylinder colliders (planet-local). */
  colliders(local: Vector3, radius: number): Collider[] {
    const out: Collider[] = [];
    if (!this.planet) return out;
    const mined = this.minedSet;
    const r2 = radius * radius;
    for (const cell of this.cells.values()) {
      if (!cell.data || !cell.ids) continue;
      if (cell.center.distanceToSquared(local) > (radius + 120) * (radius + 120)) continue;
      const d = cell.data;
      for (let i = 0; i < cell.ids.length; i++) {
        const o = i * FLORA_STRIDE;
        const sp = this.species[d[o + 3]]?.desc;
        if (!sp || sp.collide <= 0) continue;
        const x = d[o] + cell.origin.x, y = d[o + 1] + cell.origin.y, z = d[o + 2] + cell.origin.z;
        const dx = x - local.x, dy = y - local.y, dz = z - local.z;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        if (mined.has(hash2(cell.hash, cell.ids[i]))) continue;
        const s = d[o + 4];
        out.push({ x, y, z, radius: sp.collide * s, height: this.species[d[o + 3]].model.height * s });
      }
    }
    return out;
  }

  /** Ray pick against flora bounding spheres (planet-local ray). */
  pick(origin: Vector3, dir: Vector3, maxDist: number, filter?: (s: FloraSpeciesDesc) => boolean): FloraHit | null {
    if (!this.planet) return null;
    const mined = this.minedSet;
    let best: FloraHit | null = null;
    let bestT = maxDist;
    for (const cell of this.cells.values()) {
      if (!cell.data || !cell.ids) continue;
      if (cell.center.distanceTo(origin) > maxDist + 150) continue;
      const d = cell.data;
      for (let i = 0; i < cell.ids.length; i++) {
        const o = i * FLORA_STRIDE;
        const sr = this.species[d[o + 3]];
        if (!sr || sr.desc.pick <= 0) continue;
        if (filter && !filter(sr.desc)) continue;
        const s = d[o + 4];
        const lx = d[o] + cell.origin.x, ly = d[o + 1] + cell.origin.y, lz = d[o + 2] + cell.origin.z;
        // sphere centred part-way up the model
        const upl = Math.hypot(lx, ly, lz);
        const hc = Math.min(sr.model.height * 0.45, sr.desc.pick) * s;
        const cx = lx + (lx / upl) * hc, cy = ly + (ly / upl) * hc, cz = lz + (lz / upl) * hc;
        const rad = sr.desc.pick * s;
        const ox = origin.x - cx, oy = origin.y - cy, oz = origin.z - cz;
        const b = ox * dir.x + oy * dir.y + oz * dir.z;
        const cc = ox * ox + oy * oy + oz * oz - rad * rad;
        const disc = b * b - cc;
        if (disc < 0) continue;
        const t = -b - Math.sqrt(disc);
        const tt = t < 0 ? (cc < 0 ? 0 : -1) : t;
        if (tt < 0 || tt > bestT) continue;
        const mineId = hash2(cell.hash, cell.ids[i]);
        if (mined.has(mineId)) continue;
        bestT = tt;
        best = { cell, index: i, species: sr.desc, mineId, local: new Vector3(cx, cy, cz), dist: tt, scale: s };
      }
    }
    return best;
  }

  /** Resource nodes (and notable flora) near a point, for the scanner. */
  nearby(local: Vector3, radius: number, filter: (s: FloraSpeciesDesc) => boolean, limit = 40): { local: Vector3; species: FloraSpeciesDesc; dist: number }[] {
    const out: { local: Vector3; species: FloraSpeciesDesc; dist: number }[] = [];
    if (!this.planet) return out;
    const mined = this.minedSet;
    for (const cell of this.cells.values()) {
      if (!cell.data || !cell.ids) continue;
      if (cell.center.distanceTo(local) > radius + 150) continue;
      const d = cell.data;
      for (let i = 0; i < cell.ids.length; i++) {
        const o = i * FLORA_STRIDE;
        const sr = this.species[d[o + 3]];
        if (!sr || !filter(sr.desc)) continue;
        const p = new Vector3(d[o] + cell.origin.x, d[o + 1] + cell.origin.y, d[o + 2] + cell.origin.z);
        const dist = p.distanceTo(local);
        if (dist > radius) continue;
        if (mined.has(hash2(cell.hash, cell.ids[i]))) continue;
        out.push({ local: p.addScaledVector(p.clone().normalize(), sr.model.height * d[o + 4] * 0.6), species: sr.desc, dist });
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    return out.slice(0, limit);
  }

  markMined(id: number): void {
    this.minedSet.add(id);
    this.dirty = true;
  }

  modelHeight(speciesIndex: number): number {
    return this.species[speciesIndex]?.model.height ?? 1;
  }

  /** Brief highlight flash on a species' material (mining feedback). */
  flash(species: FloraSpeciesDesc, amount: number): void {
    const s = this.species[species.index];
    if (s) s.material.uniforms.uFlash.value = amount;
  }
}
