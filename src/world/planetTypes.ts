import type { RGB } from '../engine/color';
import type { ResourceId } from './resources';

export type Biome =
  | 'lush' | 'tropical' | 'desert' | 'frozen' | 'toxic' | 'radioactive'
  | 'volcanic' | 'barren' | 'exotic' | 'ocean' | 'swamp';

export type Liquid = 'water' | 'lava' | 'acid' | 'ice';
export type Hazard = 'none' | 'heat' | 'cold' | 'toxic' | 'radiation';

export type FloraKind =
  | 'tree' | 'conifer' | 'palm' | 'mushroom' | 'bush' | 'cactus' | 'grass'
  | 'rock' | 'boulder' | 'crystal' | 'sodiumPlant' | 'oxygenPlant' | 'deposit' | 'spireRock' | 'bulb';

export interface TerrainShape {
  contFreq: number;
  contOctaves: number;
  contAmp: number;
  contBias: number;
  mountFreq: number;
  mountAmp: number;
  mountSharp: number;
  hillFreq: number;
  hillAmp: number;
  detailFreq: number;
  detailAmp: number;
  warp: number;
  terraceStep: number;
  terraceSharp: number;
  craterDensity: number;
  craterDepth: number;
  canyon: number;
  canyonDepth: number;
  spires: number;
  spireHeight: number;
  plateau: number;
}

export interface Palette {
  beach: RGB;
  low1: RGB;
  low2: RGB;
  high: RGB;
  rock1: RGB;
  rock2: RGB;
  peak: RGB;
  seabed: RGB;
  liquidShallow: RGB;
  liquidDeep: RGB;
  leaf: [RGB, RGB, RGB];
  trunk: RGB;
  bloom: [RGB, RGB];
  glow: RGB;
}

export interface AtmosphereParams {
  /** Scattering tint (linear RGB, max channel 1). */
  color: RGB;
  density: number;
  height: number;
  scaleHeight: number;
  mie: number;
}

export interface CloudParams {
  coverage: number;
  color: RGB;
  altitude: number;
  scale: number;
  speed: number;
  opacity: number;
}

export interface RingParams {
  inner: number;
  outer: number;
  colorA: RGB;
  colorB: RGB;
  opacity: number;
  seed: number;
}

export interface FloraSpeciesDesc {
  index: number;
  kind: FloraKind;
  seed: number;
  name: string;
  /** Instances per 1000 m² at full density. */
  density: number;
  moistMin: number;
  moistMax: number;
  scaleMin: number;
  scaleMax: number;
  slopeMax: number;
  resource: ResourceId | null;
  yield: number;
  /** Clustering 0 (uniform) .. 1 (clumped). */
  cluster: number;
  /** Radius of the collision cylinder at scale 1 (0 = walk through). */
  collide: number;
  /** Bounding radius at scale 1 for picking. */
  pick: number;
  /** Shown in the discovery log. */
  scannable: boolean;
}

export interface PlanetParams {
  id: string;
  seed: number;
  name: string;
  biome: Biome;
  label: string;
  descriptor: string;
  radius: number;
  gravity: number;
  dayLength: number;
  seaLevel: number | null;
  liquid: Liquid;
  minHeight: number;
  maxHeight: number;
  shape: TerrainShape;
  palette: Palette;
  polarCaps: number;
  snowLine: number;
  moistureBias: number;
  atmosphere: AtmosphereParams | null;
  clouds: CloudParams | null;
  rings: RingParams | null;
  hazard: Hazard;
  hazardLevel: number;
  temperature: number;
  floraDensity: number;
  faunaDensity: number;
  flora: FloraSpeciesDesc[];
  rare: ResourceId;
  weather: string;
  isMoon: boolean;
  /** Radius of the flora placement cells, in quadtree level. */
  floraLevel: number;
}
