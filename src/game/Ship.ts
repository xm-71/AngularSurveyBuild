import { Quaternion, Vector2, Vector3 } from 'three';
import type { Input } from '../engine/input';
import { clamp, dampFactor, moveToward, quatFromForwardUp, raySphere, smoothstep } from '../engine/math';
import type { ShipModel } from '../gfx/shipModel';
import type { Planet } from './Planet';
import type { Universe } from './Universe';

export type ShipState = 'landed' | 'takeoff' | 'flying' | 'landing';

export interface ShipEvents {
  message?: (text: string, kind?: 'info' | 'warn') => void;
  impact?: (strength: number) => void;
  pulse?: (on: boolean) => void;
  landed?: () => void;
  takeoff?: () => void;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

export const SHIP_SPEEDS = {
  atmoCruise: 90,
  atmoMax: 190,
  atmoBoost: 420,
  spaceCruise: 260,
  spaceMax: 520,
  spaceBoost: 1100,
  pulseMax: 16000,
};

/**
 * The player's starship. On the ground (landed, take-off, landing) it lives in
 * the planet's rotating frame; in flight it is simulated in system space with a
 * co-rotating reference that fades out above the atmosphere, so leaving a
 * planet and arriving at the next is continuous.
 */
export class Ship {
  state: ShipState = 'landed';
  planet: Planet | null = null;
  readonly localPos = new Vector3();
  readonly localQuat = new Quaternion();
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly quat = new Quaternion();
  readonly stick = new Vector2();
  speed = 0;
  pulse = false;
  pulseSpeed = 0;
  boosting = false;
  shield = 100;
  launchFuel = 100;
  pulseFuel = 100;
  warpCells = 1;
  hyperdriveRange = 110;
  thrust = 0;
  altitude = Infinity;
  inAtmosphere = false;
  reentry = 0;
  shake = 0;
  events: ShipEvents = {};
  private stateT = 0;
  private landFrom = new Vector3();
  private landTo = new Vector3();
  private landQuatFrom = new Quaternion();
  private landQuatTo = new Quaternion();
  private landDuration = 3;
  private takeoffQuat = new Quaternion();

  constructor(public model: ShipModel) {}

  get grounded(): boolean {
    return this.state !== 'flying';
  }

  /** World-space pose, valid in every state. */
  worldPose(outPos: Vector3, outQuat: Quaternion): void {
    if (this.state === 'flying' || !this.planet) {
      outPos.copy(this.pos);
      outQuat.copy(this.quat);
    } else {
      this.planet.toWorld(this.localPos, outPos);
      outQuat.copy(this.planet.quat).multiply(this.localQuat);
    }
  }

  forwardWorld(out: Vector3): Vector3 {
    this.worldPose(_v3, _q2);
    return out.set(0, 0, -1).applyQuaternion(_q2);
  }

  /** Land the ship instantly at a local direction on a planet (spawns, respawns). */
  placeLanded(planet: Planet, localDir: Vector3, heading: Vector3): void {
    this.planet = planet;
    const up = _v.copy(localDir).normalize();
    const normal = planet.normalAtLocal(up, _v2, 3);
    const n = normal.lerp(up, 0.5).normalize();
    const r = planet.groundRadiusAtLocal(up);
    this.localPos.copy(up).multiplyScalar(r).addScaledVector(n, this.model.gearHeight);
    const f = _v3.copy(heading).addScaledVector(n, -heading.dot(n)).normalize();
    quatFromForwardUp(f, n, this.localQuat);
    this.state = 'landed';
    this.speed = 0;
    this.vel.set(0, 0, 0);
    this.pulse = false;
  }

  /** Put the ship in flight at a world pose (warp arrival, debug). */
  placeFlying(pos: Vector3, quat: Quaternion, speed: number): void {
    this.state = 'flying';
    this.planet = null;
    this.pos.copy(pos);
    this.quat.copy(quat);
    this.speed = speed;
    this.vel.set(0, 0, -speed).applyQuaternion(quat);
    this.pulse = false;
  }

  canTakeOff(): boolean {
    return this.state === 'landed' && this.launchFuel >= 15;
  }

  takeOff(): boolean {
    if (this.state !== 'landed') return false;
    if (this.launchFuel < 15) {
      this.events.message?.('Launch thrusters need fuel. Recharge them with Hydrogen.', 'warn');
      return false;
    }
    this.launchFuel = Math.max(0, this.launchFuel - 15);
    this.state = 'takeoff';
    this.stateT = 0;
    this.takeoffQuat.copy(this.localQuat);
    this.events.takeoff?.();
    return true;
  }

  /** Try to start the landing autopilot. */
  tryLand(universe: Universe): boolean {
    if (this.state !== 'flying' || this.pulse) return false;
    const near = universe.nearestPlanet(this.pos);
    if (!near) return false;
    const planet = near.planet;
    const alt = planet.altitudeAt(this.pos);
    if (alt > 620) {
      this.events.message?.('Too high to land. Descend below 600 m.', 'warn');
      return false;
    }
    // Aim slightly ahead along the flight direction.
    const localPos = planet.toLocal(this.pos, _v);
    const up = _v2.copy(localPos).normalize();
    const fwdW = _v3.set(0, 0, -1).applyQuaternion(this.quat);
    const fwdL = planet.dirToLocal(fwdW, new Vector3());
    fwdL.addScaledVector(up, -fwdL.dot(up));
    if (fwdL.lengthSq() < 1e-6) fwdL.set(1, 0, 0).addScaledVector(up, -up.x);
    fwdL.normalize();
    const ahead = Math.min(60, 10 + this.speed * 0.3);
    const targetDir = up.clone().multiplyScalar(planet.radius).addScaledVector(fwdL, ahead).normalize();
    const h = planet.gen.height(targetDir.x, targetDir.y, targetDir.z);
    const sea = planet.params.seaLevel;
    if (sea !== null && h < sea + 0.3 && planet.params.liquid !== 'ice') {
      this.events.message?.('Cannot land on liquid. Find solid ground.', 'warn');
      return false;
    }
    const normal = planet.normalAtLocal(targetDir, new Vector3(), 3);
    const slope = normal.dot(targetDir);
    if (slope < 0.72) {
      this.events.message?.('Terrain too steep to land here.', 'warn');
      return false;
    }
    const n = normal.lerp(targetDir, 0.5).normalize();
    const groundR = planet.groundRadiusAtLocal(targetDir);
    this.planet = planet;
    this.landFrom.copy(localPos);
    this.landTo.copy(targetDir).multiplyScalar(groundR).addScaledVector(n, this.model.gearHeight);
    this.landQuatFrom.copy(planet.quatInv).multiply(this.quat);
    const f = fwdL.clone().addScaledVector(n, -fwdL.dot(n)).normalize();
    quatFromForwardUp(f, n, this.landQuatTo);
    this.landDuration = clamp(this.landFrom.distanceTo(this.landTo) / 45, 2.2, 9);
    this.localPos.copy(localPos);
    this.localQuat.copy(this.landQuatFrom);
    this.state = 'landing';
    this.stateT = 0;
    this.pulse = false;
    return true;
  }

  togglePulse(universe: Universe): void {
    if (this.state !== 'flying') return;
    if (this.pulse) {
      this.pulse = false;
      this.speed = Math.min(this.speed, SHIP_SPEEDS.spaceMax);
      this.events.pulse?.(false);
      return;
    }
    const near = universe.nearestPlanet(this.pos);
    if (near && near.dist < near.planet.atmoRadius + 800) {
      this.events.message?.('Pulse drive unavailable inside an atmosphere.', 'warn');
      return;
    }
    if (this.pulseFuel <= 0.5) {
      this.events.message?.('Pulse drive needs fuel. Refuel it with Tritium.', 'warn');
      return;
    }
    this.pulse = true;
    this.pulseSpeed = Math.max(this.speed, SHIP_SPEEDS.spaceMax);
    this.events.pulse?.(true);
  }

  update(dt: number, input: Input | null, universe: Universe, invertY: boolean, sensitivity: number): void {
    switch (this.state) {
      case 'landed':
        this.thrust = 0;
        this.speed = 0;
        this.altitude = 0;
        this.inAtmosphere = !!this.planet?.params.atmosphere;
        break;
      case 'takeoff':
        this.updateTakeoff(dt);
        break;
      case 'landing':
        this.updateLanding(dt);
        break;
      case 'flying':
        this.updateFlight(dt, input, universe, invertY, sensitivity);
        break;
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.model.gear.visible = this.state !== 'flying';
    const f = this.pulse ? 2.2 : this.state === 'takeoff' ? 1.2 : 0.25 + this.thrust * (this.boosting ? 1.6 : 0.9);
    for (const fl of this.model.flames) fl.scale.set(1, 1, f * (this.state === 'landed' ? 0 : 1) * 2.6 + 0.001);
    this.model.flameMat.uniforms.uPower.value = this.state === 'landed' ? 0 : 0.5 + this.thrust;
  }

  private updateTakeoff(dt: number): void {
    const planet = this.planet!;
    this.stateT += dt;
    const t = this.stateT;
    const up = _v.copy(this.localPos).normalize();
    const climb = 16 * smoothstep(0, 0.6, t) * (1 - smoothstep(2.2, 2.8, t) * 0.4);
    this.localPos.addScaledVector(up, climb * dt);
    // Level out while rising.
    const fwd = _v2.set(0, 0, -1).applyQuaternion(this.localQuat);
    fwd.addScaledVector(up, -fwd.dot(up)).normalize();
    quatFromForwardUp(fwd, up, _q);
    this.localQuat.slerp(_q, dampFactor(2.5, dt));
    this.thrust = 1;
    this.altitude = this.localPos.length() - planet.groundRadiusAtLocal(this.localPos);
    if (t > 2.6) {
      // Hand over to free flight in system space.
      planet.toWorld(this.localPos, this.pos);
      this.quat.copy(planet.quat).multiply(this.localQuat);
      this.speed = 40;
      const fwdW = _v3.set(0, 0, -1).applyQuaternion(this.quat);
      planet.frameVelocity(this.pos, this.vel);
      this.vel.addScaledVector(fwdW, this.speed);
      const upW = planet.dirToWorld(up, _v2);
      this.vel.addScaledVector(upW, 8);
      this.state = 'flying';
    }
  }

  private updateLanding(dt: number): void {
    const planet = this.planet!;
    this.stateT += dt;
    const t = clamp(this.stateT / this.landDuration, 0, 1);
    const e = t * t * (3 - 2 * t);
    // Horizontal approach first, then vertical descent.
    const hz = smoothstep(0, 0.75, t);
    const vt = smoothstep(0.15, 1, t);
    const fromR = this.landFrom.length();
    const toR = this.landTo.length();
    const dir = _v.copy(this.landFrom).normalize().lerp(_v2.copy(this.landTo).normalize(), hz).normalize();
    const r = fromR + (toR - fromR) * vt;
    this.localPos.copy(dir).multiplyScalar(r);
    this.localQuat.copy(this.landQuatFrom).slerp(this.landQuatTo, e);
    this.thrust = 0.5 * (1 - t);
    this.altitude = r - planet.groundRadiusAtLocal(dir);
    if (t >= 1) {
      this.localPos.copy(this.landTo);
      this.localQuat.copy(this.landQuatTo);
      this.state = 'landed';
      this.speed = 0;
      this.events.landed?.();
    }
  }

  private updateFlight(dt: number, input: Input | null, universe: Universe, invertY: boolean, sensitivity: number): void {
    const near = universe.nearestPlanet(this.pos)!;
    const planet = near.planet;
    const dist = near.dist;
    this.altitude = planet.altitudeAt(this.pos);
    const atmoTop = planet.atmoRadius;
    this.inAtmosphere = !!planet.params.atmosphere && dist < atmoTop;
    const lowSpace = dist < atmoTop + 600;
    // Co-rotation weight: 1 inside the atmosphere, fading out above it.
    const w = 1 - smoothstep(atmoTop, atmoTop + planet.radius * 0.8, dist);
    const vRef = planet.frameVelocity(this.pos, _v).multiplyScalar(w);

    // --- attitude
    let pitchIn = 0, yawIn = 0, rollIn = 0, fwdIn = 0;
    this.boosting = false;
    if (input) {
      const [dx, dy] = input.consumeLook();
      this.stick.x += dx * 0.0042 * sensitivity;
      this.stick.y += dy * 0.0042 * sensitivity * (invertY ? -1 : 1);
      if (this.stick.lengthSq() > 1) this.stick.normalize();
      rollIn = -input.axisX();
      fwdIn = input.axisY();
      this.boosting = input.isDown('sprint') && !this.pulse;
      if (input.isDown('descend')) pitchIn -= 0; // reserved
    }
    this.stick.multiplyScalar(Math.exp(-3.2 * dt));
    pitchIn += -this.stick.y;
    yawIn += -this.stick.x;
    const agility = this.pulse ? 0.35 : this.boosting ? 0.75 : 1;
    const pitchRate = pitchIn * 1.5 * agility;
    const yawRate = yawIn * 1.15 * agility;
    let rollRate = rollIn * 2.1 * agility;

    // Gentle auto-level near planets when not rolling.
    if (Math.abs(rollIn) < 0.05 && dist < atmoTop + planet.radius * 0.3) {
      const upW = _v2.copy(this.pos).sub(planet.center).normalize();
      const right = _v3.set(1, 0, 0).applyQuaternion(this.quat);
      const fwd = new Vector3(0, 0, -1).applyQuaternion(this.quat);
      if (Math.abs(fwd.dot(upW)) < 0.85) rollRate += clamp(right.dot(upW), -1, 1) * 1.2;
    }
    _q.setFromAxisAngle(X, pitchRate * dt);
    this.quat.multiply(_q);
    _q.setFromAxisAngle(Y, yawRate * dt);
    this.quat.multiply(_q);
    _q.setFromAxisAngle(Z, rollRate * dt);
    this.quat.multiply(_q);
    // Follow the planet's rotation inside its atmosphere.
    if (w > 0) {
      _q.setFromAxisAngle(planet.axis, planet.spinRate * w * dt);
      this.quat.premultiply(_q);
    }
    this.quat.normalize();
    const fwd = _v2.set(0, 0, -1).applyQuaternion(this.quat);

    // --- speed
    if (this.pulse) {
      this.pulseFuel = Math.max(0, this.pulseFuel - dt * 0.9);
      this.pulseSpeed += (SHIP_SPEEDS.pulseMax - this.pulseSpeed) * dampFactor(0.55, dt);
      this.speed = this.pulseSpeed;
      this.thrust = 1;
      // Drop out near planets, or when heading into one.
      let drop = this.pulseFuel <= 0 || lowSpace;
      const lookAhead = this.speed * 2.2;
      for (const p of universe.planets) {
        const hit = raySphere(this.pos, fwd, p.center, p.atmoRadius + 1500);
        if (hit && hit[1] > 0 && hit[0] < lookAhead) drop = true;
      }
      const star = universe.star;
      const hitStar = raySphere(this.pos, fwd, _v3.set(0, 0, 0), star.radius * 6);
      if (hitStar && hitStar[1] > 0 && hitStar[0] < lookAhead) drop = true;
      if (drop) {
        this.pulse = false;
        this.speed = SHIP_SPEEDS.spaceMax;
        this.events.pulse?.(false);
        if (this.pulseFuel <= 0) this.events.message?.('Pulse drive fuel depleted.', 'warn');
      }
    } else {
      const inAtmo = this.inAtmosphere || (lowSpace && !!planet.params.atmosphere);
      const cruise = inAtmo ? SHIP_SPEEDS.atmoCruise : SHIP_SPEEDS.spaceCruise;
      const max = inAtmo ? SHIP_SPEEDS.atmoMax : SHIP_SPEEDS.spaceMax;
      const boost = inAtmo ? SHIP_SPEEDS.atmoBoost : SHIP_SPEEDS.spaceBoost;
      let target = cruise;
      if (fwdIn > 0.1) target = cruise + (max - cruise) * fwdIn;
      else if (fwdIn < -0.1) target = cruise * (1 + fwdIn);
      if (this.boosting) target = boost;
      const accel = target > this.speed ? (this.boosting ? 180 : 70) : 110;
      // Re-entry: heavy drag when arriving fast.
      this.reentry = Math.max(0, Math.min(1, (this.speed - boost) / 600)) * (inAtmo ? 1 : 0);
      if (this.speed > boost && inAtmo) this.speed = moveToward(this.speed, target, 420 * dt);
      else this.speed = moveToward(this.speed, target, accel * dt);
      this.thrust = clamp(this.speed / max, 0, 1);
    }

    // --- velocity: align with the nose, relative to the co-rotating reference
    _v3.copy(fwd).multiplyScalar(this.speed).add(vRef);
    const grip = this.pulse ? 12 : 3.2;
    this.vel.lerp(_v3, dampFactor(grip, dt));
    this.pos.addScaledVector(this.vel, dt);

    // --- terrain collision
    const altNow = planet.altitudeAt(this.pos);
    this.altitude = altNow;
    if (altNow < 12) {
      const upW = _v3.copy(this.pos).sub(planet.center).normalize();
      const relV = _v.copy(this.vel).sub(vRef);
      const vn = relV.dot(upW);
      if (altNow < 3) {
        this.pos.addScaledVector(upW, 3 - altNow);
        if (vn < 0) {
          this.vel.addScaledVector(upW, -vn * 1.5);
          if (-vn > 18) {
            const dmg = (-vn - 18) * 1.2;
            this.shield = Math.max(0, this.shield - dmg);
            this.events.impact?.(Math.min(1, dmg / 30));
            this.shake = Math.min(1, this.shake + dmg / 25);
          }
        }
        this.speed *= 0.97;
      } else if (vn < 0) {
        // soft cushion close to the ground
        this.vel.addScaledVector(upW, -vn * (1 - altNow / 12) * dampFactor(6, dt));
      }
    }

    // --- star heat
    const starDist = this.pos.length();
    const star = universe.star;
    if (starDist < star.radius * 4) {
      const heat = 1 - (starDist - star.radius) / (star.radius * 3);
      this.shield = Math.max(0, this.shield - heat * 25 * dt);
      this.vel.addScaledVector(_v.copy(this.pos).normalize(), heat * 400 * dt);
      this.shake = Math.min(1, this.shake + heat * dt);
      if (Math.random() < dt) this.events.message?.('Warning: extreme heat. Turn away from the star.', 'warn');
    }
  }

  /** Speed relative to the local surface frame (for the HUD). */
  relativeSpeed(universe: Universe): number {
    if (this.state !== 'flying') return this.state === 'landed' ? 0 : 12;
    if (this.pulse) return this.speed;
    const near = universe.nearestPlanet(this.pos);
    if (!near) return this.vel.length();
    const p = near.planet;
    const w = 1 - smoothstep(p.atmoRadius, p.atmoRadius + p.radius * 0.8, near.dist);
    return _v.copy(this.vel).sub(p.frameVelocity(this.pos, _v2).multiplyScalar(w)).length();
  }
}
