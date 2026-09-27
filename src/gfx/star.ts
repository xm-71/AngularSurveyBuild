import {
  AdditiveBlending, Group, Mesh, PlaneGeometry, ShaderMaterial, SphereGeometry, Vector3, type Camera,
} from 'three';
import { rgbToLinear, type RGB } from '../engine/color';
import { NOISE_GLSL } from './glsl';

const STAR_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vWorldPos;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const STAR_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform vec3 uColor;
uniform vec3 uTint;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vWorldPos;
void main() {
  #include <logdepthbuf_fragment>
  vec3 V = normalize(-vWorldPos);
  float mu = max(dot(normalize(vNormal), V), 0.0);
  float limb = 0.45 + 0.55 * pow(mu, 0.5);
  vec3 d = normalize(vLocal);
  float g = snoise(d * 18.0 + vec3(uTime * 0.02)) * 0.5 + snoise(d * 45.0 - vec3(uTime * 0.03)) * 0.25;
  vec3 col = uColor * (14.0 + g * 3.0) * limb * uTint;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const GLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const GLOW_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform vec3 uTint;
uniform float uCore;
uniform float uStrength;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vUv);
  if (r > 1.0) discard;
  float halo = pow(1.0 - r, 4.0) * 0.5 + exp(-r * r / (uCore * uCore)) * 1.5;
  float rays = 0.0;
  float ang = atan(vUv.y, vUv.x);
  rays = pow(abs(cos(ang * 3.0)), 60.0) + pow(abs(cos(ang * 3.0 + 0.5)), 90.0) * 0.6;
  halo += rays * pow(1.0 - r, 6.0) * 0.6;
  vec3 col = uColor * uTint * halo * uStrength;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** The system's star: an emissive sphere plus a camera-facing glow. */
export class Star {
  readonly group = new Group();
  readonly radius: number;
  private sphereMat: ShaderMaterial;
  private glowMat: ShaderMaterial;
  readonly glow: Mesh;
  readonly color: Vector3;

  constructor(radius: number, color: RGB) {
    this.radius = radius;
    const lin = rgbToLinear(color);
    this.color = new Vector3(lin[0], lin[1], lin[2]);
    this.sphereMat = new ShaderMaterial({
      uniforms: { uColor: { value: this.color }, uTint: { value: new Vector3(1, 1, 1) }, uTime: { value: 0 } },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const sphere = new Mesh(new SphereGeometry(radius, 64, 32), this.sphereMat);
    sphere.renderOrder = 900;
    this.group.add(sphere);

    this.glowMat = new ShaderMaterial({
      uniforms: {
        uColor: { value: this.color },
        uTint: { value: new Vector3(1, 1, 1) },
        uCore: { value: 0.12 },
        uStrength: { value: 1 },
      },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.glow = new Mesh(new PlaneGeometry(2, 2), this.glowMat);
    this.glow.renderOrder = 1001;
    this.glow.frustumCulled = false;
    this.group.add(this.glow);
  }

  /** starWorld relative to camera, camera for billboard orientation. */
  update(camWorld: Vector3, camera: Camera, time: number, tint: Vector3, inAtmosphere: number): void {
    this.group.position.copy(camWorld).multiplyScalar(-1);
    const dist = camWorld.length();
    this.glow.quaternion.copy(camera.quaternion);
    const size = Math.max(this.radius * 7, dist * 0.22);
    this.glow.scale.setScalar(size);
    this.glowMat.uniforms.uCore.value = Math.min(0.5, (this.radius * 1.6) / size);
    this.glowMat.uniforms.uStrength.value = 0.9 - Math.min(1, inAtmosphere * 1.6) * 0.82;
    this.glowMat.uniforms.uTint.value.copy(tint);
    this.sphereMat.uniforms.uTint.value.copy(tint);
    this.sphereMat.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.sphereMat.dispose();
    this.glowMat.dispose();
  }
}
