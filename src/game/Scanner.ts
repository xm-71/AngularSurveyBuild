import { Vector3 } from 'three';
import type { Input } from '../engine/input';
import { formatDistance } from '../engine/math';
import type { FloraKind, FloraSpeciesDesc } from '../world/planetTypes';
import { RESOURCES } from '../world/resources';
import type { Game } from './Game';
import type { Planet } from './Planet';

export interface ScanMarker {
  local: Vector3;
  label: string;
  kind: 'resource' | 'creature' | 'poi';
  color: string;
}

const FLORA_LABEL: Record<FloraKind, string> = {
  tree: 'Tree', conifer: 'Conifer', palm: 'Palm', mushroom: 'Giant fungus', bush: 'Shrub', cactus: 'Succulent',
  grass: 'Grass', rock: 'Rock', boulder: 'Boulder', crystal: 'Crystal formation', sodiumPlant: 'Sodium plant',
  oxygenPlant: 'Oxygen plant', deposit: 'Mineral deposit', spireRock: 'Rock spire', bulb: 'Bulb plant',
};

const MINERAL_KINDS: FloraKind[] = ['boulder', 'crystal', 'deposit', 'spireRock', 'rock'];

const _o = new Vector3();
const _d = new Vector3();
const _w = new Vector3();

type Target =
  | { kind: 'fauna'; id: string; name: string; sub: string; details: [string, string][]; reward: number; planet: Planet }
  | { kind: 'flora' | 'mineral'; id: string; name: string; sub: string; details: [string, string][]; reward: number; planet: Planet }
  | { kind: 'planet'; id: string; name: string; sub: string; planet: Planet };

/** Scanner pulse (C) and analysis visor (F). */
export class Scanner {
  visor = false;
  markers: ScanMarker[] = [];
  panel: { title: string; sub: string; progress: number } | null = null;
  prompt: string | null = null;
  private cooldown = 0;
  private markerTime = 0;
  private target: Target | null = null;
  private progress = 0;

  constructor(private game: Game) {}

  update(dt: number, input: Input): void {
    const g = this.game;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.markerTime -= dt;
    if (this.markerTime <= 0) this.markers = [];
    this.panel = null;
    this.prompt = null;

    if (input.wasPressed('visor')) {
      this.visor = !this.visor;
      this.progress = 0;
      g.audio.ui();
    }
    if (g.control === 'ship' && g.ship.state === 'landed') this.visor = false;

    if (g.control === 'foot' && input.wasPressed('scan')) this.pulse();

    if (!this.visor) {
      this.target = null;
      return;
    }
    const t = g.control === 'foot' ? this.aimFoot() : this.aimShip();
    if (!t) {
      this.target = null;
      this.progress = 0;
      this.panel = { title: 'Analysis visor', sub: g.control === 'foot' ? 'Aim at plants, minerals or creatures' : 'Aim at a planet to survey it', progress: 0 };
      return;
    }
    if (!this.target || this.target.id !== t.id) {
      this.target = t;
      this.progress = 0;
    }
    const known = g.discoveries.has(t.id);
    if (known) {
      this.panel = { title: t.name, sub: `${t.sub} · Logged`, progress: 1 };
      return;
    }
    this.progress = Math.min(1, this.progress + dt / (t.kind === 'planet' ? 2 : 1.2));
    this.panel = { title: t.name, sub: t.sub, progress: this.progress };
    if (this.progress >= 1) this.complete(t);
  }

  private pulse(): void {
    const g = this.game;
    if (this.cooldown > 0) {
      g.hud.toast(`Scanner recharging (${this.cooldown.toFixed(0)} s)`, 'var(--muted)');
      return;
    }
    this.cooldown = 5;
    const planet = g.player.planet;
    const center = g.player.pos;
    g.effects.scanPulse(planet.toWorld(center, new Vector3()), 240);
    g.audio.scan();
    const interesting = (s: FloraSpeciesDesc) =>
      s.kind === 'deposit' || s.kind === 'crystal' || s.kind === 'sodiumPlant' || s.kind === 'oxygenPlant';
    const found = g.flora.nearby(center, 240, interesting, 36);
    // keep a few of each kind so the view is not flooded
    const perKind = new Map<string, number>();
    this.markers = [];
    for (const f of found) {
      const n = perKind.get(f.species.kind) ?? 0;
      if (n >= 3) continue;
      perKind.set(f.species.kind, n + 1);
      const res = RESOURCES[f.species.resource!];
      this.markers.push({ local: f.local, label: res.name, kind: 'resource', color: res.color });
    }
    for (const c of g.creatures.nearby(center, 160).slice(0, 3)) {
      this.markers.push({ local: c.local, label: g.discoveries.has(c.species.id) ? c.species.name : 'Unknown lifeform', kind: 'creature', color: 'var(--scan)' });
    }
    this.markerTime = 28;
    g.hud.toast(this.markers.length ? `Scan complete · ${this.markers.length} signals` : 'Scan complete · no signals nearby', 'var(--scan)', '◎');
  }

  private aimFoot(): Target | null {
    const g = this.game;
    const planet = g.player.planet;
    planet.toLocal(g.rig.pos, _o);
    planet.dirToLocal(_w.set(0, 0, -1).applyQuaternion(g.rig.quat), _d);
    const cr = g.creatures.pick(_o, _d, 70);
    const fl = g.flora.pick(_o, _d, 60, (s) => s.scannable);
    if (cr && (!fl || cr.dist < fl.dist)) {
      const s = cr.species;
      const height = s.model.height * (s.scale[0] + s.scale[1]) * 0.5;
      const weight = Math.round(Math.pow(height, 3) * 60 + 5);
      return {
        kind: 'fauna',
        id: s.id,
        name: g.discoveries.has(s.id) ? s.name : 'Unknown lifeform',
        sub: `${formatDistance(cr.dist)} · ${s.diet}`,
        details: [
          ['Diet', s.diet],
          ['Temperament', s.temperament],
          ['Height', `${height.toFixed(1)} m`],
          ['Weight', `${weight} kg`],
          ['Notes', s.notes],
        ],
        reward: 1200 + Math.round(height * 350),
        planet,
      };
    }
    if (fl) {
      const s = fl.species;
      const mineral = MINERAL_KINDS.includes(s.kind);
      const id = `${mineral ? 'mineral' : 'flora'}:${planet.params.id}:${s.index}`;
      const res = s.resource ? RESOURCES[s.resource].name : '—';
      return {
        kind: mineral ? 'mineral' : 'flora',
        id,
        name: g.discoveries.has(id) ? s.name : FLORA_LABEL[s.kind],
        sub: `${formatDistance(fl.dist)} · ${FLORA_LABEL[s.kind]}`,
        details: [
          ['Type', FLORA_LABEL[s.kind]],
          ['Yields', res],
          ['Habitat', s.moistMin > 0.2 ? 'Damp ground' : s.moistMax < 0.8 ? 'Dry ground' : 'Widespread'],
        ],
        reward: mineral ? 350 : 550,
        planet,
      };
    }
    return null;
  }

  private aimShip(): Target | null {
    const g = this.game;
    const fwd = _w.set(0, 0, -1).applyQuaternion(g.rig.quat);
    let best: Planet | null = null;
    let bestDot = Math.cos(0.06);
    for (const p of g.universe.planets) {
      const dir = _d.copy(p.center).sub(g.rig.pos);
      const dist = dir.length();
      const ang = Math.max(0.03, Math.atan(p.radius / dist) * 0.8);
      const dot = dir.divideScalar(dist).dot(fwd);
      if (dot > Math.cos(ang) && dot > bestDot - 0.05) {
        bestDot = dot;
        best = p;
      }
    }
    if (!best) return null;
    const p = best.params;
    return { kind: 'planet', id: `planet:${p.id}`, name: p.name, sub: `${p.label} · ${p.descriptor}`, planet: best };
  }

  private complete(t: Target): void {
    const g = this.game;
    this.progress = 0;
    if (t.kind === 'planet') {
      g.discoverPlanet(t.planet);
      return;
    }
    const s = g.system;
    const name = t.kind === 'fauna' ? this.speciesName(t) : this.floraName(t);
    g.discoveries.add({
      id: t.id,
      kind: t.kind,
      name,
      systemKey: s.key,
      systemName: s.name,
      planetId: t.planet.params.id,
      planetName: t.planet.params.name,
      details: t.details,
      reward: t.reward,
      time: Date.now(),
    });
    g.hud.toast(`${t.kind === 'fauna' ? 'Fauna' : t.kind === 'mineral' ? 'Mineral' : 'Flora'} discovered: ${name}  +${t.reward.toLocaleString('en-US')} u`, 'var(--scan)', '◎');
    g.audio.discover();
  }

  private speciesName(t: Target): string {
    const sp = this.game.creatures.species.find((s) => s.id === t.id);
    return sp?.name ?? t.name;
  }

  private floraName(t: Target): string {
    const parts = t.id.split(':');
    const idx = Number(parts[parts.length - 1]);
    return t.planet.params.flora[idx]?.name ?? t.name;
  }
}
