import { h, setStyle, setText } from './dom';

export interface BarSpec {
  key: string;
  label: string;
  value: number;
  max?: number;
  text?: string;
  warn?: boolean;
  color?: string;
}

export interface MarkerSpec {
  x: number;
  y: number;
  label: string;
  sub?: string;
  kind: 'ship' | 'planet' | 'resource' | 'creature' | 'star' | 'target' | 'poi';
  color?: string;
  offscreen?: boolean;
}

export interface CompassMarker {
  bearing: number;
  color: string;
  label?: string;
}

export interface HudFrame {
  mode: 'foot' | 'ship';
  location: { name: string; sub: string; cond: string[]; hazard?: string } | null;
  bars: BarSpec[];
  readout: { label: string; value: string }[];
  heading: number | null;
  compassMarkers: CompassMarker[];
  markers: MarkerSpec[];
  prompt: string | null;
  crosshair: 'dot' | 'mine' | 'scan' | 'ship' | 'none';
  stick: [number, number] | null;
  heat: number;
  overheated: boolean;
  scan: { title: string; sub: string; progress: number } | null;
  underwater: boolean;
  visor: boolean;
  damage: number;
  reentry: number;
  fps: number | null;
  pulse: boolean;
}

interface BarEl {
  root: HTMLElement;
  label: HTMLElement;
  fill: HTMLElement;
  val: HTMLElement;
}

export class Hud {
  readonly root: HTMLElement;
  private locName: HTMLElement;
  private locSub: HTMLElement;
  private locCond: HTMLElement;
  private locBox: HTMLElement;
  private barsBox: HTMLElement;
  private bars = new Map<string, BarEl>();
  private readoutBox: HTMLElement;
  private compass: HTMLElement;
  private compassStrip: HTMLElement;
  private compassMarks: HTMLElement;
  private prompt: HTMLElement;
  private crosshair: HTMLElement;
  private stick: HTMLElement;
  private heat: HTMLElement;
  private heatFill: HTMLElement;
  private feed: HTMLElement;
  private markersBox: HTMLElement;
  private markerPool: HTMLElement[] = [];
  private banner: HTMLElement;
  private bannerTitle: HTMLElement;
  private bannerSub: HTMLElement;
  private bannerTimer = 0;
  private scanBox: HTMLElement;
  private scanTitle: HTMLElement;
  private scanSub: HTMLElement;
  private scanFill: HTMLElement;
  private overlays: Record<string, HTMLElement> = {};
  private fpsEl: HTMLElement;
  private compassMarkPool: HTMLElement[] = [];
  private readouts: HTMLElement[] = [];

  constructor(parent: HTMLElement) {
    this.locName = h('div', { class: 'loc-name' });
    this.locSub = h('div', { class: 'loc-sub' });
    this.locCond = h('div', { class: 'loc-cond' });
    this.locBox = h('div', { class: 'hud-loc frame' }, this.locName, this.locSub, this.locCond);
    this.barsBox = h('div', { class: 'hud-bars frame' });
    this.readoutBox = h('div', { class: 'hud-readout frame' });

    const ticks: HTMLElement[] = [];
    const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let k = -1; k <= 1; k++) {
      for (let d = 0; d < 360; d += 15) {
        const label = names[d];
        ticks.push(
          h('span', { class: label ? (label.length === 1 ? 'tick major' : 'tick mid') : 'tick', style: `left:${(d + k * 360) * 2}px` }, label ?? ''),
        );
      }
    }
    this.compassStrip = h('div', { class: 'compass-strip' }, ...ticks);
    this.compassMarks = h('div', { class: 'compass-marks' });
    this.compass = h('div', { class: 'hud-compass' }, h('div', { class: 'compass-window' }, this.compassStrip, this.compassMarks), h('div', { class: 'compass-caret' }));

    this.crosshair = h('div', { class: 'crosshair', 'data-kind': 'dot' });
    this.stick = h('div', { class: 'flight-stick' }, h('div', { class: 'stick-dot' }));
    this.prompt = h('div', { class: 'prompt' });
    this.heatFill = h('div', { class: 'heat-fill' });
    this.heat = h('div', { class: 'heat' }, this.heatFill);

    this.scanTitle = h('div', { class: 'scan-title' });
    this.scanSub = h('div', { class: 'scan-sub' });
    this.scanFill = h('div', { class: 'scan-fill' });
    this.scanBox = h('div', { class: 'hud-scan' }, this.scanTitle, this.scanSub, h('div', { class: 'scan-track' }, this.scanFill));

    this.feed = h('div', { class: 'hud-feed' });
    this.markersBox = h('div', { class: 'hud-markers' });
    this.bannerTitle = h('div', { class: 'banner-title' });
    this.bannerSub = h('div', { class: 'banner-sub' });
    this.banner = h('div', { class: 'hud-banner' }, h('div', { class: 'banner-rule' }), this.bannerTitle, this.bannerSub, h('div', { class: 'banner-rule' }));
    this.fpsEl = h('div', { class: 'hud-fps' });

    for (const k of ['underwater', 'visor', 'damage', 'reentry', 'pulse']) {
      this.overlays[k] = h('div', { class: `overlay overlay-${k}` });
    }

    this.root = h(
      'div',
      { class: 'hud', 'data-mode': 'foot' },
      ...Object.values(this.overlays),
      this.markersBox,
      this.compass,
      this.locBox,
      this.barsBox,
      this.readoutBox,
      h('div', { class: 'hud-center' }, this.crosshair, this.stick, this.heat, this.prompt),
      this.scanBox,
      this.feed,
      this.banner,
      this.fpsEl,
    );
    parent.append(this.root);
  }

  setVisible(v: boolean): void {
    this.root.hidden = !v;
  }

  toast(text: string, color = 'var(--text)', icon?: string): void {
    const el = h('div', { class: 'toast' }, icon ? h('span', { class: 'toast-icon', style: `color:${color};border-color:${color}` }, icon) : null, h('span', null, text));
    this.feed.prepend(el);
    while (this.feed.children.length > 6) this.feed.lastElementChild?.remove();
    window.setTimeout(() => el.classList.add('out'), 3600);
    window.setTimeout(() => el.remove(), 4200);
  }

  showBanner(title: string, sub: string, seconds = 4.5): void {
    setText(this.bannerTitle, title);
    setText(this.bannerSub, sub);
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerTimer = seconds;
  }

  private bar(spec: BarSpec): BarEl {
    let b = this.bars.get(spec.key);
    if (!b) {
      const fill = h('div', { class: 'bar-fill' });
      const val = h('span', { class: 'bar-val' });
      const label = h('span', { class: 'bar-label' }, spec.label);
      const root = h('div', { class: 'bar' }, label, h('div', { class: 'bar-track' }, fill), val);
      b = { root, label, fill, val };
      this.bars.set(spec.key, b);
    }
    return b;
  }

  update(f: HudFrame, dt: number): void {
    this.root.dataset.mode = f.mode;

    // Location
    if (f.location) {
      this.locBox.hidden = false;
      setText(this.locName, f.location.name);
      setText(this.locSub, f.location.sub);
      const cond = f.location.cond.join('  ·  ');
      setText(this.locCond, cond);
      this.locCond.classList.toggle('hazard', !!f.location.hazard);
    } else {
      this.locBox.hidden = true;
    }

    // Bars (rebuild order only when the set changes)
    const keys = f.bars.map((b) => b.key).join(',');
    if (this.barsBox.dataset.keys !== keys) {
      this.barsBox.replaceChildren(...f.bars.map((b) => this.bar(b).root));
      this.barsBox.dataset.keys = keys;
    }
    for (const spec of f.bars) {
      const b = this.bar(spec);
      setText(b.label, spec.label);
      const max = spec.max ?? 100;
      const pct = Math.max(0, Math.min(1, spec.value / max));
      setStyle(b.fill, 'transform', `scaleX(${pct.toFixed(3)})`);
      if (spec.color) setStyle(b.fill, 'background', spec.color);
      setText(b.val, spec.text ?? `${Math.round(spec.value)}`);
      b.root.classList.toggle('warn', !!spec.warn || pct < 0.2);
    }

    // Readouts
    while (this.readouts.length < f.readout.length) {
      const el = h('div', { class: 'readout' }, h('span', { class: 'ro-label' }), h('span', { class: 'ro-value' }));
      this.readouts.push(el);
      this.readoutBox.append(el);
    }
    this.readouts.forEach((el, i) => {
      const r = f.readout[i];
      el.hidden = !r;
      if (r) {
        setText(el.firstElementChild as HTMLElement, r.label);
        setText(el.lastElementChild as HTMLElement, r.value);
      }
    });
    this.readoutBox.hidden = f.readout.length === 0;

    // Compass
    if (f.heading !== null) {
      this.compass.hidden = false;
      const deg = ((f.heading * 180) / Math.PI + 360) % 360;
      setStyle(this.compassStrip, 'transform', `translateX(${(-deg * 2).toFixed(1)}px)`);
      while (this.compassMarkPool.length < f.compassMarkers.length) {
        const el = h('div', { class: 'cmark' });
        this.compassMarkPool.push(el);
        this.compassMarks.append(el);
      }
      this.compassMarkPool.forEach((el, i) => {
        const m = f.compassMarkers[i];
        if (!m) {
          el.hidden = true;
          return;
        }
        let rel = ((m.bearing - f.heading!) * 180) / Math.PI;
        rel = ((rel + 540) % 360) - 180;
        const x = Math.max(-100, Math.min(100, rel)) * 2;
        el.hidden = false;
        setStyle(el, 'transform', `translateX(${x.toFixed(1)}px)`);
        setStyle(el, 'color', m.color);
        setText(el, m.label ?? '◆');
      });
    } else {
      this.compass.hidden = true;
    }

    // Markers
    while (this.markerPool.length < f.markers.length) {
      const el = h('div', { class: 'marker' }, h('div', { class: 'm-icon' }), h('div', { class: 'm-label' }), h('div', { class: 'm-sub' }));
      this.markerPool.push(el);
      this.markersBox.append(el);
    }
    this.markerPool.forEach((el, i) => {
      const m = f.markers[i];
      if (!m) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.dataset.kind = m.kind;
      el.classList.toggle('offscreen', !!m.offscreen);
      setStyle(el, 'transform', `translate(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px)`);
      setStyle(el, 'color', m.color ?? '');
      setText(el.children[1] as HTMLElement, m.label);
      setText(el.children[2] as HTMLElement, m.sub ?? '');
    });

    // Center
    this.crosshair.dataset.kind = f.crosshair;
    this.prompt.hidden = !f.prompt;
    if (f.prompt) setText(this.prompt, f.prompt);
    if (f.stick) {
      this.stick.hidden = false;
      setStyle(this.stick.firstElementChild as HTMLElement, 'transform', `translate(${(f.stick[0] * 34).toFixed(1)}px, ${(f.stick[1] * 34).toFixed(1)}px)`);
    } else {
      this.stick.hidden = true;
    }
    this.heat.hidden = f.heat <= 0.001 && !f.overheated;
    setStyle(this.heatFill, 'transform', `scaleX(${f.heat.toFixed(3)})`);
    this.heat.classList.toggle('over', f.overheated);

    // Scan panel
    if (f.scan) {
      this.scanBox.hidden = false;
      setText(this.scanTitle, f.scan.title);
      setText(this.scanSub, f.scan.sub);
      setStyle(this.scanFill, 'transform', `scaleX(${f.scan.progress.toFixed(3)})`);
    } else {
      this.scanBox.hidden = true;
    }

    // Overlays
    setStyle(this.overlays.underwater, 'opacity', f.underwater ? '1' : '0');
    setStyle(this.overlays.visor, 'opacity', f.visor ? '1' : '0');
    setStyle(this.overlays.damage, 'opacity', Math.min(1, f.damage).toFixed(2));
    setStyle(this.overlays.reentry, 'opacity', Math.min(1, f.reentry).toFixed(2));
    setStyle(this.overlays.pulse, 'opacity', f.pulse ? '1' : '0');

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    this.fpsEl.hidden = f.fps === null;
    if (f.fps !== null) setText(this.fpsEl, `${Math.round(f.fps)} FPS`);
  }
}
