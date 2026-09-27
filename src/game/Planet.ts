import { Group, Matrix3, Matrix4, Mesh, Quaternion, SphereGeometry, Vector3, type ShaderMaterial } from 'three';
import type { QualityPreset } from '../engine/settings';
import type { GenPool } from '../gfx/genPool';
import {
  applyPlanetConstants, createCloudMaterial, createPlanetUniforms, createSkyShellMaterial, createTerrainMaterial,
  createWaterMaterial, type GlobalUniforms, type PlanetUniforms,
} from '../gfx/materials';
import { QuadTree } from '../gfx/quadtree';
import { nodeSize } from '../world/cubeSphere';
import type { PlanetParams } from '../world/planetTypes';
import type { PlanetDesc } from '../world/starSystem';
import type { TerrainGenerator } from '../world/terrain';

const skyGeo = new SphereGeometry(1, 96, 48);
const cloudGeo = new SphereGeometry(1, 160, 80);
const _v = new Vector3();
const _m4 = new Matrix4();

/** A planet in the current star system: rotation, LOD terrain, shells and helpers. */
export class Planet {
  readonly params: PlanetParams;
  readonly gen: TerrainGenerator;
  readonly center: Vector3;
  readonly axis: Vector3;
  readonly group = new Group();
  readonly uniforms: PlanetUniforms;
  readonly quat = new Quaternion();
  readonly quatInv = new Quaternion();
  readonly angVel: Vector3;
  readonly radius: number;
  readonly atmoRadius: number;
  readonly seaRadius: number | null;
  readonly spinRate: number;
  readonly sunDir = new Vector3();
  tree: QuadTree;
  private tilt = new Quaternion();
  private terrainMat: ShaderMaterial;
  private waterMat: ShaderMaterial | null;
  private skyMat: ShaderMaterial | null;
  private cloudMat: ShaderMaterial | null;
  private sky: Mesh | null = null;
  private clouds: Mesh | null = null;
  maxLevel = 8;
  distanceToCamera = Infinity;

  constructor(
    readonly desc: PlanetDesc,
    private pool: GenPool,
    G: GlobalUniforms,
    private quality: QualityPreset,
  ) {
    this.params = desc.params;
    const p = this.params;
    this.gen = pool.registerPlanet(p);
    this.radius = p.radius;
    this.center = new Vector3(...desc.position);
    this.axis = new Vector3(...desc.axis).normalize();
    this.tilt.setFromUnitVectors(new Vector3(0, 1, 0), this.axis);
    this.spinRate = (Math.PI * 2) / p.dayLength;
    this.angVel = this.axis.clone().multiplyScalar(this.spinRate);
    this.atmoRadius = p.atmosphere ? p.radius + p.atmosphere.height : p.radius + p.maxHeight;
    this.seaRadius = p.seaLevel !== null ? p.radius + p.seaLevel : null;
    this.sunDir.copy(this.center).multiplyScalar(-1).normalize();

    this.uniforms = createPlanetUniforms();
    applyPlanetConstants(this.uniforms, p);
    this.uniforms.uSunDir.value.copy(this.sunDir);

    this.terrainMat = createTerrainMaterial(G, this.uniforms, quality.detailNoise);
    this.waterMat = p.seaLevel !== null ? createWaterMaterial(G, this.uniforms, p) : null;
    this.skyMat = p.atmosphere ? createSkyShellMaterial(G, this.uniforms) : null;
    this.cloudMat = createCloudMaterial(G, this.uniforms, p);

    if (this.skyMat) {
      this.sky = new Mesh(skyGeo, this.skyMat);
      this.sky.scale.setScalar(this.atmoRadius);
      this.sky.renderOrder = 101;
      this.group.add(this.sky);
    }
    if (this.cloudMat && p.clouds) {
      this.clouds = new Mesh(cloudGeo, this.cloudMat);
      this.clouds.scale.setScalar(p.radius + p.clouds.altitude);
      this.clouds.renderOrder = 102;
      this.group.add(this.clouds);
    }
    this.tree = this.createTree();
  }

  private createTree(): QuadTree {
    const p = this.params;
    const q = this.quality;
    let lvl = 0;
    while (nodeSize(p.radius, lvl) / q.patchRes > q.maxLevelSpacing && lvl < 16) lvl++;
    this.maxLevel = lvl;
    return new QuadTree(
      {
        planetId: p.id,
        radius: p.radius,
        minHeight: p.minHeight,
        maxHeight: p.maxHeight,
        seaLevel: p.seaLevel,
        res: q.patchRes,
        splitFactor: q.splitFactor,
        maxLevel: lvl,
      },
      this.pool,
      this.group,
      this.terrainMat,
      this.waterMat,
    );
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    this.tree.dispose();
    this.terrainMat.uniforms.uDetail.value = q.detailNoise ? 1 : 0;
    this.tree = this.createTree();
  }

  /** Planet orientation at a given game time. */
  rotationAt(time: number, out: Quaternion): Quaternion {
    const a = this.desc.spin0 + time * this.spinRate;
    out.setFromAxisAngle(_v.set(0, 1, 0), a);
    return out.premultiply(this.tilt);
  }

  updateRotation(time: number): void {
    this.rotationAt(time, this.quat);
    this.quatInv.copy(this.quat).invert();
  }

  toLocal(world: Vector3, out: Vector3): Vector3 {
    return out.copy(world).sub(this.center).applyQuaternion(this.quatInv);
  }

  toWorld(local: Vector3, out: Vector3): Vector3 {
    return out.copy(local).applyQuaternion(this.quat).add(this.center);
  }

  dirToLocal(world: Vector3, out: Vector3): Vector3 {
    return out.copy(world).applyQuaternion(this.quatInv);
  }

  dirToWorld(local: Vector3, out: Vector3): Vector3 {
    return out.copy(local).applyQuaternion(this.quat);
  }

  /** Velocity of the co-rotating surface frame at a world point. */
  frameVelocity(world: Vector3, out: Vector3): Vector3 {
    return out.copy(world).sub(this.center).crossVectors(this.angVel, out);
  }

  /** Terrain height above radius for a local direction (not normalized is fine). */
  heightAtLocal(local: Vector3): number {
    const l = local.length();
    return this.gen.height(local.x / l, local.y / l, local.z / l);
  }

  /** Walkable ground radius (frozen seas count as ground). */
  groundRadiusAtLocal(local: Vector3): number {
    const l = local.length();
    return this.radius + this.gen.groundHeight(local.x / l, local.y / l, local.z / l);
  }

  /** Altitude above terrain (or liquid surface) for a world position. */
  altitudeAt(world: Vector3): number {
    this.toLocal(world, _v);
    const r = _v.length();
    let ground = this.radius + this.gen.height(_v.x / r, _v.y / r, _v.z / r);
    if (this.seaRadius !== null) ground = Math.max(ground, this.seaRadius);
    return r - ground;
  }

  /** Terrain surface normal (local frame) by central differences. */
  normalAtLocal(local: Vector3, out: Vector3, step = 1.5): Vector3 {
    const up = _v.copy(local).normalize();
    const t1 = new Vector3(0, 1, 0);
    if (Math.abs(up.y) > 0.9) t1.set(1, 0, 0);
    t1.cross(up).normalize();
    const t2 = new Vector3().crossVectors(up, t1);
    const R = this.radius;
    const sample = (dx: number, dy: number): Vector3 => {
      const d = new Vector3().copy(up).multiplyScalar(R).addScaledVector(t1, dx).addScaledVector(t2, dy).normalize();
      const h = this.gen.groundHeight(d.x, d.y, d.z);
      return d.multiplyScalar(R + h);
    };
    const a = sample(-step, 0), b = sample(step, 0), c = sample(0, -step), d = sample(0, step);
    const u = b.sub(a);
    const v = d.sub(c);
    out.crossVectors(u, v).normalize();
    if (out.dot(up) < 0) out.negate();
    return out;
  }

  /**
   * Per-frame update: transforms relative to the camera, uniforms and LOD.
   * camWorld is the camera position in system coordinates.
   */
  update(camWorld: Vector3, sunScatter: Vector3, detailed: boolean, lodScale = 1): void {
    this.group.position.copy(this.center).sub(camWorld);
    this.group.quaternion.copy(this.quat);
    this.distanceToCamera = camWorld.distanceTo(this.center);
    const u = this.uniforms;
    u.uPlanetCenter.value.copy(this.group.position);
    u.uSunScatter.value.copy(sunScatter);
    u.uPlanetRotInv.value.setFromMatrix4(_m4.makeRotationFromQuaternion(this.quatInv));

    const camLocal = this.toLocal(camWorld, _v);
    this.tree.update(camLocal, detailed, lodScale);
  }

  setRenderRank(rank: number): void {
    const base = 100 + rank * 4;
    this.tree.setWaterRenderOrder(base);
    if (this.sky) this.sky.renderOrder = base + 1;
    if (this.clouds) this.clouds.renderOrder = base + 2;
  }

  get ready(): boolean {
    return this.tree.rootsReady;
  }

  get rotationMatrix3(): Matrix3 {
    return new Matrix3().setFromMatrix4(_m4.makeRotationFromQuaternion(this.quat));
  }

  dispose(): void {
    this.tree.dispose();
    this.terrainMat.dispose();
    this.waterMat?.dispose();
    this.skyMat?.dispose();
    this.cloudMat?.dispose();
    this.group.removeFromParent();
    this.pool.dropPlanet(this.params.id);
  }
}
