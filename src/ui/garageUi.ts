import { CATEGORY_LABELS, PARTS, blueprintTotals, partsCost, stat, validateBlueprint, type CarBlueprint, type PartDef } from '../car/parts';
import type { PartCategory } from '../car/carConfig';
import { burnRate } from '../game/state';
import type { Profile } from '../game/profile';
import { IS_TOUCH } from '../core/device';
import type { GarageMode } from '../garage/Garage';
import type { RotateAxis } from '../car/orientation';

export interface GarageUiHandlers {
  onSelect: (partId: string) => void;
  onDrive: () => void;
  onStarter: () => void;
  onClear: () => void;
  onMode: (mode: GarageMode) => void;
  onRotate: (axis: RotateAxis) => void;
  onResetRotation: () => void;
  onUndo: () => void;
}

/** Garage tool state shown in the toolbar. */
export interface GarageToolState {
  selected: string | null;
  mode: GarageMode;
  rotated: boolean;
  canUndo: boolean;
}

const TOOL_ICONS = {
  place: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>',
  remove: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg>',
  // Turn: arrow around a vertical axis. Tilt: nose tipping forward. Roll: tipping onto its side.
  turn: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="13" rx="8" ry="3.5" /><path d="M12 3v14" /><path d="m17 8.5 3 1-1 3" /></svg>',
  tilt: '<svg viewBox="0 0 24 24"><path d="M4 12h16" /><path d="M7 6a8 8 0 0 1 10 0" /><path d="m17 3 0 3-3 0" /><rect x="8" y="13" width="8" height="5" /></svg>',
  roll: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" /><path d="M5 9a8 8 0 0 1 14 0" /><path d="m19 5 0 4-4 0" /><rect x="7" y="14" width="10" height="5" /></svg>',
  straight: '<svg viewBox="0 0 24 24"><rect x="6" y="9" width="12" height="9" /><path d="M12 3v4M9 5l3-2 3 2" /></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>',
};

/** Short stat summary for a part button. */
function partSummary(def: PartDef): string {
  const bits = [`${stat(def, 'mass')} kg`];
  if (def.weapon?.type === 'melee') bits.push(`melee · dmg ${def.weapon.damage}`);
  if (def.weapon?.type === 'ranged') bits.push(`dmg ${def.weapon.damage}${def.weapon.splash ? ' blast' : ''} · ${def.weapon.ammo} ammo`);
  if (def.stats.enginePower) bits.push(`${def.stats.enginePower} N`);
  if (def.stats.fuelCapacity) bits.push(`${def.stats.fuelCapacity} fuel`);
  if (def.stats.ammoBonus) bits.push(`+${def.stats.ammoBonus}% ammo`);
  if (def.stats.armor) bits.push(`armor ${def.stats.armor}`);
  if (def.stats.wheelRadius) bits.push(`r ${def.stats.wheelRadius} m`);
  if (def.stats.grip && def.stats.grip !== 1) bits.push(`grip ×${def.stats.grip}`);
  return bits.join(' · ');
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** HTML panels around the 3D garage: part catalog (left), car stats (right), coins (top). */
export class GarageUi {
  private root: HTMLDivElement;
  private catalog: HTMLDivElement;
  private stats: HTMLDivElement;
  private errors: HTMLUListElement;
  private driveBtn: HTMLButtonElement;
  private coins: HTMLSpanElement;
  private best: HTMLSpanElement;
  private toast: HTMLDivElement;
  private toastTimer: number | undefined;
  private toolbar: HTMLDivElement;
  private statsPanel: HTMLDivElement;

  constructor(container: HTMLElement, handlers: GarageUiHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'garage hidden';
    this.root.innerHTML = `
      <div class="garage-top">
        <h1>Garage</h1>
        <div class="garage-wallet"><span class="coin">●</span> <span data-coins></span> &nbsp; Best <span data-best></span></div>
      </div>
      <div class="garage-panel garage-catalog" data-catalog></div>
      <div class="garage-panel garage-stats" data-stats-panel>
        <button type="button" class="stats-toggle" data-stats-toggle aria-label="Show or hide car stats">
          <h2>Your car</h2><span class="stats-caret">▾</span>
        </button>
        <div data-stats></div>
        <ul class="garage-errors" data-errors></ul>
        <button type="button" class="btn-primary" data-drive>Drive!</button>
        <div class="garage-row">
          <button type="button" class="btn-secondary" data-starter>Starter car</button>
          <button type="button" class="btn-secondary" data-clear>Clear</button>
        </div>
      </div>
      <div class="garage-toolbar" data-toolbar>
        <button type="button" data-mode="place" aria-label="Place mode">${TOOL_ICONS.place}<span>Place</span></button>
        <button type="button" data-mode="remove" aria-label="Remove mode">${TOOL_ICONS.remove}<span>Remove</span></button>
        <button type="button" data-rotate="y" aria-label="Turn part left/right">${TOOL_ICONS.turn}<span>Turn</span></button>
        <button type="button" data-rotate="x" aria-label="Tilt part forward">${TOOL_ICONS.tilt}<span>Tilt</span></button>
        <button type="button" data-rotate="z" aria-label="Roll part onto its side">${TOOL_ICONS.roll}<span>Roll</span></button>
        <button type="button" data-reset-rotation aria-label="Reset rotation">${TOOL_ICONS.straight}<span>Upright</span></button>
        <button type="button" data-undo aria-label="Undo">${TOOL_ICONS.undo}<span>Undo</span></button>
        ${IS_TOUCH && document.fullscreenEnabled ? `<button type="button" data-fullscreen aria-label="Full screen">${TOOL_ICONS.full}<span>Full</span></button>` : ''}
      </div>
      <div class="garage-help">${IS_TOUCH
        ? 'Each piece costs coins · removing refunds · Tap: place/remove · Turn/Tilt/Roll to rotate · Drag: orbit · Pinch: zoom · Weapons fire the way they point'
        : 'Each piece costs coins (removing refunds) · Click: place · Right click: remove · R/T/F: turn/tilt/roll (Shift = other way) · Ctrl+Z: undo · Drag: orbit · Scroll: zoom · Weapons fire the way they point'}</div>
      <div class="garage-toast" data-toast></div>`;
    container.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.catalog = q('[data-catalog]');
    this.stats = q('[data-stats]');
    this.errors = q('[data-errors]');
    this.driveBtn = q('[data-drive]');
    this.coins = q('[data-coins]');
    this.best = q('[data-best]');
    this.toast = q('[data-toast]');
    this.toolbar = q('[data-toolbar]');
    this.statsPanel = q('[data-stats-panel]');
    // Small screens start with the stats folded away to leave room for the car.
    if (Math.min(window.innerWidth, window.innerHeight) < 600) this.statsPanel.classList.add('collapsed');
    q('[data-stats-toggle]').addEventListener('click', () => this.statsPanel.classList.toggle('collapsed'));
    this.toolbar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!btn) return;
      if (btn.dataset.mode) handlers.onMode(btn.dataset.mode as GarageMode);
      if (btn.dataset.rotate) handlers.onRotate(btn.dataset.rotate as RotateAxis);
      if (btn.hasAttribute('data-reset-rotation')) handlers.onResetRotation();
      if (btn.hasAttribute('data-undo')) handlers.onUndo();
      if (btn.hasAttribute('data-fullscreen')) {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen().catch(() => {});
      }
    });

    this.driveBtn.addEventListener('click', () => handlers.onDrive());
    q('[data-starter]').addEventListener('click', () => handlers.onStarter());
    q('[data-clear]').addEventListener('click', () => handlers.onClear());
    this.catalog.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-part]');
      if (!btn) return;
      handlers.onSelect(btn.dataset.part!);
    });
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }

  flash(message: string) {
    this.toast.textContent = message;
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 1800);
  }

  render(profile: Profile, blueprint: CarBlueprint, tools: GarageToolState) {
    const selected = tools.selected;
    this.toolbar.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === tools.mode));
    this.toolbar.querySelector<HTMLButtonElement>('[data-reset-rotation]')!.disabled = !tools.rotated;
    this.toolbar.querySelector<HTMLButtonElement>('[data-undo]')!.disabled = !tools.canUndo;
    this.coins.textContent = String(profile.coins);
    this.best.textContent = `${Math.floor(profile.bestDistance)} m`;

    // Catalog grouped by category.
    const groups = new Map<PartCategory, PartDef[]>();
    for (const def of Object.values(PARTS)) {
      if (!groups.has(def.category)) groups.set(def.category, []);
      groups.get(def.category)!.push(def);
    }
    let html = '';
    for (const [cat, defs] of groups) {
      html += `<div class="cat-title">${CATEGORY_LABELS[cat]}</div>`;
      for (const def of defs) {
        // Every piece costs coins when placed; parts you can't afford right now are dimmed.
        const affordable = profile.coins >= def.cost;
        const cls = ['part-btn', selected === def.id && tools.mode === 'place' ? 'selected' : '', affordable ? '' : 'pricey'].join(' ');
        html += `
          <button type="button" class="${cls}" data-part="${def.id}" title="${escapeHtml(def.description)}">
            <span class="swatch" style="background:${def.color}"></span>
            <span class="part-info">
              <span class="part-name">${escapeHtml(def.name)}</span>
              <span class="part-stats">${partSummary(def)}</span>
            </span>
            <span class="part-cost">● ${def.cost}</span>
          </button>`;
      }
    }
    this.catalog.innerHTML = html;

    // Stats and problems.
    const t = blueprintTotals(blueprint);
    const accel = t.mass > 0 ? t.enginePower / t.mass : 0;
    const fuelTime = t.mass > 0 && t.fuelCapacity > 0 ? t.fuelCapacity / burnRate(t.mass) : 0;
    const bar = (v: number, max: number) => `<span class="bar"><span style="width:${Math.min(100, (v / max) * 100)}%"></span></span>`;
    this.stats.innerHTML = `
      <div class="stat"><span>Car value</span><b>● ${partsCost(blueprint.parts)}</b></div>
      <div class="stat"><span>Mass</span><b>${t.mass} kg</b>${bar(t.mass, 500)}</div>
      <div class="stat"><span>Engine</span><b>${t.enginePower} N</b>${bar(t.enginePower, 8000)}</div>
      <div class="stat"><span>Acceleration</span><b>${accel.toFixed(1)} m/s²</b>${bar(accel, 16)}</div>
      <div class="stat"><span>Fuel</span><b>${t.fuelCapacity}</b>${bar(t.fuelCapacity, 400)}</div>
      <div class="stat"><span>Full-gas time</span><b>${fuelTime.toFixed(0)} s</b>${bar(fuelTime, 70)}</div>
      <div class="stat"><span>Armor</span><b>${t.armor}</b>${bar(t.armor, 30)}</div>
      <div class="stat"><span>Wheels</span><b>${t.wheels}</b></div>
      <div class="stat"><span>Weapons</span><b>${t.melee + t.ranged ? `${t.melee} melee · ${t.ranged} ranged` : 'none'}</b></div>
      <div class="stat"><span>Ammo${t.ammoBonus ? ` (+${t.ammoBonus}%)` : ''}</span><b>${t.shots.length ? t.shots.join(' · ') : t.ammoBonus ? 'no guns' : '–'}</b></div>`;
    const errors = validateBlueprint(blueprint);
    this.errors.innerHTML = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('');
    this.driveBtn.disabled = errors.length > 0;
  }
}
