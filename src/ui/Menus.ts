import { formatInt } from '../engine/math';
import type { Quality } from '../engine/settings';
import type { Mode } from '../game/Game';
import type { Game } from '../game/Game';
import { UPGRADES, WARP_CELL } from '../game/Inventory';
import { RESOURCES, type ResourceId } from '../world/resources';
import { clear, h, setText } from './dom';

const CONTROLS_DESKTOP: [string, string][] = [
  ['Move / throttle', 'W A S D'],
  ['Look / steer', 'Mouse'],
  ['Jump · jetpack (hold)', 'Space'],
  ['Sprint · ship boost', 'Shift'],
  ['Board / exit / land', 'E'],
  ['Take off', 'Space (in ship)'],
  ['Roll ship', 'A / D'],
  ['Mine · ship lasers', 'Left mouse or R'],
  ['Scanner pulse', 'C'],
  ['Analysis visor', 'F'],
  ['Pulse drive', 'J'],
  ['Galaxy map', 'M'],
  ['Inventory', 'Tab or I'],
  ['Discovery log', 'L'],
  ['Cockpit / chase view', 'V'],
  ['Torch', 'G'],
  ['Pause', 'Esc or P'],
];

const CONTROLS_TOUCH: [string, string][] = [
  ['Move / throttle', 'Left stick'],
  ['Look / steer', 'Drag right side'],
  ['Jump · jetpack', 'Jet button'],
  ['Board / exit / land', 'Use button'],
  ['Mine · ship lasers', 'Mine button (hold)'],
  ['Scanner / visor', 'Scan · Visor'],
  ['Pulse drive, map, bag, log', 'Top-right buttons'],
];

/** Title, pause, settings, inventory, discovery log and death screens. */
export class Menus {
  private title: HTMLElement;
  private titleButtons: HTMLElement;
  private loading: HTMLElement;
  private loadingText: HTMLElement;
  private pause: HTMLElement;
  private pauseBody: HTMLElement;
  private inventory: HTMLElement;
  private invBody: HTMLElement;
  private log: HTMLElement;
  private logBody: HTMLElement;
  private dead: HTMLElement;
  private logTab = 'all';
  private invTimer = 0;

  constructor(private game: Game, parent: HTMLElement) {
    this.titleButtons = h('div', { class: 'btn-row' });
    this.loadingText = h('div', { class: 'loading-line' });
    this.title = h(
      'div',
      { class: 'screen title-screen' },
      h(
        'div',
        { class: 'title-block' },
        h('div', { class: 'eyebrow' }, 'A procedural exploration game'),
        h('h1', { class: 'title-mark' }, 'Starwander', h('span', null, 'Endless galaxy')),
        h(
          'p',
          { class: 'title-copy' },
          'Walk alien worlds, lift off and fly straight into orbit and on to the next planet with no loading screens. Mine, scan the wildlife, craft warp cells and jump to a new star.',
        ),
        h(
          'div',
          { class: 'title-facts' },
          h('div', { class: 'fact' }, h('b', null, '11'), 'planet biomes'),
          h('div', { class: 'fact' }, h('b', null, '5'), 'star classes'),
          h('div', { class: 'fact' }, h('b', null, '∞'), 'seeded systems'),
        ),
        this.titleButtons,
        this.loadingText,
        h('div', { class: 'title-hint' }, 'Keyboard and mouse on desktop · on-screen controls on touch devices. Progress saves in this browser.'),
      ),
    );
    this.loading = h('div', { class: 'screen', style: 'background: rgba(6,9,15,0.92); pointer-events:auto' },
      h('div', { class: 'title-block', style: 'text-align:center; justify-items:center' },
        h('div', { class: 'eyebrow' }, 'Starwander'),
        h('div', { class: 'panel-title' }, 'Arriving'),
        this.loadingText.cloneNode() as HTMLElement,
      ));
    this.loadingText = this.loading.querySelector('.loading-line') as HTMLElement;
    this.loading.hidden = true;

    this.pauseBody = h('div');
    this.pause = h('div', { class: 'screen' }, h('div', { class: 'panel' }, this.pauseBody));
    this.pause.hidden = true;
    this.invBody = h('div');
    this.inventory = h('div', { class: 'screen' }, h('div', { class: 'panel', style: 'width:min(860px,100%)' }, this.invBody));
    this.inventory.hidden = true;
    this.logBody = h('div');
    this.log = h('div', { class: 'screen' }, h('div', { class: 'panel', style: 'width:min(820px,100%)' }, this.logBody));
    this.log.hidden = true;
    this.dead = h(
      'div',
      { class: 'screen dead-screen' },
      h('div', { class: 'panel', style: 'width:min(460px,100%); text-align:center' },
        h('div', { class: 'eyebrow', style: 'color:var(--warn)' }, 'Exosuit failure'),
        h('div', { class: 'panel-title', style: 'margin:10px 0 6px' }, 'You blacked out'),
        h('p', { style: 'color:var(--muted); margin:0 0 6px' }, 'Your suit dragged you back to the ship. Keep life support and hazard protection topped up.'),
        h('div', { class: 'btn-row', style: 'justify-content:center' }, h('button', { class: 'btn primary', type: 'button', onclick: () => this.game.respawn() }, 'Respawn at ship')),
      ),
    );
    this.dead.hidden = true;
    parent.append(this.title, this.pause, this.inventory, this.log, this.dead, this.loading);
    for (const el of [this.pause, this.inventory, this.log]) {
      el.addEventListener('pointerdown', (e) => {
        if (e.target === el) this.game.setMode('play');
      });
    }
  }

  showTitle(hasSave: boolean): void {
    clear(this.titleButtons);
    if (hasSave) {
      this.titleButtons.append(h('button', { class: 'btn primary', type: 'button', onclick: () => this.start(false) }, 'Continue journey'));
      this.titleButtons.append(h('button', { class: 'btn', type: 'button', onclick: () => this.confirmNew() }, 'New journey'));
    } else {
      this.titleButtons.append(h('button', { class: 'btn primary', type: 'button', onclick: () => this.start(true) }, 'Begin journey'));
    }
    this.titleButtons.append(h('button', { class: 'btn', type: 'button', onclick: () => this.openSettingsFromTitle() }, 'Settings'));
    this.title.hidden = false;
  }

  private confirmNew(): void {
    clear(this.titleButtons);
    this.titleButtons.append(
      h('span', { style: 'align-self:center; color:var(--muted)' }, 'Erase your saved journey?'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => this.start(true) }, 'Start over'),
      h('button', { class: 'btn', type: 'button', onclick: () => this.showTitle(true) }, 'Keep it'),
    );
  }

  private start(fresh: boolean): void {
    this.game.audio.resume();
    this.title.hidden = true;
    if (fresh || !this.game.continueGame()) this.game.newGame();
    if (!this.game.touch.active) this.game.input.requestPointerLock();
  }

  private openSettingsFromTitle(): void {
    this.title.hidden = true;
    this.game.setMode('pause');
    this.renderPause('settings', true);
  }

  showLoading(text: string): void {
    this.loading.hidden = false;
    setText(this.loadingText, text);
  }

  hideLoading(): void {
    this.loading.hidden = true;
  }

  onMode(m: Mode, _prev: Mode): void {
    this.pause.hidden = m !== 'pause';
    this.inventory.hidden = m !== 'inventory';
    this.log.hidden = m !== 'log';
    this.dead.hidden = m !== 'dead';
    if (m === 'pause') this.renderPause('main');
    if (m === 'inventory') this.renderInventory();
    if (m === 'log') this.renderLog();
    if (m === 'title') this.title.hidden = false;
  }

  // -------------------------------------------------------------- pause

  private renderPause(view: 'main' | 'settings' | 'controls', fromTitle = false): void {
    const g = this.game;
    clear(this.pauseBody);
    const back = () => {
      if (fromTitle) {
        this.pause.hidden = true;
        g.mode = 'title';
        this.title.hidden = false;
      } else this.renderPause('main');
    };
    if (view === 'main') {
      this.pauseBody.append(
        h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Paused'), h('span', { class: 'panel-meta' }, `${g.system.name} system`)),
        h('div', { class: 'btn-row', style: 'margin-top:0' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => this.resume() }, 'Resume'),
          h('button', { class: 'btn', type: 'button', onclick: () => this.renderPause('controls') }, 'Controls'),
          h('button', { class: 'btn', type: 'button', onclick: () => this.renderPause('settings') }, 'Settings'),
          h('button', { class: 'btn', type: 'button', onclick: () => { g.save(); g.hud.toast('Journey saved', 'var(--ok)'); this.resume(); } }, 'Save'),
        ),
        h('div', { class: 'section-title' }, 'Journey'),
        h('p', { style: 'color:var(--muted); margin:0' },
          `${formatInt(g.inventory.units)} units · ${g.discoveries.size} discoveries · ${g.visited.size} ${g.visited.size === 1 ? 'system' : 'systems'} visited. Progress autosaves every 20 seconds.`),
      );
      return;
    }
    if (view === 'controls') {
      const list = g.touch.active ? CONTROLS_TOUCH : CONTROLS_DESKTOP;
      this.pauseBody.append(
        h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Controls'), h('span', { class: 'panel-meta' }, g.touch.active ? 'Touch' : 'Keyboard & mouse')),
        h('div', { class: 'controls' }, ...list.map(([a, k]) => h('div', { class: 'control-row' }, h('span', null, a), h('kbd', null, k)))),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: back }, 'Back')),
      );
      return;
    }
    const s = g.settings;
    const seg = (value: Quality) =>
      h('button', {
        type: 'button', 'aria-pressed': String(s.quality === value), onclick: () => { g.setSettings({ quality: value }); this.renderPause('settings', fromTitle); },
      }, value);
    const range = (id: string, min: number, max: number, step: number, value: number, on: (v: number) => void) => {
      const el = h('input', { id, type: 'range', min, max, step, value }) as HTMLInputElement;
      el.addEventListener('input', () => on(Number(el.value)));
      return el;
    };
    const check = (id: string, value: boolean, on: (v: boolean) => void) => {
      const el = h('input', { id, type: 'checkbox' }) as HTMLInputElement;
      el.checked = value;
      el.addEventListener('change', () => on(el.checked));
      return el;
    };
    this.pauseBody.append(
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Settings')),
      h('div', { class: 'setting' }, h('label', null, 'Graphics quality', h('small', null, 'Lower settings stream less terrain and flora.')), h('div', { class: 'seg' }, seg('low'), seg('medium'), seg('high'))),
      h('div', { class: 'setting' }, h('label', { for: 'sens' }, 'Look sensitivity'), range('sens', 0.3, 2.5, 0.05, s.sensitivity, (v) => g.setSettings({ sensitivity: v }))),
      h('div', { class: 'setting' }, h('label', { for: 'fov' }, 'Field of view'), range('fov', 55, 100, 1, s.fov, (v) => g.setSettings({ fov: v }))),
      h('div', { class: 'setting' }, h('label', { for: 'vol' }, 'Volume'), range('vol', 0, 1, 0.05, s.volume, (v) => g.setSettings({ volume: v }))),
      h('div', { class: 'setting' }, h('label', { for: 'inv' }, 'Invert look Y'), check('inv', s.invertY, (v) => g.setSettings({ invertY: v }))),
      h('div', { class: 'setting' }, h('label', { for: 'fps' }, 'Show frame rate'), check('fps', s.showFps, (v) => g.setSettings({ showFps: v }))),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: back }, 'Back')),
    );
  }

  private resume(): void {
    this.game.setMode('play');
    if (!this.game.touch.active) this.game.input.requestPointerLock();
  }

  // -------------------------------------------------------------- inventory

  update(dt: number): void {
    if (this.game.mode === 'inventory') {
      this.invTimer += dt;
      if (this.invTimer > 0.5) {
        this.invTimer = 0;
        this.renderInventory();
      }
    }
  }

  renderInventory(): void {
    const g = this.game;
    const inv = g.inventory;
    clear(this.invBody);
    const costText = (res: ResourceId, n: number) => {
      const have = inv.count(res);
      return h('span', { class: have < n ? 'short' : '' }, `${n} ${RESOURCES[res].symbol} (${have})`);
    };
    const meter = (v: number) => h('span', { class: 'meter' }, h('i', { style: `width:${Math.max(0, Math.min(100, v))}%` }));
    const refill = (label: string, value: number, res: ResourceId, per: number, kind: Parameters<Game['refuel']>[0]) => {
      const need = Math.ceil((100 - value) / per);
      return h('div', { class: 'action' },
        h('div', null,
          h('div', { class: 'action-name' }, label, meter(value)),
          h('div', { class: 'cost' }, `${Math.round(value)}% · refill uses `, costText(res, Math.max(0, need))),
        ),
        h('button', { class: 'btn small', type: 'button', disabled: value >= 99.5 || inv.count(res) === 0, onclick: () => { g.refuel(kind); this.renderInventory(); } }, 'Recharge'),
      );
    };
    const warpCost = Object.entries(WARP_CELL.cost) as [ResourceId, number][];
    this.invBody.append(
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, 'Inventory'),
        h('span', { class: 'panel-meta' }, h('span', { class: 'units' }, `${formatInt(inv.units)} u`), ` · cargo value ${formatInt(inv.value())} u`)),
      h('div', { class: 'section-title', style: 'margin-top:0' }, 'Resources'),
      inv.list().length
        ? h('div', { class: 'inv-grid' }, ...inv.list().map(({ id, n }) => {
          const r = RESOURCES[id];
          return h('div', { class: 'slot', style: `color:${r.color}`, title: r.description },
            h('span', { class: 'slot-sym' }, r.symbol),
            h('span', { class: 'slot-name' }, r.name),
            h('span', { class: 'slot-n', style: 'color:var(--text)' }, String(n)),
            h('span', { class: 'slot-bar', style: `width:${(n / 500) * 100}%` }));
        }))
        : h('p', { class: 'empty-note' }, 'Empty. Mine plants, rocks and crystals with your multi-tool.'),
      h('div', { class: 'section-title' }, 'Exosuit'),
      h('div', { class: 'action-list' },
        refill('Health', g.survival.health, 'carbon', 1, 'health'),
        refill('Life support', g.survival.lifeSupport, 'oxygen', 2, 'life'),
        refill('Hazard protection', g.survival.hazard, 'sodium', 2, 'hazard'),
      ),
      h('div', { class: 'section-title' }, 'Starship'),
      h('div', { class: 'action-list' },
        refill('Launch thrusters', g.ship.launchFuel, 'hydrogen', 1, 'launch'),
        refill('Pulse drive', g.ship.pulseFuel, 'tritium', 1, 'pulse'),
        refill('Shields', g.ship.shield, 'iron', 1, 'shield'),
        h('div', { class: 'action' },
          h('div', null,
            h('div', { class: 'action-name' }, `Warp cell · ${g.ship.warpCells}/5`),
            h('div', { class: 'action-desc' }, WARP_CELL.description),
            h('div', { class: 'cost' }, ...warpCost.flatMap(([id, n], i) => [i ? ' · ' : '', costText(id, n)])),
          ),
          h('button', { class: 'btn small primary', type: 'button', disabled: !inv.canAfford(WARP_CELL.cost) || g.ship.warpCells >= 5, onclick: () => { g.craftWarpCell(); this.renderInventory(); } }, 'Craft'),
        ),
      ),
      h('div', { class: 'section-title' }, 'Upgrades'),
      h('div', { class: 'action-list' }, ...UPGRADES.map((u) => {
        const lvl = inv.upgradeLevel(u.id);
        const maxed = lvl >= u.max;
        return h('div', { class: 'action' },
          h('div', null,
            h('div', { class: 'action-name' }, `${u.name} · ${lvl}/${u.max}`),
            h('div', { class: 'action-desc' }, u.description),
          ),
          h('button', { class: 'btn small', type: 'button', disabled: maxed || inv.units < u.price, onclick: () => { g.buyUpgrade(u.id, u.price, u.max); this.renderInventory(); } },
            maxed ? 'Installed' : `${formatInt(u.price)} u`),
        );
      })),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => g.setMode('play') }, 'Close')),
    );
  }

  // -------------------------------------------------------------- log

  renderLog(): void {
    const g = this.game;
    const d = g.discoveries;
    clear(this.logBody);
    const count = (k: string) => d.countWhere((x) => x.kind === k);
    const planet = g.activePlanet;
    let planetLine: HTMLElement | null = null;
    if (planet) {
      const pid = planet.params.id;
      const faunaTotal = g.creatures.planet === planet ? g.creatures.species.length : 0;
      const faunaFound = d.countWhere((x) => x.kind === 'fauna' && x.planetId === pid);
      const floraTotal = planet.params.flora.filter((f) => f.scannable).length;
      const floraFound = d.countWhere((x) => (x.kind === 'flora' || x.kind === 'mineral') && x.planetId === pid);
      planetLine = h('p', { style: 'color:var(--muted); margin:0 0 12px' },
        `${planet.params.name}: fauna ${faunaFound}/${faunaTotal || '?'} · flora & minerals ${floraFound}/${floraTotal}`);
    }
    const tabs: [string, string][] = [['all', 'All'], ['planet', 'Planets'], ['fauna', 'Fauna'], ['flora', 'Flora'], ['mineral', 'Minerals'], ['system', 'Systems']];
    const list = d.all().filter((x) => this.logTab === 'all' || x.kind === this.logTab);
    this.logBody.append(
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, 'Discoveries'), h('span', { class: 'panel-meta' }, `${d.size} entries`)),
      h('div', { class: 'log-summary' },
        ...[['system', 'Systems'], ['planet', 'Planets'], ['fauna', 'Fauna'], ['flora', 'Flora'], ['mineral', 'Minerals']].map(([k, label]) =>
          h('div', { class: 'log-stat' }, h('b', null, String(count(k))), h('span', null, label)))),
      ...(planetLine ? [planetLine] : []),
      h('div', { class: 'tabs', role: 'tablist', style: 'margin-bottom:10px' }, ...tabs.map(([k, label]) =>
        h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(this.logTab === k), onclick: () => { this.logTab = k; this.renderLog(); } }, label))),
      list.length
        ? h('div', { class: 'log-list' }, ...list.slice(0, 120).map((x) =>
          h('div', { class: 'log-entry' },
            h('span', { class: 'log-kind' }, x.kind),
            h('div', null,
              h('div', { class: 'log-name' }, x.name),
              h('div', { class: 'log-detail' }, [x.planetName, x.systemName].filter(Boolean).join(' · ')),
              h('div', { class: 'log-detail' }, x.details.map(([a, b]) => `${a}: ${b}`).join(' · '))),
            h('span', { class: 'log-reward' }, x.reward ? `+${formatInt(x.reward)} u` : ''))))
        : h('p', { class: 'empty-note' }, 'Nothing logged yet. Press F to open the analysis visor and hold it on plants, minerals and creatures.'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: () => g.setMode('play') }, 'Close')),
    );
  }
}
