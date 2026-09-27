import { Vector3, type Camera, type Scene } from 'three';
import { rgbToLinear } from '../engine/color';
import type { QualityPreset } from '../engine/settings';
import type { GenPool } from '../gfx/genPool';
import { copyPlanetUniforms, createPlanetUniforms, type GlobalUniforms, type PlanetUniforms } from '../gfx/materials';
import type { Sky } from '../gfx/sky';
import { Star } from '../gfx/star';
import type { SystemSummary } from '../world/galaxy';
import { generateSystem, type StarSystemDesc } from '../world/starSystem';
import { Planet } from './Planet';

const _v = new Vector3();
const _v2 = new Vector3();

/** Owns the currently loaded star system: its star, planets and shared lighting state. */
export class Universe {
  system!: StarSystemDesc;
  planets: Planet[] = [];
  star!: Star;
  /** Atmosphere/lighting uniforms for dynamic objects near the current planet. */
  readonly local: PlanetUniforms = createPlanetUniforms();
  current: Planet | null = null;
  /** 0 in space .. 1 deep inside the current planet's atmosphere. */
  atmosphereFactor = 0;
  /** Sun colour after atmospheric extinction at the camera. */
  readonly sunTint = new Vector3(1, 1, 1);
  readonly sunScatter = new Vector3();
  readonly starLinear = new Vector3();
  private lightColor = new Vector3(1, 1, 1);

  constructor(
    private scene: Scene,
    private pool: GenPool,
    private G: GlobalUniforms,
    private quality: QualityPreset,
    private sky: Sky,
  ) {}

  load(summary: SystemSummary, forceHabitable: boolean): StarSystemDesc {
    this.unload();
    const sys = generateSystem(summary, forceHabitable);
    this.system = sys;
    this.star = new Star(sys.starRadius, sys.starColor);
    this.scene.add(this.star.group);
    const lin = rgbToLinear(sys.starColor);
    this.starLinear.set(lin[0], lin[1], lin[2]);
    const lc = sys.lightColor;
    this.lightColor.set(lc[0], lc[1], lc[2]);
    // Scattered light keeps most of the star's hue but never goes fully monochrome.
    this.sunScatter.set(0.6 + 0.4 * lin[0], 0.6 + 0.4 * lin[1], 0.6 + 0.4 * lin[2]).multiplyScalar(14);
    for (const d of sys.planets) {
      const p = new Planet(d, this.pool, this.G, this.quality);
      this.planets.push(p);
      this.scene.add(p.group);
    }
    this.sky.bake(sys.nebula[0], sys.nebula[1], sys.nebulaDensity, sys.seed);
    this.sky.buildStars(sys.seed, this.quality.floraRadius > 200 ? 7000 : 4000);
    return sys;
  }

  unload(): void {
    for (const p of this.planets) p.dispose();
    this.planets = [];
    if (this.star) {
      this.star.group.removeFromParent();
      this.star.dispose();
    }
    this.current = null;
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    for (const p of this.planets) p.setQuality(q);
  }

  /** Planet whose influence the position is in (closest relative to its size). */
  nearestPlanet(world: Vector3): { planet: Planet; dist: number } | null {
    let best: Planet | null = null;
    let bestScore = Infinity;
    let bestDist = Infinity;
    for (const p of this.planets) {
      const d = world.distanceTo(p.center);
      const score = d / p.radius;
      if (score < bestScore) {
        bestScore = score;
        best = p;
        bestDist = d;
      }
    }
    return best ? { planet: best, dist: bestDist } : null;
  }

  updateRotations(time: number): void {
    for (const p of this.planets) p.updateRotation(time);
  }

  /** Per-frame update of transforms, lighting and LOD. */
  update(camWorld: Vector3, camera: Camera, time: number): void {
    const near = this.nearestPlanet(camWorld);
    this.current = near && near.dist < near.planet.radius * 4 ? near.planet : null;

    // Rank planets far-to-near so transparent shells composite in the right order.
    const sorted = [...this.planets].sort((a, b) => b.center.distanceTo(camWorld) - a.center.distanceTo(camWorld));
    sorted.forEach((p, i) => p.setRenderRank(i));

    for (const p of this.planets) {
      const d = camWorld.distanceTo(p.center);
      // Refine only planets that are reasonably close; distant ones stay at root LOD.
      p.update(camWorld, this.sunScatter, d < p.radius * 12);
    }

    // Lighting and atmosphere state at the camera.
    this.atmosphereFactor = 0;
    this.sunTint.set(1, 1, 1);
    const cur = this.current;
    if (cur) {
      copyPlanetUniforms(this.local, cur.uniforms);
      const a = cur.params.atmosphere;
      if (a) {
        const r = near!.dist;
        const h = Math.max(0, r - cur.radius);
        this.atmosphereFactor = Math.max(0, Math.min(1, 1 - (r - cur.radius) / (cur.atmoRadius - cur.radius)));
        // Extinction of sunlight at the camera (same model as the shaders).
        const up = _v.copy(camWorld).sub(cur.center).normalize();
        const mu = up.dot(cur.sunDir);
        const ch = Math.sqrt((1.5707963 * r) / a.scaleHeight);
        const airmass = 1 / Math.max(mu + 1 / ch, 0.35 / ch);
        const od = Math.exp(-h / a.scaleHeight) * a.scaleHeight * airmass;
        const b = cur.uniforms.uAtmoBeta.value;
        const m = cur.uniforms.uAtmoMie.value;
        this.sunTint.set(Math.exp(-(b.x + m) * od), Math.exp(-(b.y + m) * od), Math.exp(-(b.z + m) * od));
      }
    } else {
      const lu = this.local;
      lu.uHasAtmo.value = 0;
      lu.uPlanetCenter.value.set(0, 0, 0);
      lu.uAmbient.value.set(0.03, 0.03, 0.035);
      lu.uSunDir.value.copy(camWorld).multiplyScalar(-1).normalize();
    }
    // Planet shadow at the camera for the direct light.
    let shadow = 1;
    if (cur) {
      const rel = _v2.copy(camWorld).sub(cur.center);
      const r = rel.length();
      const muS = rel.dot(cur.sunDir) / r;
      const horizon = -Math.sqrt(Math.max(0, 1 - (cur.radius * cur.radius) / (r * r)));
      shadow = Math.max(0, Math.min(1, (muS - (horizon - 0.06)) / 0.12));
    }
    this.G.uSunColor.value.copy(this.lightColor).multiplyScalar(2.6);
    this.star.update(camWorld, camera, time, _v.copy(this.sunTint).multiplyScalar(0.25 + 0.75 * shadow), this.atmosphereFactor);
  }

  get ready(): boolean {
    return this.planets.every((p) => p.ready);
  }
}
