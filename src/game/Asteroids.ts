import { IcosahedronGeometry, InstancedMesh, Matrix4, Quaternion, Vector3, type Scene, type ShaderMaterial } from 'three';
import { hsl, rgbToLinear } from '../engine/color';
import type { Input } from '../engine/input';
import { Simplex } from '../engine/noise';
import { hash4, hashFloat, hashInt, Rng } from '../engine/rng';
import type { QualityPreset } from '../engine/settings';
import { createLitMaterial, type GlobalUniforms, type PlanetUniforms } from '../gfx/materials';
import { displace, MeshBuilder } from '../gfx/meshBuilder';
import type { MarkerSpec } from '../ui/Hud';
import type { StarSystemDesc } from '../world/starSystem';
import { Beam } from './Effects';
import type { Game } from './Game';

const CELL = 1600;
const VARIANTS = 4;

interface Rock {
  id: number;
  pos: Vector3;
  radius: number;
  variant: number;
  quat: Quaternion;
  hp: number;
}

const _m = new Matrix4();
const _s = new Vector3();
const _v = new Vector3();
const _d = new Vector3();
const _q = new Quaternion();

/** Asteroid fields in open space, mined with the ship's lasers for Tritium. */
export class Asteroids {
  private meshes: InstancedMesh[] = [];
  private material: ShaderMaterial;
  private rocks: Rock[] = [];
  private destroyed = new Map<string, Set<number>>();
  private system: StarSystemDesc | null = null;
  private anchor = new Vector3(1e12, 0, 0);
  private beams: Beam[];
  private fireCarry = 0;
  heat = 0;
  overheated = false;
  prompt: string | null = null;
  markers: MarkerSpec[] = [];
  private firing = false;

  constructor(scene: Scene, G: GlobalUniforms, P: PlanetUniforms, private quality: QualityPreset) {
    const base = rgbToLinear(hsl(28, 0.08, 0.36));
    this.material = createLitMaterial(G, P, { vertexColors: true, specular: 0.05 });
    for (let v = 0; v < VARIANTS; v++) {
      const rng = new Rng(9000 + v);
      const n = new Simplex(rng.uint());
      const g = new IcosahedronGeometry(1, 2);
      displace(g, (x, y, z) => 1 + n.noise3(x * 1.4, y * 1.4, z * 1.4) * 0.38 + n.noise3(x * 3.5, y * 3.5, z * 3.5) * 0.12);
      g.scale(rng.range(0.8, 1.2), rng.range(0.6, 0.95), rng.range(0.9, 1.3));
      const b = new MeshBuilder();
      b.add(g, [base[0] * rng.range(0.8, 1.2), base[1] * rng.range(0.8, 1.1), base[2] * rng.range(0.8, 1.1)]);
      const mesh = new InstancedMesh(b.build(), this.material, 600);
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
    this.beams = [new Beam(scene, new Vector3(1.0, 0.3, 0.2), 0.12), new Beam(scene, new Vector3(1.0, 0.3, 0.2), 0.12)];
  }

  setQuality(q: QualityPreset): void {
    this.quality = q;
    this.anchor.set(1e12, 0, 0);
  }

  setSystem(sys: StarSystemDesc): void {
    this.system = sys;
    if (!this.destroyed.has(sys.key)) this.destroyed.set(sys.key, new Set());
    this.anchor.set(1e12, 0, 0);
  }

  clear(): void {
    this.rocks = [];
    for (const m of this.meshes) m.count = 0;
    this.anchor.set(1e12, 0, 0);
  }

  private rebuild(center: Vector3, game: Game): void {
    const sys = this.system;
    if (!sys) return;
    this.anchor.copy(center);
    this.rocks = [];
    const R = this.quality.asteroidRadius;
    const dead = this.destroyed.get(sys.key)!;
    const c0x = Math.floor((center.x - R) / CELL), c1x = Math.floor((center.x + R) / CELL);
    const c0y = Math.floor((center.y - R) / CELL), c1y = Math.floor((center.y + R) / CELL);
    const c0z = Math.floor((center.z - R) / CELL), c1z = Math.floor((center.z + R) / CELL);
    const density = sys.asteroidDensity;
    for (let x = c0x; x <= c1x; x++) {
      for (let y = c0y; y <= c1y; y++) {
        for (let z = c0z; z <= c1z; z++) {
          const h = hash4(x, y, z, sys.seed | 0);
          // clumpy fields: only some cells are populated
          const field = hashFloat(hash4(Math.floor(x / 4), Math.floor(y / 3), Math.floor(z / 4), sys.seed ^ 0x3a));
          if (field > 0.35 * density + 0.1) continue;
          const n = Math.floor(hashFloat(h) * 7 * density);
          for (let i = 0; i < n; i++) {
            const hh = hashInt(h + i * 7919);
            const px = (x + hashFloat(hashInt(hh + 1))) * CELL;
            const py = (y + hashFloat(hashInt(hh + 2))) * CELL;
            const pz = (z + hashFloat(hashInt(hh + 3))) * CELL;
            const pos = new Vector3(px, py, pz);
            if (pos.distanceTo(center) > R) continue;
            const id = hh >>> 0;
            if (dead.has(id)) continue;
            let blocked = pos.length() < 60000;
            for (const p of game.universe.planets) {
              if (pos.distanceTo(p.center) < p.atmoRadius * 1.6 + 2000) {
                blocked = true;
                break;
              }
            }
            if (blocked) continue;
            const radius = 6 + Math.pow(hashFloat(hashInt(hh + 4)), 3) * 60;
            const quat = new Quaternion().setFromAxisAngle(
              _v.set(hashFloat(hashInt(hh + 5)) - 0.5, hashFloat(hashInt(hh + 6)) - 0.5, hashFloat(hashInt(hh + 7)) - 0.5).normalize(),
              hashFloat(hashInt(hh + 8)) * Math.PI * 2,
            );
            this.rocks.push({ id, pos, radius, variant: hh % VARIANTS, quat, hp: radius * 2.2 });
          }
        }
      }
    }
    this.writeInstances();
  }

  private writeInstances(): void {
    const counts = new Array(VARIANTS).fill(0);
    for (const r of this.rocks) {
      const mesh = this.meshes[r.variant];
      const k = counts[r.variant];
      if (k >= 600) continue;
      _s.setScalar(r.radius);
      _m.compose(_v.copy(r.pos).sub(this.anchor), r.quat, _s);
      mesh.setMatrixAt(k, _m);
      counts[r.variant]++;
    }
    this.meshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
    });
  }

  update(camPos: Vector3, _dt: number, game: Game): void {
    const inSpace = game.control === 'ship' && game.ship.state === 'flying' && !game.ship.inAtmosphere;
    const visible = inSpace || game.mode === 'title';
    for (const m of this.meshes) m.visible = visible;
    if (!visible) {
      for (const b of this.beams) b.hide();
      return;
    }
    if (camPos.distanceTo(this.anchor) > 1200) this.rebuild(camPos, game);
    for (const m of this.meshes) m.position.copy(this.anchor).sub(camPos);

    // Ship collisions
    const ship = game.ship;
    if (ship.state === 'flying' && !ship.pulse) {
      for (const r of this.rocks) {
        const d = ship.pos.distanceTo(r.pos);
        const minD = r.radius * 0.85 + 4;
        if (d < minD) {
          const n = _v.copy(ship.pos).sub(r.pos).divideScalar(Math.max(d, 1e-3));
          ship.pos.addScaledVector(n, minD - d);
          const vn = ship.vel.dot(n);
          if (vn < 0) {
            ship.vel.addScaledVector(n, -vn * 1.6);
            ship.speed *= 0.5;
            const dmg = Math.min(30, -vn / 10);
            ship.shield = Math.max(0, ship.shield - dmg);
            ship.shake = Math.min(1, ship.shake + dmg / 20);
            game.audio.impact(Math.min(1, dmg / 20));
          }
        }
      }
    }
  }

  /** Ship lasers: hold the mine action while flying in space. */
  updateLasers(dt: number, input: Input, game: Game): void {
    this.prompt = null;
    this.markers = [];
    const ship = game.ship;
    const inSpace = ship.state === 'flying' && !ship.inAtmosphere && game.mode === 'play';
    if (!this.firing) this.heat = Math.max(0, this.heat - dt * 0.5);
    if (this.overheated && this.heat < 0.05) this.overheated = false;
    if (!inSpace) {
      this.stopFiring(game);
      return;
    }
    // Target: first rock along the ship's nose
    ship.worldPose(_v, _q);
    const fwd = _d.set(0, 0, -1).applyQuaternion(_q);
    let best: Rock | null = null;
    let bestT = 2500;
    for (const r of this.rocks) {
      const oc = _s.copy(_v).sub(r.pos);
      const b = oc.dot(fwd);
      const c = oc.lengthSq() - r.radius * r.radius * 0.8;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < bestT) {
        bestT = t;
        best = r;
      }
    }
    if (best) {
      this.prompt = `Hold ${game.touch.active ? 'Fire' : 'LMB'} · Mine asteroid (Tritium)`;
    }
    const wantFire = input.isDown('mine') && !this.overheated && !ship.pulse;
    if (!wantFire) {
      this.stopFiring(game);
      return;
    }
    if (!this.firing) {
      this.firing = true;
      game.audio.laser(true);
    }
    this.heat += dt * 0.16;
    if (this.heat >= 1) {
      this.heat = 1;
      this.overheated = true;
      game.hud.toast('Ship lasers overheated', 'var(--warn)', '!');
      this.stopFiring(game);
      return;
    }
    const camPos = game.rig.pos;
    const endWorld = best ? _s.copy(_v).addScaledVector(fwd, bestT) : _s.copy(_v).addScaledVector(fwd, 2500);
    const endRel = endWorld.clone().sub(camPos);
    game.shipModel.muzzles.forEach((m, i) => {
      const from = m.clone().applyQuaternion(_q).add(_v).sub(camPos);
      this.beams[i].set(from, endRel, game.time, 1);
    });
    if (!best) return;
    best.hp -= dt * 40;
    this.fireCarry += dt;
    if (this.fireCarry > 0.06) {
      this.fireCarry = 0;
      game.effects.burst(endWorld.clone(), [1.4, 0.6, 0.3], 3, 20, 0.6);
    }
    if (best.hp <= 0) this.destroy(best, game);
  }

  private stopFiring(game: Game): void {
    if (this.firing) game.audio.laser(false);
    this.firing = false;
    for (const b of this.beams) b.hide();
  }

  private destroy(r: Rock, game: Game): void {
    this.destroyed.get(this.system!.key)!.add(r.id);
    this.rocks = this.rocks.filter((x) => x !== r);
    this.writeInstances();
    game.effects.burst(r.pos, [1.2, 1.0, 0.8], 60, r.radius * 0.8 + 10, 1.4);
    const tritium = Math.round(12 + r.radius * 1.4);
    const added = game.collect('tritium', tritium);
    game.hud.toast(`+${added} Tritium`, '#a3e86f', 'Tr');
    const rng = new Rng(r.id);
    if (rng.chance(0.3)) {
      const extra = rng.pick(['iron', 'silver', 'gold', 'platinum'] as const);
      const n = rng.int(5, 20);
      game.collect(extra, n);
      game.hud.toast(`+${n} ${extra.charAt(0).toUpperCase() + extra.slice(1)}`, 'var(--text)', '◆');
    }
    game.audio.explode();
  }
}
