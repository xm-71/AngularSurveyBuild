// Procedural sound: everything is synthesised with WebAudio, so the game ships
// without audio files. The context starts on the first user gesture.

type Ctx = AudioContext;

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private vol = 0.6;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private loops = new Map<string, { stop: () => void }>();

  set volume(v: number) {
    this.vol = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v * 0.5, this.ctx.currentTime, 0.05);
  }

  resume(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.vol * 0.5;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.startBeds();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private noiseSource(): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noise) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  private startBeds(): void {
    const c = this.ctx!;
    // Ship engine: low saw + filtered noise
    this.engineOsc = c.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 48;
    this.engineFilter = c.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 300;
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    const en = this.noiseSource()!;
    const enf = c.createBiquadFilter();
    enf.type = 'lowpass';
    enf.frequency.value = 500;
    const eng = c.createGain();
    eng.gain.value = 0.6;
    en.connect(enf).connect(eng).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master!);
    this.engineOsc.start();
    en.start();
    // Wind
    const wn = this.noiseSource()!;
    this.windFilter = c.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.6;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0;
    wn.connect(this.windFilter).connect(this.windGain).connect(this.master!);
    wn.start();
  }

  /** Continuous beds, call every frame. */
  update(thrust: number, inShip: boolean, wind: number, speed01: number): void {
    const c = this.ctx;
    if (!c || !this.engineGain || !this.engineOsc || !this.engineFilter || !this.windGain || !this.windFilter) return;
    const t = c.currentTime;
    const eg = inShip ? 0.05 + thrust * 0.16 : 0;
    this.engineGain.gain.setTargetAtTime(eg, t, 0.15);
    this.engineOsc.frequency.setTargetAtTime(42 + thrust * 40 + speed01 * 30, t, 0.2);
    this.engineFilter.frequency.setTargetAtTime(220 + thrust * 900 + speed01 * 600, t, 0.2);
    const wg = wind * (0.05 + speed01 * 0.25) * (0.8 + 0.2 * Math.sin(t * 0.7));
    this.windGain.gain.setTargetAtTime(wg, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(300 + speed01 * 900 + Math.sin(t * 0.37) * 60, t, 0.3);
  }

  private env(node: AudioNode, gain: number, attack: number, decay: number): GainNode | null {
    const c = this.ctx;
    if (!c || !this.master) return null;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g).connect(this.master);
    return g;
  }

  private tone(type: OscillatorType, f0: number, f1: number, gain: number, dur: number, attack = 0.01): void {
    const c = this.ctx;
    if (!c) return;
    const o = c.createOscillator();
    o.type = type;
    const t = c.currentTime;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    this.env(o, gain, attack, dur);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  private burst(freq: number, q: number, gain: number, dur: number, type: BiquadFilterType = 'bandpass'): void {
    const c = this.ctx;
    const s = this.noiseSource();
    if (!c || !s) return;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    s.connect(f);
    this.env(f, gain, 0.005, dur);
    const t = c.currentTime;
    s.start(t, Math.random());
    s.stop(t + dur + 0.1);
  }

  private loop(key: string, on: boolean, make: () => { stop: () => void } | null): void {
    const cur = this.loops.get(key);
    if (on && !cur) {
      const l = make();
      if (l) this.loops.set(key, l);
    } else if (!on && cur) {
      cur.stop();
      this.loops.delete(key);
    }
  }

  private makeLoop(build: (c: Ctx, out: GainNode) => AudioScheduledSourceNode[], level: number): { stop: () => void } | null {
    const c = this.ctx;
    if (!c || !this.master) return null;
    const g = c.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(level, c.currentTime + 0.08);
    g.connect(this.master);
    const srcs = build(c, g);
    srcs.forEach((s) => s.start());
    return {
      stop: () => {
        const t = c.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        srcs.forEach((s) => s.stop(t + 0.15));
      },
    };
  }

  jetpack(on: boolean): void {
    this.loop('jet', on, () => this.makeLoop((c, out) => {
      const s = this.noiseSource()!;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      s.connect(f).connect(out);
      return [s];
    }, 0.22));
  }

  mining(on: boolean): void {
    this.loop('mine', on, () => this.makeLoop((c, out) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 210;
      const lfo = c.createOscillator();
      lfo.frequency.value = 13;
      const lg = c.createGain();
      lg.gain.value = 18;
      lfo.connect(lg).connect(o.frequency);
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 1.2;
      o.connect(f).connect(out);
      const s = this.noiseSource()!;
      const hf = c.createBiquadFilter();
      hf.type = 'highpass';
      hf.frequency.value = 3000;
      const ng = c.createGain();
      ng.gain.value = 0.25;
      s.connect(hf).connect(ng).connect(out);
      return [o, lfo, s];
    }, 0.12));
  }

  laser(on: boolean): void {
    this.loop('laser', on, () => this.makeLoop((c, out) => {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = 140;
      const lfo = c.createOscillator();
      lfo.frequency.value = 24;
      const lg = c.createGain();
      lg.gain.value = 40;
      lfo.connect(lg).connect(o.frequency);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      o.connect(f).connect(out);
      return [o, lfo];
    }, 0.09));
  }

  pulse(on: boolean): void {
    if (on) this.tone('sine', 90, 520, 0.25, 1.2, 0.05);
    else this.tone('sine', 400, 70, 0.2, 0.8, 0.02);
  }

  step(v: number): void {
    this.burst(260 + Math.random() * 120, 1.4, 0.05 * v + 0.02, 0.09, 'lowpass');
  }

  impact(s: number): void {
    this.burst(120, 0.8, 0.25 + s * 0.4, 0.5, 'lowpass');
  }

  land(): void {
    this.burst(160, 0.7, 0.3, 0.7, 'lowpass');
  }

  takeoff(): void {
    this.tone('sawtooth', 50, 140, 0.18, 2.2, 0.3);
    this.burst(400, 0.5, 0.25, 2.0, 'lowpass');
  }

  board(): void {
    this.tone('sine', 520, 780, 0.12, 0.18);
    window.setTimeout(() => this.tone('sine', 780, 1040, 0.1, 0.2), 90);
  }

  collect(): void {
    this.tone('triangle', 880, 1320, 0.14, 0.15);
    window.setTimeout(() => this.tone('triangle', 1320, 1760, 0.1, 0.18), 70);
  }

  discover(): void {
    [660, 880, 1100, 1480].forEach((f, i) => window.setTimeout(() => this.tone('sine', f, f * 1.01, 0.12, 0.35), i * 90));
  }

  scan(): void {
    this.tone('sine', 1400, 300, 0.16, 1.2, 0.01);
  }

  ui(): void {
    this.tone('square', 1200, 1100, 0.04, 0.05);
  }

  explode(): void {
    this.burst(90, 0.6, 0.6, 1.4, 'lowpass');
    this.burst(900, 0.6, 0.2, 0.4, 'bandpass');
  }

  warp(): void {
    this.tone('sawtooth', 40, 900, 0.22, 2.4, 0.4);
    window.setTimeout(() => this.burst(600, 0.4, 0.45, 3.5, 'lowpass'), 2200);
  }
}
