import { expect, it } from 'vitest';
import {
  STAFF_ACCESS_ROLES,
  TEMPORARY_STAFF_PIN_TTL_MS,
  staffAccessSystemRole,
  temporaryStaffPinExpiresAt,
} from '../staff-access-roles.ts';

it('D1 the request offers exactly two closed roles', () => {
  expect([...STAFF_ACCESS_ROLES]).toEqual(['staff', 'reception']);
});

it('D1 reception maps to the cashier system role and staff stays staff', () => {
  expect(staffAccessSystemRole('staff')).toBe('staff');
  expect(staffAccessSystemRole('reception')).toBe('cashier');
});

it('D4 the temporary PIN lives 24 hours from the moment it was set', () => {
  expect(TEMPORARY_STAFF_PIN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  const setAt = new Date('2026-11-23T10:00:00Z');
  expect(temporaryStaffPinExpiresAt(setAt).toISOString()).toBe('2026-11-24T10:00:00.000Z');
});
