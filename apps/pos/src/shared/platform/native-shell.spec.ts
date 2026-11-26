import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  capabilities,
  isStagingApp,
  nativeFlavour,
  usesNativeStaffTransport,
  webAppUrl,
} from './native-shell';

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

describe('capabilities', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('opens every capability in the web build', () => {
    vi.stubEnv('VITE_NATIVE', '');
    vi.stubEnv('VITE_NATIVE_QR_SCAN', '0');
    vi.stubEnv('VITE_NATIVE_ATTENDANCE_CAMERA', '0');

    expect(capabilities()).toEqual({
      webPush: true,
      passkeys: true,
      qrScan: true,
      attendanceCamera: true,
    });
  });

  it('closes the browser capabilities in the native build', () => {
    vi.stubEnv('VITE_NATIVE', '1');
    vi.stubEnv('VITE_NATIVE_QR_SCAN', '0');
    vi.stubEnv('VITE_NATIVE_ATTENDANCE_CAMERA', '0');

    expect(capabilities()).toEqual({
      webPush: false,
      passkeys: false,
      qrScan: false,
      attendanceCamera: false,
    });
  });

  it('opens the camera capabilities only when the build asks for them', () => {
    vi.stubEnv('VITE_NATIVE', '1');
    vi.stubEnv('VITE_NATIVE_QR_SCAN', '1');
    vi.stubEnv('VITE_NATIVE_ATTENDANCE_CAMERA', '1');

    expect(capabilities()).toEqual({
      webPush: false,
      passkeys: false,
      qrScan: true,
      attendanceCamera: true,
    });
  });
});

describe('nativeFlavour', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is production only when the build says so', () => {
    vi.stubEnv('VITE_NATIVE_FLAVOUR', 'production');
    expect(nativeFlavour()).toBe('production');

    vi.stubEnv('VITE_NATIVE_FLAVOUR', 'staging');
    expect(nativeFlavour()).toBe('staging');

    vi.stubEnv('VITE_NATIVE_FLAVOUR', '');
    expect(nativeFlavour()).toBe('staging');
  });
});

describe('webAppUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the web app link of the native host', () => {
    vi.stubEnv('VITE_NATIVE', '1');
    vi.stubEnv('VITE_POS_HOST', 'pos.staging.pospay.systems');

    expect(webAppUrl()).toBe('https://pos.staging.pospay.systems/personal');
    expect(webAppUrl('/attendance')).toBe('https://pos.staging.pospay.systems/attendance');
    expect(webAppUrl('attendance')).toBe('https://pos.staging.pospay.systems/attendance');
  });

  it('keeps the plain path in the web build', () => {
    vi.stubEnv('VITE_NATIVE', '');
    vi.stubEnv('VITE_POS_HOST', 'pos.staging.pospay.systems');

    expect(webAppUrl('/personal')).toBe('/personal');
  });

  it('keeps the plain path when the build has no host', () => {
    vi.stubEnv('VITE_NATIVE', '1');
    vi.stubEnv('VITE_POS_HOST', '');

    expect(webAppUrl('/personal')).toBe('/personal');
  });
});
