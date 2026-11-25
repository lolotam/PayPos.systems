import { expect, it } from 'vitest';

import { pinState } from '../staff-pin-state.ts';

const now = new Date('2026-11-25T10:00:00.000Z');

it('a permanent PIN without an expiry is usable', () => {
  expect(pinState({ temporary: false, expiresAt: null }, now)).toBe('USABLE');
});

it('a temporary PIN before its expiry needs a change', () => {
  expect(
    pinState({ temporary: true, expiresAt: new Date('2026-11-25T10:00:00.001Z') }, now),
  ).toBe('CHANGE_REQUIRED');
});

it('a temporary PIN at the moment of its expiry is already expired', () => {
  expect(pinState({ temporary: true, expiresAt: now }, now)).toBe('EXPIRED');
});

it('a temporary PIN after its expiry is expired', () => {
  expect(pinState({ temporary: true, expiresAt: new Date('2026-11-25T09:59:59.999Z') }, now)).toBe(
    'EXPIRED',
  );
});

it('a temporary PIN without an expiry still needs a change', () => {
  expect(pinState({ temporary: true, expiresAt: null }, now)).toBe('CHANGE_REQUIRED');
});

it('a row without the temporary flag reads as a permanent PIN', () => {
  expect(pinState({}, now)).toBe('USABLE');
});

it('an expired permanent PIN is expired too, so the expiry rule outranks the flag', () => {
  expect(pinState({ temporary: false, expiresAt: new Date('2026-11-25T09:59:59.000Z') }, now)).toBe(
    'EXPIRED',
  );
});
