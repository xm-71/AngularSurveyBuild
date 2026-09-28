import {
  AdditiveBlending, BackSide, BufferAttribute, BufferGeometry, CubeCamera, Mesh, Points, Scene, ShaderMaterial,
  SphereGeometry, SRGBColorSpace, Vector3, WebGLCubeRenderTarget, type WebGLRenderer,
} from 'three';
import { rgbToLinear, type RGB } from '../engine/color';
import { Rng } from '../engine/rng';
import { NOISE_GLSL } from './glsl';

// Background sky: a nebula baked into a cube map once per star system, plus a
// sharp point starfield drawn on top.

const NEBULA_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uDensity;
uniform vec3 uSeed;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float band = exp(-pow(d.y / 0.24, 2.0));
  float n = fbm3(d * 1.8 + uSeed, 5) * 0.5 + 0.5;
  float n2 = fbm3(d * 4.2 - uSeed.zxy, 4) * 0.5 + 0.5;
  float lanes = smoothstep(0.35, 0.65, fbm3(d * 7.0 + uSeed.yzx, 3) * 0.5 + 0.5);
  float neb = pow(smoothstep(0.42, 0.95, n), 2.2) * uDensity;
  float neb2 = pow(smoothstep(0.5, 0.95, n2), 2.4) * uDensity;
  vec3 col = uColA * neb * 0.55 + uColB * neb2 * 0.4;
  col += vec3(0.85, 0.8, 0.75) * band * (0.035 + 0.07 * n2) * (0.5 + 0.5 * lanes);
  col *= 0.55 + 0.45 * lanes;
  col += vec3(0.004, 0.005, 0.01);
  gl_FragColor = vec4(col, 1.0);
}
`;

const NEBULA_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uPixelRatio;
uniform float uFade;
varying vec3 vColor;
void main() {
  vColor = aColor * uFade;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_PointSize = aSize * uPixelRatio;
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

export class Sky {
  private rt: WebGLCubeRenderTarget;
  private cubeCam: CubeCamera;
  private bakeScene = new Scene();
  private nebulaMat: ShaderMaterial;
  readonly stars: Points;
  private starMat: ShaderMaterial;

  constructor(private renderer: WebGLRenderer, starCount: number) {
    this.rt = new WebGLCubeRenderTarget(512);
    this.rt.texture.colorSpace = SRGBColorSpace;
    this.cubeCam = new CubeCamera(0.1, 1000, this.rt);
    this.nebulaMat = new ShaderMaterial({
      uniforms: {
        uColA: { value: new Vector3() },
        uColB: { value: new Vector3() },
        uDensity: { value: 0.5 },
        uSeed: { value: new Vector3() },
      },
      vertexShader: NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
      side: BackSide,
      depthWrite: false,
    });
    this.bakeScene.add(new Mesh(new SphereGeometry(100, 64, 32), this.nebulaMat));

    this.starMat = new ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 }, uFade: { value: 1 } },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: false,
    });
    this.stars = new Points(new BufferGeometry(), this.starMat);
    this.stars.renderOrder = -1000;
    this.stars.frustumCulled = false;
    this.buildStars(1, starCount);
  }

  get texture() {
    return this.rt.texture;
  }

  set pixelRatio(v: number) {
    this.starMat.uniforms.uPixelRatio.value = v;
  }

  set fade(v: number) {
    this.starMat.uniforms.uFade.value = v;
  }

  buildStars(seed: number, count: number): void {
    const rng = new Rng(seed ^ 0x57a2);
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Concentrate some stars toward the galactic plane.
      let [x, y, z] = rng.unitVector();
      if (rng.chance(0.35)) {
        y *= 0.25;
        const l = Math.hypot(x, y, z);
        x /= l; y /= l; z /= l;
      }
      pos[i * 3] = x * 900;
      pos[i * 3 + 1] = y * 900;
      pos[i * 3 + 2] = z * 900;
      const b = Math.pow(rng.next(), 6);
      size[i] = 1.4 + b * 3.6;
      const t = rng.next();
      const c: RGB = t < 0.15 ? [1, 0.75, 0.55] : t < 0.35 ? [0.7, 0.8, 1] : t < 0.45 ? [1, 0.95, 0.75] : [1, 1, 1];
      const lin = rgbToLinear(c);
      const k = 0.25 + b * 2.5;
      col[i * 3] = lin[0] * k;
      col[i * 3 + 1] = lin[1] * k;
      col[i * 3 + 2] = lin[2] * k;
    }
    const g = this.stars.geometry;
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSize', new BufferAttribute(size, 1));
    g.setAttribute('aColor', new BufferAttribute(col, 3));
    g.computeBoundingSphere();
  }

  bake(colA: RGB, colB: RGB, density: number, seed: number): void {
    const u = this.nebulaMat.uniforms;
    const a = rgbToLinear(colA), b = rgbToLinear(colB);
    u.uColA.value.set(a[0], a[1], a[2]);
    u.uColB.value.set(b[0], b[1], b[2]);
    u.uDensity.value = density;
    const rng = new Rng(seed);
    u.uSeed.value.set(rng.range(-50, 50), rng.range(-50, 50), rng.range(-50, 50));
    const prevTarget = this.renderer.getRenderTarget();
    this.cubeCam.update(this.renderer, this.bakeScene);
    this.renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.rt.dispose();
  }
}
