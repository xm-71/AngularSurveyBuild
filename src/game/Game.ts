import { Quaternion, Vector3 } from 'three';
import { AudioEngine } from '../engine/audio';
import { Input } from '../engine/input';
import { clamp, formatDistance, formatSpeed, quatFromForwardUp } from '../engine/math';
import { Rng } from '../engine/rng';
import { loadSettings, QUALITY_PRESETS, saveSettings, type Settings } from '../engine/settings';
import { loadJSON, removeKey, saveJSON } from '../engine/storage';
import { GenPool } from '../gfx/genPool';
import { createGlobalUniforms, type GlobalUniforms } from '../gfx/materials';
import { createRenderContext, resizeRenderContext, type RenderContext } from '../gfx/renderer';
import { buildShip, type ShipModel } from '../gfx/shipModel';
import { Sky } from '../gfx/sky';
import { GalaxyMap } from '../ui/GalaxyMap';
import { Hud, type BarSpec, type HudFrame, type MarkerSpec } from '../ui/Hud';
import { Menus } from '../ui/Menus';
import { TouchControls } from '../ui/Touch';
import { parseRefKey, startingSystem, summarize, type SystemSummary } from '../world/galaxy';
import { RESOURCES, type ResourceId } from '../world/resources';
import { Asteroids } from './Asteroids';
import { CameraRig } from './CameraRig';
import { Creatures } from './Creatures';
import { Discoveries } from './Discoveries';
import { Effects } from './Effects';
import { Flora } from './Flora';
import { Inventory, WARP_CELL } from './Inventory';
import { Mining } from './Mining';
import type { Planet } from './Planet';
import { Player } from './Player';
import { Scanner } from './Scanner';
import { Ship } from './Ship';
import { Survival } from './Survival';
import { Universe } from './Universe';
import { Warp } from './Warp';
import { Weather } from './Weather';

export type Mode = 'title' | 'loading' | 'play' | 'pause' | 'inventory' | 'log' | 'map' | 'warp' | 'dead';
export type Control = 'foot' | 'ship';

const SAVE_KEY = 'starwander.save.v1';

interface SaveData {
  v: 1;
  time: number;
  system: string;
  control: Control;
  player: { planet: number; pos: number[]; heading: number[]; pitch: number };
  ship: {
    state: 'landed' | 'flying';
    planet: number;
    localPos: number[];
    localQuat: number[];
    pos: number[];
    quat: number[];
    speed: number;
    shield: number;
    launchFuel: number;
    pulseFuel: number;
    warpCells: number;
  };
  survival: ReturnType<Survival['toJSON']>;
  inventory: ReturnType<Inventory['toJSON']>;
  discoveries: ReturnType<Discoveries['toJSON']>;
  mined: Record<string, number[]>;
  visited: string[];
}

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _q = new Quaternion();

export class Game {
  readonly ctx: RenderContext;
  readonly input: Input;
  readonly G: GlobalUniforms;
  readonly pool: GenPool;
  readonly sky: Sky;
  readonly universe: Universe;
  readonly hud: Hud;
  readonly menus: Menus;
  readonly map: GalaxyMap;
  readonly touch: TouchControls;
  readonly audio = new AudioEngine();
  readonly rig = new CameraRig();
  readonly inventory = new Inventory();
  readonly discoveries = new Discoveries();
  readonly survival = new Survival();
  readonly flora: Flora;
  readonly creatures: Creatures;
  readonly mining: Mining;
  readonly scanner: Scanner;
  readonly asteroids: Asteroids;
  readonly effects: Effects;
  readonly warp: Warp;
  readonly weather: Weather;
  settings: Settings;
  mode: Mode = 'title';
  control: Control = 'foot';
  time = 0;
  system!: SystemSummary;
  player!: Player;
  ship: Ship;
  shipModel: ShipModel;
  visited = new Set<string>();
  private lastNow = 0;
  private fps = 60;
  private autosave = 0;
  private cockpit = false;
  private titleAngle = 0;
  private loadingT = 0;
  private loadingStart = 0;
  private lastPlanetId: string | null = null;
  private lastInAtmo = false;
  private sizeKey = '';
  private camForward = new Vector3();
  private readonly shipPos = new Vector3();
  private readonly shipQuat = new Quaternion();

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.settings = loadSettings();
    const q = QUALITY_PRESETS[this.settings.quality];
    this.ctx = createRenderContext(canvas, q.pixelRatio);
    this.input = new Input(canvas);
    this.G = createGlobalUniforms();
    this.applyQualityUniforms();
    const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.pool = new GenPool(workers);
    this.sky = new Sky(this.ctx.renderer, 6000);
    this.ctx.scene.background = this.sky.texture;
    this.ctx.scene.add(this.sky.stars);
    this.universe = new Universe(this.ctx.scene, this.pool, this.G, q, this.sky);

    this.shipModel = buildShip(0x5eed, this.G, this.universe.local);
    this.ctx.scene.add(this.shipModel.group);
    this.ship = new Ship(this.shipModel);

    this.effects = new Effects(this.ctx.scene, this.G, this.universe.local);
    this.flora = new Flora(this.pool, this.G, this.universe.local, q);
    this.creatures = new Creatures(this.G, this.universe.local, q);
    this.mining = new Mining(this);
    this.scanner = new Scanner(this);
    this.asteroids = new Asteroids(this.ctx.scene, this.G, this.universe.local, q);
    this.warp = new Warp(this);
    this.weather = new Weather(this.ctx.scene, q.floraRadius > 300 ? 2000 : q.floraRadius > 200 ? 1400 : 800);

    this.hud = new Hud(uiRoot);
    this.hud.setVisible(false);
    this.map = new GalaxyMap(this, uiRoot);
    this.menus = new Menus(this, uiRoot);
    this.touch = new TouchControls(this, uiRoot);
    this.hud.root.classList.toggle('touch', this.touch.active);

    this.wireEvents();
    canvas.addEventListener('click', () => {
      if (this.mode === 'play' && !this.touch.active) this.input.requestPointerLock();
      this.audio.resume();
    });
    this.input.onPointerLockLost = () => {
      if (this.mode === 'play') this.setMode('pause');
    };
    this.discoveries.onAdd = (d) => {
      if (d.reward > 0) this.inventory.units += d.reward;
    };
  }

  // ---------------------------------------------------------------- setup

  private applyQualityUniforms(): void {
    const q = QUALITY_PRESETS[this.settings.quality];
    this.G.uAtmoSteps.value = q.atmoSamples;
    this.G.uSkySteps.value = q.skySamples;
    this.G.uCloudOctaves.value = q.cloudOctaves;
  }

  get quality() {
    return QUALITY_PRESETS[this.settings.quality];
  }

  setSettings(s: Partial<Settings>): void {
    const prevQ = this.settings.quality;
    this.settings = { ...this.settings, ...s };
    saveSettings(this.settings);
    this.ctx.camera.fov = this.settings.fov;
    this.ctx.camera.updateProjectionMatrix();
    this.audio.volume = this.settings.volume;
    if (s.quality && s.quality !== prevQ) {
      const q = this.quality;
      this.applyQualityUniforms();
      this.universe.setQuality(q);
      this.flora.setQuality(q);
      this.creatures.setQuality(q);
      this.asteroids.setQuality(q);
      this.sizeKey = '';
    }
  }

  private wireEvents(): void {
    this.ship.events = {
      message: (t, kind) => this.hud.toast(t, kind === 'warn' ? 'var(--warn)' : 'var(--text)', kind === 'warn' ? '!' : undefined),
      impact: (s) => {
        this.audio.impact(s);
        this.rig.shake = Math.min(1.5, this.rig.shake + s);
      },
      pulse: (on) => {
        this.audio.pulse(on);
        if (on) this.hud.toast('Pulse drive engaged', 'var(--scan)');
      },
      landed: () => {
        this.audio.land();
        this.onLanded();
      },
      takeoff: () => this.audio.takeoff(),
    };
    this.player = new Player(null as unknown as Planet);
    this.player.events = {
      onLand: (v) => {
        if (v > 14) this.survival.damage((v - 14) * 3.5);
        this.audio.step(1);
      },
      onJetpack: (on) => this.audio.jetpack(on),
      onStep: () => this.audio.step(0.5),
    };
    this.survival.onWarn = (t) => this.hud.toast(t, 'var(--warn)', '!');
  }

  /** Starts the render loop and shows the title screen. */
  start(): void {
    const save = loadJSON<SaveData>(SAVE_KEY);
    const summary = save ? this.summaryFromKey(save.system) : startingSystem();
    this.loadSystem(summary);
    this.ctx.camera.fov = this.settings.fov;
    this.audio.volume = this.settings.volume;
    this.menus.showTitle(!!save);
    requestAnimationFrame(this.frame);
  }

  private summaryFromKey(key: string): SystemSummary {
    try {
      return summarize(parseRefKey(key));
    } catch {
      return startingSystem();
    }
  }

  isStartingSystem(s: SystemSummary): boolean {
    return s.key === startingSystem().key;
  }

  loadSystem(summary: SystemSummary): void {
    this.flora.setPlanet(null);
    this.creatures.setPlanet(null);
    this.asteroids.clear();
    this.system = summary;
    this.universe.load(summary, this.isStartingSystem(summary));
    this.universe.updateRotations(this.time);
    this.asteroids.setSystem(this.universe.system);
    this.lastPlanetId = null;
  }

  // ---------------------------------------------------------------- journeys

  newGame(): void {
    removeKey(SAVE_KEY);
    this.time = 0;
    this.inventory.load({ items: { carbon: 60, iron: 40, sodium: 20, oxygen: 30, hydrogen: 25, tritium: 40 }, units: 1500 });
    this.discoveries.load([]);
    this.survival.load(undefined);
    this.flora.mined.clear();
    this.visited.clear();
    const start = startingSystem();
    if (this.system.key !== start.key) this.loadSystem(start);
    this.universe.updateRotations(this.time);
    const planet = this.universe.planets[0];
    const spot = this.findSpawn(planet, new Rng(planet.params.seed ^ 0x11));
    this.ship.shield = 100;
    this.ship.launchFuel = 100;
    this.ship.pulseFuel = 70;
    this.ship.warpCells = 1;
    this.ship.hyperdriveRange = 110;
    this.ship.placeLanded(planet, spot.dir, spot.heading);
    this.player.planet = planet;
    this.placePlayerBesideShip();
    this.control = 'foot';
    this.rig.setMode('foot', true);
    this.markVisitedSystem();
    this.beginLoading();
    window.setTimeout(() => {
      this.hud.showBanner(planet.params.name, `${planet.params.label} · ${planet.params.descriptor}`, 6);
      this.hud.toast(`Explore on foot, then press ${this.key('interact')} by your ship to board.`, 'var(--accent)', 'i');
    }, 1800);
  }

  continueGame(): boolean {
    const save = loadJSON<SaveData>(SAVE_KEY);
    if (!save || save.v !== 1) return false;
    try {
      this.applySave(save);
    } catch (e) {
      console.warn('Save could not be loaded', e);
      return false;
    }
    this.beginLoading();
    return true;
  }

  private beginLoading(): void {
    this.loadingT = 0;
    this.loadingStart = performance.now();
    this.setMode('loading');
    this.menus.showLoading('Charting the surface');
  }

  /** Pick a flat, dry spot in the morning sun. */
  findSpawn(planet: Planet, rng: Rng): { dir: Vector3; heading: Vector3 } {
    const sunL = planet.dirToLocal(planet.sunDir, new Vector3()).normalize();
    const t1 = new Vector3(0, 1, 0).cross(sunL).normalize();
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
    const t2 = new Vector3().crossVectors(sunL, t1);
    const sea = planet.params.seaLevel;
    let best: Vector3 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 400; i++) {
      const elev = rng.range(0.35, 0.75); // sun elevation proxy
      const az = rng.range(0, Math.PI * 2);
      const ang = Math.acos(elev);
      const d = sunL.clone().multiplyScalar(Math.cos(ang))
        .addScaledVector(t1, Math.sin(ang) * Math.cos(az))
        .addScaledVector(t2, Math.sin(ang) * Math.sin(az))
        .normalize();
      const h = planet.gen.height(d.x, d.y, d.z);
      if (sea !== null && h < sea + 6) continue;
      const n = planet.normalAtLocal(d, _v, 4);
      const flat = n.dot(d);
      if (flat < 0.9) continue;
      const cold = planet.gen.coldness(d.y, h - (sea ?? 0));
      const score = flat * 2 - Math.max(0, cold - 0.6) * 3 - Math.abs(elev - 0.55) + rng.next() * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    const dir = best ?? sunL.clone();
    const heading = new Vector3().crossVectors(dir, t1).normalize();
    return { dir, heading };
  }

  placePlayerBesideShip(): void {
    const planet = this.ship.planet!;
    this.player.planet = planet;
    const up = _v.copy(this.ship.localPos).normalize();
    const right = _v2.set(1, 0, 0).applyQuaternion(this.ship.localQuat);
    right.addScaledVector(up, -right.dot(up)).normalize();
    const spot = _v3.copy(this.ship.localPos).addScaledVector(right, 5.5).normalize();
    const heading = new Vector3().crossVectors(right, up).multiplyScalar(-1);
    // face the ship's nose direction
    const fwd = _v2.set(0, 0, -1).applyQuaternion(this.ship.localQuat);
    heading.copy(fwd).addScaledVector(up, -fwd.dot(up));
    this.player.placeAt(spot, heading.lengthSq() > 1e-6 ? heading.normalize() : undefined);
    this.player.pitch = -0.05;
  }

  // ---------------------------------------------------------------- mode

  setMode(m: Mode): void {
    const prev = this.mode;
    this.mode = m;
    const playing = m === 'play';
    this.hud.setVisible(m === 'play' || m === 'warp' || m === 'loading');
    this.input.enabled = playing;
    if (!playing) this.input.clearAll();
    if (m !== 'play' && m !== 'warp' && prev === 'play') this.input.exitPointerLock();
    this.touch.setVisible(playing && this.touch.active);
    this.menus.onMode(m, prev);
    if (m === 'map') this.map.open();
    else if (prev === 'map') this.map.close();
  }

  togglePanel(m: 'inventory' | 'log' | 'map'): void {
    if (this.mode === m) this.setMode('play');
    else if (this.mode === 'play' || this.mode === 'inventory' || this.mode === 'log' || this.mode === 'map') this.setMode(m);
  }

  // ---------------------------------------------------------------- loop

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    let dt = this.lastNow ? (now - this.lastNow) / 1000 : 1 / 60;
    this.lastNow = now;
    if (!(dt > 0)) dt = 1 / 60;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.1;
    dt = Math.min(dt, 0.05);
    this.tick(dt, true);
  };

  /** Advance the game by dt; `draw` renders a frame (off for debug fast-forward). */
  tick(dt: number, draw: boolean): void {

    const key = `${window.innerWidth}x${window.innerHeight}x${window.devicePixelRatio}`;
    if (key !== this.sizeKey) {
      this.sizeKey = key;
      resizeRenderContext(this.ctx, this.quality.pixelRatio);
      this.sky.pixelRatio = this.ctx.renderer.getPixelRatio();
      this.weather.pixelRatio = this.ctx.renderer.getPixelRatio();
      const px = window.innerHeight * this.ctx.renderer.getPixelRatio();
      this.universe.lodScale = Math.max(0.7, Math.min(1.5, px / 1000));
      this.effects.pixelRatio = this.ctx.renderer.getPixelRatio();
    }

    this.handleGlobalKeys();
    this.touch.update();
    this.menus.update(dt);
    this.updateAudio();

    if (this.mode === 'map') {
      if (draw) this.map.render(dt);
      this.input.endFrame();
      return;
    }

    if (this.mode === 'play' || this.mode === 'warp') this.time += dt;
    this.universe.updateRotations(this.time);

    switch (this.mode) {
      case 'play':
        this.simulate(dt);
        break;
      case 'warp':
        this.warp.update(dt);
        break;
      case 'loading':
        this.updateLoading(dt);
        break;
      case 'title':
        this.titleCamera(dt);
        break;
      default:
        this.updateCamera(0);
        break;
    }
    this.renderWorld(dt, draw);
    this.input.endFrame();
  }

  /** Debug helper: run the simulation for a while without drawing. */
  fastForward(seconds: number, step = 1 / 30): void {
    for (let t = 0; t < seconds; t += step) this.tick(step, false);
  }

  private updateAudio(): void {
    const inShip = this.control === 'ship' && (this.mode === 'play' || this.mode === 'warp');
    const planet = this.activePlanet;
    const atmo = planet?.params.atmosphere ? 1 : 0;
    const speed = inShip ? this.ship.relativeSpeed(this.universe) : this.player?.speed ?? 0;
    const speed01 = Math.min(1, speed / (inShip ? 400 : 12));
    const wind = this.mode === 'play' ? atmo * (inShip ? (this.ship.inAtmosphere ? 1 : 0) : 0.6) : 0;
    this.audio.update(inShip ? this.ship.thrust : 0, inShip, wind, speed01);
  }

  private handleGlobalKeys(): void {
    const i = this.input;
    // Esc that just released pointer lock already opened the pause menu.
    const escConsumed = performance.now() - i.lockLostAt < 400;
    if (i.wasPressed('menu') && !escConsumed) {
      if (this.mode === 'play') this.setMode('pause');
      else if (this.mode === 'pause' || this.mode === 'inventory' || this.mode === 'log' || this.mode === 'map') this.setMode('play');
    }
    if (this.mode === 'play' || this.mode === 'inventory' || this.mode === 'log' || this.mode === 'map') {
      if (i.wasPressed('inventory')) this.togglePanel('inventory');
      if (i.wasPressed('log')) this.togglePanel('log');
      if (i.wasPressed('map')) this.togglePanel('map');
    }
  }

  private updateLoading(dt: number): void {
    this.loadingT = (performance.now() - this.loadingStart) / 1000;
    this.updateCamera(dt);
    const planet = this.control === 'foot' ? this.player.planet : this.ship.planet;
    const settled = this.pool.pending < 6;
    if (planet && this.control === 'foot') {
      this.flora.setPlanet(planet);
      this.creatures.setPlanet(planet);
    }
    if ((settled && this.loadingT > 1.2) || this.loadingT > 12) {
      this.menus.hideLoading();
      this.setMode('play');
      this.audio.resume();
    }
  }

  private titleCamera(dt: number): void {
    this.titleAngle += dt * 0.025;
    const p = this.universe.planets[0];
    if (!p) return;
    const sunSide = _v.copy(p.sunDir);
    const side = _v2.set(-sunSide.z, 0, sunSide.x).normalize();
    const d = p.radius * 2.7;
    const pos = _v3.copy(p.center)
      .addScaledVector(sunSide, Math.cos(this.titleAngle) * d * 0.8)
      .addScaledVector(side, Math.sin(this.titleAngle) * d * 0.8 + d * 0.5)
      .addScaledVector(new Vector3(0, 1, 0), d * 0.25);
    this.rig.pos.copy(pos);
    const toPlanet = _v.copy(p.center).sub(pos).normalize();
    // offset the view so the planet sits on the right of the title text
    const right = _v2.crossVectors(toPlanet, new Vector3(0, 1, 0)).normalize();
    const look = toPlanet.clone().addScaledVector(right, -0.32).normalize();
    quatFromForwardUp(look, new Vector3(0, 1, 0), this.rig.quat);
  }

  // ---------------------------------------------------------------- simulation

  private simulate(dt: number): void {
    const input = this.input;
    const sens = this.settings.sensitivity;
    const inv = this.settings.invertY ? -1 : 1;

    if (this.control === 'foot') {
      const [dx, dy] = input.consumeLook();
      this.player.look(dx * 0.0022 * sens, dy * 0.0022 * sens * inv);
      const colliders = this.flora.colliders(this.player.pos, 6);
      if (this.ship.planet === this.player.planet && this.ship.state === 'landed') {
        colliders.push({ x: this.ship.localPos.x, y: this.ship.localPos.y, z: this.ship.localPos.z, radius: 2.4, height: 3 });
      }
      this.player.update(dt, input, colliders);
      this.player.jetpackBoost = 1 + 0.25 * this.inventory.upgradeLevel('jetpack');

      // Board the ship
      if (this.nearShip() && input.wasPressed('interact')) this.boardShip();
      if (input.wasPressed('torch')) this.G.uLamp.value = this.G.uLamp.value > 0.5 ? 0 : 1;
      this.mining.update(dt, input);
      this.scanner.update(dt, input);
      const p = this.player.planet;
      this.survival.update(dt, {
        inShip: false,
        planet: p.params,
        inLiquid: this.player.inLiquid,
        submerged: this.player.swimming,
        night: this.isNight(p, this.player.pos),
        hazardUpgrade: this.inventory.upgradeLevel('hazard'),
        storm: this.weather.storm,
      });
      if (this.survival.dead) this.die();
      this.ship.update(dt, null, this.universe, false, 1);
    } else {
      const flying = this.ship.state === 'flying';
      if (!flying) {
        const [dx, dy] = input.consumeLook();
        this.rig.orbitYaw -= dx * 0.004 * sens;
        this.rig.orbitPitch = clamp(this.rig.orbitPitch - dy * 0.004 * sens * inv, -1.2, 0.5);
      }
      this.ship.update(dt, flying ? input : null, this.universe, this.settings.invertY, sens);
      if (input.wasPressed('interact')) {
        if (this.ship.state === 'landed') this.exitShip();
        else if (this.ship.state === 'flying') this.ship.tryLand(this.universe);
      }
      if (input.wasPressed('jump') && this.ship.state === 'landed') this.ship.takeOff();
      if (input.wasPressed('pulse')) this.ship.togglePulse(this.universe);
      if (input.wasPressed('camera')) {
        this.cockpit = !this.cockpit;
        this.rig.setMode(this.cockpit ? 'cockpit' : 'chase');
      }
      this.asteroids.updateLasers(dt, input, this);
      this.survival.update(dt, { inShip: true, planet: null, inLiquid: 'none', submerged: false, night: false, hazardUpgrade: 0, storm: false });
      this.scanner.update(dt, input);
      this.mining.update(dt, null);
    }

    this.updateCamera(dt);
    this.updateLocation();
    this.autosave += dt;
    if (this.autosave > 20) {
      this.autosave = 0;
      this.save();
    }
  }

  updateCamera(dt: number): void {
    if (!this.player.planet) return;
    this.ship.worldPose(this.shipPos, this.shipQuat);
    if (this.control === 'foot') {
      const p = this.player.planet;
      p.toWorld(this.player.eyeLocal(_v), _v2);
      this.player.viewQuatLocal(_q);
      _q.premultiply(p.quat);
      this.rig.updateFoot(dt, _v2, _q);
    } else {
      const rel = this.ship.relativeSpeed(this.universe);
      this.rig.updateShip(dt, this.shipPos, this.shipQuat, rel, this.ship.state !== 'flying', this.shipModel.cockpit);
    }
    this.rig.shake = Math.max(this.rig.shake - dt * 2, this.ship.shake * 0.8 + this.ship.reentry * 0.6);
  }

  /** Control label for prompts: keyboard key on desktop, button name on touch. */
  key(action: 'interact' | 'jump' | 'pulse' | 'map' | 'mine'): string {
    const t = this.touch.active;
    switch (action) {
      case 'interact': return t ? 'Use' : 'E';
      case 'jump': return t ? 'Lift off' : 'Space';
      case 'pulse': return t ? 'Pulse' : 'J';
      case 'map': return t ? 'Map' : 'M';
      case 'mine': return t ? 'Mine' : 'LMB';
    }
  }

  nearShip(): boolean {
    if (this.ship.state !== 'landed' || this.ship.planet !== this.player.planet) return false;
    return this.player.pos.distanceTo(this.ship.localPos) < 9;
  }

  boardShip(): void {
    this.control = 'ship';
    this.cockpit = false;
    this.rig.setMode('chase');
    this.mining.stop();
    this.audio.board();
    this.hud.toast(`Press ${this.key('jump')} to take off`, 'var(--accent)', 'i');
  }

  exitShip(): void {
    if (this.ship.state !== 'landed') return;
    this.placePlayerBesideShip();
    this.control = 'foot';
    this.rig.setMode('foot');
    this.audio.board();
  }

  private onLanded(): void {
    const planet = this.ship.planet;
    if (!planet) return;
    this.discoverPlanet(planet);
  }

  private die(): void {
    this.mining.stop();
    this.setMode('dead');
  }

  respawn(): void {
    this.survival.load({ health: 100, lifeSupport: 70, hazard: 70 });
    if (this.ship.state === 'landed' && this.ship.planet) {
      this.placePlayerBesideShip();
      this.control = 'foot';
      this.rig.setMode('foot', true);
    } else {
      this.control = 'ship';
      this.rig.setMode('chase', true);
    }
    this.setMode('play');
  }

  isNight(planet: Planet, local: Vector3): boolean {
    const sunL = planet.dirToLocal(planet.sunDir, _v3);
    return sunL.dot(_v.copy(local).normalize()) < -0.05;
  }

  /** Planet the explorer is currently on or flying over. */
  get activePlanet(): Planet | null {
    if (this.control === 'foot') return this.player.planet;
    if (this.ship.state !== 'flying') return this.ship.planet;
    const near = this.universe.nearestPlanet(this.ship.pos);
    if (near && near.dist < near.planet.atmoRadius + near.planet.radius * 0.5) return near.planet;
    return null;
  }

  private updateLocation(): void {
    const planet = this.activePlanet;
    // Flora and creatures follow the explorer's planet.
    const focusPlanet = planet && (this.control === 'foot' || this.ship.altitude < 2500) ? planet : null;
    this.flora.setPlanet(focusPlanet);
    this.creatures.setPlanet(focusPlanet);

    const id = planet?.params.id ?? null;
    const inAtmo = !!planet && (this.control === 'foot' || this.ship.inAtmosphere || this.ship.state !== 'flying');
    if (id !== this.lastPlanetId || inAtmo !== this.lastInAtmo) {
      if (planet && inAtmo && (id !== this.lastPlanetId || !this.lastInAtmo)) {
        const p = planet.params;
        this.hud.showBanner(p.name, `${p.label} · ${p.descriptor}`);
        this.discoverPlanet(planet);
      }
      this.lastPlanetId = id;
      this.lastInAtmo = inAtmo;
    }
  }

  discoverPlanet(planet: Planet): void {
    const p = planet.params;
    const id = `planet:${p.id}`;
    if (this.discoveries.has(id)) return;
    const reward = 2500 + Math.round(p.radius / 10);
    this.discoveries.add({
      id,
      kind: 'planet',
      name: p.name,
      systemKey: this.system.key,
      systemName: this.system.name,
      planetId: p.id,
      planetName: p.name,
      details: [
        ['Biome', `${p.label} · ${p.descriptor}`],
        ['Weather', p.weather],
        ['Temperature', `${p.temperature} °C`],
        ['Flora', densityWord(p.floraDensity)],
        ['Fauna', densityWord(p.faunaDensity)],
        ['Rare resource', RESOURCES[p.rare].name],
      ],
      reward,
      time: Date.now(),
    });
    this.hud.toast(`Planet discovered: ${p.name}  +${reward.toLocaleString('en-US')} u`, 'var(--scan)', '◎');
    this.audio.discover();
  }

  markVisitedSystem(): void {
    const s = this.system;
    this.visited.add(s.key);
    const id = `system:${s.key}`;
    if (this.discoveries.has(id)) return;
    const sys = this.universe.system;
    this.discoveries.add({
      id,
      kind: 'system',
      name: s.name,
      systemKey: s.key,
      systemName: s.name,
      details: [
        ['Star', sys.starLabel],
        ['Planets', `${sys.planets.filter((p) => p.parent < 0).length} planets · ${sys.planets.filter((p) => p.parent >= 0).length} moons`],
      ],
      reward: 1000,
      time: Date.now(),
    });
  }

  // ---------------------------------------------------------------- crafting

  refuel(kind: 'launch' | 'pulse' | 'shield' | 'life' | 'hazard' | 'health'): void {
    const map: Record<string, { res: ResourceId; per: number; get: () => number; set: (v: number) => void }> = {
      launch: { res: 'hydrogen', per: 1, get: () => this.ship.launchFuel, set: (v) => (this.ship.launchFuel = v) },
      pulse: { res: 'tritium', per: 1, get: () => this.ship.pulseFuel, set: (v) => (this.ship.pulseFuel = v) },
      shield: { res: 'iron', per: 1, get: () => this.ship.shield, set: (v) => (this.ship.shield = v) },
      life: { res: 'oxygen', per: 2, get: () => this.survival.lifeSupport, set: (v) => (this.survival.lifeSupport = v) },
      hazard: { res: 'sodium', per: 2, get: () => this.survival.hazard, set: (v) => (this.survival.hazard = v) },
      health: { res: 'carbon', per: 1, get: () => this.survival.health, set: (v) => (this.survival.health = v) },
    };
    const m = map[kind];
    const missing = 100 - m.get();
    const needed = Math.ceil(missing / m.per);
    const have = this.inventory.count(m.res);
    const use = Math.min(needed, have);
    if (use <= 0) {
      this.hud.toast(missing <= 0.5 ? 'Already full.' : `Not enough ${RESOURCES[m.res].name}.`, 'var(--warn)', '!');
      return;
    }
    this.inventory.remove(m.res, use);
    m.set(Math.min(100, m.get() + use * m.per));
    this.audio.ui();
  }

  craftWarpCell(): void {
    if (this.ship.warpCells >= 5) {
      this.hud.toast('Warp cell storage full (5).', 'var(--warn)', '!');
      return;
    }
    if (!this.inventory.pay(WARP_CELL.cost)) {
      this.hud.toast('Missing materials for a Warp Cell.', 'var(--warn)', '!');
      return;
    }
    this.ship.warpCells++;
    this.hud.toast('Warp Cell crafted', 'var(--accent)', '◆');
    this.audio.ui();
  }

  buyUpgrade(id: string, price: number, max: number): void {
    const lvl = this.inventory.upgradeLevel(id);
    if (lvl >= max) return;
    if (this.inventory.units < price) {
      this.hud.toast('Not enough units.', 'var(--warn)', '!');
      return;
    }
    this.inventory.units -= price;
    this.inventory.upgrades[id] = lvl + 1;
    if (id === 'hyperdrive') this.ship.hyperdriveRange += 60;
    this.hud.toast('Upgrade installed', 'var(--accent)', '◆');
    this.audio.ui();
  }

  collect(res: ResourceId, n: number): number {
    const added = this.inventory.add(res, n);
    return added;
  }

  // ---------------------------------------------------------------- rendering

  private renderWorld(dt: number, draw = true): void {
    const cam = this.ctx.camera;
    cam.position.set(0, 0, 0);
    cam.quaternion.copy(this.rig.quat);
    const aspect = cam.aspect || 1;
    const minHFov = 64 * (Math.PI / 180);
    const portraitFov = (2 * Math.atan(Math.tan(minHFov / 2) / aspect) * 180) / Math.PI;
    const baseFov = Math.min(100, Math.max(this.settings.fov, portraitFov));
    const speedKick = this.control === 'ship' && this.ship.state === 'flying'
      ? Math.min(14, this.ship.relativeSpeed(this.universe) / 60) + (this.ship.pulse ? 12 : 0)
      : 0;
    const fov = baseFov + speedKick;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true);
    const camPos = this.rig.pos;
    this.universe.update(camPos, cam, this.time);

    // Ship model
    this.ship.worldPose(this.shipPos, this.shipQuat);
    const sm = this.shipModel.group;
    sm.position.copy(this.shipPos).sub(camPos);
    sm.quaternion.copy(this.shipQuat);
    sm.visible = !(this.control === 'ship' && this.rig.mode === 'cockpit' && !this.rig.transitioning) && this.mode !== 'title';

    this.mining.setVisible(this.mode === 'play' && this.control === 'foot' && !this.rig.transitioning);
    // Surface systems follow the camera.
    this.flora.update(camPos, dt);
    this.creatures.update(dt, this);
    this.asteroids.update(camPos, dt, this);
    this.effects.update(dt, camPos);
    this.weather.update(dt, this);

    // Globals
    this.G.uTime.value = this.time;
    cam.getWorldDirection(this.camForward);
    this.G.uLampDir.value.copy(this.camForward);
    const underwater = this.isCameraUnderwater();
    this.G.uUnderwater.value = underwater ? 1 : 0;
    const cur = this.universe.current;
    if (cur && underwater) {
      const c = cur.params.palette.liquidDeep;
      this.G.uUnderwaterColor.value.set(c[0] * 0.3, c[1] * 0.35, c[2] * 0.4);
    }
    // Stars fade near bright planets' day sides
    this.sky.fade = 1;

    this.pool.update(this.pool.usingWorkers ? 2 : 7);
    if (!draw) return;
    this.ctx.renderer.render(this.ctx.scene, cam);

    if (this.mode === 'play' || this.mode === 'warp' || this.mode === 'loading') this.hud.update(this.buildHud(underwater), dt);
  }

  isCameraUnderwater(): boolean {
    const cur = this.universe.current;
    if (!cur || cur.seaRadius === null || cur.params.liquid === 'ice') return false;
    return this.rig.pos.distanceTo(cur.center) < cur.seaRadius - 0.1;
  }

  // ---------------------------------------------------------------- HUD

  private project(worldRel: Vector3, out: { x: number; y: number; on: boolean }): void {
    const cam = this.ctx.camera;
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    _v3.copy(worldRel).applyMatrix4(cam.matrixWorldInverse);
    const behind = _v3.z > 0;
    _v3.applyMatrix4(cam.projectionMatrix);
    let x = _v3.x, y = _v3.y;
    if (behind) {
      x = -x;
      y = -y;
    }
    const on = !behind && Math.abs(x) <= 1 && Math.abs(y) <= 1;
    if (!on) {
      const m = Math.max(Math.abs(x), Math.abs(y), 1e-6);
      x = (x / m) * 0.92;
      y = (y / m) * 0.88;
    }
    out.x = (x * 0.5 + 0.5) * w;
    out.y = (-y * 0.5 + 0.5) * hgt;
    out.on = on;
  }

  private buildHud(underwater: boolean): HudFrame {
    const markers: MarkerSpec[] = [];
    const bars: BarSpec[] = [];
    const readout: { label: string; value: string }[] = [];
    const camPos = this.rig.pos;
    const pr = { x: 0, y: 0, on: false };
    let prompt: string | null = null;
    let heading: number | null = null;
    const compassMarkers: { bearing: number; color: string; label?: string }[] = [];
    const planet = this.activePlanet;
    const inSpace = this.control === 'ship' && this.ship.state === 'flying' && !this.ship.inAtmosphere && (!planet || this.ship.altitude > (planet.atmoRadius - planet.radius));

    if (this.control === 'foot') {
      const s = this.survival;
      bars.push({ key: 'health', label: 'Health', value: s.health });
      bars.push({ key: 'life', label: 'Life support', value: s.lifeSupport, color: 'var(--scan)' });
      const p = this.player.planet.params;
      if (p.hazard !== 'none') bars.push({ key: 'hazard', label: `${hazardName(p.hazard)} prot.`, value: s.hazard, color: '#ffd08a' });
      bars.push({ key: 'jet', label: 'Jetpack', value: this.player.jetpack * 100, color: 'var(--accent)' });
      readout.push({ label: 'Units', value: this.inventory.units.toLocaleString('en-US') });

      // Compass
      const pl = this.player;
      const up = _v.copy(pl.pos).normalize();
      const north = _v2.set(0, 1, 0).addScaledVector(up, -up.y).normalize();
      const east = new Vector3().crossVectors(north, up);
      const f = pl.viewDirLocal(new Vector3());
      heading = Math.atan2(f.dot(east), f.dot(north));
      const bearingOf = (target: Vector3): number => {
        const d = target.clone().sub(pl.pos);
        return Math.atan2(d.dot(east), d.dot(north));
      };
      if (this.ship.planet === pl.planet && this.ship.state === 'landed') {
        compassMarkers.push({ bearing: bearingOf(this.ship.localPos), color: 'var(--accent)', label: '▲' });
        const dist = pl.pos.distanceTo(this.ship.localPos);
        if (dist > 25) {
          this.project(_v.copy(this.shipPos).sub(camPos), pr);
          markers.push({ x: pr.x, y: pr.y, label: 'Ship', sub: formatDistance(dist), kind: 'ship', color: 'var(--accent)', offscreen: !pr.on });
        }
      }
      for (const m of this.scanner.markers) {
        const world = pl.planet.toWorld(m.local, _v3.set(0, 0, 0));
        const rel = world.sub(camPos);
        const dist = rel.length();
        this.project(rel, pr);
        if (pr.on) markers.push({ x: pr.x, y: pr.y, label: m.label, sub: formatDistance(dist), kind: m.kind, color: m.color });
        compassMarkers.push({ bearing: bearingOf(m.local), color: m.color, label: '◆' });
      }
      if (this.nearShip()) prompt = `${this.key('interact')} · Board ship`;
      else prompt = this.mining.prompt ?? this.scanner.prompt;
    } else {
      const sh = this.ship;
      bars.push({ key: 'shield', label: 'Shield', value: sh.shield });
      bars.push({ key: 'launch', label: 'Launch', value: sh.launchFuel, color: 'var(--accent)' });
      bars.push({ key: 'pulsef', label: 'Pulse fuel', value: sh.pulseFuel, color: 'var(--scan)' });
      bars.push({ key: 'warp', label: 'Warp cells', value: sh.warpCells, max: 5, text: `${sh.warpCells}`, warn: false, color: '#b9a7ff' });
      const speed = sh.relativeSpeed(this.universe);
      readout.push({ label: sh.pulse ? 'Pulse' : 'Speed', value: formatSpeed(speed) });
      if (!inSpace && sh.state !== 'landed') readout.push({ label: 'Altitude', value: formatDistance(Math.max(0, sh.altitude)) });
      const t = this.touch.active;
      if (sh.state === 'landed') prompt = t ? 'Lift off to launch · Exit to walk' : 'Space · Take off    E · Exit ship';
      else if (sh.state === 'flying' && sh.inAtmosphere && sh.altitude < 600 && !sh.pulse) prompt = t ? 'Land is ready' : 'E · Land';
      else if (sh.state === 'flying' && inSpace && !sh.pulse) prompt = t ? 'Pulse drive and galaxy map ready' : 'J · Pulse drive    M · Galaxy map';
      else if (sh.pulse) prompt = t ? 'Pulse again to drop out' : 'J · Disengage pulse';

      if (sh.state === 'flying') {
        // Planet markers
        for (const p of this.universe.planets) {
          const rel = _v.copy(p.center).sub(camPos);
          const dist = rel.length() - p.radius;
          if (planet === p && !inSpace) continue;
          this.project(rel, pr);
          markers.push({
            x: pr.x, y: pr.y, label: p.params.name, sub: `${p.params.label} · ${formatDistance(Math.max(0, dist))}`,
            kind: 'planet', color: this.discoveries.has(`planet:${p.params.id}`) ? 'var(--scan)' : 'var(--text)', offscreen: !pr.on,
          });
        }
        if (inSpace) {
          const rel = _v.set(0, 0, 0).sub(camPos);
          this.project(rel, pr);
          if (pr.on) markers.push({ x: pr.x, y: pr.y, label: this.system.name, sub: formatDistance(rel.length()), kind: 'star', color: '#ffd9a0' });
        }
        for (const m of this.asteroids.markers) markers.push(m);
      }
    }

    let location: HudFrame['location'] = null;
    if (planet && !inSpace) {
      const p = planet.params;
      const cond = [this.weather.storm ? `Storm · ${p.weather}` : p.weather, `${p.temperature} °C`];
      if (p.hazard !== 'none') cond.push(`${hazardName(p.hazard)} hazard`);
      location = { name: p.name, sub: `${p.label} · ${p.descriptor}`, cond, hazard: p.hazard !== 'none' ? p.hazard : undefined };
    } else {
      const sys = this.universe.system;
      location = {
        name: `${this.system.name} system`,
        sub: sys.starLabel,
        cond: [`${sys.planets.length} bodies`, this.visited.size > 1 ? `${this.visited.size} systems visited` : 'Home system'],
      };
    }

    const minePrompt = this.control === 'ship' && inSpace && this.ship.state === 'flying' ? this.asteroids.prompt : null;
    return {
      mode: this.control,
      location,
      bars,
      readout,
      heading,
      compassMarkers,
      markers,
      prompt: minePrompt ?? prompt,
      crosshair: this.control === 'ship' ? (this.ship.state === 'flying' ? 'ship' : 'none') : this.scanner.visor ? 'scan' : this.mining.targeting ? 'mine' : 'dot',
      stick: this.control === 'ship' && this.ship.state === 'flying' ? [this.ship.stick.x, this.ship.stick.y] : null,
      heat: this.control === 'foot' ? this.mining.heat : this.asteroids.heat,
      overheated: this.control === 'foot' ? this.mining.overheated : this.asteroids.overheated,
      scan: this.scanner.panel,
      underwater,
      visor: this.scanner.visor,
      damage: this.survival.damageFlash,
      reentry: this.control === 'ship' ? this.ship.reentry : 0,
      fps: this.settings.showFps ? this.fps : null,
      pulse: this.ship.pulse && this.control === 'ship',
    };
  }

  // ---------------------------------------------------------------- save

  save(): void {
    if (this.mode === 'title' || !this.player.planet) return;
    if (this.ship.state === 'takeoff' || this.ship.state === 'landing') return;
    const planets = this.universe.planets;
    const idx = (p: Planet | null) => (p ? planets.indexOf(p) : -1);
    const mined: Record<string, number[]> = {};
    for (const [k, set] of this.flora.mined) mined[k] = [...set].slice(-3000);
    const data: SaveData = {
      v: 1,
      time: this.time,
      system: this.system.key,
      control: this.control,
      player: { planet: idx(this.player.planet), pos: this.player.pos.toArray(), heading: this.player.heading.toArray(), pitch: this.player.pitch },
      ship: {
        state: this.ship.state === 'flying' ? 'flying' : 'landed',
        planet: idx(this.ship.planet),
        localPos: this.ship.localPos.toArray(),
        localQuat: this.ship.localQuat.toArray(),
        pos: this.ship.pos.toArray(),
        quat: this.ship.quat.toArray(),
        speed: this.ship.speed,
        shield: this.ship.shield,
        launchFuel: this.ship.launchFuel,
        pulseFuel: this.ship.pulseFuel,
        warpCells: this.ship.warpCells,
      },
      survival: this.survival.toJSON(),
      inventory: this.inventory.toJSON(),
      discoveries: this.discoveries.toJSON(),
      mined,
      visited: [...this.visited],
    };
    saveJSON(SAVE_KEY, data);
  }

  snapshot(): unknown {
    this.save();
    return loadJSON<SaveData>(SAVE_KEY);
  }

  private applySave(s: SaveData): void {
    const summary = this.summaryFromKey(s.system);
    this.time = s.time ?? 0;
    if (this.system.key !== summary.key) this.loadSystem(summary);
    this.universe.updateRotations(this.time);
    const planets = this.universe.planets;
    this.inventory.load(s.inventory);
    this.discoveries.load(s.discoveries);
    this.survival.load(s.survival);
    this.visited = new Set(s.visited ?? [summary.key]);
    this.flora.mined.clear();
    for (const [k, list] of Object.entries(s.mined ?? {})) this.flora.mined.set(k, new Set(list));
    const sh = s.ship;
    this.ship.shield = sh.shield;
    this.ship.launchFuel = sh.launchFuel;
    this.ship.pulseFuel = sh.pulseFuel;
    this.ship.warpCells = sh.warpCells;
    this.ship.hyperdriveRange = 110 + 60 * this.inventory.upgradeLevel('hyperdrive');
    if (sh.state === 'landed' && planets[sh.planet]) {
      this.ship.planet = planets[sh.planet];
      this.ship.localPos.fromArray(sh.localPos);
      this.ship.localQuat.fromArray(sh.localQuat);
      this.ship.state = 'landed';
      const minR = this.ship.planet.groundRadiusAtLocal(this.ship.localPos) + this.shipModel.gearHeight * 0.8;
      if (this.ship.localPos.length() < minR) this.ship.localPos.setLength(minR + 0.2);
    } else {
      this.ship.placeFlying(new Vector3().fromArray(sh.pos), new Quaternion().fromArray(sh.quat), sh.speed ?? 0);
    }
    const pp = planets[s.player.planet] ?? this.ship.planet ?? planets[0];
    this.player.planet = pp;
    this.player.pos.fromArray(s.player.pos);
    this.player.vel.set(0, 0, 0);
    this.player.heading.fromArray(s.player.heading);
    this.player.pitch = s.player.pitch ?? 0;
    // Guard against a save made while falling through unloaded terrain.
    const gr = pp.groundRadiusAtLocal(this.player.pos);
    if (this.player.pos.length() < gr) this.player.pos.setLength(gr + 0.1);
    this.control = s.control === 'ship' ? 'ship' : 'foot';
    this.rig.setMode(this.control === 'ship' ? 'chase' : 'foot', true);
  }

  /** Called by the warp sequence once the new system is loaded. */
  arriveInSystem(summary: SystemSummary): void {
    this.loadSystem(summary);
    const sys = this.universe.system;
    const pos = new Vector3(...sys.arrival);
    const target = this.universe.planets[sys.arrivalTarget];
    const q = quatFromForwardUp(_v.copy(target.center).sub(pos).normalize(), new Vector3(0, 1, 0), new Quaternion());
    this.ship.placeFlying(pos, q, 300);
    this.player.planet = target;
    this.control = 'ship';
    this.cockpit = false;
    this.rig.setMode('chase', true);
    this.markVisitedSystem();
    this.hud.showBanner(summary.name, `${sys.starLabel} · ${sys.planets.length} bodies`, 6);
    this.save();
  }
}

function densityWord(d: number): string {
  if (d < 0.05) return 'None';
  if (d < 0.35) return 'Sparse';
  if (d < 0.7) return 'Moderate';
  return 'Abundant';
}

export function hazardName(h: string): string {
  return { heat: 'Heat', cold: 'Cold', toxic: 'Toxic', radiation: 'Radiation', none: 'None' }[h] ?? h;
}

