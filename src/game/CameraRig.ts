import { Quaternion, Vector3 } from 'three';
import { clamp, dampFactor } from '../engine/math';

export type CamMode = 'foot' | 'chase' | 'cockpit';

const _v = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);

/** Produces the camera pose in system space, with smooth handovers between views. */
export class CameraRig {
  mode: CamMode = 'foot';
  readonly pos = new Vector3();
  readonly quat = new Quaternion();
  private readonly fromPos = new Vector3();
  private readonly fromQuat = new Quaternion();
  private blend = 1;
  private blendTime = 0.9;
  private readonly offset = new Vector3(0, 3, 14);
  private readonly lagQuat = new Quaternion();
  private initialized = false;
  orbitYaw = 0;
  orbitPitch = -0.12;
  shake = 0;
  fovKick = 0;

  setMode(mode: CamMode, instant = false): void {
    if (mode === this.mode && !instant) return;
    this.mode = mode;
    this.fromPos.copy(this.pos);
    this.fromQuat.copy(this.quat);
    this.blend = instant || !this.initialized ? 1 : 0;
    this.orbitYaw = 0;
    this.orbitPitch = -0.12;
  }

  /** First-person camera at the player's eye. */
  updateFoot(dt: number, eyeWorld: Vector3, viewQuat: Quaternion): void {
    this.apply(dt, eyeWorld, viewQuat);
  }

  /** Chase / cockpit camera around the ship. */
  updateShip(dt: number, shipPos: Vector3, shipQuat: Quaternion, speed: number, landed: boolean, cockpit: Vector3): void {
    if (this.mode === 'cockpit') {
      _v.copy(cockpit).applyQuaternion(shipQuat).add(shipPos);
      _q.copy(shipQuat);
      if (landed) {
        _q2.setFromAxisAngle(Y, this.orbitYaw * 0.8);
        _q.multiply(_q2);
        _q2.setFromAxisAngle(X, this.orbitPitch + 0.12);
        _q.multiply(_q2);
      }
      this.apply(dt, _v, _q);
      return;
    }
    const back = 13.5 + clamp(speed / 120, 0, 5);
    const up = 3.3 + clamp(speed / 400, 0, 1.2);
    // Orbit around the ship when landed; trail behind it in flight.
    _q.copy(shipQuat);
    if (landed) {
      _q2.setFromAxisAngle(Y, this.orbitYaw);
      _q.multiply(_q2);
      _q2.setFromAxisAngle(X, this.orbitPitch);
      _q.multiply(_q2);
    } else {
      this.orbitYaw *= Math.exp(-3 * dt);
      this.orbitPitch += (-0.12 - this.orbitPitch) * dampFactor(3, dt);
    }
    if (!this.initialized) this.lagQuat.copy(_q);
    this.lagQuat.slerp(_q, dampFactor(landed ? 12 : 6.5, dt));
    const desired = _v.set(0, up, back).applyQuaternion(this.lagQuat);
    this.offset.lerp(desired, dampFactor(9, dt));
    const camPos = _v.copy(shipPos).add(this.offset);
    // Look slightly down at the ship.
    _q2.setFromAxisAngle(X, -0.1);
    const look = _q.copy(this.lagQuat).multiply(_q2);
    this.apply(dt, camPos, look);
  }

  private apply(dt: number, targetPos: Vector3, targetQuat: Quaternion): void {
    if (!this.initialized) {
      this.pos.copy(targetPos);
      this.quat.copy(targetQuat);
      this.fromPos.copy(targetPos);
      this.fromQuat.copy(targetQuat);
      this.initialized = true;
      this.blend = 1;
      return;
    }
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendTime);
      const t = this.blend;
      const e = t * t * (3 - 2 * t);
      this.pos.copy(this.fromPos).lerp(targetPos, e);
      this.quat.copy(this.fromQuat).slerp(targetQuat, e);
    } else {
      this.pos.copy(targetPos);
      this.quat.copy(targetQuat);
    }
    if (this.shake > 0.001) {
      const s = this.shake * 0.12;
      this.pos.x += (Math.random() - 0.5) * s;
      this.pos.y += (Math.random() - 0.5) * s;
      this.pos.z += (Math.random() - 0.5) * s;
      _q2.setFromAxisAngle(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), this.shake * 0.01);
      this.quat.multiply(_q2);
    }
  }

  get transitioning(): boolean {
    return this.blend < 1;
  }
}
