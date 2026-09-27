import './style.css';
import { Quaternion, Vector3 } from 'three';
import { quatFromForwardUp } from './engine/math';
import { saveJSON } from './engine/storage';
import { Game } from './game/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

interface HotApi {
  snapshot?: (fn: () => unknown) => void;
  ready?: (fn: (data: Record<string, unknown>) => void) => void;
  data?: Record<string, unknown>;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function showFatal(message: string): void {
  ui.innerHTML = '';
  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.innerHTML = `<div class="panel" style="width:min(480px,100%)"><div class="eyebrow">Starwander</div><h2 class="panel-title" style="margin:8px 0">Can't start the engine</h2><p style="color:var(--muted);margin:0"></p></div>`;
  (screen.querySelector('p') as HTMLElement).textContent = message;
  ui.append(screen);
}

let game: Game | null = null;

function start(data: Record<string, unknown>): void {
  if (game) return;
  if (!webglAvailable()) {
    showFatal('This browser or device does not support WebGL 2, which the planet renderer needs. Try a recent Chrome, Edge, Firefox or Safari.');
    return;
  }
  // A snapshot from a hot reload restores the journey in progress.
  if (data && typeof data === 'object' && data.save) saveJSON('starwander.save.v1', data.save);
  try {
    game = new Game(canvas, ui);
    game.start();
  } catch (e) {
    console.error(e);
    showFatal(`Something went wrong while starting: ${(e as Error).message}`);
    return;
  }
  exposeDebug(game);
}

/** Small scripting surface used for automated screenshots and debugging. */
function exposeDebug(g: Game): void {
  const api = {
    game: g,
    stats() {
      return {
        mode: g.mode,
        control: g.control,
        pending: g.pool.pending,
        workers: g.pool.usingWorkers,
        planet: g.activePlanet?.params.name ?? null,
        settled: g.pool.pending === 0 && g.universe.planets.every((p) => p.tree.requested === 0),
        ship: g.ship.state,
        calls: g.ctx.renderer.info.render.calls,
        tris: g.ctx.renderer.info.render.triangles,
      };
    },
    /** Put the explorer on foot at a local direction of a planet. */
    footAt(planetIndex: number, dir?: number[]) {
      const p = g.universe.planets[planetIndex];
      const d = dir ? new Vector3(dir[0], dir[1], dir[2]).normalize() : g.findSpawn(p, new (class { next() { return Math.random(); } range(a: number, b: number) { return a + (b - a) * Math.random(); } })() as never).dir;
      g.player.planet = p;
      g.player.placeAt(d);
      g.control = 'foot';
      g.rig.setMode('foot', true);
      return d.toArray();
    },
    /** Put the ship in flight above a planet at an altitude, facing along the surface. */
    flyAt(planetIndex: number, alt: number, dir?: number[], pitch = 0) {
      const p = g.universe.planets[planetIndex];
      const d = dir ? new Vector3(dir[0], dir[1], dir[2]).normalize() : p.dirToLocal(p.sunDir, new Vector3()).normalize();
      const ground = Math.max(p.groundRadiusAtLocal(d), p.seaRadius ?? 0);
      const local = d.clone().multiplyScalar(ground + alt);
      const world = p.toWorld(local, new Vector3());
      const upW = p.dirToWorld(d, new Vector3());
      const t = new Vector3(0, 1, 0).cross(upW).normalize();
      const fwd = t.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(upW, Math.sin(pitch)).normalize();
      const q = quatFromForwardUp(fwd, upW, new Quaternion());
      g.ship.placeFlying(world, q, 120);
      g.control = 'ship';
      g.rig.setMode('chase', true);
    },
  };
  (window as unknown as { __sw: typeof api }).__sw = api;
}

const hot = (window as unknown as { claude?: { hot?: HotApi } }).claude?.hot;
hot?.snapshot?.(() => ({ save: game?.snapshot() ?? null }));
if (hot?.ready) hot.ready(start);
else start(hot?.data ?? {});
