import { afterEach, describe, expect, it, vi } from 'vitest';

import { isStagingApp } from './native-shell';

describe('isStagingApp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is true in the staging flavour of the native app', () => {
    vi.stubEnv('VITE_NATIVE', '1');
    vi.stubEnv('VITE_NATIVE_FLAVOUR', 'staging');

    expect(isStagingApp()).toBe(true);
  });

  it('is false in the production flavour of the native app', () => {
    vi.stubEnv('VITE_NATIVE', '1');
    vi.stubEnv('VITE_NATIVE_FLAVOUR', 'production');

    expect(isStagingApp()).toBe(false);
  });

  it('is false in the web build, whatever the flavour says', () => {
    vi.stubEnv('VITE_NATIVE', '');
    vi.stubEnv('VITE_NATIVE_FLAVOUR', 'staging');

    expect(isStagingApp()).toBe(false);
  });
});
