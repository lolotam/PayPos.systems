import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMinVersionStatus } from './version-fetch';

const capacitor = vi.hoisted(() => ({
  platform: 'android',
  version: '1.0.0',
  request: null as { url: string; connectTimeout: number; readTimeout: number } | null,
  status: 200,
  data: '' as unknown,
}));

vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: async () => ({ version: capacitor.version }),
    addListener: async () => ({ remove: () => undefined }),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => capacitor.platform },
  CapacitorHttp: {
    get: async (options: { url: string; connectTimeout: number; readTimeout: number }) => {
      capacitor.request = options;
      return { status: capacitor.status, data: capacitor.data };
    },
  },
}));

const manifest = (ios: string, android: string) =>
  JSON.stringify({
    ios: { minimum: ios, latest: ios, store_url: 'https://apps.apple.com/app/id1' },
    android: {
      minimum: android,
      latest: android,
      store_url: 'https://play.google.com/store/apps/details?id=systems.pospay.business',
    },
  });

beforeEach(() => {
  capacitor.platform = 'android';
  capacitor.version = '1.0.0';
  capacitor.request = null;
  capacitor.status = 200;
  capacitor.data = manifest('1.0.0', '1.0.0');
  vi.stubEnv('VITE_NATIVE', '1');
  vi.stubEnv('VITE_POS_HOST', 'pos.staging.pospay.systems');
  vi.stubEnv('VITE_NATIVE_FLAVOUR', 'staging');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fetchMinVersionStatus', () => {
  it('reads the file of the build flavour over native http with the two timeouts', async () => {
    await fetchMinVersionStatus();

    expect(capacitor.request?.url).toBe(
      'https://pos.staging.pospay.systems/app-version/staging.json',
    );
    expect(capacitor.request?.connectTimeout).toBe(10000);
    expect(capacitor.request?.readTimeout).toBe(10000);
  });

  it('reads the production file when the build is the production flavour', async () => {
    vi.stubEnv('VITE_NATIVE_FLAVOUR', 'production');

    await fetchMinVersionStatus();

    expect(capacitor.request?.url).toBe(
      'https://pos.staging.pospay.systems/app-version/production.json',
    );
  });

  it('blocks below the minimum of the platform of the app only (VER-T12)', async () => {
    capacitor.platform = 'ios';
    capacitor.version = '1.1.0';
    capacitor.data = manifest('1.2.0', '1.0.0');

    expect(await fetchMinVersionStatus()).toEqual({
      outcome: 'blocked',
      storeUrl: 'https://apps.apple.com/app/id1',
    });
  });

  it('does not block on the other platform entry (VER-T12)', async () => {
    capacitor.platform = 'android';
    capacitor.version = '1.1.0';
    capacitor.data = manifest('1.2.0', '1.0.0');

    expect(await fetchMinVersionStatus()).toEqual({ outcome: 'ok' });
  });

  it('does not block a version equal to the minimum', async () => {
    capacitor.version = '1.0.0';
    capacitor.data = manifest('1.0.0', '1.0.0');

    expect(await fetchMinVersionStatus()).toEqual({ outcome: 'ok' });
  });

  it('reads nothing from a missing file, a broken file or a broken version', async () => {
    capacitor.status = 404;
    expect(await fetchMinVersionStatus()).toBeNull();

    capacitor.status = 200;
    capacitor.data = 'not json';
    expect(await fetchMinVersionStatus()).toBeNull();

    capacitor.data = JSON.stringify({ ios: { minimum: '1.0.0' } });
    expect(await fetchMinVersionStatus()).toBeNull();

    capacitor.data = manifest('1.0.0', '1.0.0');
    capacitor.version = '1.0.0-beta';
    expect(await fetchMinVersionStatus()).toBeNull();
  });
});
