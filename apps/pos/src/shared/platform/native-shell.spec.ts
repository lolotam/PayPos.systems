import { afterEach, describe, expect, it, vi } from 'vitest';

import { isStagingApp, usesNativeStaffTransport } from './native-shell';

describe('isStagingApp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

describe('usesNativeStaffTransport', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('is true in a native build when Capacitor reports iOS', () => {
    vi.stubEnv('VITE_NATIVE', '1');
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios' });

    expect(usesNativeStaffTransport()).toBe(true);
  });

  it('is false in a native Android build', () => {
    vi.stubEnv('VITE_NATIVE', '1');
    vi.stubGlobal('Capacitor', { getPlatform: () => 'android' });

    expect(usesNativeStaffTransport()).toBe(false);
  });

  it('is false in a web build even when Capacitor reports iOS', () => {
    vi.stubEnv('VITE_NATIVE', '');
    vi.stubGlobal('Capacitor', { getPlatform: () => 'ios' });

    expect(usesNativeStaffTransport()).toBe(false);
  });

  it('is false in a native build without a Capacitor global', () => {
    vi.stubEnv('VITE_NATIVE', '1');
    vi.stubGlobal('Capacitor', undefined);

    expect(usesNativeStaffTransport()).toBe(false);
  });
});
