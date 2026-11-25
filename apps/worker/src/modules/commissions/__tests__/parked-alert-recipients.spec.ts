import { expect, it } from 'vitest';

import { groupParkedAlertRecipients } from '../domain/parked-alert-recipients.ts';

const owner = (index: number): string => `01920000-0000-7000-8000-${String(index).padStart(12, '0')}`;

it('gives no group for no owner', () => {
  expect(groupParkedAlertRecipients([], 100)).toEqual([]);
});

it('gives one group holding every owner, sorted and without duplicates', () => {
  expect(groupParkedAlertRecipients([owner(2), owner(1), owner(2)], 100)).toEqual([
    [owner(1), owner(2)],
  ]);
});

it('splits the owners into groups of at most the given size', () => {
  const owners = Array.from({ length: 101 }, (_, index) => owner(index));
  const groups = groupParkedAlertRecipients(owners, 100);
  expect(groups).toHaveLength(2);
  expect(groups[0]).toHaveLength(100);
  expect(groups[1]).toEqual([owner(100)]);
});

it('refuses a group size that is not a positive integer', () => {
  expect(() => groupParkedAlertRecipients([owner(1)], 0)).toThrow(RangeError);
  expect(() => groupParkedAlertRecipients([owner(1)], -1)).toThrow(RangeError);
  expect(() => groupParkedAlertRecipients([owner(1)], 1.5)).toThrow(RangeError);
});
