import { Quaternion, Vector3 } from 'three';
import type { Input } from '../engine/input';
import { anyPerpendicular, clamp, damp, quatFromForwardUp } from '../engine/math';
import type { Planet } from './Planet';

export interface Collider {
  /** Local position of the collider base. */
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
}

export interface PlayerEvents {
  onLand?: (impactSpeed: number) => void;
  onJetpack?: (active: boolean) => void;
  onStep?: () => void;
  onSplash?: () => void;
}

const EYE = 1.65;
const _up = new Vector3();
const _right = new Vector3();
const _fwd = new Vector3();
const _desired = new Vector3();
const _tang = new Vector3();
const _q = new Quaternion();
const _v = new Vector3();

/** First-person explorer walking on a rotating planet (all state in planet-local space). */
export class Player {
  planet: Planet;
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly heading = new Vector3(1, 0, 0);
  pitch = 0;
  grounded = false;
  swimming = false;
  inLiquid: 'none' | 'water' | 'lava' | 'acid' = 'none';
  jetpack = 1;
  private jetCooldown = 0;
  private jetting = false;
  private stepDist = 0;
  private bob = 0;
  sprinting = false;
  speed = 0;
  jetpackBoost = 1;
  events: PlayerEvents = {};

  constructor(planet: Planet) {
    this.planet = planet;
  }

  get up(): Vector3 {
    return _up.copy(this.pos).normalize();
  }

  /** Place the player on the ground at a local direction. */
  placeAt(localDir: Vector3, heading?: Vector3): void {
    const d = _v.copy(localDir).normalize();
    const r = this.planet.groundRadiusAtLocal(d);
    this.pos.copy(d).multiplyScalar(r + 0.05);
    this.vel.set(0, 0, 0);
    if (heading) this.heading.copy(heading);
    this.fixHeading();
    this.grounded = true;
  }

  private fixHeading(): void {
    const up = _up.copy(this.pos).normalize();
    this.heading.addScaledVector(up, -this.heading.dot(up));
    if (this.heading.lengthSq() < 1e-8) anyPerpendicular(up, this.heading);
    this.heading.normalize();
  }

  look(dx: number, dy: number): void {
    const up = _up.copy(this.pos).normalize();
    _q.setFromAxisAngle(up, -dx);
    this.heading.applyQuaternion(_q);
    this.pitch = clamp(this.pitch - dy, -1.52, 1.52);
    this.fixHeading();
  }

  eyeLocal(out: Vector3): Vector3 {
    const up = _up.copy(this.pos).normalize();
    const bobY = this.grounded && !this.swimming ? Math.sin(this.bob) * 0.035 * Math.min(1, this.speed / 5) : 0;
    return out.copy(this.pos).addScaledVector(up, EYE + bobY);
  }

  /** Forward view direction (local). */
  viewDirLocal(out: Vector3): Vector3 {
    const up = _up.copy(this.pos).normalize();
    return out.copy(this.heading).multiplyScalar(Math.cos(this.pitch)).addScaledVector(up, Math.sin(this.pitch)).normalize();
  }

  viewQuatLocal(out: Quaternion): Quaternion {
    const up = _v.copy(this.pos).normalize();
    const f = this.viewDirLocal(_fwd);
    // keep a stable up even when looking straight up or down
    const camUp = _tang.copy(up).multiplyScalar(Math.cos(this.pitch)).addScaledVector(this.heading, -Math.sin(this.pitch));
    return quatFromForwardUp(f, camUp, out);
  }

  update(dt: number, input: Input, colliders: Collider[]): void {
    const planet = this.planet;
    const g = planet.params.gravity;
    this.fixHeading();
    const up = _up.copy(this.pos).normalize();
    const right = _right.crossVectors(this.heading, up).normalize();

    const ax = input.axisX();
    const ay = input.axisY();
    const moveMag = Math.min(1, Math.hypot(ax, ay));
    this.sprinting = input.isDown('sprint') && ay > 0.3 && !this.swimming;
    const maxSpeed = this.swimming ? 3.6 : this.sprinting ? 9 : 5;
    _desired.set(0, 0, 0).addScaledVector(this.heading, ay).addScaledVector(right, ax);
    if (_desired.lengthSq() > 1e-6) _desired.normalize().multiplyScalar(maxSpeed * moveMag);

    // Liquid state
    const r = this.pos.length();
    const seaR = planet.seaRadius;
    const liquid = planet.params.liquid;
    this.inLiquid = 'none';
    this.swimming = false;
    if (seaR !== null && liquid !== 'ice' && r < seaR - 0.2) {
      this.inLiquid = liquid === 'lava' ? 'lava' : liquid === 'acid' ? 'acid' : 'water';
      if (r < seaR - 1.0) this.swimming = true;
    }

    const vr = this.vel.dot(up);
    _tang.copy(this.vel).addScaledVector(up, -vr);

    if (this.swimming) {
      // Swim along the view direction; buoyancy keeps the head above the surface.
      const view = this.viewDirLocal(_fwd);
      _desired.set(0, 0, 0).addScaledVector(view, ay * maxSpeed).addScaledVector(right, ax * maxSpeed);
      const k = 1 - Math.exp(-3 * dt);
      this.vel.lerp(_desired, k);
      const depth = seaR! - 1.2 - r;
      if (ay <= 0.2 || view.dot(up) > -0.3) this.vel.addScaledVector(up, clamp(depth * 3, -3, 4) * dt * 3);
      if (input.isDown('jump')) this.vel.addScaledVector(up, 6 * dt);
      this.grounded = false;
    } else {
      // Horizontal control
      const control = this.grounded ? 14 : this.jetting ? 3.5 : 1.6;
      const k = 1 - Math.exp(-control * dt);
      _tang.lerp(_desired, k);
      let vUp = vr;
      if (this.grounded && input.wasPressed('jump')) {
        vUp = 5.5;
        this.grounded = false;
        this.jetCooldown = 0.25;
      }
      // Jetpack
      this.jetCooldown -= dt;
      const wantJet = input.isDown('jump') && !this.grounded && this.jetCooldown <= 0 && this.jetpack > 0;
      if (wantJet !== this.jetting) this.events.onJetpack?.(wantJet);
      this.jetting = wantJet;
      if (this.jetting) {
        vUp += (g + 9.5 * this.jetpackBoost) * dt;
        vUp = Math.min(vUp, 9 * this.jetpackBoost);
        const view = this.viewDirLocal(_fwd);
        const horiz = view.addScaledVector(up, -view.dot(up));
        if (ay > 0 && horiz.lengthSq() > 1e-4) {
          horiz.normalize();
          _tang.addScaledVector(horiz, 7 * ay * dt);
          const ts = _tang.length();
          if (ts > 13) _tang.multiplyScalar(13 / ts);
        }
        this.jetpack = Math.max(0, this.jetpack - dt * 0.34);
      } else if (this.grounded) {
        this.jetpack = Math.min(1, this.jetpack + dt * 0.55);
      }
      vUp -= g * dt;
      if (this.inLiquid !== 'none') vUp = damp(vUp, 0, 3, dt);
      this.vel.copy(_tang).addScaledVector(up, vUp);
    }

    this.pos.addScaledVector(this.vel, dt);

    // Cylinder colliders (trees, rocks, ship)
    for (const c of colliders) {
      _v.set(this.pos.x - c.x, this.pos.y - c.y, this.pos.z - c.z);
      const h = _v.dot(up);
      if (h < -0.5 || h > c.height) continue;
      _v.addScaledVector(up, -h);
      const d = _v.length();
      const minD = c.radius + 0.35;
      if (d < minD && d > 1e-5) {
        this.pos.addScaledVector(_v, (minD - d) / d);
        const vn = this.vel.dot(_v) / d;
        if (vn < 0) this.vel.addScaledVector(_v, -vn / d);
      }
    }

    // Ground collision
    const nr = this.pos.length();
    const groundR = planet.groundRadiusAtLocal(this.pos);
    const upNow = _up.copy(this.pos).divideScalar(nr);
    const vrNow = this.vel.dot(upNow);
    const wasGrounded = this.grounded;
    if (nr <= groundR) {
      if (!wasGrounded && vrNow < -3) this.events.onLand?.(-vrNow);
      this.pos.copy(upNow).multiplyScalar(groundR);
      if (vrNow < 0) this.vel.addScaledVector(upNow, -vrNow);
      this.grounded = true;
    } else if (wasGrounded && nr - groundR < 0.45 && vrNow < 1.0 && !this.swimming) {
      // stick to the ground when walking down slopes
      this.pos.copy(upNow).multiplyScalar(groundR);
      if (vrNow < 0) this.vel.addScaledVector(upNow, -vrNow);
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    if (this.swimming) this.grounded = false;

    // Walking bob and footsteps
    const hs = _tang.copy(this.vel).addScaledVector(upNow, -this.vel.dot(upNow)).length();
    this.speed = hs;
    if (this.grounded && hs > 0.5) {
      this.bob += hs * dt * 2.1;
      this.stepDist += hs * dt;
      if (this.stepDist > (this.sprinting ? 2.4 : 1.8)) {
        this.stepDist = 0;
        this.events.onStep?.();
      }
    }
  }
}
