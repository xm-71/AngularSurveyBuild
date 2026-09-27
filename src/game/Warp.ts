import { Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import type { SystemSummary } from '../world/galaxy';
import type { Game } from './Game';

const WARP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const WARP_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uAspect;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 p = vUv * vec2(uAspect, 1.0);
  float r = length(p);
  float a = atan(p.y, p.x);
  float z = 0.35 / max(r, 0.02) + uTime * 3.5;
  float lanes = 64.0;
  float cell = floor(a / 6.2831 * lanes);
  float h = hash(vec2(cell, floor(z * 0.6)));
  float streak = smoothstep(0.5, 0.0, abs(fract(a / 6.2831 * lanes) - 0.5) * 2.0 - 0.2);
  float len = fract(z * 0.6 + h);
  float s = streak * smoothstep(0.0, 0.1, len) * smoothstep(0.55, 0.15, len) * step(0.55, h);
  vec3 col = mix(uColA, uColB, h) * s * 2.2;
  float tunnel = smoothstep(1.4, 0.0, r) * 0.35;
  col += mix(uColB, uColA, 0.5 + 0.5 * sin(z * 0.8)) * tunnel * (0.5 + 0.5 * sin(a * 6.0 + uTime * 4.0));
  col += vec3(1.0) * smoothstep(0.25, 0.0, r) * 0.6;
  gl_FragColor = vec4(col * uIntensity, uIntensity);
}
`;

/** Hyperdrive jump: charge, tunnel, arrive. The next system generates behind the tunnel. */
export class Warp {
  private mesh: Mesh;
  private mat: ShaderMaterial;
  private t = 0;
  private target: SystemSummary | null = null;
  private arrived = false;
  private phase: 'charge' | 'tunnel' | 'arrive' = 'charge';

  constructor(private game: Game) {
    this.mat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uAspect: { value: 1 },
        uColA: { value: new Vector3(0.4, 0.7, 1.4) },
        uColB: { value: new Vector3(1.3, 0.5, 1.0) },
      },
      vertexShader: WARP_VERT,
      fragmentShader: WARP_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5000;
    this.mesh.visible = false;
    game.ctx.scene.add(this.mesh);
  }

  /** Validates and starts a jump. Returns an error message or null. */
  begin(target: SystemSummary): string | null {
    const g = this.game;
    if (g.control !== 'ship' || g.ship.state !== 'flying') return 'Board your ship and take off first.';
    if (g.ship.inAtmosphere || g.ship.altitude < 1500) return 'Leave the atmosphere to engage the hyperdrive.';
    if (g.ship.warpCells < 1) return 'No warp cells. Craft one from Tritium, Hydrogen and Iron.';
    if (target.key === g.system.key) return 'You are already in this system.';
    g.ship.warpCells--;
    g.ship.pulse = false;
    this.target = target;
    this.t = 0;
    this.arrived = false;
    this.phase = 'charge';
    this.mesh.visible = true;
    g.setMode('warp');
    g.audio.warp();
    return null;
  }

  update(dt: number): void {
    const g = this.game;
    this.t += dt;
    g.updateCamera(dt);
    const u = this.mat.uniforms;
    u.uTime.value = this.t;
    u.uAspect.value = window.innerWidth / Math.max(1, window.innerHeight);
    // keep the ship pointing forward during the charge
    if (this.phase === 'charge') {
      g.ship.speed = Math.min(2000, g.ship.speed + dt * 800);
      g.ship.update(dt, null, g.universe, false, 1);
      g.rig.shake = Math.min(1, this.t * 0.5);
      u.uIntensity.value = Math.min(1, this.t / 2.2) * 0.9;
      if (this.t > 2.2) {
        this.phase = 'tunnel';
        this.t = 0;
      }
      return;
    }
    if (this.phase === 'tunnel') {
      u.uIntensity.value = 1;
      g.rig.shake = 0.3;
      if (!this.arrived && this.t > 0.4 && this.target) {
        this.arrived = true;
        g.arriveInSystem(this.target);
        const c = this.target.starColor;
        u.uColB.value.set(c[0] * 1.3, c[1] * 1.1, c[2] * 1.3);
      }
      // hold the tunnel until the new planets have their base meshes
      if (this.arrived && this.t > 3.2 && (g.universe.ready || this.t > 9)) {
        this.phase = 'arrive';
        this.t = 0;
      }
      return;
    }
    // arrive: fade the tunnel out while flying on
    g.ship.update(dt, null, g.universe, false, 1);
    u.uIntensity.value = Math.max(0, 1 - this.t / 1.4);
    g.rig.shake = Math.max(0, 0.3 - this.t * 0.3);
    if (this.t > 1.4) {
      this.mesh.visible = false;
      g.setMode('play');
    }
  }

  get active(): boolean {
    return this.mesh.visible;
  }
}
