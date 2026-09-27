import { Rng } from './rng';

// Syllable-based procedural names for systems, planets and species.

const ONSETS = [
  '', '', 'b', 'br', 'c', 'ch', 'd', 'dr', 'f', 'g', 'gr', 'h', 'j', 'k', 'kr', 'kh', 'l', 'm', 'n', 'p',
  'pr', 'qu', 'r', 's', 'sh', 'st', 't', 'th', 'tr', 'v', 'vr', 'x', 'z', 'zh', 'y', 'sk', 'ph', 'gl',
];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'o', 'ae', 'ai', 'ea', 'io', 'ou', 'y', 'ei', 'oa', 'ua', 'ia'];
const CODAS = ['', '', '', 'n', 'r', 's', 'th', 'x', 'l', 'm', 'k', 'sh', 'nd', 'st', 'rk', 'll', 'ss', 'z', 'q'];
const SYSTEM_SUFFIX = ['', '', '', '', 'ia', 'us', 'ar', 'on', 'is', 'ex', 'ora', 'eth'];
const PLANET_TAGS = ['Prime', 'Minor', 'Major', 'Beta', 'Gamma', 'Tau', 'Sigma', 'Delta', 'Omega'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const LATIN_END = ['us', 'ae', 'ium', 'ensis', 'oides', 'ata', 'ix', 'ora', 'anthus', 'odon', 'ops', 'ella'];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function word(rng: Rng, minSyl: number, maxSyl: number): string {
  const n = rng.int(minSyl, maxSyl);
  let s = '';
  for (let i = 0; i < n; i++) {
    s += rng.pick(ONSETS) + rng.pick(VOWELS);
    if (i === n - 1 || rng.chance(0.25)) s += rng.pick(CODAS);
  }
  // Avoid awkward triple letters and overly long results.
  s = s.replace(/(.)\1\1+/g, '$1$1');
  if (s.length > 11) s = s.slice(0, 11);
  if (s.length < 3) s += rng.pick(['ra', 'on', 'ix', 'el']);
  return s;
}

export function systemName(seed: number): string {
  const rng = new Rng(seed ^ 0x51a7);
  let name = capitalize(word(rng, 2, 3) + rng.pick(SYSTEM_SUFFIX));
  if (rng.chance(0.18)) name += '-' + rng.int(2, 99);
  return name;
}

export function planetName(seed: number, index: number, systemBase: string): string {
  const rng = new Rng(seed ^ 0x9e11);
  const r = rng.next();
  if (r < 0.35) return `${capitalize(word(rng, 2, 3))}`;
  if (r < 0.6) return `${capitalize(word(rng, 1, 2))} ${rng.pick(PLANET_TAGS)}`;
  if (r < 0.8) return `${systemBase} ${ROMAN[Math.min(index, ROMAN.length - 1)]}`;
  return `${capitalize(word(rng, 2, 2))} ${ROMAN[rng.int(0, 7)]}`;
}

export function speciesName(seed: number): string {
  const rng = new Rng(seed ^ 0x5bec);
  const genus = capitalize(word(rng, 2, 3));
  const epithet = word(rng, 1, 2).replace(/[aeiouy]+$/, '') + rng.pick(LATIN_END);
  return `${genus} ${epithet}`;
}

export function shortName(seed: number): string {
  return capitalize(word(new Rng(seed ^ 0x77aa), 2, 2));
}
