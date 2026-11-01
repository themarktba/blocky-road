/** What the player wants the car to do this frame. Values are -1..1 / booleans. */
export interface DriveInput {
  /** 1 = full gas, -1 = full brake/reverse. */
  throttle: number;
  /** -1 = left, 1 = right. */
  steer: number;
  /** True only on the frame R was pressed. */
  reset: boolean;
  /** Fire ranged weapons (held). */
  fire: boolean;
}

const GAS = ['KeyW', 'ArrowUp'];
const BRAKE = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const RESET = ['KeyR'];
const FIRE = ['Space'];

/**
 * Keyboard + on-screen touch buttons, both turned into the same DriveInput.
 * Touch buttons call hold()/tap() with the key they stand for (e.g. 'KeyW').
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  /** Keys held by on-screen buttons. */
  private touchDown = new Set<string>();

  /** An on-screen button is pressed (true) or released (false). */
  hold(code: string, on: boolean) {
    if (on) this.touchDown.add(code);
    else this.touchDown.delete(code);
  }

  /** An on-screen button that acts once per press (like R to reset). */
  tap(code: string) {
    this.pressed.add(code);
  }

  /** Release all on-screen buttons (e.g. when they are hidden). */
  releaseTouch() {
    this.touchDown.clear();
  }

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  private any(codes: string[]) {
    return codes.some((c) => this.down.has(c) || this.touchDown.has(c));
  }

  /** Read the current input. Call once per frame; clears "just pressed" keys. */
  read(): DriveInput {
    const input: DriveInput = {
      throttle: (this.any(GAS) ? 1 : 0) - (this.any(BRAKE) ? 1 : 0),
      steer: (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0),
      reset: RESET.some((c) => this.pressed.has(c)),
      fire: this.any(FIRE),
    };
    this.pressed.clear();
    return input;
  }
}
