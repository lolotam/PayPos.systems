import { expect, it } from 'vitest';
import {
  SHARED_INSTALLATION_WINDOW_MS,
  sharesInstallationWithinWindow,
} from '../shared-installation.ts';
const first = {
  companyId: 'a',
  employeeId: 'a',
  installationHash: 'hash',
  clockedAt: new Date('2026-10-04T10:00:00Z'),
};
const second = { ...first, employeeId: 'b' };
it.each([0, 1, SHARED_INSTALLATION_WINDOW_MS - 1, SHARED_INSTALLATION_WINDOW_MS])(
  'flags distinct employees at inclusive %s ms in either order',
  (distance) => {
    const next = { ...second, clockedAt: new Date(first.clockedAt.getTime() + distance) };
    expect(sharesInstallationWithinWindow(first, next)).toBe(true);
    expect(sharesInstallationWithinWindow(next, first)).toBe(true);
  },
);
it('never flags same employee, another company/install, empty signal, invalid time or beyond window', () => {
  for (const next of [
    first,
    { ...second, companyId: 'b' },
    { ...second, installationHash: 'other' },
    { ...second, installationHash: '' },
    { ...second, clockedAt: new Date('invalid') },
    {
      ...second,
      clockedAt: new Date(first.clockedAt.getTime() + SHARED_INSTALLATION_WINDOW_MS + 1),
    },
  ])
    expect(sharesInstallationWithinWindow(first, next)).toBe(false);
  expect(
    sharesInstallationWithinWindow(
      { ...first, installationHash: '' },
      { ...second, installationHash: '' },
    ),
  ).toBe(false);
});
it('supports an explicitly selected window and refuses nonsensical windows', () => {
  expect(sharesInstallationWithinWindow(first, second, 0)).toBe(true);
  for (const window of [-1, NaN, Infinity])
    expect(sharesInstallationWithinWindow(first, second, window)).toBe(false);
});
