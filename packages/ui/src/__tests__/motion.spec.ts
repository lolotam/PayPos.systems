import { expect, it } from 'vitest';

import { fadeIn, reducedMotion, slideIn } from '../motion.js';

it('slides from inline start and mirrors entrance and exit in RTL', () => {
  expect(slideIn.rtl.hidden.x).toBeGreaterThan(0);
  expect(slideIn.ltr.hidden.x).toBe(-slideIn.rtl.hidden.x);
  expect(slideIn.ltr.exit.x).toBe(-slideIn.rtl.exit.x);
  expect(slideIn.rtl.visible.x).toBe(0);
  expect(slideIn.ltr.visible.x).toBe(0);
});

it('offers static visible states without translation or duration for reduced motion', () => {
  expect(reducedMotion.hidden).toEqual({ opacity: 1, x: 0 });
  expect(reducedMotion.visible).toEqual({ opacity: 1, x: 0, transition: { duration: 0 } });
  expect(reducedMotion.exit).toEqual(reducedMotion.visible);
  expect(fadeIn.hidden.opacity).toBe(0);
  expect(fadeIn.visible.opacity).toBe(1);
});
