import { runCoins, type RunEndReason, type RunState } from '../game/state';
import type { Profile } from '../game/profile';

export interface HudHandlers {
  onRestart: () => void;
  onGarage: () => void;
}

const END_TITLES: Record<RunEndReason, [string, string]> = {
  fuel: ['Run over', 'Out of fuel!'],
  stalled: ['Run over', 'No engine left to drive with.'],
  wrecked: ['Wrecked!', 'Your cabin was destroyed.'],
  gaveUp: ['Run over', 'You ended the run.'],
};

/**
 * HTML overlay while driving: fuel, car condition, distance, speed, coins,
 * toasts, and the "Run over" screen.
 */
export class Hud {
  private root: HTMLDivElement;
  private fuelFill: HTMLDivElement;
  private fuelText: HTMLSpanElement;
  private hpFill: HTMLDivElement;
  private distanceText: HTMLSpanElement;
  private speedText: HTMLSpanElement;
  private coinsText: HTMLSpanElement;
  private ammoText: HTMLSpanElement;
  private ammoRow: HTMLDivElement;
  private toast: HTMLDivElement;
  private alerts: HTMLDivElement;
  private runOver: HTMLDivElement;
  private runOverTitle: HTMLHeadingElement;
  private runOverReason: HTMLParagraphElement;
  private runOverStats: HTMLDivElement;
  private toastTimer = 0;

  constructor(container: HTMLElement, handlers: HudHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'hud hidden';
    this.root.innerHTML = `
      <div class="hud-panel hud-fuel">
        <div class="hud-label">FUEL <span data-fuel-text></span></div>
        <div class="fuel-bar"><div class="fuel-fill" data-fuel-fill></div></div>
        <div class="hud-label hud-hp-label">CAR</div>
        <div class="fuel-bar hp-bar"><div class="hp-fill" data-hp-fill></div></div>
      </div>
      <div class="hud-panel hud-stats">
        <div><span class="hud-label">DISTANCE</span> <span class="hud-value" data-distance></span></div>
        <div><span class="hud-label">SPEED</span> <span class="hud-value" data-speed></span></div>
        <div><span class="hud-label">COINS</span> <span class="hud-value coin-value" data-coins></span></div>
        <div data-ammo-row><span class="hud-label">AMMO</span> <span class="hud-value" data-ammo></span></div>
      </div>
      <div class="hud-alerts" data-alerts></div>
      <div class="hud-help">W/S gas · brake/reverse &nbsp;·&nbsp; A/D steer &nbsp;·&nbsp; Space fire &nbsp;·&nbsp; R reset &nbsp;·&nbsp; Esc end run</div>
      <div class="hud-toast" data-toast></div>
      <div class="run-over hidden" data-run-over>
        <div class="run-over-card">
          <h1 data-title>Run over</h1>
          <p data-reason></p>
          <div class="run-over-stats" data-run-over-stats></div>
          <div class="run-over-buttons">
            <button type="button" class="btn-secondary" data-garage>Garage</button>
            <button type="button" class="btn-primary" data-restart>Drive again</button>
          </div>
          <div class="run-over-hint">Enter: drive again · G: garage</div>
        </div>
      </div>`;
    container.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.fuelFill = q('[data-fuel-fill]');
    this.fuelText = q('[data-fuel-text]');
    this.hpFill = q('[data-hp-fill]');
    this.distanceText = q('[data-distance]');
    this.speedText = q('[data-speed]');
    this.coinsText = q('[data-coins]');
    this.ammoText = q('[data-ammo]');
    this.ammoRow = q('[data-ammo-row]');
    this.toast = q('[data-toast]');
    this.alerts = q('[data-alerts]');
    this.runOver = q('[data-run-over]');
    this.runOverTitle = q('[data-title]');
    this.runOverReason = q('[data-reason]');
    this.runOverStats = q('[data-run-over-stats]');

    q<HTMLButtonElement>('[data-restart]').addEventListener('click', handlers.onRestart);
    q<HTMLButtonElement>('[data-garage]').addEventListener('click', handlers.onGarage);
    window.addEventListener('keydown', (e) => {
      if (this.runOver.classList.contains('hidden') || this.root.classList.contains('hidden')) return;
      if (e.code === 'Enter') handlers.onRestart();
      if (e.code === 'KeyG') handlers.onGarage();
    });
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
  }

  update(dt: number, state: RunState, speedMs: number, integrity: number, ammo: number[]) {
    this.ammoRow.classList.toggle('hidden', ammo.length === 0);
    this.ammoText.textContent = ammo.join(' · ');
    const pct = state.fuelCapacity > 0 ? state.fuel / state.fuelCapacity : 0;
    this.fuelFill.style.width = `${(pct * 100).toFixed(1)}%`;
    this.fuelFill.classList.toggle('low', pct < 0.2);
    this.fuelText.textContent = `${Math.ceil(state.fuel)} / ${state.fuelCapacity}`;
    this.hpFill.style.width = `${(integrity * 100).toFixed(1)}%`;
    this.hpFill.classList.toggle('low', integrity < 0.35);
    this.distanceText.textContent = `${Math.floor(state.distance)} m`;
    this.speedText.textContent = `${Math.round(speedMs * 3.6)} km/h`;
    this.coinsText.textContent = String(runCoins(state));

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
  }

  /** Big message in the middle of the screen, e.g. "+35 fuel". */
  flash(message: string, kind: 'good' | 'bad' = 'good') {
    this.toast.textContent = message;
    this.toast.classList.toggle('bad', kind === 'bad');
    this.toast.classList.add('show');
    this.toastTimer = 1.4;
  }

  /** Small stacking alert on the side, e.g. "Lost: Small Engine". */
  alert(message: string) {
    const el = document.createElement('div');
    el.className = 'hud-alert';
    el.textContent = message;
    this.alerts.prepend(el);
    setTimeout(() => el.classList.add('fade'), 2500);
    setTimeout(() => el.remove(), 3200);
    while (this.alerts.children.length > 5) this.alerts.lastElementChild?.remove();
  }

  showRunOver(state: RunState, profile: Profile, isBest: boolean, coinsEarned: number) {
    const [title, reason] = END_TITLES[state.endReason ?? 'fuel'];
    this.runOverTitle.textContent = title;
    this.runOverReason.textContent = reason;
    this.runOverStats.innerHTML = `
      <div><span>Distance</span><b>${Math.floor(state.distance)} m</b></div>
      <div><span>Best</span><b>${Math.floor(profile.bestDistance)} m${isBest ? ' ★' : ''}</b></div>
      <div><span>Fuel cans</span><b>${state.cansCollected}</b></div>
      <div><span>Enemies destroyed</span><b>${state.enemiesDestroyed}</b></div>
      <div><span>Obstacles destroyed</span><b>${state.obstaclesDestroyed}</b></div>
      <div><span>Parts lost</span><b>${state.partsLost}</b></div>
      <div class="coins-row"><span>Coins earned</span><b>● +${coinsEarned}</b></div>
      <div><span>Total coins</span><b>● ${profile.coins}</b></div>`;
    this.runOver.classList.remove('hidden');
    this.root.querySelector<HTMLButtonElement>('[data-restart]')?.focus();
  }

  hideRunOver() {
    this.runOver.classList.add('hidden');
  }
}
