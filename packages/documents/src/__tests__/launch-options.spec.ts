import { expect, it } from 'vitest';

import { chromiumLaunchOptions } from '../playwright/factory.ts';

it('leaves process signals to the worker', () => {
  expect(chromiumLaunchOptions.handleSIGINT).toBe(false);
  expect(chromiumLaunchOptions.handleSIGTERM).toBe(false);
  expect(chromiumLaunchOptions.handleSIGHUP).toBe(false);
  expect(chromiumLaunchOptions.chromiumSandbox).toBe(false);
  expect(chromiumLaunchOptions.args).toEqual(['--disable-dev-shm-usage', '--disable-gpu']);
});
