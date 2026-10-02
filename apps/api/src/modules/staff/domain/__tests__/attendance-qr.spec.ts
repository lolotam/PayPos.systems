import { expect, it } from 'vitest';

import {
  acceptsAttendanceQrWindow,
  attendanceQrSecretScope,
  attendanceQrTiming,
  attendanceQrWindow,
} from '../attendance-qr.ts';

it.each([
  [0, 0],
  [59_999, 0],
  [60_000, 1],
  [119_999, 1],
  [120_000, 2],
])('at %i ms uses window %i', (now, expected) => {
  expect(attendanceQrWindow(now)).toBe(expected);
});

it.each([-1, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER])('refuses invalid time %s', (now) => {
  expect(() => attendanceQrWindow(now)).toThrow(RangeError);
});

it('reports exclusive refresh and verification boundaries', () => {
  expect(attendanceQrTiming(119_999)).toEqual({
    window: 1,
    server_time: '1970-01-01T00:01:59.999Z',
    refresh_at: '1970-01-01T00:02:00.000Z',
    expires_at: '1970-01-01T00:03:00.000Z',
  });
});

it.each([
  [2, true],
  [1, true],
  [0, false],
  [3, false],
  [-1, false],
  [1.5, false],
  [NaN, false],
])('accepts exactly current/previous: %s -> %s', (window, expected) => {
  expect(acceptsAttendanceQrWindow('branch', { branch_id: 'branch', window }, 120_000)).toBe(
    expected,
  );
});

it('refuses another branch and has no negative previous window at epoch', () => {
  expect(acceptsAttendanceQrWindow('other', { branch_id: 'branch', window: 2 }, 120_000)).toBe(
    false,
  );
  expect(acceptsAttendanceQrWindow('branch', { branch_id: 'branch', window: -1 }, 0)).toBe(false);
});

it('keeps the previous day until its final window leaves tolerance', () => {
  expect(attendanceQrSecretScope('company', 'branch', 1439)).toEqual({
    companyId: 'company',
    branchId: 'branch',
    day: 0,
    retainUntil: 86_460_000,
  });
  expect(attendanceQrSecretScope('company', 'branch', 1440)).toEqual({
    companyId: 'company',
    branchId: 'branch',
    day: 1,
    retainUntil: 172_860_000,
  });
  expect(
    acceptsAttendanceQrWindow('branch', { branch_id: 'branch', window: 1439 }, 86_459_999),
  ).toBe(true);
  expect(
    acceptsAttendanceQrWindow('branch', { branch_id: 'branch', window: 1439 }, 86_460_000),
  ).toBe(false);
});
