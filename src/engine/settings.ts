import { loadJSON, saveJSON } from './storage';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  quality: Quality;
  sensitivity: number;
  invertY: boolean;
  fov: number;
  volume: number;
  showFps: boolean;
}

export interface QualityPreset {
  pixelRatio: number;
  patchRes: number;
  splitFactor: number;
  maxLevelSpacing: number;
  floraRadius: number;
  floraDensity: number;
  grassRadius: number;
  maxCreatures: number;
  atmoSamples: number;
  skySamples: number;
  cloudOctaves: number;
  detailNoise: boolean;
  asteroidRadius: number;
  maxInflight: number;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: {
    pixelRatio: 1,
    patchRes: 16,
    splitFactor: 2.4,
    maxLevelSpacing: 2.0,
    floraRadius: 160,
    floraDensity: 0.55,
    grassRadius: 0,
    maxCreatures: 8,
    atmoSamples: 3,
    skySamples: 5,
    cloudOctaves: 2,
    detailNoise: false,
    asteroidRadius: 3500,
    maxInflight: 6,
  },
  medium: {
    pixelRatio: 1.5,
    patchRes: 24,
    splitFactor: 2.8,
    maxLevelSpacing: 1.2,
    floraRadius: 230,
    floraDensity: 0.75,
    grassRadius: 40,
    maxCreatures: 14,
    atmoSamples: 4,
    skySamples: 7,
    cloudOctaves: 3,
    detailNoise: true,
    asteroidRadius: 5000,
    maxInflight: 10,
  },
  high: {
    pixelRatio: 2,
    patchRes: 32,
    splitFactor: 3.3,
    maxLevelSpacing: 0.8,
    floraRadius: 340,
    floraDensity: 1.0,
    grassRadius: 70,
    maxCreatures: 20,
    atmoSamples: 5,
    skySamples: 10,
    cloudOctaves: 4,
    detailNoise: true,
    asteroidRadius: 7000,
    maxInflight: 14,
  },
};

export function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0) &&
    window.matchMedia?.('(pointer: coarse)').matches
  );
}

const KEY = 'starwander.settings.v1';

export function loadSettings(): Settings {
  const defaults: Settings = {
    quality: isTouchDevice() ? 'low' : 'medium',
    sensitivity: 1,
    invertY: false,
    fov: 72,
    volume: 0.6,
    showFps: false,
  };
  const saved = loadJSON<Partial<Settings>>(KEY);
  return { ...defaults, ...(saved ?? {}) };
}

export function saveSettings(s: Settings): void {
  saveJSON(KEY, s);
}
