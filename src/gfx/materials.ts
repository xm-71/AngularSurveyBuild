import {
  AddEquation, BackSide, Color, CustomBlending, DoubleSide, FrontSide, Matrix3, NormalBlending, OneFactor, ShaderMaterial,
  SrcAlphaFactor, Vector3, ZeroFactor, type IUniform,
} from 'three';
import { rgbToLinear, type RGB } from '../engine/color';
import type { PlanetParams } from '../world/planetTypes';
import { ATMO_GLSL, LIGHT_GLSL, NOISE_GLSL } from './glsl';

export type Uniforms = Record<string, IUniform>;

/** Uniforms shared by every material (updated once per frame). */
export interface GlobalUniforms extends Uniforms {
  uTime: IUniform<number>;
  uSunColor: IUniform<Vector3>;
  uNightAmbient: IUniform<Vector3>;
  uLamp: IUniform<number>;
  uLampDir: IUniform<Vector3>;
  uUnderwater: IUniform<number>;
  uUnderwaterColor: IUniform<Vector3>;
  uAtmoSteps: IUniform<number>;
  uSkySteps: IUniform<number>;
  uCloudOctaves: IUniform<number>;
  uWind: IUniform<number>;
}

export function createGlobalUniforms(): GlobalUniforms {
  return {
    uTime: { value: 0 },
    uSunColor: { value: new Vector3(3, 3, 3) },
    uNightAmbient: { value: new Vector3(0.02, 0.025, 0.04) },
    uLamp: { value: 0 },
    uLampDir: { value: new Vector3(0, 0, -1) },
    uUnderwater: { value: 0 },
    uUnderwaterColor: { value: new Vector3(0.02, 0.1, 0.15) },
    uAtmoSteps: { value: 4 },
    uSkySteps: { value: 8 },
    uCloudOctaves: { value: 3 },
    uWind: { value: 1 },
  };
}

/** Per-planet atmosphere + lighting uniforms. */
export interface PlanetUniforms extends Uniforms {
  uPlanetCenter: IUniform<Vector3>;
  uPlanetRadius: IUniform<number>;
  uAtmoRadius: IUniform<number>;
  uAtmoBeta: IUniform<Vector3>;
  uAtmoMie: IUniform<number>;
  uAtmoScaleH: IUniform<number>;
  uHasAtmo: IUniform<number>;
  uSunDir: IUniform<Vector3>;
  uSunScatter: IUniform<Vector3>;
  uAmbient: IUniform<Vector3>;
  uPlanetRotInv: IUniform<Matrix3>;
  uSeaRadius: IUniform<number>;
}

export function createPlanetUniforms(): PlanetUniforms {
  return {
    uPlanetCenter: { value: new Vector3() },
    uPlanetRadius: { value: 1 },
    uAtmoRadius: { value: 1 },
    uAtmoBeta: { value: new Vector3() },
    uAtmoMie: { value: 0 },
    uAtmoScaleH: { value: 1 },
    uHasAtmo: { value: 0 },
    uSunDir: { value: new Vector3(1, 0, 0) },
    uSunScatter: { value: new Vector3(20, 20, 20) },
    uAmbient: { value: new Vector3(0.1, 0.1, 0.1) },
    uPlanetRotInv: { value: new Matrix3() },
    uSeaRadius: { value: 0 },
  };
}

/** Static atmosphere constants for a planet. */
export function applyPlanetConstants(u: PlanetUniforms, p: PlanetParams): void {
  u.uPlanetRadius.value = p.radius;
  u.uSeaRadius.value = p.radius + (p.seaLevel ?? p.minHeight);
  const a = p.atmosphere;
  if (a) {
    u.uHasAtmo.value = 1;
    u.uAtmoRadius.value = p.radius + a.height;
    u.uAtmoScaleH.value = a.scaleHeight;
    const tau = 0.3 * a.density;
    const k = tau / a.scaleHeight;
    u.uAtmoBeta.value.set(a.color[0] * k, a.color[1] * k, a.color[2] * k);
    u.uAtmoMie.value = (0.018 * a.mie * a.density) / a.scaleHeight;
    u.uAmbient.value.set(a.color[0], a.color[1], a.color[2]).multiplyScalar(0.22 * Math.min(1.3, a.density)).addScalar(0.025);
  } else {
    u.uHasAtmo.value = 0;
    u.uAtmoRadius.value = p.radius + 1;
    u.uAtmoScaleH.value = 1;
    u.uAtmoBeta.value.set(0, 0, 0);
    u.uAtmoMie.value = 0;
    u.uAmbient.value.set(0.035, 0.035, 0.04);
  }
}

export function copyPlanetUniforms(dst: PlanetUniforms, src: PlanetUniforms): void {
  dst.uPlanetCenter.value.copy(src.uPlanetCenter.value);
  dst.uPlanetRadius.value = src.uPlanetRadius.value;
  dst.uAtmoRadius.value = src.uAtmoRadius.value;
  dst.uAtmoBeta.value.copy(src.uAtmoBeta.value);
  dst.uAtmoMie.value = src.uAtmoMie.value;
  dst.uAtmoScaleH.value = src.uAtmoScaleH.value;
  dst.uHasAtmo.value = src.uHasAtmo.value;
  dst.uSunDir.value.copy(src.uSunDir.value);
  dst.uSunScatter.value.copy(src.uSunScatter.value);
  dst.uAmbient.value.copy(src.uAmbient.value);
  dst.uPlanetRotInv.value.copy(src.uPlanetRotInv.value);
  dst.uSeaRadius.value = src.uSeaRadius.value;
}

const vec3u = (c: RGB): IUniform<Vector3> => ({ value: new Vector3(c[0], c[1], c[2]) });

// ---------------------------------------------------------------------------
// Terrain

const TERRAIN_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${ATMO_GLSL}
uniform int uAtmoSteps;
attribute vec4 aNormal;
attribute vec4 aColor;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec3 vSunLight;
varying float vRock;
varying float vSnow;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * aNormal.xyz);
  vColor = pow(aColor.rgb, vec3(2.2));
  vRock = aNormal.w;
  vSnow = aColor.a;
  float dist = length(wp.xyz);
  atmoScatter(vec3(0.0), wp.xyz / max(dist, 1e-4), dist, uAtmoSteps, vInscatter, vTransmit);
  vSunLight = atmoSunLight(wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const TERRAIN_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uPlanetCenter;
uniform vec3 uSunDir;
uniform vec3 uAmbient;
uniform mat3 uPlanetRotInv;
uniform float uDetail;
${LIGHT_GLSL}
${NOISE_GLSL}
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec3 vSunLight;
varying float vRock;
varying float vSnow;
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vNormal);
  vec3 albedo = vColor;
  float dist = length(vWorldPos);
  vec3 up = normalize(vWorldPos - uPlanetCenter);
  if (uDetail > 0.5) {
    float fade = 1.0 - smoothstep(40.0, 320.0, dist);
    if (fade > 0.0) {
      vec3 lp = uPlanetRotInv * (vWorldPos - uPlanetCenter);
      float n1 = snoise(lp * 0.21);
      float n2 = snoise(lp * 0.93 + 7.1);
      float n3 = snoise(lp * 3.7 - 3.3);
      float rockiness = clamp(vRock * 1.4, 0.0, 1.0);
      float v = n1 * 0.45 + n2 * 0.35 + n3 * 0.2;
      albedo *= 1.0 + v * fade * mix(0.16, 0.34, rockiness);
      // small normal perturbation for rock
      vec3 t1 = normalize(cross(up, vec3(0.0, 1.0, 0.0) + up.zxy * 0.01));
      vec3 t2 = cross(up, t1);
      N = normalize(N + (t1 * n2 + t2 * n3) * 0.22 * fade * (0.3 + rockiness));
    }
  }
  float NdotL = max(dot(N, uSunDir), 0.0);
  vec3 ambient = uAmbient * (0.55 + 0.45 * dot(N, up)) * (0.25 + 0.75 * smoothstep(-0.3, 0.25, dot(up, uSunDir))) + uNightAmbient;
  vec3 lit = albedo * (vSunLight * uSunColor * NdotL + ambient + headlamp(vWorldPos, N));
  // gentle sheen on snow
  vec3 V = -vWorldPos / max(dist, 1e-3);
  vec3 H = normalize(V + uSunDir);
  lit += vSunLight * uSunColor * pow(max(dot(N, H), 0.0), 60.0) * vSnow * 0.25;
  vec3 col = lit * vTransmit + vInscatter;
  col = applyUnderwater(col, dist);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createTerrainMaterial(G: GlobalUniforms, P: PlanetUniforms, detail: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...G, ...P, uDetail: { value: detail ? 1 : 0 } },
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
  });
}

// ---------------------------------------------------------------------------
// Liquid surface

const WATER_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${ATMO_GLSL}
uniform int uAtmoSteps;
attribute float aDepth;
varying vec3 vWorldPos;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec3 vSunLight;
varying float vDepth;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vDepth = aDepth;
  float dist = length(wp.xyz);
  atmoScatter(vec3(0.0), wp.xyz / max(dist, 1e-4), dist, uAtmoSteps, vInscatter, vTransmit);
  vSunLight = atmoSunLight(wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const WATER_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uPlanetCenter;
uniform vec3 uSunDir;
uniform vec3 uAmbient;
uniform mat3 uPlanetRotInv;
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform float uLiquid;
${LIGHT_GLSL}
${NOISE_GLSL}
varying vec3 vWorldPos;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec3 vSunLight;
varying float vDepth;
void main() {
  #include <logdepthbuf_fragment>
  float dist = length(vWorldPos);
  vec3 V = -vWorldPos / max(dist, 1e-3);
  vec3 up = normalize(vWorldPos - uPlanetCenter);
  vec3 lp = uPlanetRotInv * (vWorldPos - uPlanetCenter);
  bool lava = uLiquid > 0.5 && uLiquid < 1.5;
  bool ice = uLiquid > 2.5;
  float waveFade = 1.0 - smoothstep(60.0, 900.0, dist);
  vec3 N = up;
  float tflow = lava ? uTime * 0.05 : uTime * 0.35;
  if (waveFade > 0.0 && !ice) {
    vec3 t1 = normalize(cross(up, vec3(0.0, 1.0, 0.0) + up.zxy * 0.01));
    vec3 t2 = cross(up, t1);
    float a = snoise(lp * 0.08 + vec3(tflow, 0.0, tflow * 0.7));
    float b = snoise(lp * 0.23 + vec3(-tflow * 1.3, tflow, 0.0));
    float c = snoise(lp * 0.9 + vec3(0.0, -tflow * 2.0, tflow));
    N = normalize(up + (t1 * (a * 0.6 + c * 0.25) + t2 * (b * 0.6 - c * 0.25)) * 0.12 * waveFade);
  }
  bool below = dot(V, up) < 0.0;
  if (below) N = -N;
  float NdotV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
  float depthF = 1.0 - exp(-max(vDepth, 0.0) * 0.06);
  vec3 base = mix(uShallow, uDeep, depthF);
  vec3 R = reflect(-V, N);
  float sunVis = dot(vSunLight, vec3(0.333));
  vec3 sky = uAmbient * 2.6 + uNightAmbient;
  vec3 col;
  float alpha;
  if (lava) {
    float n = snoise(lp * 0.05 + vec3(tflow)) * 0.5 + 0.5;
    float crust = smoothstep(0.35, 0.75, snoise(lp * 0.12 - vec3(tflow * 0.5)) * 0.5 + 0.5);
    col = mix(uShallow * (2.2 + 1.8 * n), uDeep * 0.25, crust * 0.8);
    alpha = 1.0;
  } else if (ice) {
    float n = snoise(lp * 0.03) * 0.5 + 0.5;
    vec3 iceCol = mix(uShallow, uDeep, n * 0.6);
    float NdotL = max(dot(up, uSunDir), 0.0);
    col = iceCol * (vSunLight * uSunColor * NdotL + uAmbient + uNightAmbient);
    col += vSunLight * uSunColor * pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.4;
    alpha = 1.0;
  } else {
    float NdotL = max(dot(up, uSunDir), 0.0);
    vec3 body = base * (vSunLight * uSunColor * NdotL * 0.55 + uAmbient * 1.2 + uNightAmbient);
    col = mix(body, sky, fres * 0.85);
    float spec = pow(max(dot(R, uSunDir), 0.0), 600.0) * 2.2 + pow(max(dot(R, uSunDir), 0.0), 60.0) * 0.12;
    col += vSunLight * uSunColor * spec;
    float foam = (1.0 - smoothstep(0.0, 1.1, vDepth)) * (0.55 + 0.45 * snoise(lp * 0.6 + vec3(uTime * 0.4)));
    col = mix(col, vec3(0.9) * (vSunLight * uSunColor * 0.5 + uAmbient * 2.0), clamp(foam, 0.0, 1.0) * 0.7 * waveFade);
    alpha = mix(0.5, 0.94, smoothstep(0.0, 9.0, vDepth));
    alpha = max(alpha, fres);
    if (below) {
      col = mix(uDeep * 0.6, sky, 0.3);
      alpha = 0.85;
    }
  }
  col = col * vTransmit + vInscatter;
  col = applyUnderwater(col, dist);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createWaterMaterial(G: GlobalUniforms, P: PlanetUniforms, params: PlanetParams): ShaderMaterial {
  const liquidId = { water: 0, lava: 1, acid: 2, ice: 3 }[params.liquid];
  const opaque = params.liquid === 'lava' || params.liquid === 'ice';
  return new ShaderMaterial({
    uniforms: {
      ...G,
      ...P,
      uShallow: vec3u(rgbToLinear(params.palette.liquidShallow)),
      uDeep: vec3u(rgbToLinear(params.palette.liquidDeep)),
      uLiquid: { value: liquidId },
    },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: !opaque,
    side: DoubleSide,
    depthWrite: true,
  });
}

// ---------------------------------------------------------------------------
// Atmosphere shell (drawn as the sky from inside, as a halo from outside)

const SKY_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const SKY_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMO_GLSL}
uniform int uSkySteps;
uniform float uSeaRadius;
varying vec3 vWorldPos;
void main() {
  #include <logdepthbuf_fragment>
  vec3 rd = normalize(vWorldPos);
  vec2 tp = raySphere(vec3(0.0), rd, uPlanetCenter, uSeaRadius);
  float tMax = tp.x > 0.0 ? tp.x : 1e20;
  vec3 inscatter, transmit;
  atmoScatter(vec3(0.0), rd, tMax, uSkySteps, inscatter, transmit);
  float T = dot(transmit, vec3(0.3333));
  float lum = dot(inscatter, vec3(0.2126, 0.7152, 0.0722));
  float alpha = T * (1.0 - smoothstep(0.0, 0.045, lum));
  gl_FragColor = vec4(inscatter, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.a = alpha;
}
`;

export function createSkyShellMaterial(G: GlobalUniforms, P: PlanetUniforms): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...G, ...P },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: SrcAlphaFactor,
    // keep the framebuffer opaque: only colour is attenuated
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
}

// ---------------------------------------------------------------------------
// Cloud layer

const CLOUD_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${ATMO_GLSL}
uniform int uAtmoSteps;
varying vec3 vWorldPos;
varying vec3 vLocal;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec3 vSunLight;
void main() {
  vLocal = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  float dist = length(wp.xyz);
  atmoScatter(vec3(0.0), wp.xyz / max(dist, 1e-4), dist, uAtmoSteps, vInscatter, vTransmit);
  vSunLight = atmoSunLight(wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const CLOUD_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uPlanetCenter;
uniform vec3 uSunDir;
uniform vec3 uAmbient;
uniform float uTime;
uniform float uCoverage;
uniform float uScale;
uniform float uSpeed;
uniform float uOpacity;
uniform vec3 uCloudColor;
uniform float uCloudRadius;
uniform int uCloudOctaves;
${LIGHT_GLSL}
${NOISE_GLSL}
varying vec3 vWorldPos;
varying vec3 vLocal;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec3 vSunLight;
void main() {
  #include <logdepthbuf_fragment>
  float a = uTime * uSpeed;
  float ca = cos(a), sa = sin(a);
  vec3 d = vec3(ca * vLocal.x - sa * vLocal.z, vLocal.y, sa * vLocal.x + ca * vLocal.z);
  vec3 q = d * uScale;
  q += 0.35 * vec3(snoise(q * 0.5 + 3.1), snoise(q * 0.5 + 7.7), snoise(q * 0.5 - 2.9));
  float n = fbm3(q, uCloudOctaves) * 0.5 + 0.5;
  float c = smoothstep(1.0 - uCoverage, 1.0 - uCoverage + 0.28, n);
  if (c < 0.01) discard;
  vec3 up = normalize(vWorldPos - uPlanetCenter);
  float camR = length(uPlanetCenter);
  bool fromBelow = camR < uCloudRadius;
  float dist = length(vWorldPos);
  float near = smoothstep(60.0, 450.0, dist);
  float sunUp = dot(up, uSunDir);
  vec3 light = vSunLight * uSunColor * (0.35 + 0.65 * max(sunUp, 0.0)) + uAmbient * 1.6 + uNightAmbient;
  vec3 col = uCloudColor * light * (fromBelow ? mix(0.55, 0.8, 1.0 - c) : 1.0);
  col = col * vTransmit + vInscatter;
  gl_FragColor = vec4(col, c * uOpacity * near);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createCloudMaterial(G: GlobalUniforms, P: PlanetUniforms, params: PlanetParams): ShaderMaterial | null {
  const c = params.clouds;
  if (!c) return null;
  return new ShaderMaterial({
    uniforms: {
      ...G,
      ...P,
      uCoverage: { value: c.coverage },
      uScale: { value: c.scale },
      uSpeed: { value: c.speed },
      uOpacity: { value: c.opacity },
      uCloudColor: vec3u(rgbToLinear(c.color)),
      uCloudRadius: { value: params.radius + c.altitude },
    },
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
  });
}

// ---------------------------------------------------------------------------
// Lit material for props, flora, creatures and ships.

const LIT_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${ATMO_GLSL}
uniform int uAtmoSteps;
uniform float uTime;
uniform float uWind;
uniform float uWindAmount;
#ifdef USE_GLOW
attribute float aGlow;
varying float vGlow;
#endif
#ifdef USE_VCOLOR
attribute vec3 aColor;
#endif
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec3 vSunLight;
void main() {
  vec3 pos = position;
  vec3 nrm = normal;
  vColor = vec3(1.0);
  #ifdef USE_VCOLOR
  vColor = aColor;
  #endif
  #ifdef USE_INSTANCING_COLOR
  vColor *= instanceColor;
  #endif
  #ifdef USE_GLOW
  vGlow = aGlow;
  #endif
  vec4 lp = vec4(pos, 1.0);
  #ifdef USE_INSTANCING
  vec3 ip = instanceMatrix[3].xyz;
  #ifdef USE_WIND
  float h = max(pos.y, 0.0);
  float sway = h * h * uWindAmount * uWind;
  lp.x += sin(uTime * 1.7 + ip.x * 0.07 + ip.z * 0.05) * sway;
  lp.z += cos(uTime * 1.3 + ip.y * 0.06 + ip.x * 0.03) * sway * 0.8;
  #endif
  lp = instanceMatrix * lp;
  nrm = mat3(instanceMatrix) * nrm;
  #endif
  vec4 wp = modelMatrix * lp;
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * nrm);
  float dist = length(wp.xyz);
  atmoScatter(vec3(0.0), wp.xyz / max(dist, 1e-4), dist, uAtmoSteps, vInscatter, vTransmit);
  vSunLight = atmoSunLight(wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const LIT_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uPlanetCenter;
uniform vec3 uSunDir;
uniform vec3 uAmbient;
uniform float uHasAtmo;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uGlowStrength;
uniform float uSpecular;
uniform float uFlash;
uniform float uTime;
uniform float uTranslucency;
uniform float uAmbientBoost;
${LIGHT_GLSL}
#ifdef USE_GLOW
varying float vGlow;
#endif
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vInscatter;
varying vec3 vTransmit;
varying vec3 vSunLight;
void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float dist = length(vWorldPos);
  vec3 V = -vWorldPos / max(dist, 1e-3);
  vec3 albedo = uColor * vColor;
  vec3 up = uHasAtmo > 0.5 ? normalize(vWorldPos - uPlanetCenter) : N;
  float NdotL = dot(N, uSunDir);
  float wrap = max((NdotL + 0.25) / 1.25, 0.0);
  vec3 ambient = uAmbient * uAmbientBoost * (0.6 + 0.4 * dot(N, up)) + uNightAmbient;
  vec3 lit = albedo * (vSunLight * uSunColor * wrap + ambient + headlamp(vWorldPos, N));
  // light passing through leaves when backlit
  float backlit = max(0.0, dot(V, -uSunDir));
  lit += albedo * vSunLight * uSunColor * uTranslucency * (0.35 + 0.65 * backlit) * max(0.0, -NdotL);
  vec3 H = normalize(V + uSunDir);
  lit += vSunLight * uSunColor * pow(max(dot(N, H), 0.0), 40.0) * uSpecular * step(0.0, NdotL);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  lit += (uAmbient * 0.5 + uSunColor * vSunLight * 0.06) * rim;
  lit += uEmissive;
  #ifdef USE_GLOW
  lit += albedo * vGlow * uGlowStrength * (0.85 + 0.15 * sin(uTime * 2.0 + vWorldPos.x * 0.3));
  #endif
  lit += vec3(1.0, 0.9, 0.7) * uFlash;
  vec3 col = lit * vTransmit + vInscatter;
  col = applyUnderwater(col, dist);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface LitOptions {
  color?: Color | RGB;
  vertexColors?: boolean;
  glow?: boolean;
  glowStrength?: number;
  wind?: number;
  specular?: number;
  emissive?: RGB;
  doubleSide?: boolean;
  translucency?: number;
  ambientBoost?: number;
}

export function createLitMaterial(G: GlobalUniforms, P: PlanetUniforms, o: LitOptions = {}): ShaderMaterial {
  const color = o.color instanceof Color ? new Vector3(o.color.r, o.color.g, o.color.b) : o.color ? new Vector3(...o.color) : new Vector3(1, 1, 1);
  const defines: Record<string, string> = {};
  if (o.vertexColors) defines.USE_VCOLOR = '';
  if (o.glow) defines.USE_GLOW = '';
  if (o.wind) defines.USE_WIND = '';
  return new ShaderMaterial({
    uniforms: {
      ...G,
      ...P,
      uColor: { value: color },
      uEmissive: { value: new Vector3(...(o.emissive ?? [0, 0, 0])) },
      uGlowStrength: { value: o.glowStrength ?? 1.5 },
      uSpecular: { value: o.specular ?? 0.15 },
      uWindAmount: { value: o.wind ?? 0 },
      uFlash: { value: 0 },
      uTranslucency: { value: o.translucency ?? 0 },
      uAmbientBoost: { value: o.ambientBoost ?? 1.6 },
    },
    defines,
    vertexShader: LIT_VERT,
    fragmentShader: LIT_FRAG,
    side: o.doubleSide ? DoubleSide : FrontSide,
  });
}
