import type { Action } from '../engine/input';
import { isTouchDevice } from '../engine/settings';
import type { Game } from '../game/Game';
import { h, setText } from './dom';

interface TButton {
  el: HTMLElement;
  action: Action;
  hold: boolean;
}

/** On-screen controls for touch devices: move stick, look pad and action buttons. */
export class TouchControls {
  active: boolean;
  private root: HTMLElement;
  private joy: HTMLElement;
  private knob: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private buttons: TButton[] = [];
  private labels: Record<string, HTMLElement> = {};

  constructor(private game: Game, parent: HTMLElement) {
    this.active = isTouchDevice();
    this.knob = h('div', { class: 'joy-knob' });
    this.joy = h('div', { class: 'joy' }, this.knob);
    const stickZone = h('div', { class: 'stick-zone' });
    const lookZone = h('div', { class: 'look-zone' });

    const btn = (label: string, action: Action, hold: boolean, key: string) => {
      const el = h('button', { class: 'tbtn', type: 'button', 'aria-label': label }, label);
      this.labels[key] = el;
      const b: TButton = { el, action, hold };
      this.buttons.push(b);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        el.classList.add('on');
        if (hold) this.game.input.setVirtual(b.action, true);
        else this.game.input.tap(b.action);
        this.game.audio.resume();
      });
      const up = (e: PointerEvent) => {
        e.preventDefault();
        el.classList.remove('on');
        if (hold) this.game.input.setVirtual(b.action, false);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      return el;
    };

    const grid = h('div', { class: 'tbtns' },
      btn('Scan', 'scan', false, 'scan'),
      btn('Visor', 'visor', false, 'visor'),
      btn('Use', 'interact', false, 'use'),
      btn('Run', 'sprint', true, 'sprint'),
      btn('Mine', 'mine', true, 'mine'),
      btn('Jet', 'jump', true, 'jump'),
    );
    const top = h('div', { class: 'ttop' },
      btn('Menu', 'menu', false, 'menu'),
      btn('Bag', 'inventory', false, 'inv'),
      btn('Log', 'log', false, 'log'),
      btn('Map', 'map', false, 'map'),
      btn('Pulse', 'pulse', false, 'pulse'),
      btn('Cam', 'camera', false, 'cam'),
    );
    this.root = h('div', { class: 'touch' }, stickZone, lookZone, this.joy, grid, top);
    this.root.hidden = true;
    parent.append(this.root);

    stickZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      stickZone.setPointerCapture(e.pointerId);
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.joy.classList.add('on');
      this.joy.style.left = `${e.clientX}px`;
      this.joy.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(0px, 0px)';
    });
    stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      const max = 50;
      const d = Math.hypot(dx, dy);
      const k = d > max ? max / d : 1;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.game.input.touchMoveX = (dx * k) / max;
      this.game.input.touchMoveY = (-dy * k) / max;
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.joy.classList.remove('on');
      this.game.input.touchMoveX = 0;
      this.game.input.touchMoveY = 0;
    };
    stickZone.addEventListener('pointerup', endStick);
    stickZone.addEventListener('pointercancel', endStick);

    lookZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.lookId !== null) return;
      this.lookId = e.pointerId;
      lookZone.setPointerCapture(e.pointerId);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const dx = e.clientX - this.lookLast.x;
      const dy = e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.game.input.addLook(dx * 1.6, dy * 1.6);
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    lookZone.addEventListener('pointerup', endLook);
    lookZone.addEventListener('pointercancel', endLook);

    // A real touch anywhere switches to touch controls.
    window.addEventListener('touchstart', () => {
      if (!this.active) {
        this.active = true;
        this.game.input.touchActive = true;
        this.setVisible(this.game.mode === 'play');
      }
    }, { passive: true });
    if (this.active) this.game.input.touchActive = true;
  }

  setVisible(v: boolean): void {
    this.root.hidden = !(v && this.active);
  }

  /** Context labels for the action buttons. */
  update(): void {
    if (!this.active || this.root.hidden) return;
    const g = this.game;
    const ship = g.control === 'ship';
    const flying = ship && g.ship.state === 'flying';
    setText(this.labels.jump, ship ? (flying ? 'Boost' : 'Lift off') : 'Jet');
    this.buttons.find((b) => b.el === this.labels.jump)!.action = flying ? 'sprint' : 'jump';
    setText(this.labels.mine, ship ? 'Fire' : 'Mine');
    setText(this.labels.use, ship ? (flying ? 'Land' : 'Exit') : 'Use');
    setText(this.labels.sprint, ship ? 'Brake' : 'Run');
    this.buttons.find((b) => b.el === this.labels.sprint)!.action = ship ? 'back' : 'sprint';
    this.labels.pulse.hidden = !flying;
    this.labels.scan.hidden = ship;
  }
}
