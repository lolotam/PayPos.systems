import { expect, it, vi } from 'vitest';

import { realChromiumUnavailable } from './chromium-gate.ts';

it('fails the suite in CI when Chromium cannot launch', () => {
  const error = new Error("Executable doesn't exist");
  expect(() => realChromiumUnavailable(error, { CI: 'true' })).toThrow(/required in CI/);
});

it('skips a missing Chromium only outside CI', () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  try {
    expect(realChromiumUnavailable(new Error('Failed to launch'), {})).toBe(false);
    expect(realChromiumUnavailable(new Error('browserType.launch'), { CI: '' })).toBe(false);
    expect(info).toHaveBeenCalled();
  } finally {
    info.mockRestore();
  }
});

it('rethrows a launch error that is not a missing browser', () => {
  const error = new Error('boom');
  expect(() => realChromiumUnavailable(error, { CI: 'true' })).toThrow(error);
});
