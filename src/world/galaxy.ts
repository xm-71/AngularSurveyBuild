import { hsl, type RGB } from '../engine/color';
import { systemName } from '../engine/names';
import { Simplex } from '../engine/noise';
import { hash4, hash5, hashFloat, Rng } from '../engine/rng';

// An endless, seeded galaxy laid out on a grid of cubic sectors (light-years).
// Each sector deterministically holds zero or more star systems.

export const GALAXY_SEED = 0x51a2f00d;
export const SECTOR_LY = 12;

export type StarClass = 'yellow' | 'red' | 'blue' | 'white' | 'green';

export interface SystemRef {
  sx: number;
  sy: number;
  sz: number;
  i: number;
}

export interface SystemSummary {
  ref: SystemRef;
  key: string;
  seed: number;
  name: string;
  pos: [number, number, number];
  starClass: StarClass;
  starColor: RGB;
  planetCount: number;
}

export const STAR_CLASSES: Record<StarClass, { label: string; color: RGB; weight: number }> = {
  yellow: { label: 'Class G · Yellow', color: [1.0, 0.9, 0.66], weight: 0.48 },
  red: { label: 'Class M · Red', color: [1.0, 0.6, 0.4], weight: 0.24 },
  blue: { label: 'Class B · Blue', color: [0.62, 0.78, 1.0], weight: 0.1 },
  white: { label: 'Class A · White', color: [0.95, 0.96, 1.0], weight: 0.1 },
  green: { label: 'Class E · Green', color: [0.62, 1.0, 0.7], weight: 0.08 },
};

const densityNoise = new Simplex(GALAXY_SEED);

export function refKey(r: SystemRef): string {
  return `${r.sx}:${r.sy}:${r.sz}:${r.i}`;
}

export function parseRefKey(k: string): SystemRef {
  const [sx, sy, sz, i] = k.split(':').map(Number);
  return { sx, sy, sz, i };
}

/** Relative star density (0..1) at a galactic position. */
export function galaxyDensity(x: number, y: number, z: number): number {
  const r = Math.sqrt(x * x + z * z);
  const disc = Math.exp(-Math.abs(y) / 900) * Math.exp(-r / 60000);
  const theta = Math.atan2(z, x);
  const arms = 0.55 + 0.45 * Math.cos(2 * (theta - Math.log(Math.max(r, 1)) * 2.2));
  const local = 0.55 + 0.45 * densityNoise.fbm(x / 300, y / 300, z / 300, 3);
  return Math.min(1, disc * 1.6 * arms * local + 0.05 * local);
}

export function systemsInSector(sx: number, sy: number, sz: number): SystemSummary[] {
  const cx = (sx + 0.5) * SECTOR_LY, cy = (sy + 0.5) * SECTOR_LY, cz = (sz + 0.5) * SECTOR_LY;
  const d = galaxyDensity(cx, cy, cz);
  const h = hash4(sx, sy, sz, GALAXY_SEED);
  const expected = d * 1.8;
  let count = Math.floor(expected);
  if (hashFloat(h) < expected - count) count++;
  const out: SystemSummary[] = [];
  for (let i = 0; i < Math.min(count, 4); i++) {
    const ref = { sx, sy, sz, i };
    out.push(summarize(ref));
  }
  return out;
}

export function systemSeed(ref: SystemRef): number {
  return hash5(ref.sx, ref.sy, ref.sz, ref.i, GALAXY_SEED);
}

export function summarize(ref: SystemRef): SystemSummary {
  const seed = systemSeed(ref);
  const rng = new Rng(seed);
  const pos: [number, number, number] = [
    (ref.sx + rng.next()) * SECTOR_LY,
    (ref.sy + rng.next()) * SECTOR_LY,
    (ref.sz + rng.next()) * SECTOR_LY,
  ];
  const classes = Object.keys(STAR_CLASSES) as StarClass[];
  const starClass = rng.weighted(classes, classes.map((c) => STAR_CLASSES[c].weight));
  const planetCount = rng.weighted([2, 3, 4, 5, 6], [0.12, 0.3, 0.3, 0.18, 0.1]);
  return {
    ref,
    key: refKey(ref),
    seed,
    name: systemName(seed),
    pos,
    starClass,
    starColor: STAR_CLASSES[starClass].color,
    planetCount,
  };
}

/** All systems within `radius` light-years of a point. */
export function systemsNear(x: number, y: number, z: number, radius: number): SystemSummary[] {
  const out: SystemSummary[] = [];
  const s0x = Math.floor((x - radius) / SECTOR_LY), s1x = Math.floor((x + radius) / SECTOR_LY);
  const s0y = Math.floor((y - radius) / SECTOR_LY), s1y = Math.floor((y + radius) / SECTOR_LY);
  const s0z = Math.floor((z - radius) / SECTOR_LY), s1z = Math.floor((z + radius) / SECTOR_LY);
  const r2 = radius * radius;
  for (let sx = s0x; sx <= s1x; sx++) {
    for (let sy = s0y; sy <= s1y; sy++) {
      for (let sz = s0z; sz <= s1z; sz++) {
        for (const s of systemsInSector(sx, sy, sz)) {
          const dx = s.pos[0] - x, dy = s.pos[1] - y, dz = s.pos[2] - z;
          if (dx * dx + dy * dy + dz * dz <= r2) out.push(s);
        }
      }
    }
  }
  return out;
}

/** The fixed starting system: the nearest system to a point in a quiet outer arm. */
export function startingSystem(): SystemSummary {
  const origin: [number, number, number] = [8200, 30, 21400];
  let radius = 30;
  for (;;) {
    const list = systemsNear(origin[0], origin[1], origin[2], radius);
    if (list.length > 0) {
      list.sort((a, b) => dist2(a.pos, origin) - dist2(b.pos, origin));
      return list[0];
    }
    radius *= 2;
  }
}

function dist2(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

export function distanceLy(a: SystemSummary, b: SystemSummary): number {
  return Math.sqrt(dist2(a.pos, b.pos));
}

export function nebulaColors(seed: number): [RGB, RGB] {
  const rng = new Rng(seed ^ 0x4e42);
  const h1 = rng.range(0, 360);
  const h2 = h1 + rng.range(60, 180) * rng.sign();
  return [hsl(h1, rng.range(0.5, 0.9), rng.range(0.35, 0.55)), hsl(h2, rng.range(0.5, 0.9), rng.range(0.3, 0.5))];
}
