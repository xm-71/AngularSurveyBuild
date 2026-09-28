import { hsl, type RGB, rgbToLinear } from '../engine/color';
import { speciesName } from '../engine/names';
import { hash2, Rng } from '../engine/rng';
import { nodeSize } from './cubeSphere';
import type {
  AtmosphereParams, Biome, CloudParams, FloraKind, FloraSpeciesDesc, Hazard, Liquid, Palette, PlanetParams, RingParams,
  TerrainShape,
} from './planetTypes';
import type { ResourceId } from './resources';
import { TerrainGenerator } from './terrain';

interface Archetype {
  biome: Biome;
  label: string;
  weight: number;
  moonWeight: number;
  descriptors: string[];
  weathers: string[];
  hazard: Hazard;
  hazardLevel: [number, number];
  temp: [number, number];
  seaChance: number;
  seaFrac: [number, number];
  liquid: Liquid | ((rng: Rng) => Liquid);
  atmoChance: number;
  atmoHue: [number, number];
  atmoSat: [number, number];
  atmoDensity: [number, number];
  cloudChance: number;
  cloudCover: [number, number];
  flora: [number, number];
  fauna: [number, number];
  polarCaps: [number, number];
  snowLine: [number, number];
  moisture: [number, number];
  rares: ResourceId[];
  floraKinds: FloraKind[];
  palette: (rng: Rng) => Palette;
  shape: (rng: Rng, s: TerrainShape, R: number) => void;
}

const j = (rng: Rng, v: number, d: number) => v + rng.range(-d, d);

function leafSet(rng: Rng, hue: number, sat: number, light: number, spread = 25): [RGB, RGB, RGB] {
  return [
    hsl(j(rng, hue, spread * 0.3), sat, light),
    hsl(j(rng, hue, spread), sat * rng.range(0.8, 1.1), light * rng.range(0.8, 1.2)),
    hsl(j(rng, hue, spread), sat * rng.range(0.7, 1.1), light * rng.range(0.7, 1.3)),
  ];
}

function blooms(rng: Rng): [RGB, RGB] {
  return [hsl(rng.range(0, 360), rng.range(0.7, 0.95), rng.range(0.55, 0.7)), hsl(rng.range(0, 360), rng.range(0.7, 0.95), rng.range(0.55, 0.7))];
}

const ARCHETYPES: Archetype[] = [
  {
    biome: 'lush', label: 'Lush', weight: 1.3, moonWeight: 0.3,
    descriptors: ['Paradise Planet', 'Verdant World', 'Temperate Planet', 'Bountiful World', 'Rolling Meadows'],
    weathers: ['Mild', 'Pleasant', 'Balmy', 'Gentle Rain', 'Temperate'],
    hazard: 'none', hazardLevel: [0, 0], temp: [12, 28],
    seaChance: 0.9, seaFrac: [0.3, 0.55], liquid: 'water',
    atmoChance: 1, atmoHue: [188, 222], atmoSat: [0.55, 0.9], atmoDensity: [0.8, 1.2],
    cloudChance: 0.95, cloudCover: [0.25, 0.48],
    flora: [0.75, 1], fauna: [0.7, 1], polarCaps: [0.6, 1.2], snowLine: [1.05, 1.45], moisture: [0.0, 0.15],
    rares: ['copper', 'gold', 'silver'],
    floraKinds: ['tree', 'tree', 'bush', 'bush', 'grass', 'rock', 'boulder', 'crystal', 'sodiumPlant', 'oxygenPlant', 'deposit'],
    palette: (rng) => {
      const gh = rng.range(78, 150);
      return {
        low1: hsl(gh, rng.range(0.45, 0.7), rng.range(0.26, 0.36)),
        low2: hsl(j(rng, gh, 28), rng.range(0.4, 0.7), rng.range(0.2, 0.32)),
        high: hsl(j(rng, gh - 20, 20), rng.range(0.2, 0.4), rng.range(0.3, 0.4)),
        beach: hsl(rng.range(36, 50), rng.range(0.3, 0.5), rng.range(0.6, 0.72)),
        rock1: hsl(rng.range(15, 40), rng.range(0.08, 0.22), rng.range(0.32, 0.44)),
        rock2: hsl(rng.range(15, 45), rng.range(0.1, 0.25), rng.range(0.22, 0.3)),
        peak: hsl(205, 0.25, 0.93),
        seabed: hsl(rng.range(35, 60), 0.3, 0.42),
        liquidShallow: hsl(rng.range(168, 196), rng.range(0.6, 0.85), 0.5),
        liquidDeep: hsl(rng.range(198, 222), rng.range(0.7, 0.9), rng.range(0.16, 0.24)),
        leaf: leafSet(rng, j(rng, gh, 15), rng.range(0.5, 0.75), rng.range(0.28, 0.4)),
        trunk: hsl(rng.range(18, 34), rng.range(0.25, 0.45), rng.range(0.2, 0.3)),
        bloom: blooms(rng),
        glow: hsl(rng.range(160, 200), 0.9, 0.6),
      };
    },
    shape: (rng, s) => {
      if (rng.chance(0.25)) s.warp = rng.range(0.15, 0.3);
    },
  },
  {
    biome: 'tropical', label: 'Tropical', weight: 0.8, moonWeight: 0.1,
    descriptors: ['Tropical Planet', 'Humid World', 'Jungle World', 'Overgrown Sphere'],
    weathers: ['Humid', 'Warm Rain', 'Sweltering', 'Heavy Rain', 'Steamy'],
    hazard: 'heat', hazardLevel: [0, 0.5], temp: [26, 42],
    seaChance: 1, seaFrac: [0.35, 0.6], liquid: 'water',
    atmoChance: 1, atmoHue: [168, 196], atmoSat: [0.6, 0.95], atmoDensity: [0.9, 1.35],
    cloudChance: 1, cloudCover: [0.35, 0.55],
    flora: [0.9, 1], fauna: [0.8, 1], polarCaps: [0.2, 0.6], snowLine: [1.2, 2.0], moisture: [0.1, 0.25],
    rares: ['copper', 'gold'],
    floraKinds: ['palm', 'tree', 'bush', 'bush', 'grass', 'rock', 'boulder', 'crystal', 'sodiumPlant', 'oxygenPlant', 'deposit'],
    palette: (rng) => {
      const gh = rng.range(95, 165);
      return {
        low1: hsl(gh, rng.range(0.6, 0.85), rng.range(0.24, 0.34)),
        low2: hsl(j(rng, gh, 25), rng.range(0.55, 0.85), rng.range(0.18, 0.28)),
        high: hsl(j(rng, gh, 20), rng.range(0.4, 0.6), rng.range(0.22, 0.32)),
        beach: hsl(rng.range(40, 52), rng.range(0.45, 0.65), rng.range(0.7, 0.8)),
        rock1: hsl(rng.range(20, 40), rng.range(0.1, 0.25), rng.range(0.3, 0.4)),
        rock2: hsl(rng.range(100, 160), rng.range(0.1, 0.2), rng.range(0.2, 0.28)),
        peak: hsl(rng.range(90, 150), 0.35, 0.4),
        seabed: hsl(rng.range(40, 55), 0.45, 0.6),
        liquidShallow: hsl(rng.range(168, 182), 0.9, 0.55),
        liquidDeep: hsl(rng.range(190, 210), 0.9, 0.22),
        leaf: leafSet(rng, gh, rng.range(0.6, 0.85), rng.range(0.25, 0.38)),
        trunk: hsl(rng.range(22, 36), 0.35, 0.24),
        bloom: blooms(rng),
        glow: hsl(rng.range(280, 330), 0.9, 0.65),
      };
    },
    shape: (rng, s) => {
      s.mountAmp *= 0.8;
      if (rng.chance(0.4)) s.warp = rng.range(0.15, 0.35);
    },
  },
  {
    biome: 'desert', label: 'Desert', weight: 1.0, moonWeight: 0.6,
    descriptors: ['Scorched Sands', 'Desert World', 'Dune World', 'Mesa Planet', 'Arid Expanse'],
    weathers: ['Scorching', 'Arid', 'Blistering', 'Dry Gusts', 'Sandstorms'],
    hazard: 'heat', hazardLevel: [0.8, 2], temp: [45, 85],
    seaChance: 0.12, seaFrac: [0.05, 0.12], liquid: 'water',
    atmoChance: 1, atmoHue: [18, 42], atmoSat: [0.5, 0.85], atmoDensity: [0.6, 1.1],
    cloudChance: 0.35, cloudCover: [0.1, 0.3],
    flora: [0.25, 0.5], fauna: [0.3, 0.6], polarCaps: [0, 0.2], snowLine: [3, 5], moisture: [-0.35, -0.2],
    rares: ['copper', 'gold'],
    floraKinds: ['cactus', 'cactus', 'bush', 'rock', 'boulder', 'spireRock', 'crystal', 'sodiumPlant', 'deposit'],
    palette: (rng) => {
      const sh = rng.range(18, 42);
      return {
        low1: hsl(sh, rng.range(0.45, 0.7), rng.range(0.5, 0.62)),
        low2: hsl(j(rng, sh, 10), rng.range(0.4, 0.65), rng.range(0.42, 0.55)),
        high: hsl(j(rng, sh - 8, 8), rng.range(0.45, 0.6), rng.range(0.38, 0.48)),
        beach: hsl(sh + 8, 0.45, 0.7),
        rock1: hsl(j(rng, sh - 12, 8), rng.range(0.4, 0.6), rng.range(0.34, 0.44)),
        rock2: hsl(j(rng, sh - 5, 10), rng.range(0.3, 0.5), rng.range(0.24, 0.32)),
        peak: hsl(sh + 10, 0.35, 0.78),
        seabed: hsl(sh, 0.4, 0.45),
        liquidShallow: hsl(rng.range(170, 190), 0.7, 0.5),
        liquidDeep: hsl(rng.range(195, 210), 0.7, 0.25),
        leaf: leafSet(rng, rng.range(70, 110), rng.range(0.3, 0.5), rng.range(0.3, 0.4)),
        trunk: hsl(sh, 0.3, 0.3),
        bloom: blooms(rng),
        glow: hsl(rng.range(20, 50), 0.95, 0.6),
      };
    },
    shape: (rng, s, R) => {
      s.mountAmp *= 0.6;
      if (rng.chance(0.6)) {
        s.terraceStep = rng.range(0.0018, 0.0045) * R;
        s.terraceSharp = rng.range(0.5, 0.95);
      }
      if (rng.chance(0.35)) s.plateau = s.contAmp * rng.range(0.3, 0.6);
      if (rng.chance(0.45)) {
        s.canyon = rng.range(0.4, 1);
        s.canyonDepth = R * rng.range(0.006, 0.018);
      }
      s.hillAmp *= 0.7;
    },
  },
  {
    biome: 'frozen', label: 'Frozen', weight: 0.9, moonWeight: 0.8,
    descriptors: ['Frozen World', 'Glacial Planet', 'Ice World', 'Frostbound Sphere', 'Tundra'],
    weathers: ['Freezing', 'Icy Blasts', 'Frigid', 'Snowfall', 'Whiteout Gusts'],
    hazard: 'cold', hazardLevel: [0.8, 2], temp: [-95, -25],
    seaChance: 0.65, seaFrac: [0.2, 0.45], liquid: (rng) => (rng.chance(0.65) ? 'ice' : 'water'),
    atmoChance: 1, atmoHue: [195, 265], atmoSat: [0.3, 0.7], atmoDensity: [0.7, 1.1],
    cloudChance: 0.85, cloudCover: [0.35, 0.65],
    flora: [0.3, 0.55], fauna: [0.3, 0.6], polarCaps: [2.0, 3.5], snowLine: [0.05, 0.3], moisture: [-0.1, 0.1],
    rares: ['cobalt', 'silver', 'platinum'],
    floraKinds: ['conifer', 'conifer', 'bush', 'rock', 'boulder', 'crystal', 'crystal', 'sodiumPlant', 'deposit'],
    palette: (rng) => {
      const ih = rng.range(190, 225);
      return {
        low1: hsl(ih, rng.range(0.12, 0.3), rng.range(0.8, 0.9)),
        low2: hsl(j(rng, ih, 15), rng.range(0.15, 0.35), rng.range(0.7, 0.82)),
        high: hsl(ih, 0.2, 0.9),
        beach: hsl(ih, 0.25, 0.75),
        rock1: hsl(j(rng, ih, 20), rng.range(0.08, 0.2), rng.range(0.28, 0.4)),
        rock2: hsl(j(rng, ih, 20), rng.range(0.1, 0.2), rng.range(0.18, 0.26)),
        peak: hsl(ih, 0.2, 0.96),
        seabed: hsl(ih, 0.25, 0.4),
        liquidShallow: hsl(rng.range(185, 205), rng.range(0.4, 0.6), rng.range(0.72, 0.82)),
        liquidDeep: hsl(rng.range(200, 220), rng.range(0.5, 0.7), rng.range(0.4, 0.55)),
        leaf: leafSet(rng, rng.range(150, 200), rng.range(0.2, 0.45), rng.range(0.22, 0.35)),
        trunk: hsl(rng.range(20, 30), 0.2, 0.2),
        bloom: blooms(rng),
        glow: hsl(rng.range(180, 220), 0.9, 0.65),
      };
    },
    shape: (rng, s) => {
      s.mountAmp *= rng.range(1.0, 1.4);
      s.mountSharp = rng.range(2.0, 3.0);
    },
  },
  {
    biome: 'toxic', label: 'Toxic', weight: 0.8, moonWeight: 0.3,
    descriptors: ['Toxic World', 'Caustic Planet', 'Poisonous Sphere', 'Noxious World', 'Acidic Globe'],
    weathers: ['Caustic Moisture', 'Toxic Rain', 'Acidic Deluges', 'Choking Clouds', 'Poison Mist'],
    hazard: 'toxic', hazardLevel: [0.8, 2], temp: [18, 55],
    seaChance: 0.55, seaFrac: [0.08, 0.25], liquid: 'acid',
    atmoChance: 1, atmoHue: [52, 105], atmoSat: [0.5, 0.9], atmoDensity: [1.0, 1.5],
    cloudChance: 0.8, cloudCover: [0.3, 0.6],
    flora: [0.5, 0.85], fauna: [0.4, 0.7], polarCaps: [0.3, 0.8], snowLine: [1.5, 3], moisture: [0.0, 0.15],
    rares: ['ammonia'],
    floraKinds: ['mushroom', 'mushroom', 'bulb', 'bush', 'grass', 'rock', 'boulder', 'crystal', 'oxygenPlant', 'sodiumPlant', 'deposit'],
    palette: (rng) => {
      const alt = rng.chance(0.45);
      const gh = alt ? rng.range(270, 310) : rng.range(55, 90);
      return {
        low1: hsl(gh, rng.range(0.4, 0.65), rng.range(0.3, 0.42)),
        low2: hsl(j(rng, gh, 25), rng.range(0.35, 0.6), rng.range(0.22, 0.34)),
        high: hsl(j(rng, gh + 30, 20), rng.range(0.3, 0.5), rng.range(0.28, 0.38)),
        beach: hsl(j(rng, gh, 20), 0.45, 0.5),
        rock1: hsl(rng.range(260, 320), rng.range(0.15, 0.35), rng.range(0.22, 0.32)),
        rock2: hsl(rng.range(60, 100), rng.range(0.15, 0.3), rng.range(0.18, 0.26)),
        peak: hsl(rng.range(50, 80), 0.6, 0.6),
        seabed: hsl(gh, 0.35, 0.25),
        liquidShallow: hsl(rng.range(80, 110), 0.95, 0.5),
        liquidDeep: hsl(rng.range(95, 130), 0.9, 0.22),
        leaf: leafSet(rng, alt ? rng.range(60, 100) : rng.range(270, 320), rng.range(0.5, 0.85), rng.range(0.35, 0.5), 40),
        trunk: hsl(rng.range(270, 330), 0.3, 0.25),
        bloom: blooms(rng),
        glow: hsl(rng.range(70, 110), 1, 0.6),
      };
    },
    shape: (rng, s, R) => {
      s.warp = rng.range(0.2, 0.4);
      if (rng.chance(0.4)) {
        s.canyon = rng.range(0.4, 1);
        s.canyonDepth = R * rng.range(0.005, 0.012);
      }
      if (rng.chance(0.3)) {
        s.spires = 1;
        s.spireHeight = R * rng.range(0.006, 0.014);
      }
    },
  },
  {
    biome: 'radioactive', label: 'Irradiated', weight: 0.7, moonWeight: 0.4,
    descriptors: ['Irradiated Planet', 'Nuclear World', 'Contaminated Sphere', 'Isotopic Globe', 'Gamma World'],
    weathers: ['Irradiated', 'Nuclear Emission', 'Gamma Winds', 'Radioactive Dust', 'Contaminated Squalls'],
    hazard: 'radiation', hazardLevel: [0.8, 2], temp: [5, 40],
    seaChance: 0.4, seaFrac: [0.1, 0.3], liquid: 'water',
    atmoChance: 1, atmoHue: [72, 135], atmoSat: [0.25, 0.6], atmoDensity: [0.9, 1.4],
    cloudChance: 0.6, cloudCover: [0.25, 0.5],
    flora: [0.35, 0.65], fauna: [0.3, 0.6], polarCaps: [0.4, 1], snowLine: [1, 2], moisture: [-0.15, 0.05],
    rares: ['uranium'],
    floraKinds: ['mushroom', 'bulb', 'tree', 'bush', 'grass', 'rock', 'boulder', 'crystal', 'sodiumPlant', 'deposit'],
    palette: (rng) => {
      const gh = rng.range(55, 95);
      return {
        low1: hsl(gh, rng.range(0.3, 0.5), rng.range(0.28, 0.38)),
        low2: hsl(j(rng, gh - 30, 20), rng.range(0.3, 0.5), rng.range(0.22, 0.32)),
        high: hsl(rng.range(0, 30), rng.range(0.25, 0.45), rng.range(0.3, 0.4)),
        beach: hsl(gh, 0.35, 0.5),
        rock1: hsl(rng.range(0, 30), rng.range(0.2, 0.4), rng.range(0.28, 0.38)),
        rock2: hsl(rng.range(60, 90), rng.range(0.15, 0.3), rng.range(0.2, 0.28)),
        peak: hsl(rng.range(60, 80), 0.3, 0.7),
        seabed: hsl(gh, 0.3, 0.3),
        liquidShallow: hsl(rng.range(95, 140), 0.75, 0.45),
        liquidDeep: hsl(rng.range(140, 170), 0.8, 0.2),
        leaf: leafSet(rng, rng.range(70, 130), rng.range(0.6, 0.9), rng.range(0.4, 0.55), 30),
        trunk: hsl(rng.range(20, 40), 0.2, 0.2),
        bloom: blooms(rng),
        glow: hsl(rng.range(90, 130), 1, 0.55),
      };
    },
    shape: (rng, s) => {
      if (rng.chance(0.5)) {
        s.craterDensity = rng.range(0.1, 0.3);
        s.craterDepth = rng.range(40, 120);
      }
    },
  },
  {
    biome: 'volcanic', label: 'Volcanic', weight: 0.7, moonWeight: 0.5,
    descriptors: ['Volcanic World', 'Molten Planet', 'Inferno', 'Ashen World', 'Magma Sphere'],
    weathers: ['Scorched', 'Ashen', 'Burning Air', 'Ember Storms', 'Magma Rain'],
    hazard: 'heat', hazardLevel: [1.5, 3], temp: [90, 210],
    seaChance: 0.75, seaFrac: [0.12, 0.3], liquid: 'lava',
    atmoChance: 0.9, atmoHue: [0, 28], atmoSat: [0.5, 0.85], atmoDensity: [0.9, 1.5],
    cloudChance: 0.5, cloudCover: [0.2, 0.45],
    flora: [0.15, 0.35], fauna: [0.15, 0.4], polarCaps: [0, 0.2], snowLine: [5, 8], moisture: [-0.3, -0.1],
    rares: ['phosphorus', 'gold'],
    floraKinds: ['rock', 'boulder', 'spireRock', 'bush', 'crystal', 'sodiumPlant', 'deposit'],
    palette: (rng) => {
      const bh = rng.range(0, 30);
      return {
        low1: hsl(bh, rng.range(0.08, 0.2), rng.range(0.12, 0.2)),
        low2: hsl(j(rng, bh, 15), rng.range(0.1, 0.25), rng.range(0.16, 0.24)),
        high: hsl(bh, rng.range(0.05, 0.12), rng.range(0.3, 0.4)),
        beach: hsl(bh + 10, 0.6, 0.25),
        rock1: hsl(bh, rng.range(0.06, 0.15), rng.range(0.1, 0.16)),
        rock2: hsl(j(rng, bh + 10, 10), rng.range(0.25, 0.45), rng.range(0.2, 0.28)),
        peak: hsl(bh, 0.05, 0.55),
        seabed: hsl(bh, 0.4, 0.1),
        liquidShallow: hsl(rng.range(28, 45), 1, 0.55),
        liquidDeep: hsl(rng.range(5, 20), 1, 0.4),
        leaf: leafSet(rng, rng.range(0, 40), rng.range(0.4, 0.7), rng.range(0.2, 0.3)),
        trunk: hsl(bh, 0.1, 0.1),
        bloom: blooms(rng),
        glow: hsl(rng.range(15, 40), 1, 0.55),
      };
    },
    shape: (rng, s, R) => {
      s.mountSharp = rng.range(2.2, 3.2);
      s.mountAmp *= rng.range(1.0, 1.3);
      if (rng.chance(0.35)) {
        s.craterDensity = rng.range(0.1, 0.25);
        s.craterDepth = rng.range(50, 140);
      }
      if (rng.chance(0.3)) {
        s.spires = 1;
        s.spireHeight = R * rng.range(0.004, 0.01);
      }
    },
  },
  {
    biome: 'barren', label: 'Barren', weight: 0.6, moonWeight: 2.2,
    descriptors: ['Barren Moon', 'Dead World', 'Rocky Planetoid', 'Cratered Rock', 'Desolate Sphere'],
    weathers: ['Airless', 'Still', 'No Atmosphere', 'Silent'],
    hazard: 'cold', hazardLevel: [0, 0.6], temp: [-80, 20],
    seaChance: 0, seaFrac: [0, 0], liquid: 'water',
    atmoChance: 0.25, atmoHue: [20, 60], atmoSat: [0.05, 0.25], atmoDensity: [0.25, 0.5],
    cloudChance: 0, cloudCover: [0, 0],
    flora: [0, 0.1], fauna: [0, 0.15], polarCaps: [0, 0.3], snowLine: [4, 6], moisture: [-0.4, -0.3],
    rares: ['platinum', 'silver'],
    floraKinds: ['rock', 'rock', 'boulder', 'crystal', 'deposit'],
    palette: (rng) => {
      const gh = rng.range(15, 45);
      const sat = rng.range(0.03, 0.15);
      return {
        low1: hsl(gh, sat, rng.range(0.38, 0.52)),
        low2: hsl(j(rng, gh, 10), sat, rng.range(0.3, 0.44)),
        high: hsl(gh, sat, rng.range(0.5, 0.62)),
        beach: hsl(gh, sat, 0.5),
        rock1: hsl(gh, sat, rng.range(0.26, 0.34)),
        rock2: hsl(gh, sat, rng.range(0.18, 0.24)),
        peak: hsl(gh, sat, 0.7),
        seabed: hsl(gh, sat, 0.3),
        liquidShallow: hsl(200, 0.5, 0.5),
        liquidDeep: hsl(210, 0.6, 0.2),
        leaf: leafSet(rng, gh, 0.2, 0.3),
        trunk: hsl(gh, 0.1, 0.2),
        bloom: blooms(rng),
        glow: hsl(rng.range(180, 280), 0.9, 0.6),
      };
    },
    shape: (rng, s) => {
      s.craterDensity = rng.range(0.25, 0.55);
      s.craterDepth = rng.range(60, 200);
      s.mountAmp *= rng.range(0.2, 0.6);
      s.hillAmp *= 0.8;
      s.contAmp *= 0.7;
    },
  },
  {
    biome: 'exotic', label: 'Exotic', weight: 0.5, moonWeight: 0.4,
    descriptors: ['Anomalous World', 'Bizarre Planet', 'Glassy Sphere', 'Spined World', 'Dreaming Globe'],
    weathers: ['Anomalous', 'Unstable', 'Wandering Energy', 'Shifting Light', 'Humming Air'],
    hazard: 'none', hazardLevel: [0, 0.8], temp: [-10, 45],
    seaChance: 0.5, seaFrac: [0.1, 0.35], liquid: 'water',
    atmoChance: 1, atmoHue: [0, 360], atmoSat: [0.6, 1], atmoDensity: [0.8, 1.4],
    cloudChance: 0.5, cloudCover: [0.2, 0.5],
    flora: [0.5, 0.9], fauna: [0.3, 0.7], polarCaps: [0.2, 1], snowLine: [1, 2.5], moisture: [-0.1, 0.1],
    rares: ['gold', 'cobalt', 'ammonia', 'platinum'],
    floraKinds: ['bulb', 'bulb', 'mushroom', 'spireRock', 'grass', 'rock', 'boulder', 'crystal', 'crystal', 'oxygenPlant', 'deposit'],
    palette: (rng) => {
      const gh = rng.range(0, 360);
      return {
        low1: hsl(gh, rng.range(0.5, 0.85), rng.range(0.38, 0.52)),
        low2: hsl(j(rng, gh + 40, 40), rng.range(0.5, 0.85), rng.range(0.3, 0.45)),
        high: hsl(j(rng, gh + 180, 40), rng.range(0.4, 0.7), rng.range(0.4, 0.55)),
        beach: hsl(j(rng, gh + 90, 40), 0.6, 0.6),
        rock1: hsl(j(rng, gh + 200, 50), rng.range(0.3, 0.6), rng.range(0.3, 0.45)),
        rock2: hsl(j(rng, gh + 120, 50), rng.range(0.3, 0.6), rng.range(0.2, 0.32)),
        peak: hsl(rng.range(0, 360), 0.6, 0.8),
        seabed: hsl(gh, 0.5, 0.3),
        liquidShallow: hsl(rng.range(0, 360), 0.85, 0.55),
        liquidDeep: hsl(rng.range(0, 360), 0.85, 0.25),
        leaf: leafSet(rng, rng.range(0, 360), rng.range(0.6, 0.95), rng.range(0.45, 0.6), 60),
        trunk: hsl(rng.range(0, 360), 0.4, 0.3),
        bloom: blooms(rng),
        glow: hsl(rng.range(0, 360), 1, 0.6),
      };
    },
    shape: (rng, s, R) => {
      s.warp = rng.range(0.25, 0.45);
      if (rng.chance(0.65)) {
        s.spires = 1;
        s.spireHeight = R * rng.range(0.008, 0.02);
      }
      if (rng.chance(0.4)) {
        s.terraceStep = R * rng.range(0.002, 0.005);
        s.terraceSharp = rng.range(0.6, 1);
      }
    },
  },
  {
    biome: 'ocean', label: 'Oceanic', weight: 0.5, moonWeight: 0.1,
    descriptors: ['Ocean World', 'Archipelago', 'Water World', 'Island Chain', 'Tidal Planet'],
    weathers: ['Breezy', 'Sea Mist', 'Squalls', 'Warm Rain', 'Coastal Winds'],
    hazard: 'none', hazardLevel: [0, 0], temp: [10, 30],
    seaChance: 1, seaFrac: [0.72, 0.86], liquid: 'water',
    atmoChance: 1, atmoHue: [185, 215], atmoSat: [0.6, 0.9], atmoDensity: [0.9, 1.25],
    cloudChance: 1, cloudCover: [0.3, 0.5],
    flora: [0.75, 1], fauna: [0.6, 0.9], polarCaps: [0.8, 1.3], snowLine: [1.1, 1.5], moisture: [0.05, 0.2],
    rares: ['copper', 'silver'],
    floraKinds: ['palm', 'tree', 'bush', 'grass', 'rock', 'boulder', 'crystal', 'sodiumPlant', 'oxygenPlant', 'deposit'],
    palette: (rng) => {
      const gh = rng.range(80, 145);
      return {
        low1: hsl(gh, rng.range(0.5, 0.75), rng.range(0.28, 0.38)),
        low2: hsl(j(rng, gh, 20), rng.range(0.5, 0.75), rng.range(0.22, 0.32)),
        high: hsl(j(rng, gh - 20, 15), 0.3, 0.35),
        beach: hsl(rng.range(38, 50), rng.range(0.45, 0.6), rng.range(0.72, 0.82)),
        rock1: hsl(rng.range(20, 40), 0.15, 0.4),
        rock2: hsl(rng.range(20, 40), 0.12, 0.28),
        peak: hsl(205, 0.2, 0.92),
        seabed: hsl(rng.range(40, 55), 0.4, 0.55),
        liquidShallow: hsl(rng.range(170, 190), 0.85, 0.52),
        liquidDeep: hsl(rng.range(200, 225), 0.85, 0.18),
        leaf: leafSet(rng, gh, 0.65, 0.33),
        trunk: hsl(28, 0.35, 0.26),
        bloom: blooms(rng),
        glow: hsl(rng.range(170, 200), 0.9, 0.6),
      };
    },
    shape: (_rng, s) => {
      s.mountAmp *= 0.7;
    },
  },
  {
    biome: 'swamp', label: 'Marsh', weight: 0.5, moonWeight: 0.1,
    descriptors: ['Marsh World', 'Swamp Planet', 'Boggy World', 'Wetland Sphere', 'Mire'],
    weathers: ['Humid', 'Fog', 'Drizzle', 'Muggy', 'Heavy Fog'],
    hazard: 'toxic', hazardLevel: [0, 0.5], temp: [15, 35],
    seaChance: 1, seaFrac: [0.38, 0.5], liquid: 'water',
    atmoChance: 1, atmoHue: [70, 150], atmoSat: [0.3, 0.6], atmoDensity: [1.2, 1.6],
    cloudChance: 0.9, cloudCover: [0.4, 0.7],
    flora: [0.85, 1], fauna: [0.6, 0.9], polarCaps: [0.3, 0.8], snowLine: [1.5, 2.5], moisture: [0.2, 0.35],
    rares: ['ammonia', 'copper'],
    floraKinds: ['tree', 'mushroom', 'bush', 'bush', 'grass', 'rock', 'crystal', 'sodiumPlant', 'oxygenPlant', 'deposit'],
    palette: (rng) => {
      const gh = rng.range(55, 110);
      return {
        low1: hsl(gh, rng.range(0.3, 0.5), rng.range(0.22, 0.3)),
        low2: hsl(j(rng, gh - 25, 15), rng.range(0.3, 0.5), rng.range(0.16, 0.24)),
        high: hsl(j(rng, gh, 20), 0.3, 0.3),
        beach: hsl(gh - 20, 0.3, 0.3),
        rock1: hsl(rng.range(25, 45), 0.15, 0.3),
        rock2: hsl(rng.range(60, 100), 0.15, 0.2),
        peak: hsl(gh, 0.2, 0.5),
        seabed: hsl(gh - 20, 0.35, 0.2),
        liquidShallow: hsl(rng.range(60, 100), 0.45, 0.35),
        liquidDeep: hsl(rng.range(100, 160), 0.5, 0.14),
        leaf: leafSet(rng, j(rng, gh, 20), 0.45, 0.28),
        trunk: hsl(rng.range(20, 40), 0.25, 0.18),
        bloom: blooms(rng),
        glow: hsl(rng.range(60, 180), 0.9, 0.6),
      };
    },
    shape: (_rng, s) => {
      s.contAmp *= 0.35;
      s.mountAmp *= 0.25;
      s.hillAmp *= 0.5;
    },
  },
];

interface FloraSpec {
  density: [number, number];
  scale: [number, number];
  slopeMax: number;
  resource: ResourceId | null | 'rare';
  yield: number;
  cluster: [number, number];
  collide: number;
  pick: number;
  scannable: boolean;
  moistPref: 'any' | 'wet' | 'dry';
}

const FLORA_SPECS: Record<FloraKind, FloraSpec> = {
  tree: { density: [2.5, 6], scale: [0.75, 1.45], slopeMax: 0.78, resource: 'carbon', yield: 45, cluster: [0.4, 0.8], collide: 0.45, pick: 5, scannable: true, moistPref: 'wet' },
  conifer: { density: [2.5, 6], scale: [0.7, 1.5], slopeMax: 0.75, resource: 'carbon', yield: 40, cluster: [0.3, 0.7], collide: 0.4, pick: 5, scannable: true, moistPref: 'any' },
  palm: { density: [1.5, 3.5], scale: [0.8, 1.35], slopeMax: 0.8, resource: 'carbon', yield: 35, cluster: [0.5, 0.9], collide: 0.35, pick: 4, scannable: true, moistPref: 'any' },
  mushroom: { density: [1.5, 4], scale: [0.6, 1.6], slopeMax: 0.75, resource: 'carbon', yield: 35, cluster: [0.5, 0.9], collide: 0.5, pick: 4, scannable: true, moistPref: 'wet' },
  bush: { density: [5, 11], scale: [0.6, 1.3], slopeMax: 0.7, resource: 'carbon', yield: 14, cluster: [0.3, 0.6], collide: 0, pick: 1.6, scannable: true, moistPref: 'any' },
  cactus: { density: [1.5, 4], scale: [0.7, 1.4], slopeMax: 0.8, resource: 'carbon', yield: 22, cluster: [0.2, 0.5], collide: 0.35, pick: 2.5, scannable: true, moistPref: 'any' },
  grass: { density: [70, 130], scale: [0.7, 1.35], slopeMax: 0.72, resource: null, yield: 0, cluster: [0.3, 0.6], collide: 0, pick: 0, scannable: false, moistPref: 'any' },
  rock: { density: [2, 5], scale: [0.4, 1.2], slopeMax: 0.3, resource: 'iron', yield: 22, cluster: [0.3, 0.6], collide: 0, pick: 1.3, scannable: false, moistPref: 'any' },
  boulder: { density: [0.4, 1.1], scale: [0.9, 2.2], slopeMax: 0.4, resource: 'iron', yield: 60, cluster: [0.2, 0.5], collide: 1.4, pick: 3, scannable: true, moistPref: 'any' },
  crystal: { density: [0.3, 0.6], scale: [0.8, 1.4], slopeMax: 0.6, resource: 'hydrogen', yield: 32, cluster: [0.6, 0.9], collide: 0, pick: 1.6, scannable: true, moistPref: 'any' },
  sodiumPlant: { density: [0.3, 0.6], scale: [0.8, 1.2], slopeMax: 0.7, resource: 'sodium', yield: 36, cluster: [0.4, 0.8], collide: 0, pick: 1.2, scannable: true, moistPref: 'any' },
  oxygenPlant: { density: [0.3, 0.6], scale: [0.8, 1.2], slopeMax: 0.7, resource: 'oxygen', yield: 36, cluster: [0.4, 0.8], collide: 0, pick: 1.2, scannable: true, moistPref: 'wet' },
  deposit: { density: [0.06, 0.12], scale: [1.0, 1.6], slopeMax: 0.55, resource: 'rare', yield: 140, cluster: [0.1, 0.3], collide: 1.3, pick: 3, scannable: true, moistPref: 'any' },
  spireRock: { density: [0.3, 0.9], scale: [0.8, 1.8], slopeMax: 0.5, resource: 'iron', yield: 45, cluster: [0.4, 0.8], collide: 1.0, pick: 3, scannable: true, moistPref: 'any' },
  bulb: { density: [2, 5], scale: [0.6, 1.5], slopeMax: 0.7, resource: 'carbon', yield: 18, cluster: [0.5, 0.9], collide: 0.3, pick: 2.5, scannable: true, moistPref: 'any' },
};

function makeFlora(arch: Archetype, rare: ResourceId, floraDensity: number, planetSeed: number): FloraSpeciesDesc[] {
  const list: FloraSpeciesDesc[] = [];
  if (floraDensity <= 0.01 && arch.biome !== 'barren') return list;
  arch.floraKinds.forEach((kind, i) => {
    const spec = FLORA_SPECS[kind];
    const seed = hash2(planetSeed, i * 7919 + 13);
    const r = new Rng(seed);
    let moistMin = 0, moistMax = 1;
    const living = spec.resource === 'carbon' || kind === 'grass' || kind === 'oxygenPlant';
    if (spec.moistPref === 'wet') moistMin = r.range(0.25, 0.45);
    else if (spec.moistPref === 'dry') moistMax = r.range(0.55, 0.75);
    else if (living && r.chance(0.5)) {
      // split same-kind species across moisture bands for regional variety
      if (r.chance(0.5)) moistMin = r.range(0.2, 0.45);
      else moistMax = r.range(0.55, 0.8);
    }
    const densityScale = living ? floraDensity : 1;
    list.push({
      index: i,
      kind,
      seed,
      name: speciesName(seed),
      density: r.range(spec.density[0], spec.density[1]) * densityScale,
      moistMin,
      moistMax,
      scaleMin: spec.scale[0],
      scaleMax: spec.scale[1] * r.range(0.85, 1.2),
      slopeMax: spec.slopeMax,
      resource: spec.resource === 'rare' ? rare : spec.resource,
      yield: spec.yield,
      cluster: r.range(spec.cluster[0], spec.cluster[1]),
      collide: spec.collide,
      pick: spec.pick,
      scannable: spec.scannable,
    });
  });
  return list;
}

function baseShape(rng: Rng, R: number): TerrainShape {
  const k = 2 * Math.PI * R;
  return {
    contFreq: rng.range(0.9, 2.0),
    contOctaves: 5,
    contAmp: R * rng.range(0.013, 0.024),
    contBias: rng.range(-0.05, 0.12),
    mountFreq: k / rng.range(3500, 7500),
    mountAmp: R * rng.range(0.02, 0.045),
    mountSharp: rng.range(1.4, 2.6),
    hillFreq: k / rng.range(450, 1100),
    hillAmp: rng.range(14, 50),
    detailFreq: k / rng.range(22, 34),
    detailAmp: rng.range(0.7, 1.8),
    warp: rng.range(0, 0.18),
    terraceStep: 0,
    terraceSharp: 0.5,
    craterDensity: 0,
    craterDepth: 0,
    canyon: 0,
    canyonDepth: 0,
    spires: 0,
    spireHeight: 0,
    plateau: 0,
  };
}

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[i];
}

export interface PlanetGenOptions {
  seed: number;
  name: string;
  isMoon: boolean;
  /** Distance to star in meters (hotter when close). */
  starDistance: number;
  biome?: Biome;
}

export function pickBiome(rng: Rng, isMoon: boolean): Biome {
  const items = ARCHETYPES.map((a) => a.biome);
  const weights = ARCHETYPES.map((a) => (isMoon ? a.moonWeight : a.weight));
  return rng.weighted(items, weights);
}

export function generatePlanetParams(opts: PlanetGenOptions): PlanetParams {
  const rng = new Rng(opts.seed);
  const biome = opts.biome ?? pickBiome(rng.fork(1), opts.isMoon);
  const arch = ARCHETYPES.find((a) => a.biome === biome)!;
  const R = opts.isMoon ? rng.range(4800, 7200) : rng.range(11000, 17000);

  const shape = baseShape(rng.fork(2), R);
  arch.shape(rng.fork(3), shape, R);
  if (opts.isMoon) {
    shape.mountAmp *= 0.8;
  }

  const hasSea = rng.fork(4).chance(arch.seaChance);
  const liquid: Liquid = typeof arch.liquid === 'function' ? arch.liquid(rng.fork(5)) : arch.liquid;
  const palette = arch.palette(rng.fork(6));

  const hasAtmo = rng.fork(7).chance(arch.atmoChance);
  const ar = rng.fork(8);
  let atmosphere: AtmosphereParams | null = null;
  if (hasAtmo) {
    const hue = ar.range(arch.atmoHue[0], arch.atmoHue[1]);
    const sat = ar.range(arch.atmoSat[0], arch.atmoSat[1]);
    const c = rgbToLinear(hsl(hue, sat, 0.55));
    const m = Math.max(c[0], c[1], c[2], 1e-3);
    const color: RGB = [c[0] / m, c[1] / m, c[2] / m];
    // Deepen the dominant hue, but keep a floor on every channel so sunsets never go pitch black.
    for (let i = 0; i < 3; i++) color[i] = 0.07 + Math.pow(color[i], 1.35) * 0.93;
    const height = R * ar.range(0.2, 0.26);
    atmosphere = {
      color,
      density: ar.range(arch.atmoDensity[0], arch.atmoDensity[1]),
      height,
      scaleHeight: height * ar.range(0.3, 0.4),
      mie: ar.range(0.4, 1.2),
    };
  }

  const cr = rng.fork(9);
  let clouds: CloudParams | null = null;
  if (atmosphere && cr.chance(arch.cloudChance)) {
    const tint = cr.chance(0.7) ? [1, 1, 1] : hsl(cr.range(0, 360), 0.3, 0.85);
    clouds = {
      coverage: cr.range(arch.cloudCover[0], arch.cloudCover[1]),
      color: [tint[0], tint[1], tint[2]],
      altitude: R * cr.range(0.075, 0.1),
      scale: cr.range(4, 8),
      speed: cr.range(0.002, 0.006),
      opacity: cr.range(0.75, 0.95),
    };
  }

  const rr = rng.fork(15);
  let rings: RingParams | null = null;
  if (!opts.isMoon && rr.chance(0.3)) {
    const hue = rr.chance(0.5) ? rr.range(20, 50) : rr.range(180, 230);
    rings = {
      inner: R * rr.range(1.55, 1.9),
      outer: R * rr.range(2.5, 3.3),
      colorA: hsl(hue, rr.range(0.15, 0.35), rr.range(0.62, 0.78)),
      colorB: hsl(hue + rr.range(-25, 25), rr.range(0.2, 0.45), rr.range(0.35, 0.5)),
      opacity: rr.range(0.55, 0.9),
      seed: rr.range(0, 1000),
    };
  }

  const gr = rng.fork(10);
  const floraDensity = gr.range(arch.flora[0], arch.flora[1]);
  const faunaDensity = gr.range(arch.fauna[0], arch.fauna[1]);
  const rare = gr.pick(arch.rares);
  const hazardLevel = gr.range(arch.hazardLevel[0], arch.hazardLevel[1]);
  const temperature = Math.round(gr.range(arch.temp[0], arch.temp[1]));
  const weather = gr.pick(arch.weathers);
  const descriptor = gr.pick(arch.descriptors);
  const polarCaps = gr.range(arch.polarCaps[0], arch.polarCaps[1]);
  const moistureBias = gr.range(arch.moisture[0], arch.moisture[1]);
  const dayLength = gr.range(14, 30) * 60;
  const gravity = (opts.isMoon ? gr.range(4.5, 7) : gr.range(8, 12));

  const params: PlanetParams = {
    id: `p${opts.seed >>> 0}`,
    seed: opts.seed >>> 0,
    name: opts.name,
    biome,
    label: arch.label,
    descriptor,
    radius: R,
    gravity,
    dayLength,
    seaLevel: null,
    liquid,
    minHeight: 0,
    maxHeight: 0,
    shape,
    palette,
    polarCaps,
    snowLine: 1,
    moistureBias,
    atmosphere,
    clouds,
    rings,
    hazard: hazardLevel > 0.05 ? arch.hazard : 'none',
    hazardLevel,
    temperature,
    floraDensity,
    faunaDensity,
    flora: [],
    rare,
    weather: atmosphere ? weather : 'Airless',
    isMoon: opts.isMoon,
    floraLevel: 8,
  };

  // Sample the height field to place the sea and estimate the height range.
  const probe = new TerrainGenerator(params);
  const sr = rng.fork(11);
  const samples: number[] = [];
  for (let i = 0; i < 1600; i++) {
    const [x, y, z] = sr.unitVector();
    samples.push(probe.height(x, y, z));
  }
  samples.sort((a, b) => a - b);
  const minS = samples[0];
  const maxS = samples[samples.length - 1];
  const range = Math.max(1, maxS - minS);
  params.minHeight = minS - range * 0.25;
  params.maxHeight = maxS + range * 0.1;
  if (hasSea) {
    const frac = rng.fork(12).range(arch.seaFrac[0], arch.seaFrac[1]);
    params.seaLevel = percentile(samples, frac);
  }
  const ref = params.seaLevel ?? percentile(samples, 0.4);
  const span = Math.max(50, maxS - ref);
  params.snowLine = span * rng.fork(13).range(arch.snowLine[0], arch.snowLine[1]);

  params.flora = makeFlora(arch, rare, floraDensity, params.seed);

  // Flora cells are quadtree nodes roughly 60-110 m across.
  let lvl = 0;
  while (nodeSize(R, lvl) > 110) lvl++;
  params.floraLevel = lvl;

  // Quieten flora on airless worlds.
  if (!atmosphere) {
    params.flora = params.flora.filter((f) => f.resource !== 'carbon' && f.kind !== 'grass' && f.kind !== 'oxygenPlant');
  }
  params.flora.forEach((f, i) => (f.index = i));
  return params;
}

export const BIOME_LIST: Biome[] = ARCHETYPES.map((a) => a.biome);
