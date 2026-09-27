// Unified input: keyboard, mouse (pointer lock with drag-to-look fallback) and
// virtual touch controls all feed the same action/axis state.

export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'sprint' | 'interact' | 'scan' | 'visor' | 'mine'
  | 'pulse' | 'map' | 'inventory' | 'log' | 'menu' | 'camera' | 'torch' | 'descend';

const KEY_BINDINGS: Record<string, Action> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyE: 'interact',
  KeyC: 'scan',
  KeyF: 'visor',
  KeyR: 'mine',
  KeyJ: 'pulse',
  KeyM: 'map',
  Tab: 'inventory', KeyI: 'inventory',
  KeyL: 'log',
  Escape: 'menu', KeyP: 'menu',
  KeyV: 'camera',
  KeyG: 'torch',
  KeyQ: 'descend', ControlLeft: 'descend',
};

export class Input {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();
  private virtualDown = new Set<Action>();

  /** Accumulated look deltas in pixels since last consume. */
  private lookDX = 0;
  private lookDY = 0;
  wheel = 0;

  /** Virtual stick axes from touch controls, [-1, 1]. */
  touchMoveX = 0;
  touchMoveY = 0;

  pointerLocked = false;
  dragLook = false;
  private dragging = false;
  mouseX = 0;
  mouseY = 0;
  touchActive = false;
  enabled = true;

  onPointerLockLost: (() => void) | null = null;
  onAnyKey: ((code: string) => void) | null = null;

  constructor(private element: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.clearAll());
    element.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    element.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.element;
      const wasLocked = this.pointerLocked;
      this.pointerLocked = locked;
      if (wasLocked && !locked) {
        this.clearAll();
        this.onPointerLockLost?.();
      }
    });
    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false;
      this.dragLook = true;
    });
  }

  requestPointerLock(): void {
    if (this.touchActive || this.dragLook) return;
    const el = this.element as HTMLElement & { requestPointerLock?: (opts?: unknown) => Promise<void> | void };
    if (!el.requestPointerLock) {
      this.dragLook = true;
      return;
    }
    try {
      const r = el.requestPointerLock();
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => {
          this.dragLook = true;
        });
      }
    } catch {
      this.dragLook = true;
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) {
      this.pointerLocked = false; // suppress the lost-lock callback for deliberate exits
      document.exitPointerLock();
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    this.onAnyKey?.(e.code);
    const a = KEY_BINDINGS[e.code];
    if (!a) return;
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (!this.enabled && a !== 'menu' && a !== 'map' && a !== 'inventory' && a !== 'log') return;
    if (!this.down.has(a)) this.pressed.add(a);
    this.down.add(a);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const a = KEY_BINDINGS[e.code];
    if (!a) return;
    // Only release if no other key bound to the same action is held; keep it simple.
    this.down.delete(a);
    this.released.add(a);
  };

  private onMouseDown = (e: MouseEvent): void => {
    this.touchActive = false;
    if (e.button === 0) {
      if (this.dragLook) this.dragging = true;
      else if (this.pointerLocked) this.setMouseAction('mine', true);
    } else if (e.button === 2) {
      this.setMouseAction('mine', true);
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.dragging = false;
      this.setMouseAction('mine', false);
    } else if (e.button === 2) {
      this.setMouseAction('mine', false);
    }
  };

  private setMouseAction(a: Action, on: boolean): void {
    if (on) {
      if (!this.down.has(a)) this.pressed.add(a);
      this.down.add(a);
    } else {
      this.down.delete(a);
      this.released.add(a);
    }
  }

  private onMouseMove = (e: MouseEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    if (!this.enabled) return;
    if (this.pointerLocked || (this.dragLook && this.dragging)) {
      // Guard against the occasional huge spike some browsers emit on lock.
      if (Math.abs(e.movementX) < 400 && Math.abs(e.movementY) < 400) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      }
    }
  };

  addLook(dx: number, dy: number): void {
    this.lookDX += dx;
    this.lookDY += dy;
  }

  setVirtual(a: Action, on: boolean): void {
    if (on) {
      if (!this.virtualDown.has(a) && !this.down.has(a)) this.pressed.add(a);
      this.virtualDown.add(a);
    } else {
      if (this.virtualDown.has(a)) this.released.add(a);
      this.virtualDown.delete(a);
    }
  }

  /** Tap a virtual action for exactly one frame. */
  tap(a: Action): void {
    this.pressed.add(a);
  }

  isDown(a: Action): boolean {
    return this.down.has(a) || this.virtualDown.has(a);
  }

  wasPressed(a: Action): boolean {
    return this.pressed.has(a);
  }

  wasReleased(a: Action): boolean {
    return this.released.has(a);
  }

  axisX(): number {
    let x = 0;
    if (this.isDown('right')) x += 1;
    if (this.isDown('left')) x -= 1;
    x += this.touchMoveX;
    return Math.max(-1, Math.min(1, x));
  }

  axisY(): number {
    let y = 0;
    if (this.isDown('forward')) y += 1;
    if (this.isDown('back')) y -= 1;
    y += this.touchMoveY;
    return Math.max(-1, Math.min(1, y));
  }

  consumeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
  }

  clearAll(): void {
    for (const a of this.down) this.released.add(a);
    this.down.clear();
    this.virtualDown.clear();
    this.dragging = false;
    this.lookDX = 0;
    this.lookDY = 0;
    this.touchMoveX = 0;
    this.touchMoveY = 0;
  }
}
