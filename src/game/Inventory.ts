import { RESOURCE_ORDER, RESOURCES, type ResourceId } from '../world/resources';

export const STACK_LIMIT = 500;

export interface Recipe {
  id: string;
  name: string;
  description: string;
  cost: Partial<Record<ResourceId, number>>;
}

export const WARP_CELL: Recipe = {
  id: 'warpcell',
  name: 'Warp Cell',
  description: 'Powers one hyperdrive jump to another star system.',
  cost: { tritium: 40, hydrogen: 30, iron: 25 },
};

export interface Upgrade {
  id: string;
  name: string;
  description: string;
  price: number;
  max: number;
}

export const UPGRADES: Upgrade[] = [
  { id: 'jetpack', name: 'Jetpack Booster', description: 'Stronger, longer jetpack thrust.', price: 6000, max: 3 },
  { id: 'miner', name: 'Optimised Mining Beam', description: 'Mine faster with less heat.', price: 8000, max: 3 },
  { id: 'hazard', name: 'Hazard Shielding', description: 'Hazard protection drains more slowly.', price: 9000, max: 3 },
  { id: 'hyperdrive', name: 'Hyperdrive Tuning', description: 'Extends warp range by 60 light-years.', price: 15000, max: 4 },
];

/** Resources, currency and purchased upgrades. */
export class Inventory {
  items = new Map<ResourceId, number>();
  units = 0;
  upgrades: Record<string, number> = {};

  count(id: ResourceId): number {
    return this.items.get(id) ?? 0;
  }

  /** Adds up to the stack limit; returns the amount actually added. */
  add(id: ResourceId, n: number): number {
    const cur = this.count(id);
    const added = Math.max(0, Math.min(n, STACK_LIMIT - cur));
    if (added > 0) this.items.set(id, cur + added);
    return added;
  }

  remove(id: ResourceId, n: number): boolean {
    const cur = this.count(id);
    if (cur < n) return false;
    this.items.set(id, cur - n);
    return true;
  }

  canAfford(cost: Partial<Record<ResourceId, number>>): boolean {
    return Object.entries(cost).every(([id, n]) => this.count(id as ResourceId) >= (n ?? 0));
  }

  pay(cost: Partial<Record<ResourceId, number>>): boolean {
    if (!this.canAfford(cost)) return false;
    for (const [id, n] of Object.entries(cost)) this.remove(id as ResourceId, n ?? 0);
    return true;
  }

  upgradeLevel(id: string): number {
    return this.upgrades[id] ?? 0;
  }

  list(): { id: ResourceId; n: number }[] {
    return RESOURCE_ORDER.filter((id) => this.count(id) > 0).map((id) => ({ id, n: this.count(id) }));
  }

  value(): number {
    let v = 0;
    for (const [id, n] of this.items) v += RESOURCES[id].value * n;
    return v;
  }

  toJSON(): { items: Record<string, number>; units: number; upgrades: Record<string, number> } {
    const items: Record<string, number> = {};
    for (const [k, v] of this.items) if (v > 0) items[k] = v;
    return { items, units: this.units, upgrades: this.upgrades };
  }

  load(data: { items?: Record<string, number>; units?: number; upgrades?: Record<string, number> } | undefined): void {
    this.items.clear();
    if (!data) return;
    for (const [k, v] of Object.entries(data.items ?? {})) {
      if (k in RESOURCES) this.items.set(k as ResourceId, Math.min(STACK_LIMIT, Math.max(0, Math.floor(v))));
    }
    this.units = Math.max(0, Math.floor(data.units ?? 0));
    this.upgrades = { ...(data.upgrades ?? {}) };
  }
}
