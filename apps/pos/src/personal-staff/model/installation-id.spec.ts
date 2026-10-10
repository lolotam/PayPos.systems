import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attendanceInstallationSignal } from '@pospay/contracts';
import { announceOperatorChange } from '@/staff-login/model/operator-change';
import { announcePersonalChange } from './session-change';
import {
  attendanceInstallationId,
  INSTALLATION_KEY,
  INSTALLATION_STORAGE_BLOCKED,
} from './installation-id';

const v4 = (value: string) =>
  attendanceInstallationSignal.safeParse({ installation_id: value }).success;
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it('generates one random v4 id and keeps it across personal logout and operator replacement', () => {
  const id = attendanceInstallationId();
  expect(v4(id)).toBe(true);
  expect(localStorage.getItem(INSTALLATION_KEY)).toBe(id);
  announcePersonalChange();
  announceOperatorChange();
  expect(attendanceInstallationId()).toBe(id);
});

it('replaces a tampered or non-v4 stored value instead of sending arbitrary data', () => {
  for (const tampered of ['browser-fingerprint', '01920000-0000-7000-8000-0000000000a2']) {
    localStorage.setItem(INSTALLATION_KEY, tampered);
    const id = attendanceInstallationId();
    expect(id).not.toBe(tampered);
    expect(v4(id)).toBe(true);
    expect(localStorage.getItem(INSTALLATION_KEY)).toBe(id);
  }
});

it('blocked storage refuses instead of inventing a page-lifetime id', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('SYNTHETIC_BLOCKED');
  });
  expect(() => attendanceInstallationId()).toThrow(INSTALLATION_STORAGE_BLOCKED);
});

it('storage that reads but cannot write also refuses', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('SYNTHETIC_QUOTA');
  });
  expect(() => attendanceInstallationId()).toThrow(INSTALLATION_STORAGE_BLOCKED);
});

it('requests persistent storage once and ignores a rejected request', async () => {
  vi.resetModules();
  const persist = vi.fn().mockRejectedValue(new Error('SYNTHETIC_DENIED'));
  vi.stubGlobal('navigator', { storage: { persist } });
  const installation = await import('./installation-id');
  installation.attendanceInstallationId();
  installation.attendanceInstallationId();
  await Promise.resolve();
  expect(persist).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
