import { Group, Mesh, Quaternion, Vector3, type ShaderMaterial } from 'three';
import { hsl, rgbToLinear } from '../engine/color';
import { anyPerpendicular, clamp, quatFromForwardUp } from '../engine/math';
import { speciesName } from '../engine/names';
import { hash2, Rng } from '../engine/rng';
import type { QualityPreset } from '../engine/settings';
import { buildCreatureModel, colorize, type BodyPlan, type CreatureModel } from '../gfx/creatureModels';
import { createLitMaterial, type GlobalUniforms, type PlanetUniforms } from '../gfx/materials';
import type { Planet } from './Planet';

export interface CreatureSpecies {
  id: string;
  index: number;
  name: string;
  plan: BodyPlan;
  model: CreatureModel;
  material: ShaderMaterial;
  scale: [number, number];
  speed: number;
  temperament: 'Skittish' | 'Passive' | 'Curious' | 'Timid';
  diet: 'Herbivore' | 'Carnivore' | 'Omnivore' | 'Lithovore';
  herd: [number, number];
  moist: [number, number];
  notes: string;
}

interface Creature {
  species: CreatureSpecies;
  group: Group;
  legs: Group[];
  wings: Group[];
  pos: Vector3;
  heading: Vector3;
  speed: number;
  scale: number;
  state: 'idle' | 'wander' | 'flee' | 'approach' | 'fly';
  timer: number;
  target: Vector3;
  phase: number;
  hop: number;
  hopV: number;
  flyAlt: number;
  flyAngle: number;
  flyCenter: Vector3;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _up = new Vector3();
const _q = new Quaternion();

const NOTES = [
  'Grazes in the early light.', 'Hums quietly when resting.', 'Territorial around water.', 'Travels in loose herds.',
  'Burrows during storms.', 'Curious about technology.', 'Leaves glowing tracks.', 'Sleeps standing up.',
  'Communicates with low clicks.', 'Feeds on mineral dust.', 'Sheds its skin each season.', 'Drawn to warm rocks.',
];

/** Procedural fauna: species per planet, herds streamed around the explorer. */
export class Creatures {
  planet: Planet | null = null;
  species: CreatureSpecies[] = [];
  private live: Creature[] = [];
  private spawnTimer = 0;
  private rng = new Rng(1);
  readonly group = new Group();

  constructor(private G: GlobalUniforms, private P: PlanetUniforms, private quality: QualityPreset) {}

  setQuality(q: QualityPreset): void {
    this.quality = q;
  }

  static speciesFor(planetSeed: number, faunaDensity: number): { count: number; flyer: boolean } {
    if (faunaDensity < 0.05) return { count: 0, flyer: false };
    const r = new Rng(planetSeed ^ 0xfa0a);
    return { count: r.int(2, 4) + (faunaDensity > 0.6 ? 1 : 0), flyer: r.chance(0.6) };
  }

  setPlanet(p: Planet | null): void {
    if (p === this.planet) return;
    for (const c of this.live) c.group.removeFromParent();
    this.live = [];
    for (const s of this.species) {
      s.model.body.dispose();
      s.model.leg?.dispose();
      s.model.wing?.dispose();
      s.material.dispose();
    }
    this.species = [];
    this.group.removeFromParent();
    this.planet = p;
    if (!p) return;
    this.rng = new Rng(p.params.seed ^ 0x77);
    const { count, flyer } = Creatures.speciesFor(p.params.seed, p.params.faunaDensity);
    const plans: BodyPlan[] = ['quad', 'quad', 'hexapod', 'biped', 'hopper'];
    for (let i = 0; i < count + (flyer ? 1 : 0); i++) {
      const seed = hash2(p.params.seed, 9000 + i);
      const r = new Rng(seed);
      const plan: BodyPlan = i === count ? 'flyer' : r.pick(plans);
      const model = buildCreatureModel(seed, plan, p.params.palette);
      const legColor = rgbToLinear(hsl(r.range(0, 360), 0.3, 0.3));
      if (model.leg) model.leg = colorize(model.leg, legColor);
      if (model.wing) model.wing = colorize(model.wing, rgbToLinear(hsl(r.range(0, 360), 0.6, 0.55)));
      const material = createLitMaterial(this.G, this.P, { vertexColors: true, glow: true, glowStrength: 1.6, specular: 0.2 });
      const big = r.chance(0.18);
      const scaleBase = plan === 'flyer' ? r.range(0.8, 1.6) : plan === 'hopper' ? r.range(0.5, 1.2) : big ? r.range(2.2, 3.8) : r.range(0.6, 1.5);
      this.species.push({
        id: `fauna:${p.params.id}:${i}`,
        index: i,
        name: speciesName(seed),
        plan,
        model,
        material,
        scale: [scaleBase * 0.85, scaleBase * 1.15],
        speed: (plan === 'hopper' ? 3 : plan === 'flyer' ? 9 : 4.5) * r.range(0.8, 1.3) * Math.sqrt(scaleBase),
        temperament: r.pick(['Skittish', 'Passive', 'Curious', 'Timid'] as const),
        diet: r.pick(['Herbivore', 'Herbivore', 'Omnivore', 'Carnivore', 'Lithovore'] as const),
        herd: plan === 'flyer' ? [3, 6] : big ? [1, 2] : [2, 5],
        moist: r.chance(0.5) ? [0, 1] : r.chance(0.5) ? [0.35, 1] : [0, 0.65],
        notes: r.pick(NOTES),
      });
    }
    p.group.add(this.group);
    this.spawnTimer = 0.5;
  }

  get count(): number {
    return this.live.length;
  }

  private spawnHerd(around: Vector3): void {
    const p = this.planet!;
    if (this.species.length === 0) return;
    const sp = this.rng.pick(this.species);
    const up = _up.copy(around).normalize();
    const t1 = anyPerpendicular(up, _v);
    const t2 = _v2.crossVectors(up, t1);
    const ang = this.rng.range(0, Math.PI * 2);
    const dist = this.rng.range(55, 130);
    const center = up.clone().multiplyScalar(p.radius).addScaledVector(t1, Math.cos(ang) * dist).addScaledVector(t2, Math.sin(ang) * dist).normalize();
    const h = p.gen.height(center.x, center.y, center.z);
    const sea = p.params.seaLevel;
    if (sea !== null && h < sea + 0.5 && sp.plan !== 'flyer') return;
    const m = p.gen.moisture(center.x, center.y, center.z);
    if (m < sp.moist[0] || m > sp.moist[1]) return;
    const n = this.rng.int(sp.herd[0], sp.herd[1]);
    for (let i = 0; i < n; i++) {
      if (this.live.length >= this.maxCount()) break;
      const off = anyPerpendicular(center, new Vector3()).applyAxisAngle(center, this.rng.range(0, Math.PI * 2)).multiplyScalar(this.rng.range(0, 10));
      const dir = center.clone().multiplyScalar(p.radius).add(off).normalize();
      this.spawn(sp, dir);
    }
  }

  private maxCount(): number {
    const p = this.planet;
    if (!p) return 0;
    return Math.round(this.quality.maxCreatures * clamp(p.params.faunaDensity * 1.2, 0.2, 1));
  }

  private spawn(sp: CreatureSpecies, dir: Vector3): void {
    const p = this.planet!;
    const group = new Group();
    const body = new Mesh(sp.model.body, sp.material);
    group.add(body);
    const legs: Group[] = [];
    if (sp.model.leg) {
      for (const hp of sp.model.hips) {
        const pivot = new Group();
        pivot.position.set(hp[0], hp[1], hp[2]);
        pivot.add(new Mesh(sp.model.leg, sp.material));
        group.add(pivot);
        legs.push(pivot);
      }
    }
    const wings: Group[] = [];
    if (sp.model.wing) {
      sp.model.wings.forEach((wp, i) => {
        const pivot = new Group();
        pivot.position.set(wp[0], wp[1], wp[2]);
        const wm = new Mesh(sp.model.wing!, sp.material);
        if (i === 1) wm.scale.x = -1;
        pivot.add(wm);
        group.add(pivot);
        wings.push(pivot);
      });
    }
    const scale = this.rng.range(sp.scale[0], sp.scale[1]);
    group.scale.setScalar(scale);
    const r = p.groundRadiusAtLocal(dir);
    const pos = dir.clone().multiplyScalar(r);
    const heading = anyPerpendicular(dir, new Vector3()).applyAxisAngle(dir, this.rng.range(0, Math.PI * 2));
    const c: Creature = {
      species: sp, group, legs, wings, pos, heading, speed: 0, scale,
      state: sp.plan === 'flyer' ? 'fly' : 'idle',
      timer: this.rng.range(0.5, 4), target: pos.clone(), phase: this.rng.range(0, 10),
      hop: 0, hopV: 0, flyAlt: this.rng.range(18, 45), flyAngle: this.rng.range(0, Math.PI * 2),
      flyCenter: pos.clone(),
    };
    this.group.add(group);
    this.live.push(c);
  }

  update(dt: number, game: { control: string; player: { pos: Vector3; sprinting: boolean; planet: Planet | null }; rig: { pos: Vector3 } }): void {
    const p = this.planet;
    if (!p) return;
    const focus = game.player.planet === p && game.control === 'foot' ? game.player.pos : p.toLocal(game.rig.pos, new Vector3());
    const alt = focus.length() - p.radius - Math.max(0, p.params.seaLevel ?? 0);
    const visible = alt < 1200;
    this.group.visible = visible;
    if (!visible) return;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.live.length < this.maxCount()) {
      this.spawnTimer = 1.5;
      this.spawnHerd(focus);
    }
    const playerPos = game.player.pos;
    const onFoot = game.control === 'foot';

    for (let i = this.live.length - 1; i >= 0; i--) {
      const c = this.live[i];
      const d = c.pos.distanceTo(focus);
      if (d > 240) {
        c.group.removeFromParent();
        this.live.splice(i, 1);
        continue;
      }
      if (c.species.plan === 'flyer') this.updateFlyer(c, dt);
      else this.updateWalker(c, dt, onFoot ? playerPos : null, game.player.sprinting);
    }
  }

  private updateWalker(c: Creature, dt: number, player: Vector3 | null, sprinting: boolean): void {
    const p = this.planet!;
    const sp = c.species;
    const up = _up.copy(c.pos).normalize();
    c.timer -= dt;
    const pd = player ? c.pos.distanceTo(player) : Infinity;

    // Decide
    if (sp.temperament === 'Skittish' || sp.temperament === 'Timid') {
      const fear = sp.temperament === 'Skittish' ? (sprinting ? 28 : 16) : 9;
      if (pd < fear && c.state !== 'flee') {
        c.state = 'flee';
        c.timer = 3 + Math.random() * 2;
      }
    } else if (sp.temperament === 'Curious' && pd < 22 && pd > 5 && c.state !== 'approach' && Math.random() < dt * 0.3) {
      c.state = 'approach';
      c.timer = 6;
    }
    if (c.timer <= 0) {
      if (c.state === 'idle') {
        c.state = 'wander';
        c.timer = 4 + Math.random() * 5;
        const t1 = anyPerpendicular(up, _v).applyAxisAngle(up, Math.random() * Math.PI * 2);
        c.target.copy(c.pos).addScaledVector(t1, 8 + Math.random() * 18);
      } else {
        c.state = 'idle';
        c.timer = 2 + Math.random() * 5;
      }
    }

    let desired = 0;
    const dir = _v2.set(0, 0, 0);
    if (c.state === 'wander') {
      dir.copy(c.target).sub(c.pos);
      if (dir.length() < 1.5) {
        c.state = 'idle';
        c.timer = 2 + Math.random() * 4;
      }
      desired = sp.speed * 0.35;
    } else if (c.state === 'flee' && player) {
      dir.copy(c.pos).sub(player);
      desired = sp.speed * 1.2;
    } else if (c.state === 'approach' && player) {
      dir.copy(player).sub(c.pos);
      desired = pd > 5 ? sp.speed * 0.4 : 0;
    }
    dir.addScaledVector(up, -dir.dot(up));
    if (dir.lengthSq() > 1e-4 && desired > 0) {
      dir.normalize();
      // turn smoothly toward the desired direction
      c.heading.lerp(dir, 1 - Math.exp(-3 * dt));
    }
    c.heading.addScaledVector(up, -c.heading.dot(up));
    if (c.heading.lengthSq() < 1e-6) anyPerpendicular(up, c.heading);
    c.heading.normalize();
    c.speed += (desired - c.speed) * (1 - Math.exp(-4 * dt));
    c.pos.addScaledVector(c.heading, c.speed * dt);

    // Stay on the ground (and out of the sea)
    const r = p.groundRadiusAtLocal(c.pos);
    const sea = p.seaRadius;
    if (sea !== null && r < sea - 0.3 && p.params.liquid !== 'ice') {
      c.pos.addScaledVector(c.heading, -c.speed * dt * 2);
      c.heading.negate();
      c.state = 'wander';
      c.timer = 3;
      c.target.copy(c.pos).addScaledVector(c.heading, 12);
    }
    const nr = p.groundRadiusAtLocal(c.pos);
    c.pos.setLength(nr);

    // Animate
    c.phase += dt * (c.speed / Math.max(0.3, c.scale)) * 3.2;
    let yOff = 0;
    if (c.species.plan === 'hopper') {
      if (c.hop <= 0 && c.speed > 0.4) c.hopV = 3 + c.speed * 0.3;
      c.hopV -= 14 * dt;
      c.hop = Math.max(0, c.hop + c.hopV * dt);
      if (c.hop <= 0) c.hopV = 0;
      yOff = c.hop;
      const squash = c.hop > 0 ? 1.1 : 0.92 + 0.08 * Math.min(1, c.speed);
      c.group.scale.set(c.scale / Math.sqrt(squash), c.scale * squash, c.scale / Math.sqrt(squash));
    } else {
      const amp = Math.min(0.9, c.speed / (sp.speed * 0.6)) * 0.6;
      c.legs.forEach((leg, i) => {
        const side = i % 2 === 0 ? 1 : -1;
        const pair = Math.floor(i / 2);
        leg.rotation.x = Math.sin(c.phase + (pair % 2 === 0 ? 0 : Math.PI) + (side > 0 ? 0 : Math.PI)) * amp;
      });
      yOff = Math.abs(Math.sin(c.phase)) * 0.04 * c.scale * Math.min(1, c.speed);
      if (c.state === 'idle') yOff += Math.sin(performance.now() * 0.002 + c.phase) * 0.01;
    }
    this.place(c, yOff);
  }

  private updateFlyer(c: Creature, dt: number): void {
    const p = this.planet!;
    const up = _up.copy(c.flyCenter).normalize();
    c.flyAngle += dt * (c.species.speed / 40);
    const t1 = anyPerpendicular(up, _v);
    const t2 = _v2.crossVectors(up, t1);
    const radius = 30 + c.flyAlt;
    const dir = up.clone().multiplyScalar(p.radius).addScaledVector(t1, Math.cos(c.flyAngle) * radius).addScaledVector(t2, Math.sin(c.flyAngle) * radius).normalize();
    const ground = Math.max(p.groundRadiusAtLocal(dir), p.seaRadius ?? 0);
    const next = dir.multiplyScalar(ground + c.flyAlt + Math.sin(c.flyAngle * 3) * 3);
    const vel = next.clone().sub(c.pos);
    if (vel.lengthSq() > 1e-6) c.heading.copy(vel).normalize();
    c.pos.copy(next);
    c.phase += dt * 9;
    c.wings.forEach((w, i) => (w.rotation.z = Math.sin(c.phase) * 0.7 * (i === 0 ? 1 : -1)));
    this.place(c, 0);
  }

  private place(c: Creature, yOff: number): void {
    const up = _up.copy(c.pos).normalize();
    c.group.position.copy(c.pos).addScaledVector(up, yOff);
    quatFromForwardUp(c.heading, up, _q);
    c.group.quaternion.copy(_q);
  }

  /** Ray pick (planet-local). */
  pick(origin: Vector3, dir: Vector3, maxDist: number): { species: CreatureSpecies; dist: number; pos: Vector3 } | null {
    let best: { species: CreatureSpecies; dist: number; pos: Vector3 } | null = null;
    for (const c of this.live) {
      const up = _up.copy(c.pos).normalize();
      const center = _v.copy(c.pos).addScaledVector(up, c.species.model.height * 0.5 * c.scale);
      const rad = Math.max(0.6, c.species.model.length * 0.5 * c.scale);
      const oc = _v2.copy(origin).sub(center);
      const b = oc.dot(dir);
      const cc = oc.lengthSq() - rad * rad;
      const disc = b * b - cc;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > maxDist) continue;
      if (!best || t < best.dist) best = { species: c.species, dist: t, pos: center.clone() };
    }
    return best;
  }

  /** Positions of live creatures near a point (for the scanner). */
  nearby(local: Vector3, radius: number): { local: Vector3; species: CreatureSpecies }[] {
    return this.live
      .filter((c) => c.pos.distanceTo(local) < radius)
      .map((c) => ({ local: c.pos.clone().addScaledVector(c.pos.clone().normalize(), c.species.model.height * c.scale + 1), species: c.species }));
  }
}
