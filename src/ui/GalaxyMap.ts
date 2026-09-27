import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, Line, LineBasicMaterial, LineLoop, LineSegments, PerspectiveCamera, Points,
  Scene, ShaderMaterial, Vector3,
} from 'three';
import { rgbToLinear } from '../engine/color';
import { formatInt } from '../engine/math';
import type { Game } from '../game/Game';
import { distanceLy, STAR_CLASSES, systemsNear, type SystemSummary } from '../world/galaxy';
import { h, setText } from './dom';

const MAP_RADIUS = 120;

const PT_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * 220.0 / max(-mv.z, 1.0), 2.0, 34.0) * uPixelRatio;
}
`;

const PT_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.35, 0.0, d);
  float halo = smoothstep(1.0, 0.0, d) * 0.35;
  gl_FragColor = vec4(vColor * (core + halo), 1.0);
}
`;

/** 3D galaxy map with target selection and the hyperdrive jump. */
export class GalaxyMap {
  private scene = new Scene();
  private camera = new PerspectiveCamera(55, 1, 0.1, 5000);
  private systems: SystemSummary[] = [];
  private cacheKey = '';
  private points: Points;
  private ptMat: ShaderMaterial;
  private markers: Points;
  private line: Line;
  private range: LineLoop;
  private yaw = 0.6;
  private pitch = 0.5;
  private dist = 150;
  private focus = new Vector3();
  private focusTarget = new Vector3();
  private selected: SystemSummary | null = null;
  private root: HTMLElement;
  private labels: HTMLElement;
  private labelPool: HTMLElement[] = [];
  private info: {
    name: HTMLElement; star: HTMLElement; planets: HTMLElement; dist: HTMLElement; status: HTMLElement; visited: HTMLElement;
    warp: HTMLButtonElement; cells: HTMLElement; range: HTMLElement;
  };
  private dragging = false;
  private dragMoved = 0;
  private lastX = 0;
  private lastY = 0;
  private pinch = 0;
  private pointers = new Map<number, { x: number; y: number }>();

  constructor(private game: Game, parent: HTMLElement) {
    this.scene.background = new Color('#03050b');
    this.ptMat = new ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 } },
      vertexShader: PT_VERT,
      fragmentShader: PT_FRAG,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new Points(new BufferGeometry(), this.ptMat);
    this.scene.add(this.points);
    this.markers = new Points(new BufferGeometry(), this.ptMat);
    this.scene.add(this.markers);
    this.line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: '#ffb547' }));
    this.scene.add(this.line);
    const ring = new BufferGeometry();
    const rp: number[] = [];
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      rp.push(Math.cos(a), 0, Math.sin(a));
    }
    ring.setAttribute('position', new BufferAttribute(new Float32Array(rp), 3));
    this.range = new LineLoop(ring, new LineBasicMaterial({ color: '#5cf0d2', transparent: true, opacity: 0.35 }));
    this.scene.add(this.range);
    // faint grid on the galactic plane
    const grid: number[] = [];
    for (let i = -6; i <= 6; i++) {
      grid.push(i * 20, 0, -120, i * 20, 0, 120, -120, 0, i * 20, 120, 0, i * 20);
    }
    const gg = new BufferGeometry();
    gg.setAttribute('position', new BufferAttribute(new Float32Array(grid), 3));
    this.scene.add(new LineSegments(gg, new LineBasicMaterial({ color: '#1c2638', transparent: true, opacity: 0.5 })));

    const name = h('h3');
    const star = h('span');
    const planets = h('span');
    const dist = h('span');
    const status = h('span');
    const visited = h('span');
    const cells = h('span');
    const range = h('span');
    const warp = h('button', { class: 'btn primary', type: 'button', onclick: () => this.doWarp() }, 'Engage hyperdrive') as HTMLButtonElement;
    this.info = { name, star, planets, dist, status, visited, warp, cells, range };
    this.labels = h('div', { style: 'position:absolute;inset:0;pointer-events:none' });
    const panel = h(
      'div',
      { class: 'map-info' },
      h('div', { class: 'eyebrow' }, 'Target system'),
      name,
      h('div', { class: 'map-row' }, h('span', null, 'Star'), star),
      h('div', { class: 'map-row' }, h('span', null, 'Bodies'), planets),
      h('div', { class: 'map-row' }, h('span', null, 'Distance'), dist),
      h('div', { class: 'map-row' }, h('span', null, 'Status'), visited),
      h('div', { class: 'map-row' }, h('span', null, 'Hyperdrive range'), range),
      h('div', { class: 'map-row' }, h('span', null, 'Warp cells'), cells),
      h('div', { class: 'btn-row' }, warp, h('button', { class: 'btn', type: 'button', onclick: () => game.setMode('play') }, 'Close')),
      status,
    );
    status.className = 'panel-meta';
    const help = h('div', { class: 'map-help', style: 'align-self:flex-end' }, 'Drag to rotate · scroll or pinch to zoom · click a star to select it. Jumps need open space and a warp cell.');
    const top = h('div', { class: 'map-top' },
      h('div', { class: 'map-help', style: 'pointer-events:none' }, h('div', { class: 'eyebrow' }, 'Galaxy map'), h('div', { style: 'margin-top:4px' }, 'Your system glows teal. Visited systems are ringed.')),
      h('button', { class: 'btn small', type: 'button', onclick: () => this.centerCurrent() }, 'Center on current'),
    );
    this.root = h('div', { class: 'screen map-screen' }, this.labels, top, help, panel);
    this.root.hidden = true;
    parent.append(this.root);

    const canvas = game.ctx.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('wheel', (e) => {
      if (this.root.hidden) return;
      this.dist = Math.max(25, Math.min(420, this.dist * (e.deltaY > 0 ? 1.12 : 0.89)));
    }, { passive: true });
  }

  private get current(): SystemSummary {
    return this.game.system;
  }

  open(): void {
    this.root.hidden = false;
    const cur = this.current;
    if (this.cacheKey !== cur.key) this.build();
    if (!this.selected || this.selected.key === cur.key) this.selectNearestUnvisited();
    this.updateInfo();
  }

  close(): void {
    this.root.hidden = true;
  }

  private rel(s: SystemSummary, out: Vector3): Vector3 {
    const c = this.current.pos;
    return out.set(s.pos[0] - c[0], s.pos[1] - c[1], s.pos[2] - c[2]);
  }

  private build(): void {
    const cur = this.current;
    this.cacheKey = cur.key;
    this.systems = systemsNear(cur.pos[0], cur.pos[1], cur.pos[2], MAP_RADIUS);
    if (!this.systems.find((s) => s.key === cur.key)) this.systems.push(cur);
    const n = this.systems.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const v = new Vector3();
    this.systems.forEach((s, i) => {
      this.rel(s, v);
      pos.set([v.x, v.y, v.z], i * 3);
      const c = rgbToLinear(STAR_CLASSES[s.starClass].color);
      col.set([c[0] * 1.2, c[1] * 1.2, c[2] * 1.2], i * 3);
      size[i] = 1 + s.planetCount * 0.15;
    });
    const g = this.points.geometry;
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aColor', new BufferAttribute(col, 3));
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    g.computeBoundingSphere();
    this.focus.set(0, 0, 0);
    this.focusTarget.set(0, 0, 0);
  }

  private selectNearestUnvisited(): void {
    const cur = this.current;
    let best: SystemSummary | null = null;
    let bd = Infinity;
    for (const s of this.systems) {
      if (s.key === cur.key || this.game.visited.has(s.key)) continue;
      const d = distanceLy(s, cur);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    this.select(best);
  }

  private select(s: SystemSummary | null): void {
    this.selected = s;
    this.updateMarkers();
    this.updateInfo();
  }

  private updateMarkers(): void {
    const pts: number[] = [];
    const cols: number[] = [];
    const sizes: number[] = [];
    const v = new Vector3();
    // current system
    pts.push(0, 0, 0);
    cols.push(0.36, 0.94, 0.82);
    sizes.push(4);
    for (const s of this.systems) {
      if (!this.game.visited.has(s.key) || s.key === this.current.key) continue;
      this.rel(s, v);
      pts.push(v.x, v.y, v.z);
      cols.push(0.2, 0.55, 0.5);
      sizes.push(2.6);
    }
    if (this.selected) {
      this.rel(this.selected, v);
      pts.push(v.x, v.y, v.z);
      cols.push(1.0, 0.7, 0.28);
      sizes.push(5);
      const lg = this.line.geometry;
      lg.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, v.x, v.y, v.z]), 3));
      this.line.visible = true;
      this.focusTarget.copy(v).multiplyScalar(0.5);
    } else {
      this.line.visible = false;
    }
    const g = this.markers.geometry;
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    g.setAttribute('aColor', new BufferAttribute(new Float32Array(cols), 3));
    g.setAttribute('aSize', new BufferAttribute(new Float32Array(sizes), 1));
    g.computeBoundingSphere();
    const r = this.game.ship.hyperdriveRange;
    this.range.scale.setScalar(r);
  }

  private updateInfo(): void {
    const s = this.selected;
    const i = this.info;
    const g = this.game;
    setText(i.cells, `${g.ship.warpCells}`);
    setText(i.range, `${g.ship.hyperdriveRange} ly`);
    if (!s) {
      setText(i.name, 'No target');
      i.warp.disabled = true;
      return;
    }
    const d = distanceLy(s, this.current);
    setText(i.name, s.name);
    setText(i.star, STAR_CLASSES[s.starClass].label);
    setText(i.planets, `${s.planetCount} planets`);
    setText(i.dist, `${d.toFixed(1)} ly`);
    setText(i.visited, g.visited.has(s.key) ? 'Visited' : 'Uncharted');
    const inRange = d <= g.ship.hyperdriveRange;
    let msg = '';
    if (!inRange) msg = 'Out of hyperdrive range.';
    else if (g.ship.warpCells < 1) msg = 'No warp cells. Craft one in the inventory (Tab).';
    else if (g.control !== 'ship' || g.ship.state !== 'flying') msg = 'Board your ship and fly to space to jump.';
    else if (g.ship.inAtmosphere || g.ship.altitude < 1500) msg = 'Leave the atmosphere to jump.';
    else msg = `Ready. ${formatInt(g.system.planetCount)} worlds behind, ${s.planetCount} ahead.`;
    setText(i.status, msg);
    i.warp.disabled = !inRange || g.ship.warpCells < 1;
  }

  private doWarp(): void {
    const s = this.selected;
    if (!s) return;
    const d = distanceLy(s, this.current);
    if (d > this.game.ship.hyperdriveRange) return;
    const err = this.game.warp.begin(s);
    if (err) {
      this.game.hud.toast(err, 'var(--warn)', '!');
      setText(this.info.status, err);
    }
  }

  private centerCurrent(): void {
    this.focusTarget.set(0, 0, 0);
  }

  private onDown = (e: PointerEvent): void => {
    if (this.root.hidden) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dragging = true;
    this.dragMoved = 0;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (this.root.hidden || !this.dragging) return;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch > 0) this.dist = Math.max(25, Math.min(420, this.dist * (this.pinch / d)));
      this.pinch = d;
      this.dragMoved += 10;
      return;
    }
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dy * 0.006));
  };

  private onUp = (e: PointerEvent): void => {
    if (this.root.hidden) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = 0;
    if (this.pointers.size > 0) return;
    this.dragging = false;
    if (this.dragMoved < 6 && (e.target as HTMLElement)?.tagName === 'CANVAS') this.pickAt(e.clientX, e.clientY);
  };

  private pickAt(x: number, y: number): void {
    const v = new Vector3();
    const w = window.innerWidth, hh = window.innerHeight;
    let best: SystemSummary | null = null;
    let bd = 22;
    for (const s of this.systems) {
      this.rel(s, v).project(this.camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * hh;
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best && best.key !== this.current.key) {
      this.select(best);
      this.game.audio.ui();
    }
  }

  render(dt: number): void {
    const r = this.game.ctx.renderer;
    const w = window.innerWidth, hh = window.innerHeight;
    this.camera.aspect = w / Math.max(1, hh);
    this.camera.updateProjectionMatrix();
    this.ptMat.uniforms.uPixelRatio.value = r.getPixelRatio();
    this.focus.lerp(this.focusTarget, 1 - Math.exp(-4 * dt));
    this.yaw += dt * 0.02;
    const cp = Math.cos(this.pitch);
    this.camera.position.set(Math.sin(this.yaw) * cp * this.dist, Math.sin(this.pitch) * this.dist, Math.cos(this.yaw) * cp * this.dist).add(this.focus);
    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();
    r.render(this.scene, this.camera);
    this.updateLabels();
  }

  private updateLabels(): void {
    const v = new Vector3();
    const w = window.innerWidth, hh = window.innerHeight;
    const list: { s: SystemSummary; x: number; y: number; d: number; cls: string }[] = [];
    const camDist = this.camera.position.clone();
    for (const s of this.systems) {
      this.rel(s, v);
      const d = v.distanceTo(camDist);
      const isCur = s.key === this.current.key;
      const isSel = this.selected?.key === s.key;
      if (!isCur && !isSel && d > this.dist * 0.75) continue;
      v.project(this.camera);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      list.push({ s, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * hh, d: isCur || isSel ? -1 : d, cls: isCur ? 'current' : isSel ? 'target' : '' });
    }
    list.sort((a, b) => a.d - b.d);
    const shown = list.slice(0, 18);
    while (this.labelPool.length < shown.length) {
      const el = h('div', { class: 'map-label' });
      this.labelPool.push(el);
      this.labels.append(el);
    }
    this.labelPool.forEach((el, i) => {
      const l = shown[i];
      if (!l) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.className = `map-label ${l.cls}`;
      el.style.transform = `translate(${(l.x + 8).toFixed(0)}px, ${(l.y - 7).toFixed(0)}px)`;
      setText(el, l.cls === 'current' ? `${l.s.name} · here` : l.s.name);
    });
  }
}
