import { describe, expect, it } from 'vitest';

import { PackageRuleError } from '../packages/errors.js';
import { remainingAfterDraftPicks } from '../packages/package-draft-remaining.js';

function expectInvalidRemaining(componentRemaining: number, otherDraftPicks: number) {
  try {
    remainingAfterDraftPicks(componentRemaining, otherDraftPicks);
  } catch (error) {
    expect(error).toBeInstanceOf(PackageRuleError);
    expect((error as PackageRuleError).code).toBe('INVALID_REMAINING_SESSIONS');
    return;
  }
  throw new Error('Expected invalid remaining sessions to be rejected');
}

describe('remainingAfterDraftPicks', () => {
  it.each([
    [5, 2, 3],
    [2, 5, 0],
    [5, 0, 5],
    [0, 0, 0],
    [0, 3, 0],
    [Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER - 1],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0],
  ])('returns %s remaining minus %s picks as %s', (remaining, picks, expected) => {
    expect(remainingAfterDraftPicks(remaining, picks)).toBe(expected);
  });

  it.each([
    [-1, 0],
    [0, -1],
    [1.5, 0],
    [0, 1.5],
    [NaN, 0],
    [0, NaN],
    [Infinity, 0],
    [0, Infinity],
    [-Infinity, 0],
    [0, -Infinity],
    [Number.MAX_SAFE_INTEGER + 1, 0],
    [0, Number.MAX_SAFE_INTEGER + 1],
  ])('rejects invalid remaining %s and picks %s', (remaining, picks) => {
    expectInvalidRemaining(remaining, picks);
  });
});
