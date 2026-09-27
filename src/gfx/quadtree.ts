import { BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3, type Material } from 'three';
import { faceToDir, nodeSize } from '../world/cubeSphere';
import { buildPatchIndices, type PatchResult } from '../world/patchBuilder';
import type { GenPool, QueuedJob } from './genPool';

// Chunked LOD over a cube-sphere: each cube face is a quadtree of terrain patches.
// Nodes split when the camera is close relative to their size; a node keeps drawing
// until all four children are ready, so there are never holes while streaming.

const indexCache = new Map<number, BufferAttribute>();
function sharedIndex(res: number): BufferAttribute {
  let idx = indexCache.get(res);
  if (!idx) {
    idx = new BufferAttribute(buildPatchIndices(res), 1);
    indexCache.set(res, idx);
  }
  return idx;
}

const tmpDir = new Float64Array(3);
const tmpV = new Vector3();

export class QuadNode {
  children: QuadNode[] | null = null;
  mesh: Mesh | null = null;
  water: Mesh | null = null;
  job: QueuedJob | null = null;
  ready = false;
  lastUsed = 0;
  readonly centerDir = new Vector3();
  readonly center = new Vector3();
  readonly sizeM: number;
  readonly angRadius: number;
  minH: number;
  maxH: number;

  constructor(
    readonly face: number,
    readonly level: number,
    readonly x: number,
    readonly y: number,
    readonly parent: QuadNode | null,
    radius: number,
    minH: number,
    maxH: number,
  ) {
    const size = 2 / Math.pow(2, level);
    faceToDir(face, -1 + (x + 0.5) * size, -1 + (y + 0.5) * size, tmpDir);
    this.centerDir.set(tmpDir[0], tmpDir[1], tmpDir[2]);
    this.minH = minH;
    this.maxH = maxH;
    this.center.copy(this.centerDir).multiplyScalar(radius + (minH + maxH) * 0.5);
    this.sizeM = nodeSize(radius, level);
    // angular half-diagonal (conservative, cube distortion up to ~1.4x)
    this.angRadius = (this.sizeM / radius) * 0.75 + 0.002;
  }
}

export interface QuadTreeOptions {
  planetId: string;
  radius: number;
  minHeight: number;
  maxHeight: number;
  seaLevel: number | null;
  res: number;
  splitFactor: number;
  maxLevel: number;
}

export class QuadTree {
  readonly roots: QuadNode[] = [];
  private visible: QuadNode[] = [];
  private prevVisible: QuadNode[] = [];
  private frame = 0;
  private meshCount = 0;
  waterRenderOrder = 100;
  /** Set when any patch finished this frame (e.g. to refresh collisions/flora). */
  changed = false;
  /** Number of new generation requests issued during the last update. */
  requested = 0;

  constructor(
    private opts: QuadTreeOptions,
    private pool: GenPool,
    private group: Group,
    private terrainMat: Material,
    private waterMat: Material | null,
  ) {
    for (let f = 0; f < 6; f++) {
      this.roots.push(new QuadNode(f, 0, 0, 0, null, opts.radius, opts.minHeight, opts.maxHeight));
    }
  }

  get rootsReady(): boolean {
    return this.roots.every((r) => r.ready);
  }

  get stats(): { meshes: number; visible: number } {
    return { meshes: this.meshCount, visible: this.visible.length };
  }

  /** camLocal: camera position in planet-local coordinates. */
  update(camLocal: Vector3, detailed: boolean, lodScale = 1): void {
    this.frame++;
    this.changed = false;
    this.requested = 0;
    const o = this.opts;
    const camDist = camLocal.length();
    const rMin = o.radius + Math.max(o.minHeight, o.seaLevel ?? -Infinity);
    const horizonCam = camDist > rMin ? Math.acos(rMin / camDist) : Math.PI;
    const camDir = tmpV.copy(camLocal).divideScalar(Math.max(camDist, 1));

    this.prevVisible = this.visible;
    this.visible = [];

    const visit = (node: QuadNode): void => {
      node.lastUsed = this.frame;
      // Horizon culling: skip subtrees entirely hidden behind the planet's curvature.
      const topR = o.radius + node.maxH;
      const horizonNode = topR > rMin ? Math.acos(rMin / topR) : 0;
      const ang = Math.acos(Math.max(-1, Math.min(1, camDir.dot(node.centerDir))));
      if (ang - node.angRadius > horizonCam + horizonNode + 0.01) {
        if (!node.ready) this.request(node, 1e6);
        return;
      }
      const dist = Math.max(0, camLocal.distanceTo(node.center) - node.sizeM * 0.7);
      const wantSplit = detailed && node.level < o.maxLevel && dist < o.splitFactor * lodScale * node.sizeM;
      if (wantSplit) {
        if (!node.children) this.split(node);
        const ch = node.children!;
        let allReady = true;
        for (const c of ch) {
          c.lastUsed = this.frame;
          if (!c.ready) {
            allReady = false;
            this.request(c, camLocal.distanceTo(c.center) / c.sizeM + c.level * 0.05);
          }
        }
        if (allReady) {
          for (const c of ch) visit(c);
          return;
        }
      }
      if (node.ready) this.visible.push(node);
      else this.request(node, dist / node.sizeM + node.level * 0.05 - 10);
    };

    for (const r of this.roots) visit(r);

    for (const n of this.prevVisible) {
      if (n.mesh) n.mesh.visible = false;
      if (n.water) n.water.visible = false;
    }
    for (const n of this.visible) {
      if (n.mesh) n.mesh.visible = true;
      if (n.water) n.water.visible = true;
    }

    if (this.frame % 30 === 0) this.cleanup();
  }

  private split(node: QuadNode): void {
    const o = this.opts;
    const l = node.level + 1;
    node.children = [];
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        node.children.push(new QuadNode(node.face, l, node.x * 2 + i, node.y * 2 + j, node, o.radius, node.minH, node.maxH));
      }
    }
  }

  private request(node: QuadNode, priority: number): void {
    if (node.ready) return;
    if (node.job) {
      node.job.priority = priority;
      return;
    }
    const o = this.opts;
    this.requested++;
    node.job = this.pool.requestPatch(
      { planetId: o.planetId, face: node.face, level: node.level, x: node.x, y: node.y, res: o.res },
      priority,
      (r) => this.onPatch(node, r),
    );
  }

  private onPatch(node: QuadNode, r: PatchResult): void {
    node.job = null;
    if (node.ready) return;
    const idx = sharedIndex(this.opts.res);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(r.positions, 3));
    geo.setAttribute('aNormal', new BufferAttribute(r.normals, 4, true));
    geo.setAttribute('aColor', new BufferAttribute(r.colors, 4, true));
    geo.setIndex(idx);
    geo.boundingSphere = new Sphere(new Vector3(r.bcenter[0], r.bcenter[1], r.bcenter[2]), r.bradius);
    const mesh = new Mesh(geo, this.terrainMat);
    mesh.position.set(r.origin[0], r.origin[1], r.origin[2]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    this.group.add(mesh);
    node.mesh = mesh;
    this.meshCount++;

    if (r.water && this.waterMat) {
      const wg = new BufferGeometry();
      wg.setAttribute('position', new BufferAttribute(r.water, 3));
      wg.setAttribute('aDepth', new BufferAttribute(r.waterDepth!, 1));
      wg.setIndex(idx);
      wg.boundingSphere = geo.boundingSphere.clone();
      const wm = new Mesh(wg, this.waterMat);
      wm.position.copy(mesh.position);
      wm.matrixAutoUpdate = false;
      wm.updateMatrix();
      wm.visible = false;
      wm.renderOrder = this.waterRenderOrder;
      this.group.add(wm);
      node.water = wm;
    }

    node.minH = r.minH;
    node.maxH = r.maxH;
    node.center.copy(node.centerDir).multiplyScalar(this.opts.radius + (r.minH + r.maxH) * 0.5);
    // Children inherit tighter height bounds for better culling.
    node.ready = true;
    this.changed = true;
  }

  setWaterRenderOrder(order: number): void {
    if (order === this.waterRenderOrder) return;
    this.waterRenderOrder = order;
    const walk = (n: QuadNode) => {
      if (n.water) n.water.renderOrder = order;
      if (n.children) n.children.forEach(walk);
    };
    this.roots.forEach(walk);
  }

  private disposeNode(n: QuadNode): void {
    if (n.job) {
      n.job.cancelled = true;
      n.job = null;
    }
    if (n.mesh) {
      this.group.remove(n.mesh);
      n.mesh.geometry.setIndex(null);
      n.mesh.geometry.dispose();
      n.mesh = null;
      this.meshCount--;
    }
    if (n.water) {
      this.group.remove(n.water);
      n.water.geometry.setIndex(null);
      n.water.geometry.dispose();
      n.water = null;
    }
    n.ready = false;
  }

  private cleanup(): void {
    const frame = this.frame;
    const maxMeshes = 1400;
    const stale = (n: QuadNode, age: number) => frame - n.lastUsed > age;
    const walk = (n: QuadNode): void => {
      if (!n.children) return;
      for (const c of n.children) walk(c);
      // Drop whole child sets that have not been used for a while.
      if (n.children.every((c) => stale(c, 240) && !c.children)) {
        for (const c of n.children) this.disposeNode(c);
        n.children = null;
      } else {
        for (const c of n.children) {
          if (c.job && stale(c, 20)) {
            c.job.cancelled = true;
            c.job = null;
          }
        }
      }
    };
    for (const r of this.roots) walk(r);
    if (this.meshCount > maxMeshes) {
      // Aggressive pass: drop anything not used in the last few frames.
      const walk2 = (n: QuadNode): void => {
        if (!n.children) return;
        for (const c of n.children) walk2(c);
        if (n.children.every((c) => stale(c, 5) && !c.children)) {
          for (const c of n.children) this.disposeNode(c);
          n.children = null;
        }
      };
      for (const r of this.roots) walk2(r);
    }
  }

  dispose(): void {
    const walk = (n: QuadNode): void => {
      if (n.children) n.children.forEach(walk);
      this.disposeNode(n);
    };
    this.roots.forEach(walk);
  }
}
