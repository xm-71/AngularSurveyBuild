import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CylinderGeometry, Mesh, Points, Quaternion, ShaderMaterial,
  SphereGeometry, Vector3, type Scene,
} from 'three';
import type { GlobalUniforms, PlanetUniforms } from '../gfx/materials';

const BEAM_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const BEAM_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uTime;
uniform float uPower;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float edge = abs(vUv.x - 0.5) * 2.0;
  float core = pow(1.0 - clamp(edge, 0.0, 1.0), 2.0);
  float pulse = 0.75 + 0.25 * sin(vUv.y * 60.0 - uTime * 40.0);
  gl_FragColor = vec4(uColor * core * pulse * uPower * 2.5, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const SPARK_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aLife;
attribute vec3 aColor;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vLife;
void main() {
  vColor = aColor;
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(90.0 / max(-mv.z, 0.1), 1.5, 26.0) * uPixelRatio * aLife;
  #include <logdepthbuf_vertex>
}
`;

const SPARK_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
varying float vLife;
void main() {
  #include <logdepthbuf_fragment>
  if (vLife <= 0.0) discard;
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  gl_FragColor = vec4(vColor * a * 2.0, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const PULSE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uFade;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  #include <logdepthbuf_fragment>
  float f = 1.0 - abs(dot(normalize(vNormalV), normalize(-vViewPos)));
  float rim = pow(f, 3.0);
  gl_FragColor = vec4(uColor * rim * uFade * 1.4, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const PULSE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const _up = new Vector3(0, 1, 0);
const _v = new Vector3();
const _q = new Quaternion();

/** A glowing beam between two camera-relative points. */
export class Beam {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;

  constructor(scene: Scene, color: Vector3, private width: number) {
    const geo = new CylinderGeometry(1, 1, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    this.mat = new ShaderMaterial({
      uniforms: { uColor: { value: color }, uTime: { value: 0 }, uPower: { value: 1 } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1600;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** from/to are relative to the camera. */
  set(from: Vector3, to: Vector3, time: number, power = 1): void {
    const d = _v.copy(to).sub(from);
    const len = d.length();
    if (len < 1e-3) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.copy(from);
    _q.setFromUnitVectors(_up, d.divideScalar(len));
    this.mesh.quaternion.copy(_q);
    this.mesh.scale.set(this.width, len, this.width);
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uPower.value = power;
  }

  hide(): void {
    this.mesh.visible = false;
  }
}

interface Spark {
  pos: Vector3;
  vel: Vector3;
  life: number;
  maxLife: number;
  color: [number, number, number];
}

/** Sparks, scanner pulse and other transient visuals (world-space, rendered relative to the camera). */
export class Effects {
  private sparks: Spark[] = [];
  private points: Points;
  private posAttr: BufferAttribute;
  private lifeAttr: BufferAttribute;
  private colAttr: BufferAttribute;
  private readonly max = 400;
  private pulse: Mesh;
  private pulseMat: ShaderMaterial;
  private pulseOrigin = new Vector3();
  private pulseT = -1;
  private pulseRadius = 220;
  private sparkMat: ShaderMaterial;

  constructor(scene: Scene, _G: GlobalUniforms, _P: PlanetUniforms) {
    const geo = new BufferGeometry();
    this.posAttr = new BufferAttribute(new Float32Array(this.max * 3), 3);
    this.lifeAttr = new BufferAttribute(new Float32Array(this.max), 1);
    this.colAttr = new BufferAttribute(new Float32Array(this.max * 3), 3);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aLife', this.lifeAttr);
    geo.setAttribute('aColor', this.colAttr);
    this.sparkMat = new ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 } },
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.points = new Points(geo, this.sparkMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1700;
    scene.add(this.points);

    this.pulseMat = new ShaderMaterial({
      uniforms: { uColor: { value: new Vector3(0.36, 0.94, 0.82) }, uFade: { value: 0 } },
      vertexShader: PULSE_VERT,
      fragmentShader: PULSE_FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.pulse = new Mesh(new SphereGeometry(1, 48, 24), this.pulseMat);
    this.pulse.visible = false;
    this.pulse.renderOrder = 1650;
    this.pulse.frustumCulled = false;
    scene.add(this.pulse);
  }

  set pixelRatio(v: number) {
    this.sparkMat.uniforms.uPixelRatio.value = v;
  }

  burst(world: Vector3, color: [number, number, number], count: number, speed = 6, life = 0.7): void {
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= this.max) this.sparks.shift();
      const v = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      const l = life * (0.5 + Math.random() * 0.8);
      this.sparks.push({ pos: world.clone(), vel: v, life: l, maxLife: l, color });
    }
  }

  scanPulse(world: Vector3, radius = 220): void {
    this.pulseOrigin.copy(world);
    this.pulseT = 0;
    this.pulseRadius = radius;
  }

  update(dt: number, camPos: Vector3): void {
    // sparks
    const n = this.sparks.length;
    const pos = this.posAttr.array as Float32Array;
    const life = this.lifeAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) continue;
      s.vel.multiplyScalar(Math.exp(-2.5 * dt));
      s.pos.addScaledVector(s.vel, dt);
      this.sparks[k] = s;
      pos[k * 3] = s.pos.x - camPos.x;
      pos[k * 3 + 1] = s.pos.y - camPos.y;
      pos[k * 3 + 2] = s.pos.z - camPos.z;
      life[k] = s.life / s.maxLife;
      col[k * 3] = s.color[0];
      col[k * 3 + 1] = s.color[1];
      col[k * 3 + 2] = s.color[2];
      k++;
    }
    this.sparks.length = k;
    for (let i = k; i < Math.min(this.max, n + 1); i++) life[i] = 0;
    this.points.geometry.setDrawRange(0, k);
    this.posAttr.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;

    // scanner pulse
    if (this.pulseT >= 0) {
      this.pulseT += dt;
      const t = this.pulseT / 1.6;
      if (t >= 1) {
        this.pulseT = -1;
        this.pulse.visible = false;
      } else {
        this.pulse.visible = true;
        this.pulse.position.copy(this.pulseOrigin).sub(camPos);
        this.pulse.scale.setScalar(2 + t * this.pulseRadius);
        this.pulseMat.uniforms.uFade.value = (1 - t) * (1 - t);
      }
    }
  }
}
