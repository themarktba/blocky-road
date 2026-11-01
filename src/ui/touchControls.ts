import type { Input } from '../core/input';

const ICONS = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7" /></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>',
  gas: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" /></svg>',
  brake: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>',
  fire: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.5-5.8" /><path d="M4 4v5h5" /></svg>',
  end: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>',
};

/** Keep getting this finger's events even if it slides off the button (never fatal if it fails). */
function capture(el: HTMLElement, pointerId: number) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Pointer already gone – the press still counts.
  }
}

/**
 * On-screen driving controls for phones and tablets.
 *  - Left: steering pad (slide your thumb left/right).
 *  - Right: gas (big) and brake pedals, plus a fire button when the car has ranged weapons.
 *  - Top: reset and end-run buttons.
 * Every button simply holds the matching keyboard key in Input, so driving code doesn't care.
 */
export class TouchControls {
  private root: HTMLDivElement;
  private fireBtn: HTMLButtonElement;

  constructor(container: HTMLElement, private input: Input, onEnd: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls hidden';
    this.root.innerHTML = `
      <div class="tc-top">
        <button type="button" class="tc-small" data-reset aria-label="Reset car">${ICONS.reset}</button>
        <button type="button" class="tc-small" data-end aria-label="End run">${ICONS.end}</button>
      </div>
      <div class="tc-steer" data-steer>
        <div class="tc-steer-half" data-side="left">${ICONS.left}</div>
        <div class="tc-steer-half" data-side="right">${ICONS.right}</div>
      </div>
      <div class="tc-pedals">
        <button type="button" class="tc-fire hidden" data-fire aria-label="Fire">${ICONS.fire}</button>
        <button type="button" class="tc-brake" data-brake aria-label="Brake / reverse">${ICONS.brake}</button>
        <button type="button" class="tc-gas" data-gas aria-label="Gas">${ICONS.gas}</button>
      </div>`;
    container.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.holdButton(q('[data-gas]'), 'KeyW');
    this.holdButton(q('[data-brake]'), 'KeyS');
    this.fireBtn = q('[data-fire]');
    this.holdButton(this.fireBtn, 'Space');
    this.tapButton(q('[data-reset]'), () => input.tap('KeyR'));
    this.tapButton(q('[data-end]'), onEnd);
    this.steerPad(q('[data-steer]'));

    // Stop long-press menus and double-tap zoom on the controls.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show(on: boolean) {
    this.root.classList.toggle('hidden', !on);
    if (!on) {
      this.input.releaseTouch();
      this.root.querySelectorAll('.active').forEach((el) => el.classList.remove('active'));
    }
  }

  /** Show the fire button only for cars with ranged weapons. */
  setFireVisible(on: boolean) {
    this.fireBtn.classList.toggle('hidden', !on);
  }

  /** A button that holds a key while a finger is on it. */
  private holdButton(el: HTMLElement, code: string) {
    const release = () => {
      el.classList.remove('active');
      this.input.hold(code, false);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(el, e.pointerId);
      el.classList.add('active');
      this.input.hold(code, true);
    });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  }

  private tapButton(el: HTMLElement, action: () => void) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      action();
    });
  }

  /** One pad for steering: the half under your thumb decides the direction, and you can slide across. */
  private steerPad(pad: HTMLElement) {
    const halves = pad.querySelectorAll<HTMLElement>('[data-side]');
    const set = (side: 'left' | 'right' | null) => {
      this.input.hold('KeyA', side === 'left');
      this.input.hold('KeyD', side === 'right');
      halves.forEach((h) => h.classList.toggle('active', h.dataset.side === side));
    };
    const sideAt = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2 ? 'left' : 'right';
    };
    let pointer: number | null = null;
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointer = e.pointerId;
      capture(pad, e.pointerId);
      set(sideAt(e));
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === pointer) set(sideAt(e));
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      set(null);
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('lostpointercapture', end);
  }
}
