import type { RGB } from '../engine/color';
import { planetName } from '../engine/names';
import { hash2, Rng } from '../engine/rng';
import { nebulaColors, STAR_CLASSES, type StarClass, type SystemSummary } from './galaxy';
import { generatePlanetParams } from './planetGen';
import type { Biome, PlanetParams } from './planetTypes';

export interface PlanetDesc {
  index: number;
  params: PlanetParams;
  position: [number, number, number];
  axis: [number, number, number];
  spin0: number;
  parent: number;
}

export interface StarSystemDesc {
  summary: SystemSummary;
  key: string;
  seed: number;
  name: string;
  starClass: StarClass;
  starLabel: string;
  starColor: RGB;
  lightColor: RGB;
  starRadius: number;
  planets: PlanetDesc[];
  nebula: [RGB, RGB];
  nebulaDensity: number;
  asteroidDensity: number;
  arrival: [number, number, number];
  arrivalTarget: number;
}

const HABITABLE: Biome[] = ['lush', 'tropical', 'lush'];

export function generateSystem(summary: SystemSummary, forceHabitableFirst = false): StarSystemDesc {
  const rng = new Rng(summary.seed ^ 0x5157);
  const starRadius = rng.range(6000, 9000);
  const sc = STAR_CLASSES[summary.starClass];
  const lightColor: RGB = [
    1 + (sc.color[0] - 1) * 0.35,
    1 + (sc.color[1] - 1) * 0.35,
    1 + (sc.color[2] - 1) * 0.35,
  ];

  const planets: PlanetDesc[] = [];
  let orbit = rng.range(260e3, 340e3);
  for (let i = 0; i < summary.planetCount; i++) {
    const pr = rng.fork(100 + i);
    const angle = pr.range(0, Math.PI * 2);
    const y = pr.range(-0.07, 0.07) * orbit;
    const pos: [number, number, number] = [Math.cos(angle) * orbit, y, Math.sin(angle) * orbit];
    const seed = hash2(summary.seed, i + 1);
    const biome = forceHabitableFirst && i === 0 ? HABITABLE[seed % HABITABLE.length] : undefined;
    const params = generatePlanetParams({
      seed,
      name: planetName(seed, i, summary.name),
      isMoon: false,
      starDistance: orbit,
      biome,
    });
    const tilt = pr.range(0, 0.45);
    const az = pr.range(0, Math.PI * 2);
    const axis: [number, number, number] = [Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az)];
    const index = planets.length;
    planets.push({ index, params, position: pos, axis, spin0: pr.range(0, Math.PI * 2), parent: -1 });

    // Moons orbit at a respectful distance from their parent.
    const moonCount = pr.chance(0.45) ? (pr.chance(0.3) ? 2 : 1) : 0;
    for (let m = 0; m < moonCount; m++) {
      const mseed = hash2(seed, 777 + m);
      const mparams = generatePlanetParams({
        seed: mseed,
        name: planetName(mseed, index + m + 1, summary.name),
        isMoon: true,
        starDistance: orbit,
      });
      const d = params.radius * pr.range(4.6, 6.2) + m * params.radius * 2.2;
      const ma = pr.range(0, Math.PI * 2);
      const my = pr.range(-0.25, 0.25);
      const mpos: [number, number, number] = [
        pos[0] + Math.cos(ma) * d,
        pos[1] + my * d,
        pos[2] + Math.sin(ma) * d,
      ];
      const mt = pr.range(0, 0.3);
      const maz = pr.range(0, Math.PI * 2);
      planets.push({
        index: planets.length,
        params: mparams,
        position: mpos,
        axis: [Math.sin(mt) * Math.cos(maz), Math.cos(mt), Math.sin(mt) * Math.sin(maz)],
        spin0: pr.range(0, Math.PI * 2),
        parent: index,
      });
    }
    orbit += rng.range(170e3, 250e3);
  }

  // Warp-in point: out in space on the sunward side of the first planet.
  const target = 0;
  const tp = planets[target].position;
  const tl = Math.hypot(tp[0], tp[1], tp[2]);
  const toSun: [number, number, number] = [-tp[0] / tl, -tp[1] / tl, -tp[2] / tl];
  const side = rng.range(-0.8, 0.8);
  const dist = planets[target].params.radius * 7.5;
  const arrival: [number, number, number] = [
    tp[0] + (toSun[0] * 0.7 + -toSun[2] * side) * dist,
    tp[1] + 0.25 * dist,
    tp[2] + (toSun[2] * 0.7 + toSun[0] * side) * dist,
  ];

  return {
    summary,
    key: summary.key,
    seed: summary.seed,
    name: summary.name,
    starClass: summary.starClass,
    starLabel: sc.label,
    starColor: sc.color,
    lightColor,
    starRadius,
    planets,
    nebula: nebulaColors(summary.seed),
    nebulaDensity: rng.range(0.25, 0.8),
    asteroidDensity: rng.range(0.35, 1),
    arrival,
    arrivalTarget: target,
  };
}
