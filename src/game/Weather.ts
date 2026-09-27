import {
  AdditiveBlending, BufferAttribute, BufferGeometry, LineSegments, NormalBlending, Points, ShaderMaterial, Vector3, type Scene,
} from 'three';
import { Simplex } from '../engine/noise';
import type { PlanetParams } from '../world/planetTypes';
import type { Game } from './Game';

type WeatherKind = 'none' | 'rain' | 'acid' | 'snow' | 'dust' | 'ash' | 'motes';

const BOX = 36;

const PT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uSize;
uniform float uPixelRatio;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * 60.0 / max(-mv.z, 0.2), 1.0, 14.0) * uPixelRatio;
  #include <logdepthbuf_vertex>
}
`;

const PT_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  #include <logdepthbuf_fragment>
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.2, d) * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

const LINE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const LINE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(uColor, uOpacity);
  #include <colorspace_fragment>
}
`;

function kindFor(p: PlanetParams): WeatherKind {
  if (!p.atmosphere) return 'none';
  const w = p.weather.toLowerCase();
  if (p.biome === 'frozen' || /snow|icy|whiteout|frigid/.test(w)) return 'snow';
  if (p.biome === 'desert' || /sand|dust|dry/.test(w)) return 'dust';
  if (p.biome === 'volcanic' || /ash|ember|magma|burning/.test(w)) return 'ash';
  if (p.biome === 'toxic' || /acid|toxic|caustic/.test(w)) return 'acid';
  if (/rain|drizzle|deluge|squall|humid|mist|fog/.test(w)) return 'rain';
  if (p.biome === 'exotic' || p.biome === 'radioactive') return 'motes';
  return 'none';
}

/** Local weather particles around the camera, plus storms that raise hazards. */
export class Weather {
  private n: number;
  private pos: Float32Array;
  private seed: Float32Array;
  private points: Points;
  private lines: LineSegments;
  private linePos: Float32Array;
  private ptMat: ShaderMaterial;
  private lineMat: ShaderMaterial;
  private lastCam = new Vector3();
  private hasLast = false;
  private noise = new Simplex(4242);
  kind: WeatherKind = 'none';
  intensity = 0;
  storm = false;
  private stormAnnounced = false;

  constructor(scene: Scene, count: number) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.pos[i * 3] = (Math.random() * 2 - 1) * BOX;
      this.pos[i * 3 + 1] = (Math.random() * 2 - 1) * BOX;
      this.pos[i * 3 + 2] = (Math.random() * 2 - 1) * BOX;
      this.seed[i] = Math.random();
    }
    const pg = new BufferGeometry();
    pg.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.ptMat = new ShaderMaterial({
      uniforms: { uColor: { value: new Vector3(1, 1, 1) }, uOpacity: { value: 0.8 }, uSize: { value: 1 }, uPixelRatio: { value: 1 } },
      vertexShader: PT_VERT,
      fragmentShader: PT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.points = new Points(pg, this.ptMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1400;
    this.points.visible = false;
    scene.add(this.points);

    this.linePos = new Float32Array(count * 6);
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(this.linePos, 3));
    this.lineMat = new ShaderMaterial({
      uniforms: { uColor: { value: new Vector3(0.75, 0.8, 0.9) }, uOpacity: { value: 0.35 } },
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.lines = new LineSegments(lg, this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1400;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  set pixelRatio(v: number) {
    this.ptMat.uniforms.uPixelRatio.value = v;
  }

  update(dt: number, game: Game): void {
    const planet = game.activePlanet;
    const onSurface = !!planet && (game.control === 'foot' || (game.ship.inAtmosphere && game.ship.altitude < 400));
    const kind = planet && onSurface && game.mode !== 'title' ? kindFor(planet.params) : 'none';
    if (kind !== this.kind) {
      this.kind = kind;
      this.configure();
    }
    if (kind === 'none' || !planet) {
      this.points.visible = false;
      this.lines.visible = false;
      this.storm = false;
      this.intensity = 0;
      return;
    }
    // Slowly varying weather with occasional storms.
    const t = game.time * 0.012 + planet.params.seed * 1e-6;
    const base = 0.5 + 0.5 * this.noise.noise3(t, 0.3, planet.params.seed % 97);
    const target = Math.max(0, Math.min(1, base * 1.25 - 0.1));
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.5);
    const wasStorm = this.storm;
    this.storm = this.intensity > 0.82 && planet.params.hazard !== 'none';
    if (this.storm && !wasStorm && !this.stormAnnounced) {
      game.hud.toast(`Storm approaching on ${planet.params.name}. Hazard protection drains faster.`, 'var(--warn)', '!');
      this.stormAnnounced = true;
    }
    if (!this.storm && this.intensity < 0.6) this.stormAnnounced = false;

    const cam = game.rig.pos;
    const down = new Vector3().copy(planet.center).sub(cam).normalize();
    const side = new Vector3(0, 1, 0).cross(down).normalize();
    const windDir = side.applyAxisAngle(down, game.time * 0.05);
    const cfg = this.params();
    const fall = cfg.fall * (0.6 + this.intensity * 0.8);
    const wind = cfg.wind * (0.3 + this.intensity);
    // Camera motion: keep particles fixed in the world.
    const dx = this.hasLast ? cam.x - this.lastCam.x : 0;
    const dy = this.hasLast ? cam.y - this.lastCam.y : 0;
    const dz = this.hasLast ? cam.z - this.lastCam.z : 0;
    this.lastCam.copy(cam);
    this.hasLast = true;
    const jump = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > BOX;
    const vx = down.x * fall + windDir.x * wind;
    const vy = down.y * fall + windDir.y * wind;
    const vz = down.z * fall + windDir.z * wind;
    const p = this.pos;
    const active = Math.floor(this.n * Math.min(1, 0.25 + this.intensity * 0.9));
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      if (jump) {
        p[k] = (Math.random() * 2 - 1) * BOX;
        p[k + 1] = (Math.random() * 2 - 1) * BOX;
        p[k + 2] = (Math.random() * 2 - 1) * BOX;
      }
      const s = this.seed[i];
      const wob = cfg.wobble * Math.sin(game.time * (1 + s * 2) + s * 40);
      p[k] += (vx * (0.8 + s * 0.4) + wob * windDir.z) * dt - dx;
      p[k + 1] += (vy * (0.8 + s * 0.4)) * dt - dy;
      p[k + 2] += (vz * (0.8 + s * 0.4) - wob * windDir.x) * dt - dz;
      for (let a = 0; a < 3; a++) {
        if (p[k + a] > BOX) p[k + a] -= BOX * 2;
        else if (p[k + a] < -BOX) p[k + a] += BOX * 2;
      }
    }
    if (cfg.lines) {
      const lp = this.linePos;
      const len = 0.045;
      for (let i = 0; i < active; i++) {
        const k = i * 3;
        lp[i * 6] = p[k];
        lp[i * 6 + 1] = p[k + 1];
        lp[i * 6 + 2] = p[k + 2];
        lp[i * 6 + 3] = p[k] - vx * len;
        lp[i * 6 + 4] = p[k + 1] - vy * len;
        lp[i * 6 + 5] = p[k + 2] - vz * len;
      }
      this.lines.geometry.setDrawRange(0, active * 2);
      (this.lines.geometry.attributes.position as BufferAttribute).needsUpdate = true;
      this.lineMat.uniforms.uOpacity.value = cfg.opacity * (0.4 + this.intensity * 0.6);
      this.lines.visible = true;
      this.points.visible = false;
    } else {
      this.points.geometry.setDrawRange(0, active);
      (this.points.geometry.attributes.position as BufferAttribute).needsUpdate = true;
      this.ptMat.uniforms.uOpacity.value = cfg.opacity * (0.5 + this.intensity * 0.5);
      this.points.visible = true;
      this.lines.visible = false;
    }
    this.points.position.set(0, 0, 0);
    this.lines.position.set(0, 0, 0);
  }

  private params(): { fall: number; wind: number; wobble: number; opacity: number; lines: boolean } {
    switch (this.kind) {
      case 'rain': return { fall: 22, wind: 3, wobble: 0, opacity: 0.35, lines: true };
      case 'acid': return { fall: 18, wind: 3, wobble: 0, opacity: 0.4, lines: true };
      case 'snow': return { fall: 2.2, wind: 2.5, wobble: 0.8, opacity: 0.9, lines: false };
      case 'dust': return { fall: 0.6, wind: 14, wobble: 1.5, opacity: 0.55, lines: false };
      case 'ash': return { fall: 1.2, wind: 3, wobble: 0.6, opacity: 0.8, lines: false };
      case 'motes': return { fall: -0.3, wind: 0.8, wobble: 0.6, opacity: 0.9, lines: false };
      default: return { fall: 0, wind: 0, wobble: 0, opacity: 0, lines: false };
    }
  }

  private configure(): void {
    const c = this.ptMat.uniforms;
    this.ptMat.blending = NormalBlending;
    switch (this.kind) {
      case 'snow':
        c.uColor.value.set(0.95, 0.97, 1.0);
        c.uSize.value = 1.2;
        break;
      case 'dust':
        c.uColor.value.set(0.85, 0.66, 0.42);
        c.uSize.value = 0.9;
        break;
      case 'ash':
        c.uColor.value.set(1.0, 0.45, 0.15);
        c.uSize.value = 0.7;
        this.ptMat.blending = AdditiveBlending;
        break;
      case 'motes':
        c.uColor.value.set(0.6, 1.0, 0.8);
        c.uSize.value = 0.6;
        this.ptMat.blending = AdditiveBlending;
        break;
      case 'acid':
        this.lineMat.uniforms.uColor.value.set(0.7, 0.95, 0.4);
        break;
      case 'rain':
        this.lineMat.uniforms.uColor.value.set(0.75, 0.82, 0.92);
        break;
    }
    this.ptMat.needsUpdate = true;
  }
}
