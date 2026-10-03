import { describe, expect, it } from 'vitest';

import { attendanceQrToken } from '../staff/attendance-qr.js';

const valid = {
  branch_id: '01920000-0000-7000-8000-000000000001',
  window: 100,
  sig: 'ab'.repeat(32),
};

describe('attendance QR transport', () => {
  it('contains only the branch, safe non-negative window and fixed-length signature', () => {
    expect(attendanceQrToken.parse(valid)).toEqual(valid);
    for (const partial of [
      { branch_id: 'unknown' },
      { window: -1 },
      { window: 0.5 },
      { window: Number.MAX_SAFE_INTEGER + 1 },
      { sig: 'g'.repeat(64) },
      { sig: '00' },
      { secret: 'synthetic-extra-field' },
    ])
      expect(attendanceQrToken.safeParse({ ...valid, ...partial }).success).toBe(false);
  });
});
