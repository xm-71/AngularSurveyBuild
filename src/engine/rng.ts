// Deterministic hashing and seeded random numbers. Everything procedural in the
// universe is derived from these so a given galaxy seed always produces the same worlds.

export function hashInt(x: number): number {
  x |= 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

export function hashCombine(h: number, v: number): number {
  return hashInt((h ^ Math.imul((v | 0) + 0x9e3779b9, 0x85ebca6b)) + Math.imul(h, 0xc2b2ae35));
}

export function hash2(a: number, b: number): number {
  return hashCombine(hashInt(a), b);
}

export function hash3(a: number, b: number, c: number): number {
  return hashCombine(hashCombine(hashInt(a), b), c);
}

export function hash4(a: number, b: number, c: number, d: number): number {
  return hashCombine(hashCombine(hashCombine(hashInt(a), b), c), d);
}

export function hash5(a: number, b: number, c: number, d: number, e: number): number {
  return hashCombine(hash4(a, b, c, d), e);
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hashInt(h);
}

/** Hash to float in [0, 1). */
export const hashFloat = (h: number): number => (h >>> 0) / 4294967296;

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = hashInt(seed ^ 0x5bd1e995) || 1;
  }

  /** Float in [0, 1). mulberry32 */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Integer in [a, b] inclusive. */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  gaussian(): number {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** Random unit vector as a tuple. */
  unitVector(): [number, number, number] {
    const z = this.range(-1, 1);
    const a = this.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), r * Math.sin(a), z];
  }

  /** Derive an independent generator. */
  fork(salt: number): Rng {
    return new Rng(hashCombine(this.s, salt));
  }

  uint(): number {
    return Math.floor(this.next() * 4294967296) >>> 0;
  }
}
