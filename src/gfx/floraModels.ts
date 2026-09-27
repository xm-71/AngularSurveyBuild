import {
  BoxGeometry, BufferAttribute, BufferGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry, IcosahedronGeometry,
  OctahedronGeometry, SphereGeometry,
} from 'three';
import { hexToRgb, mixRGB, rgbToLinear, scaleRGB, type RGB } from '../engine/color';
import { Simplex } from '../engine/noise';
import { Rng } from '../engine/rng';
import type { FloraSpeciesDesc, Palette } from '../world/planetTypes';
import { RESOURCES } from '../world/resources';
import { displace, mat, MeshBuilder } from './meshBuilder';

export interface FloraModel {
  geometry: BufferGeometry;
  /** Approximate model height at scale 1 (m). */
  height: number;
  /** Tip sway amplitude in meters. */
  wind: number;
  glow: number;
  instanceTint: boolean;
}

const lin = (c: RGB): RGB => rgbToLinear(c);

function jitter(rng: Rng, c: RGB, amt = 0.08): RGB {
  return [
    Math.max(0, Math.min(1, c[0] * (1 + rng.range(-amt, amt)))),
    Math.max(0, Math.min(1, c[1] * (1 + rng.range(-amt, amt)))),
    Math.max(0, Math.min(1, c[2] * (1 + rng.range(-amt, amt)))),
  ];
}

function rockGeo(rng: Rng, detail: number, rough: number): BufferGeometry {
  const n = new Simplex(rng.uint());
  const g = detail > 0 ? new IcosahedronGeometry(1, detail) : new DodecahedronGeometry(1, 0);
  const sx = rng.range(0.8, 1.3), sy = rng.range(0.55, 1.0), sz = rng.range(0.8, 1.3);
  displace(g, (x, y, z) => 1 + n.noise3(x * 1.6, y * 1.6, z * 1.6) * rough + n.noise3(x * 4, y * 4, z * 4) * rough * 0.35);
  g.scale(sx, sy, sz);
  return g;
}

/** Builds the model for one flora species of a planet. */
export function buildFloraModel(sp: FloraSpeciesDesc, pal: Palette): FloraModel {
  const rng = new Rng(sp.seed);
  const b = new MeshBuilder();
  const leaf = pal.leaf.map((c) => lin(c)) as [RGB, RGB, RGB];
  const trunk = lin(pal.trunk);
  const rock1 = lin(pal.rock1);
  const rock2 = lin(pal.rock2);
  const bloom = pal.bloom.map((c) => lin(c)) as [RGB, RGB];
  const glowCol = lin(pal.glow);
  let height = 1;
  let wind = 0;
  let glow = 0;
  let instanceTint = false;

  switch (sp.kind) {
    case 'tree': {
      const h = rng.range(6, 11);
      height = h;
      const style = rng.int(0, 3);
      const tr = rng.range(0.22, 0.4);
      const lean = rng.range(-0.12, 0.12);
      b.add(new CylinderGeometry(tr * 0.6, tr, h * 0.62, 6), trunk, mat([0, h * 0.31, 0], [lean, 0, lean * 0.5]));
      const top = h * 0.62;
      const lc = rng.pick(leaf);
      if (style === 0) {
        // round blob canopy
        const n = rng.int(3, 5);
        for (let i = 0; i < n; i++) {
          const r = rng.range(1.4, 2.4) * (h / 9);
          b.add(new IcosahedronGeometry(r, 0), jitter(rng, lc), mat([rng.range(-1.2, 1.2), top + rng.range(0, 2.2), rng.range(-1.2, 1.2)], [rng.next(), rng.next(), 0], [1, rng.range(0.7, 1), 1]));
        }
      } else if (style === 1) {
        // umbrella canopy
        const r = rng.range(2.6, 3.8) * (h / 9);
        b.add(new SphereGeometry(r, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), lc, mat([0, top + 0.6, 0], [0, 0, 0], [1, rng.range(0.35, 0.6), 1]));
        b.add(new CylinderGeometry(r * 0.98, r * 0.8, 0.5, 9), jitter(rng, lc, 0.2), mat([0, top + 0.45, 0]));
      } else if (style === 2) {
        // layered discs
        for (let i = 0; i < 3; i++) {
          const r = (2.8 - i * 0.7) * (h / 9);
          b.add(new CylinderGeometry(r * 0.7, r, 0.9, 7), jitter(rng, lc), mat([0, top - 1 + i * 1.5, 0], [0, rng.next() * 3, 0]));
        }
      } else {
        // twisted branches with pods
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + rng.range(-0.3, 0.3);
          const len = rng.range(1.8, 2.8);
          b.add(new CylinderGeometry(0.08, 0.15, len, 5), trunk, mat([Math.cos(a) * len * 0.35, top + len * 0.3, Math.sin(a) * len * 0.35], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9]));
          b.add(new IcosahedronGeometry(rng.range(0.9, 1.5), 0), jitter(rng, lc), mat([Math.cos(a) * len * 0.75, top + len * 0.62, Math.sin(a) * len * 0.75]));
        }
        b.add(new IcosahedronGeometry(1.4, 0), jitter(rng, lc), mat([0, top + 1.6, 0]));
      }
      if (rng.chance(0.35)) {
        for (let i = 0; i < 5; i++) {
          b.add(new IcosahedronGeometry(0.22, 0), bloom[i % 2], mat([rng.range(-2, 2), top + rng.range(0.2, 2.5), rng.range(-2, 2)]), 0.6);
        }
      }
      wind = 0.35;
      break;
    }
    case 'conifer': {
      const h = rng.range(7, 13);
      height = h;
      b.add(new CylinderGeometry(0.15, 0.32, h * 0.4, 6), trunk, mat([0, h * 0.2, 0]));
      const layers = rng.int(3, 5);
      const lc = rng.pick(leaf);
      for (let i = 0; i < layers; i++) {
        const t = i / layers;
        const r = (1 - t * 0.75) * rng.range(1.8, 2.5) * (h / 10);
        const ch = h * 0.34;
        b.add(new ConeGeometry(r, ch, 7), jitter(rng, lc, 0.12), mat([0, h * 0.25 + t * h * 0.6 + ch * 0.4, 0], [0, rng.next() * 2, 0]));
      }
      wind = 0.25;
      break;
    }
    case 'palm': {
      const h = rng.range(6, 10);
      height = h;
      const segs = 5;
      const bend = rng.range(0.15, 0.35);
      let x = 0, y = 0;
      for (let i = 0; i < segs; i++) {
        const segH = h / segs;
        const ang = bend * (i / segs);
        b.add(new CylinderGeometry(0.2, 0.26, segH * 1.05, 6), trunk, mat([x + Math.sin(ang) * segH * 0.5, y + segH * 0.5, 0], [0, 0, -ang]));
        x += Math.sin(ang) * segH;
        y += Math.cos(ang) * segH;
      }
      const lc = rng.pick(leaf);
      const fronds = rng.int(6, 9);
      for (let i = 0; i < fronds; i++) {
        const a = (i / fronds) * Math.PI * 2;
        const len = rng.range(2.6, 3.6);
        const g = new BoxGeometry(len, 0.06, 0.7);
        g.translate(len / 2, 0, 0);
        b.add(g, jitter(rng, lc), mat([x, y, 0], [0, a, -0.35 - rng.range(0, 0.3)]));
      }
      b.add(new IcosahedronGeometry(0.35, 0), bloom[0], mat([x, y - 0.2, 0.2]), 0.4);
      wind = 0.4;
      break;
    }
    case 'mushroom': {
      const h = rng.range(3, 7);
      height = h;
      const capCol = rng.chance(0.5) ? bloom[0] : rng.pick(leaf);
      const stemCol = mixRGB(trunk, [0.8, 0.78, 0.7], 0.5);
      b.add(new CylinderGeometry(rng.range(0.25, 0.45), rng.range(0.45, 0.7), h, 7), stemCol, mat([0, h / 2, 0], [rng.range(-0.1, 0.1), 0, rng.range(-0.1, 0.1)]));
      const cr = rng.range(1.6, 2.8) * (h / 5);
      b.add(new SphereGeometry(cr, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), capCol, mat([0, h - 0.2, 0], [0, 0, 0], [1, rng.range(0.4, 0.8), 1]), 0.25);
      b.add(new CylinderGeometry(cr, cr * 0.9, 0.25, 10), scaleRGB(capCol, 0.6), mat([0, h - 0.3, 0]));
      if (rng.chance(0.6)) {
        for (let i = 0; i < 6; i++) {
          const a = rng.next() * Math.PI * 2;
          const rr = rng.range(0.2, 0.8) * cr;
          b.add(new IcosahedronGeometry(0.18, 0), glowCol, mat([Math.cos(a) * rr, h - 0.2 + (1 - rr / cr) * cr * 0.45, Math.sin(a) * rr]), 2.2);
        }
        glow = 1;
      }
      wind = 0.08;
      break;
    }
    case 'bush': {
      height = rng.range(0.9, 1.7);
      const n = rng.int(3, 6);
      const lc = rng.pick(leaf);
      for (let i = 0; i < n; i++) {
        const r = rng.range(0.4, 0.75);
        b.add(new IcosahedronGeometry(r, 0), jitter(rng, lc, 0.15), mat([rng.range(-0.5, 0.5), r * 0.7 + rng.range(0, 0.5), rng.range(-0.5, 0.5)], [rng.next(), rng.next(), 0]));
      }
      if (rng.chance(0.5)) {
        for (let i = 0; i < 4; i++) b.add(new IcosahedronGeometry(0.12, 0), bloom[1], mat([rng.range(-0.6, 0.6), rng.range(0.6, 1.3), rng.range(-0.6, 0.6)]), 0.8);
      }
      wind = 0.08;
      break;
    }
    case 'cactus': {
      const h = rng.range(2.5, 5);
      height = h;
      const c = rng.pick(leaf);
      const r = rng.range(0.28, 0.45);
      b.add(new CylinderGeometry(r, r * 1.1, h, 8), c, mat([0, h / 2, 0]));
      b.add(new SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), c, mat([0, h, 0]));
      const arms = rng.int(0, 3);
      for (let i = 0; i < arms; i++) {
        const a = rng.next() * Math.PI * 2;
        const ay = rng.range(0.35, 0.7) * h;
        const al = rng.range(0.7, 1.4);
        b.add(new CylinderGeometry(r * 0.7, r * 0.7, al, 7), c, mat([Math.cos(a) * al * 0.5, ay, Math.sin(a) * al * 0.5], [0, -a, Math.PI / 2]));
        const up = rng.range(0.8, 1.6);
        b.add(new CylinderGeometry(r * 0.65, r * 0.7, up, 7), c, mat([Math.cos(a) * al, ay + up / 2, Math.sin(a) * al]));
      }
      if (rng.chance(0.6)) b.add(new IcosahedronGeometry(0.2, 0), bloom[0], mat([0, h + 0.2, 0]), 0.8);
      wind = 0;
      break;
    }
    case 'grass': {
      height = rng.range(0.5, 0.9);
      const blades = rng.int(5, 8);
      const g = new BufferGeometry();
      const pos: number[] = [];
      for (let i = 0; i < blades; i++) {
        const a = rng.next() * Math.PI * 2;
        const r = rng.range(0, 0.18);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const w = rng.range(0.04, 0.07);
        const hh = height * rng.range(0.7, 1.2);
        const lean = rng.range(0.05, 0.25);
        const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
        pos.push(x - px, 0, z - pz, x + px, 0, z + pz, x + Math.cos(a) * lean, hh, z + Math.sin(a) * lean);
      }
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      b.add(g, [1, 1, 1]);
      wind = 0.12;
      instanceTint = true;
      break;
    }
    case 'rock': {
      height = 0.8;
      b.add(rockGeo(rng, 0, 0.25), jitter(rng, rng.chance(0.5) ? rock1 : rock2), mat([0, 0.2, 0], [0, 0, 0], 0.6));
      if (rng.chance(0.5)) b.add(rockGeo(rng, 0, 0.3), jitter(rng, rock2), mat([0.6, 0.05, 0.2], [0, 0, 0], 0.35));
      break;
    }
    case 'boulder': {
      height = 2.6;
      b.add(rockGeo(rng, 1, 0.22), jitter(rng, rock1), mat([0, 0.9, 0], [0, 0, 0], 1.8));
      if (rng.chance(0.6)) b.add(rockGeo(rng, 0, 0.3), jitter(rng, rock2), mat([1.5, 0.3, 0.6], [0, 0, 0], 0.8));
      break;
    }
    case 'spireRock': {
      const h = rng.range(6, 12);
      height = h;
      const n = new Simplex(rng.uint());
      const g = new CylinderGeometry(0.7, 1.6, h, 7, 6);
      const p = g.attributes.position as BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 1 + n.noise3(x * 0.8, y * 0.35, z * 0.8) * 0.35;
        p.setXYZ(i, x * k + Math.sin(y * 0.3) * 0.4, y + h / 2, z * k);
      }
      b.add(g, jitter(rng, rock1), undefined);
      b.add(rockGeo(rng, 0, 0.3), rock2, mat([0, h, 0], [0, 0, 0], 1.1));
      break;
    }
    case 'crystal': {
      height = 1.6;
      const c = lin(hexToRgb(RESOURCES.hydrogen.color));
      const n = rng.int(4, 7);
      for (let i = 0; i < n; i++) {
        const hh = rng.range(0.6, 1.6);
        const g = new OctahedronGeometry(0.28, 0);
        g.scale(0.7, hh / 0.5, 0.7);
        const a = rng.next() * Math.PI * 2;
        const tilt = rng.range(0, 0.5);
        b.add(g, jitter(rng, c, 0.1), mat([Math.cos(a) * 0.25, hh * 0.45, Math.sin(a) * 0.25], [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt]), 1.3);
      }
      b.add(rockGeo(rng, 0, 0.3), rock2, mat([0, 0.05, 0], [0, 0, 0], [0.7, 0.3, 0.7]));
      glow = 1;
      break;
    }
    case 'sodiumPlant':
    case 'oxygenPlant': {
      height = 1.2;
      const isNa = sp.kind === 'sodiumPlant';
      const c = lin(hexToRgb(isNa ? RESOURCES.sodium.color : RESOURCES.oxygen.color));
      const stem = mixRGB(rng.pick(leaf), [0.1, 0.1, 0.1], 0.3);
      const stems = rng.int(3, 5);
      for (let i = 0; i < stems; i++) {
        const a = (i / stems) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const hh = rng.range(0.6, 1.1);
        const tilt = rng.range(0.15, 0.45);
        b.add(new CylinderGeometry(0.04, 0.06, hh, 5), stem, mat([Math.cos(a) * hh * 0.2, hh / 2, Math.sin(a) * hh * 0.2], [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt]));
        const bulb = isNa ? new IcosahedronGeometry(0.2, 0) : new SphereGeometry(0.22, 7, 5);
        b.add(bulb, c, mat([Math.cos(a) * hh * 0.42, hh, Math.sin(a) * hh * 0.42]), 1.6);
      }
      b.add(new IcosahedronGeometry(0.3, 0), mixRGB(stem, c, 0.2), mat([0, 0.1, 0], [0, 0, 0], [1, 0.5, 1]));
      glow = 1;
      wind = 0.06;
      break;
    }
    case 'deposit': {
      height = 3;
      const res = sp.resource ? RESOURCES[sp.resource] : RESOURCES.gold;
      const c = lin(hexToRgb(res.color));
      b.add(rockGeo(rng, 1, 0.25), rock2, mat([0, 0.6, 0], [0, 0, 0], [2.2, 1.2, 2.2]));
      const n = rng.int(5, 9);
      for (let i = 0; i < n; i++) {
        const hh = rng.range(1.0, 2.6);
        const g = new CylinderGeometry(0, 0.35, hh, 6);
        const a = rng.next() * Math.PI * 2;
        const r = rng.range(0.2, 1.3);
        const tilt = rng.range(0, 0.6);
        b.add(g, jitter(rng, c, 0.1), mat([Math.cos(a) * r, 0.9 + hh * 0.4, Math.sin(a) * r], [Math.sin(a) * tilt, 0, -Math.cos(a) * tilt]), 0.9);
      }
      glow = 1;
      break;
    }
    case 'bulb': {
      const h = rng.range(2, 4.5);
      height = h;
      const stem = rng.pick(leaf);
      const c = rng.chance(0.5) ? bloom[0] : glowCol;
      b.add(new CylinderGeometry(0.08, 0.16, h, 5), stem, mat([0, h / 2, 0], [rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15)]));
      b.add(new SphereGeometry(rng.range(0.5, 0.9), 9, 7), c, mat([0, h, 0]), 1.4);
      if (rng.chance(0.6)) {
        const h2 = h * 0.6;
        b.add(new CylinderGeometry(0.06, 0.1, h2, 5), stem, mat([0.4, h2 / 2, 0.2], [0, 0, -0.3]));
        b.add(new SphereGeometry(0.4, 8, 6), c, mat([0.75, h2, 0.3]), 1.4);
      }
      for (let i = 0; i < 3; i++) {
        const g = new BoxGeometry(0.9, 0.04, 0.3);
        g.translate(0.45, 0, 0);
        b.add(g, stem, mat([0, 0.1, 0], [0, (i / 3) * Math.PI * 2, 0.4]));
      }
      glow = 1;
      wind = 0.12;
      break;
    }
  }

  return { geometry: b.build(), height, wind, glow, instanceTint };
}
