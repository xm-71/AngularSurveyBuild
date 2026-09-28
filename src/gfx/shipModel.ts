import {
  AdditiveBlending, BoxGeometry, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, Mesh, ShaderMaterial,
  SphereGeometry, Vector3,
} from 'three';
import { hsl, rgbToLinear, type RGB } from '../engine/color';
import { Rng } from '../engine/rng';
import { createLitMaterial, type GlobalUniforms, type PlanetUniforms } from './materials';
import { mat, MeshBuilder } from './meshBuilder';

const FLAME_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying float vT;
void main() {
  vT = -position.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const FLAME_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uPower;
varying float vT;
void main() {
  #include <logdepthbuf_fragment>
  float fade = pow(clamp(1.0 - vT, 0.0, 1.0), 1.6);
  gl_FragColor = vec4(uColor * fade * uPower * 3.0, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface ShipModel {
  group: Group;
  gear: Mesh;
  flames: Mesh[];
  flameMat: ShaderMaterial;
  hullMat: ShaderMaterial;
  /** Gear contact height below the origin. */
  gearHeight: number;
  length: number;
  muzzles: Vector3[];
  cockpit: Vector3;
}

/** Procedural starfighter pointing along -Z. */
export function buildShip(seed: number, G: GlobalUniforms, P: PlanetUniforms): ShipModel {
  const rng = new Rng(seed);
  const hullHue = rng.range(0, 360);
  const primary = rgbToLinear(hsl(hullHue, rng.range(0.05, 0.2), rng.range(0.78, 0.9)));
  const accent = rgbToLinear(hsl(rng.pick([18, 28, 200, 350, 45]), 0.85, 0.52));
  const dark = rgbToLinear(hsl(hullHue, 0.12, 0.17));
  const glass: RGB = rgbToLinear(hsl(195, 0.6, 0.18));
  const engineGlow = rgbToLinear(hsl(rng.pick([190, 20, 280]), 1, 0.6));

  const b = new MeshBuilder();
  // Fuselage: an 8-sided tapered body.
  b.add(new CylinderGeometry(0.62, 1.05, 7.2, 8, 1), primary, mat([0, 0, 0.2], [Math.PI / 2, 0, Math.PI / 8], [1, 1, 0.7]));
  b.add(new ConeGeometry(0.62, 2.6, 8, 1), primary, mat([0, 0, -4.7], [-Math.PI / 2, 0, Math.PI / 8], [1, 1, 0.7]));
  // Accent stripe along the spine
  b.add(new BoxGeometry(0.35, 0.12, 6.4), accent, mat([0, 0.78, 0.5]));
  // Cockpit canopy
  b.add(new SphereGeometry(0.8, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), glass, mat([0, 0.45, -1.8], [0, 0, 0], [0.85, 0.75, 2.0]));
  // Rear block and engines
  b.add(new BoxGeometry(2.2, 1.0, 1.6), dark, mat([0, -0.05, 3.9]));
  b.add(new CylinderGeometry(0.5, 0.58, 2.2, 8), primary, mat([1.05, -0.1, 3.9], [Math.PI / 2, 0, 0]));
  b.add(new CylinderGeometry(0.34, 0.34, 0.2, 8), engineGlow, mat([1.05, -0.1, 5.05], [Math.PI / 2, 0, 0]), 2.2);
  b.add(new BoxGeometry(0.2, 0.3, 1.6), accent, mat([1.6, -0.1, 3.8]));
  const engineParts = 3;
  // Swept wing
  const span = rng.range(4.2, 5.4);
  const sweep = rng.range(0.25, 0.55);
  const dihedral = rng.range(-0.18, 0.12);
  b.add(new BoxGeometry(span, 0.16, 2.4), primary, mat([span / 2 + 0.6, -0.2, 1.6], [0, -sweep, dihedral]));
  b.add(new BoxGeometry(span * 0.7, 0.18, 0.5), accent, mat([span / 2 + 0.7, -0.12, 2.3], [0, -sweep, dihedral]));
  const tipX = span + 0.5;
  const tipZ = 1.6 + Math.tan(sweep) * (span / 2);
  b.add(new BoxGeometry(0.16, 1.3, 1.6), dark, mat([tipX, 0.2 + dihedral * span * 0.5, tipZ], [0, 0, -0.15]));
  b.add(new IcosahedronGeometry(0.14, 0), engineGlow, mat([tipX, 0.9 + dihedral * span * 0.5, tipZ - 0.6]), 3);
  // Canard
  b.add(new BoxGeometry(1.6, 0.1, 0.8), dark, mat([1.1, 0.0, -2.8], [0, -0.3, 0]));
  b.mirrorX(engineParts + 5);
  // Tail fin
  b.add(new BoxGeometry(0.16, 1.9, 1.8), primary, mat([0, 1.2, 3.6], [0.35, 0, 0]));
  b.add(new BoxGeometry(0.18, 0.4, 1.2), accent, mat([0, 1.95, 3.95], [0.35, 0, 0]));
  // Belly intake
  b.add(new BoxGeometry(1.0, 0.5, 2.6), dark, mat([0, -0.72, -0.4]));

  const hullMat = createLitMaterial(G, P, { vertexColors: true, glow: true, glowStrength: 2.5, specular: 0.45 });
  const hull = new Mesh(b.build(), hullMat);
  const group = new Group();
  group.add(hull);

  // Landing gear (shown when landed)
  const gb = new MeshBuilder();
  const strut = (x: number, z: number) => {
    gb.add(new CylinderGeometry(0.09, 0.09, 1.3, 6), dark, mat([x, -1.25, z]));
    gb.add(new CylinderGeometry(0.28, 0.32, 0.12, 8), dark, mat([x, -1.9, z]));
  };
  strut(0, -2.8);
  strut(1.3, 2.6);
  strut(-1.3, 2.6);
  const gear = new Mesh(gb.build(), hullMat);
  group.add(gear);

  const flameMat = new ShaderMaterial({
    uniforms: { uColor: { value: new Vector3(...engineGlow) }, uPower: { value: 0 } },
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const flames: Mesh[] = [];
  for (const x of [1.05, -1.05]) {
    // unit-length cone along +Z (behind the ship), scaled by thrust
    const cone = new ConeGeometry(0.34, 1, 10, 1, true);
    cone.rotateX(Math.PI / 2);
    cone.translate(0, 0, 0.5);
    const f = new Mesh(cone, flameMat);
    f.position.set(x, -0.1, 5.1);
    f.renderOrder = 1500;
    flames.push(f);
    group.add(f);
  }

  return {
    group,
    gear,
    flames,
    flameMat,
    hullMat,
    gearHeight: 1.96,
    length: 10,
    muzzles: [new Vector3(1.3, -0.3, -2.8), new Vector3(-1.3, -0.3, -2.8)],
    cockpit: new Vector3(0, 0.75, -1.9),
  };
}
