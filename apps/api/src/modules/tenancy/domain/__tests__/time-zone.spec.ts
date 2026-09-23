import { describe, expect, it } from 'vitest';

import { effectiveTimeZone } from '../time-zone.ts';

describe('branch time zone (PRD D-10)', () => {
  it("is the branch's own when set", () => {
    expect(effectiveTimeZone('Asia/Riyadh', 'Asia/Kuwait')).toBe('Asia/Riyadh');
  });

  it("falls back to the business's when the branch has none", () => {
    expect(effectiveTimeZone(null, 'Asia/Kuwait')).toBe('Asia/Kuwait');
  });
});
