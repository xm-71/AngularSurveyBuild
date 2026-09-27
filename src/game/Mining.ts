import { BoxGeometry, CylinderGeometry, Group, Mesh, Vector3 } from 'three';
import type { Input } from '../engine/input';
import { hsl, rgbToLinear } from '../engine/color';
import { createLitMaterial } from '../gfx/materials';
import { mat, MeshBuilder } from '../gfx/meshBuilder';
import type { FloraKind } from '../world/planetTypes';
import { RESOURCES } from '../world/resources';
import { Beam } from './Effects';
import type { Game } from './Game';

const MINE_TIME: Partial<Record<FloraKind, number>> = {
  tree: 3.2, conifer: 3.2, palm: 2.8, mushroom: 2.6, bush: 1.1, cactus: 1.6, rock: 1.4, boulder: 3.6,
  crystal: 1.8, sodiumPlant: 1.3, oxygenPlant: 1.3, deposit: 5.5, spireRock: 3.2, bulb: 1.4,
};

const _o = new Vector3();
const _d = new Vector3();
const _w = new Vector3();
const _w2 = new Vector3();

/** The multi-tool mining beam used on foot. */
export class Mining {
  heat = 0;
  overheated = false;
  targeting = false;
  prompt: string | null = null;
  private tool: Group;
  private beam: Beam;
  private progress = new Map<number, { mined: number; carry: number }>();
  private active = false;
  private sparkTimer = 0;
  private bob = 0;

  constructor(private game: Game) {
    const b = new MeshBuilder();
    const dark = rgbToLinear(hsl(210, 0.12, 0.16));
    const body = rgbToLinear(hsl(28, 0.75, 0.52));
    const glow = rgbToLinear(hsl(40, 1, 0.6));
    b.add(new BoxGeometry(0.09, 0.11, 0.34), body, mat([0, 0, 0]));
    b.add(new BoxGeometry(0.07, 0.16, 0.08), dark, mat([0, -0.1, 0.1], [0.3, 0, 0]));
    b.add(new CylinderGeometry(0.025, 0.035, 0.22, 6), dark, mat([0, 0.02, -0.26], [Math.PI / 2, 0, 0]));
    b.add(new CylinderGeometry(0.03, 0.03, 0.02, 6), glow, mat([0, 0.02, -0.375], [Math.PI / 2, 0, 0]), 3);
    b.add(new BoxGeometry(0.02, 0.05, 0.2), glow, mat([0.05, 0.03, -0.02]), 1.5);
    const m = createLitMaterial(game.G, game.universe.local, { vertexColors: true, glow: true, glowStrength: 2, specular: 0.5 });
    this.tool = new Group();
    this.tool.add(new Mesh(b.build(), m));
    this.tool.position.set(0.19, -0.17, -0.6);
    this.tool.scale.setScalar(0.55);
    this.tool.renderOrder = 10;
    game.ctx.camera.add(this.tool);
    this.beam = new Beam(game.ctx.scene, new Vector3(1.0, 0.62, 0.25), 0.028);
  }

  setVisible(v: boolean): void {
    this.tool.visible = v;
    const aspect = this.game.ctx.camera.aspect || 1;
    const k = aspect < 1 ? 0.62 : 1;
    this.tool.scale.setScalar(0.55 * k);
    this.tool.position.x = aspect < 1 ? 0.1 : 0.19;
  }

  stop(): void {
    this.active = false;
    this.beam.hide();
    this.game.audio.mining(false);
  }

  update(dt: number, input: Input | null): void {
    const g = this.game;
    const onFoot = g.control === 'foot' && g.mode === 'play';
    this.prompt = null;
    this.targeting = false;
    const minerLvl = g.inventory.upgradeLevel('miner');

    // Cooling
    if (!this.active) this.heat = Math.max(0, this.heat - dt * 0.45);
    if (this.overheated && this.heat <= 0.02) this.overheated = false;

    if (!onFoot || !input || g.scanner.visor) {
      if (this.active) this.stop();
      return;
    }

    // Aim ray in planet-local space
    const planet = g.player.planet;
    planet.toLocal(g.rig.pos, _o);
    planet.dirToLocal(_w.set(0, 0, -1).applyQuaternion(g.rig.quat), _d);
    const hit = g.flora.pick(_o, _d, 45, (s) => s.resource !== null);
    if (hit) {
      this.targeting = true;
      const res = RESOURCES[hit.species.resource!];
      this.prompt = `Hold ${g.touch.active ? 'Mine' : 'LMB'} · ${res.name}`;
    }

    const wantMine = input.isDown('mine') && !this.overheated;
    if (!wantMine) {
      if (this.active) this.stop();
      this.bob += dt;
      this.tool.position.y = -0.17 + Math.sin(this.bob * 1.5) * 0.004;
      return;
    }
    if (!this.active) {
      this.active = true;
      g.audio.mining(true);
    }
    this.heat += dt * (0.13 - 0.025 * minerLvl);
    if (this.heat >= 1) {
      this.heat = 1;
      this.overheated = true;
      g.hud.toast('Mining beam overheated', 'var(--warn)', '!');
      this.stop();
      return;
    }

    // Beam from the tool muzzle toward the target (or straight ahead).
    const muzzle = _w2.set(0, 0.02, -0.38);
    this.tool.localToWorld(muzzle);
    let endRel: Vector3;
    if (hit) {
      endRel = planet.toWorld(hit.local, new Vector3()).sub(g.rig.pos);
    } else {
      endRel = _w.set(0, 0, -30).applyQuaternion(g.rig.quat);
    }
    this.beam.set(muzzle, endRel, g.time, 1);
    this.tool.position.y = -0.17 + (Math.random() - 0.5) * 0.004;

    if (!hit) return;
    const sp = hit.species;
    const total = Math.round(sp.yield * hit.scale);
    const time = (MINE_TIME[sp.kind] ?? 2) * (1 - 0.2 * minerLvl) * Math.max(0.6, hit.scale);
    let st = this.progress.get(hit.mineId);
    if (!st) {
      st = { mined: 0, carry: 0 };
      this.progress.set(hit.mineId, st);
    }
    st.carry += (total / time) * dt;
    const whole = Math.floor(st.carry);
    if (whole > 0) {
      st.carry -= whole;
      const give = Math.min(whole, total - st.mined);
      st.mined += give;
      const added = g.collect(sp.resource!, give);
      if (added < give && added === 0) g.hud.toast(`${RESOURCES[sp.resource!].name} storage full`, 'var(--warn)', '!');
    }
    this.sparkTimer -= dt;
    const hitWorld = planet.toWorld(hit.local, new Vector3());
    if (this.sparkTimer <= 0) {
      this.sparkTimer = 0.05;
      const c = hexToLin(RESOURCES[sp.resource!].color);
      g.effects.burst(hitWorld, c, 3, 5, 0.5);
    }
    if (st.mined >= total) {
      g.flora.markMined(hit.mineId);
      this.progress.delete(hit.mineId);
      const res = RESOURCES[sp.resource!];
      g.hud.toast(`+${total} ${res.name}`, res.color, res.symbol);
      g.effects.burst(hitWorld, hexToLin(res.color), 26, 9, 0.9);
      g.audio.collect();
    }
  }
}

function hexToLin(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  const f = (x: number) => Math.pow(x / 255, 2.2) * 1.5;
  return [f((v >> 16) & 255), f((v >> 8) & 255), f(v & 255)];
}
