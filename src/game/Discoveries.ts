export type DiscoveryKind = 'system' | 'planet' | 'fauna' | 'flora' | 'mineral';

export interface Discovery {
  id: string;
  kind: DiscoveryKind;
  name: string;
  systemKey: string;
  systemName: string;
  planetId?: string;
  planetName?: string;
  details: [string, string][];
  reward: number;
  time: number;
}

/** The explorer's log of everything scanned or visited. */
export class Discoveries {
  private map = new Map<string, Discovery>();
  onAdd: ((d: Discovery) => void) | null = null;

  has(id: string): boolean {
    return this.map.has(id);
  }

  add(d: Discovery): boolean {
    if (this.map.has(d.id)) return false;
    this.map.set(d.id, d);
    this.onAdd?.(d);
    return true;
  }

  all(): Discovery[] {
    return [...this.map.values()].sort((a, b) => b.time - a.time);
  }

  countWhere(pred: (d: Discovery) => boolean): number {
    let n = 0;
    for (const d of this.map.values()) if (pred(d)) n++;
    return n;
  }

  get size(): number {
    return this.map.size;
  }

  toJSON(): Discovery[] {
    return [...this.map.values()];
  }

  load(list: Discovery[] | undefined): void {
    this.map.clear();
    for (const d of list ?? []) {
      if (d && typeof d.id === 'string') this.map.set(d.id, d);
    }
  }
}
