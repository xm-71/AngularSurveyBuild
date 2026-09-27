import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, SphereGeometry } from 'three';
import { hsl, mixRGB, rgbToLinear, type RGB } from '../engine/color';
import { Rng } from '../engine/rng';
import type { Palette } from '../world/planetTypes';
import { mat, MeshBuilder } from './meshBuilder';

export type BodyPlan = 'quad' | 'hexapod' | 'biped' | 'hopper' | 'flyer';

export interface CreatureModel {
  plan: BodyPlan;
  body: BufferGeometry;
  leg: BufferGeometry | null;
  wing: BufferGeometry | null;
  /** Hip positions (local, y up, forward -Z). */
  hips: [number, number, number][];
  wings: [number, number, number][];
  legLength: number;
  height: number;
  length: number;
}

/**
 * Builds a creature from a body plan. Units are meters at scale 1; the creature
 * faces -Z with its feet at y = 0.
 */
export function buildCreatureModel(seed: number, plan: BodyPlan, pal: Palette): CreatureModel {
  const rng = new Rng(seed);
  const baseHue = rng.chance(0.5) ? rng.range(0, 360) : rng.range(0, 60);
  const skin = rgbToLinear(hsl(baseHue, rng.range(0.3, 0.75), rng.range(0.35, 0.6)));
  const accent = rgbToLinear(rng.chance(0.5) ? pal.bloom[rng.int(0, 1)] : hsl(baseHue + rng.range(90, 200), 0.65, 0.55));
  const belly = mixRGB(skin, [0.95, 0.92, 0.85], 0.45);
  const dark: RGB = [0.02, 0.02, 0.025];
  const eyeGlow = rng.chance(0.3);
  const b = new MeshBuilder();
  const hips: [number, number, number][] = [];
  const wings: [number, number, number][] = [];
  let leg: BufferGeometry | null = null;
  let wing: BufferGeometry | null = null;
  let legLength = 0;
  let height = 1;
  let length = 1;

  const eyes = (x: number, y: number, z: number, r: number) => {
    b.add(new SphereGeometry(r, 6, 4), eyeGlow ? accent : dark, mat([x, y, z]), eyeGlow ? 2 : 0);
    b.add(new SphereGeometry(r, 6, 4), eyeGlow ? accent : dark, mat([-x, y, z]), eyeGlow ? 2 : 0);
  };

  if (plan === 'quad' || plan === 'hexapod') {
    const L = rng.range(1.0, 1.8);
    const W = rng.range(0.45, 0.8);
    const H = rng.range(0.45, 0.8);
    legLength = rng.range(0.45, 0.9) * (plan === 'hexapod' ? 0.7 : 1);
    const by = legLength + H * 0.4;
    b.add(new SphereGeometry(0.5, 9, 7), skin, mat([0, by, 0], [0, 0, 0], [W, H, L]));
    b.add(new SphereGeometry(0.5, 8, 5), belly, mat([0, by - H * 0.18, 0], [0, 0, 0], [W * 0.8, H * 0.6, L * 0.85]));
    // neck + head
    const hs = rng.range(0.28, 0.45);
    const neckUp = rng.range(0.1, 0.5);
    b.add(new CylinderGeometry(hs * 0.45, hs * 0.6, 0.5, 6), skin, mat([0, by + neckUp * 0.5, -L * 0.45], [-0.8, 0, 0]));
    const hz = -L * 0.55 - 0.2;
    const hy = by + neckUp;
    if (rng.chance(0.5)) b.add(new BoxGeometry(hs * 1.4, hs * 1.1, hs * 1.8), skin, mat([0, hy, hz]));
    else b.add(new SphereGeometry(hs, 8, 6), skin, mat([0, hy, hz], [0, 0, 0], [1, 0.9, 1.3]));
    b.add(new ConeGeometry(hs * 0.45, hs * 1.1, 6), belly, mat([0, hy - hs * 0.2, hz - hs * 1.1], [-Math.PI / 2, 0, 0]));
    eyes(hs * 0.55, hy + hs * 0.3, hz - hs * 0.6, hs * 0.18);
    if (rng.chance(0.55)) {
      const hl = rng.range(0.2, 0.6);
      b.add(new ConeGeometry(hs * 0.18, hl, 5), accent, mat([hs * 0.45, hy + hs * 0.8, hz + hs * 0.1], [0.4, 0, -0.35]));
      b.add(new ConeGeometry(hs * 0.18, hl, 5), accent, mat([-hs * 0.45, hy + hs * 0.8, hz + hs * 0.1], [0.4, 0, 0.35]));
    }
    // tail
    const tl = rng.range(0.3, 1.2);
    b.add(new ConeGeometry(W * 0.2, tl, 6), skin, mat([0, by + 0.05, L * 0.5 + tl * 0.4], [Math.PI / 2 - 0.3, 0, 0]));
    // back ridge
    if (rng.chance(0.5)) {
      for (let i = 0; i < 4; i++) {
        b.add(new ConeGeometry(0.08, 0.25 + rng.next() * 0.2, 4), accent, mat([0, by + H * 0.5, -L * 0.3 + i * L * 0.22]));
      }
    }
    const pairs = plan === 'hexapod' ? 3 : 2;
    for (let i = 0; i < pairs; i++) {
      const z = pairs === 2 ? (i === 0 ? -L * 0.32 : L * 0.3) : -L * 0.35 + i * L * 0.35;
      hips.push([W * 0.38, legLength, z], [-W * 0.38, legLength, z]);
    }
    const lr = rng.range(0.07, 0.13);
    const lg = new CylinderGeometry(lr, lr * 0.7, legLength, 5);
    lg.translate(0, -legLength / 2, 0);
    leg = lg;
    height = by + H * 0.5;
    length = L + 0.6;
  } else if (plan === 'biped') {
    const L = rng.range(0.9, 1.5);
    const H = rng.range(0.55, 0.9);
    legLength = rng.range(0.8, 1.3);
    const by = legLength + H * 0.35;
    b.add(new SphereGeometry(0.5, 9, 7), skin, mat([0, by, 0], [-0.2, 0, 0], [H * 0.9, H, L]));
    const hs = rng.range(0.28, 0.42);
    const hy = by + H * 0.45;
    const hz = -L * 0.55;
    b.add(new SphereGeometry(hs, 8, 6), skin, mat([0, hy, hz], [0, 0, 0], [1, 0.95, 1.4]));
    b.add(new BoxGeometry(hs * 0.9, hs * 0.35, hs * 1.2), belly, mat([0, hy - hs * 0.35, hz - hs * 0.8]));
    eyes(hs * 0.5, hy + hs * 0.3, hz - hs * 0.8, hs * 0.16);
    // small arms
    b.add(new CylinderGeometry(0.05, 0.04, 0.45, 4), skin, mat([H * 0.35, by - 0.05, -L * 0.3], [0.9, 0, 0.3]));
    b.add(new CylinderGeometry(0.05, 0.04, 0.45, 4), skin, mat([-H * 0.35, by - 0.05, -L * 0.3], [0.9, 0, -0.3]));
    // long tail
    const tl = rng.range(0.8, 1.6);
    b.add(new ConeGeometry(H * 0.25, tl, 6), skin, mat([0, by, L * 0.45 + tl * 0.45], [Math.PI / 2 - 0.15, 0, 0]));
    if (rng.chance(0.6)) b.add(new ConeGeometry(0.12, 0.5, 4), accent, mat([0, hy + hs * 0.8, hz + 0.1], [-0.4, 0, 0]));
    hips.push([H * 0.28, legLength, 0.05], [-H * 0.28, legLength, 0.05]);
    const lr = rng.range(0.08, 0.14);
    const lg = new CylinderGeometry(lr, lr * 0.6, legLength, 5);
    lg.translate(0, -legLength / 2, 0);
    leg = lg;
    height = hy + hs;
    length = L + tl;
  } else if (plan === 'hopper') {
    const r = rng.range(0.35, 0.6);
    b.add(new IcosahedronGeometry(r, 1), skin, mat([0, r, 0], [0, 0, 0], [1, rng.range(0.8, 1.1), 1.1]));
    b.add(new SphereGeometry(r * 0.7, 7, 5), belly, mat([0, r * 0.75, -r * 0.35], [0, 0, 0], [0.9, 0.7, 0.6]));
    eyes(r * 0.4, r * 1.45, -r * 0.55, r * 0.22);
    b.add(new SphereGeometry(r * 0.22, 6, 4), [0.9, 0.9, 0.9], mat([r * 0.4, r * 1.4, -r * 0.5]));
    b.add(new SphereGeometry(r * 0.22, 6, 4), [0.9, 0.9, 0.9], mat([-r * 0.4, r * 1.4, -r * 0.5]));
    const ant = rng.range(0.3, 0.7);
    b.add(new CylinderGeometry(0.02, 0.03, ant, 4), dark, mat([r * 0.25, r * 1.8 + ant * 0.3, 0], [0, 0, -0.3]));
    b.add(new CylinderGeometry(0.02, 0.03, ant, 4), dark, mat([-r * 0.25, r * 1.8 + ant * 0.3, 0], [0, 0, 0.3]));
    b.add(new SphereGeometry(0.06, 5, 4), accent, mat([r * 0.25 + ant * 0.3, r * 1.8 + ant * 0.75, 0]), 2);
    b.add(new SphereGeometry(0.06, 5, 4), accent, mat([-r * 0.25 - ant * 0.3, r * 1.8 + ant * 0.75, 0]), 2);
    b.add(new ConeGeometry(r * 0.25, r * 0.5, 5), skin, mat([r * 0.6, r * 0.2, 0.1], [0, 0, 0.9]));
    b.add(new ConeGeometry(r * 0.25, r * 0.5, 5), skin, mat([-r * 0.6, r * 0.2, 0.1], [0, 0, -0.9]));
    height = r * 2;
    length = r * 2.2;
  } else {
    // flyer
    const L = rng.range(0.5, 0.9);
    b.add(new SphereGeometry(0.5, 8, 6), skin, mat([0, 0, 0], [0, 0, 0], [0.35, 0.3, L]));
    b.add(new SphereGeometry(0.16, 6, 5), skin, mat([0, 0.06, -L * 0.55]));
    b.add(new ConeGeometry(0.05, 0.25, 4), accent, mat([0, 0.04, -L * 0.55 - 0.2], [-Math.PI / 2, 0, 0]));
    eyes(0.08, 0.1, -L * 0.62, 0.035);
    b.add(new ConeGeometry(0.12, 0.45, 4), accent, mat([0, 0, L * 0.55], [Math.PI / 2, 0, 0], [1.6, 1, 0.3]));
    const span = rng.range(0.8, 1.5);
    const wg = new BoxGeometry(span, 0.03, 0.42);
    wg.translate(span / 2, 0, 0);
    wing = wg;
    wings.push([0.12, 0.05, -0.05], [-0.12, 0.05, -0.05]);
    height = 0.4;
    length = L + 0.5;
  }

  return { plan, body: b.build(), leg, wing, hips, wings, legLength, height, length };
}

/** Builds a flat-shaded wing/leg piece with the body colour. */
export function colorize(geo: BufferGeometry, color: RGB): BufferGeometry {
  const b = new MeshBuilder();
  b.add(geo, color);
  return b.build();
}
