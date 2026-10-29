import { describe, expect, it } from 'vitest';

import { ratingOptOutDecision } from '../rating-opt-out.ts';

const EXPIRES_AT = new Date('2026-06-08T00:00:00Z');

describe('the rating opt-out decision', () => {
  it('refuses one millisecond before the expiry', () => {
    const now = new Date(EXPIRES_AT.getTime() - 1);
    expect(ratingOptOutDecision(EXPIRES_AT, now, null)).toBe('OPTED_OUT');
  });

  it('treats the expiry instant as expired', () => {
    expect(ratingOptOutDecision(EXPIRES_AT, EXPIRES_AT, null)).toBe('LINK_UNAVAILABLE');
  });

  it('treats a later moment as expired', () => {
    const now = new Date(EXPIRES_AT.getTime() + 1);
    expect(ratingOptOutDecision(EXPIRES_AT, now, null)).toBe('LINK_UNAVAILABLE');
  });

  it('reports an expired link even when the customer already opted out', () => {
    const now = new Date(EXPIRES_AT.getTime() + 1);
    expect(ratingOptOutDecision(EXPIRES_AT, now, new Date('2026-06-02T00:00:00Z'))).toBe(
      'LINK_UNAVAILABLE',
    );
  });

  it('does not write again when the customer already opted out', () => {
    const now = new Date('2026-06-02T00:00:00Z');
    expect(ratingOptOutDecision(EXPIRES_AT, now, new Date('2026-06-01T00:00:00Z'))).toBe(
      'ALREADY_OPTED_OUT',
    );
  });
});
