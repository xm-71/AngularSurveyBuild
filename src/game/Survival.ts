import type { PlanetParams } from '../world/planetTypes';

export interface SurvivalContext {
  inShip: boolean;
  planet: PlanetParams | null;
  inLiquid: 'none' | 'water' | 'lava' | 'acid';
  submerged: boolean;
  night: boolean;
  hazardUpgrade: number;
  storm: boolean;
}

/** Exosuit health, life support and hazard protection. */
export class Survival {
  health = 100;
  lifeSupport = 100;
  hazard = 100;
  damageFlash = 0;
  private sinceDamage = 10;
  private warnCooldown = 0;
  onWarn: ((text: string) => void) | null = null;

  damage(amount: number): void {
    if (amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.damageFlash = Math.min(1, this.damageFlash + amount / 25 + 0.15);
    this.sinceDamage = 0;
  }

  get dead(): boolean {
    return this.health <= 0;
  }

  update(dt: number, c: SurvivalContext): void {
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
    this.sinceDamage += dt;
    this.warnCooldown -= dt;
    if (c.inShip) {
      this.hazard = Math.min(100, this.hazard + dt * 6);
      this.lifeSupport = Math.min(100, this.lifeSupport + dt * 1.5);
      if (this.sinceDamage > 3) this.health = Math.min(100, this.health + dt * 4);
      return;
    }
    // Life support: a full tank lasts ~9 minutes, faster underwater.
    this.lifeSupport = Math.max(0, this.lifeSupport - dt * (c.submerged ? 0.6 : 0.185));
    // Hazard protection depends on the planet and time of day.
    const p = c.planet;
    let hazardRate = 0;
    if (p && p.hazard !== 'none') {
      hazardRate = p.hazardLevel * 0.38;
      if (p.hazard === 'cold' && c.night) hazardRate *= 1.5;
      if (p.hazard === 'heat' && !c.night) hazardRate *= 1.25;
      hazardRate *= 1 - 0.2 * c.hazardUpgrade;
      if (c.storm) hazardRate *= 2.2;
    }
    if (c.inLiquid === 'water' && c.submerged) hazardRate += 0.2;
    this.hazard = Math.max(0, this.hazard - dt * hazardRate);
    if (hazardRate === 0) this.hazard = Math.min(100, this.hazard + dt * 2);

    let hurt = 0;
    if (this.lifeSupport <= 0) hurt += 2.2;
    if (this.hazard <= 0 && hazardRate > 0) hurt += 1.6 + (p?.hazardLevel ?? 0);
    if (c.inLiquid === 'lava') hurt += 30;
    if (c.inLiquid === 'acid') hurt += 5;
    if (hurt > 0) {
      this.health = Math.max(0, this.health - hurt * dt);
      this.damageFlash = Math.max(this.damageFlash, 0.25);
      this.sinceDamage = 0;
    } else if (this.sinceDamage > 5) {
      this.health = Math.min(100, this.health + dt * 2.5);
    }

    if (this.warnCooldown <= 0) {
      if (this.lifeSupport < 20 && this.lifeSupport > 0) this.warn('Life support low. Refill it with Oxygen.');
      else if (this.hazard < 20 && hazardRate > 0) this.warn('Hazard protection low. Recharge it with Sodium or return to your ship.');
      else if (c.inLiquid === 'lava') this.warn('Molten rock! Get out now.');
    }
  }

  private warn(t: string): void {
    this.warnCooldown = 12;
    this.onWarn?.(t);
  }

  toJSON(): { health: number; lifeSupport: number; hazard: number } {
    return { health: this.health, lifeSupport: this.lifeSupport, hazard: this.hazard };
  }

  load(d: { health?: number; lifeSupport?: number; hazard?: number } | undefined): void {
    this.health = d?.health ?? 100;
    this.lifeSupport = d?.lifeSupport ?? 100;
    this.hazard = d?.hazard ?? 100;
  }
}
