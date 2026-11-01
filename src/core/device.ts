/** True on phones/tablets (finger as the main pointer). Touch controls are shown when this is true. */
export const IS_TOUCH =
  typeof window !== 'undefined' &&
  (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

/** Small screen: use lighter graphics settings. */
export const IS_SMALL_SCREEN = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600;

if (IS_TOUCH) document.documentElement.classList.add('touch');
