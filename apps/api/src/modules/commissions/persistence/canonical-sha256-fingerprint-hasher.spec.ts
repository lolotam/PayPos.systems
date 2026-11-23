import { buildCanonicalInput, type CanonicalInputRows } from '@pospay/commissions-engine';
import { describe, expect, it } from 'vitest';

import { CanonicalSha256FingerprintHasher } from './canonical-sha256-fingerprint-hasher.ts';

const hasher = new CanonicalSha256FingerprintHasher();
const EMPLOYEE = '01920000-0000-7000-8000-0000000000e1';
const SOURCE_STATEMENT = '01920000-0000-7000-8000-0000000000d1';

/** شهر صغير: بند بنسبة لقطة وبقشيش كارت وترحيل عمولة؛ كفاية لإثبات إن مفيش bigint هرب. */
function month(): CanonicalInputRows {
  return {
    lines: [
      {
        employeeId: EMPLOYEE,
        lineId: 'line-1',
        serviceId: 'service-1',
        revision: 1n,
        occurredAt: 1_790_000_000_000_001n,
        recordedAt: 1_790_000_000_000_002n,
        businessDate: '2026-10-05',
        netShare: 100_000n,
        shareBps: 10_000n,
        counts: true,
        ruleSnapshot: { kind: 'PCT', value: 1_000n },
        status: 'ACTIVE',
      },
    ],
    sales: [],
    tips: [
      {
        sessionId: 'session-1',
        employeeId: EMPLOYEE,
        revision: 1n,
        businessDate: '2026-10-05',
        method: 'CARD',
        amount: 6_000n,
      },
    ],
    salaries: [],
    versions: [],
    overrides: [],
    corrections: [],
    blocked: [],
    carries: [
      {
        employeeId: EMPLOYEE,
        kind: 'COMMISSION',
        amount: -5_000n,
        sourceStatementId: SOURCE_STATEMENT,
        sourcePeriod: '2026-09',
        targetPeriod: '2026-10',
      },
    ],
  };
}

describe('the fingerprint hasher over the real canonical serializer', () => {
  it('matches an independently computed SHA-256 of the canonical text', () => {
    // التسلسل الثابت مكتوب بإيدي هنا (مفاتيح مرتبة، من غير مسافات)، والتجزئة محسوبة برا الكود ده.
    expect(hasher.hash({ b: [true, null, 'x'], a: 1 })).toBe(
      'eca8cfb31ab74533e1eb2f4c74d2d55dfe3c79ac704787e54be8647ea7777eb1',
    );
  });

  it('gives the same hash whatever the key order of the value', () => {
    expect(hasher.hash({ a: 1, b: { y: 2, x: 1 } })).toBe(hasher.hash({ b: { x: 1, y: 2 }, a: 1 }));
  });

  it('refuses a bigint instead of hashing it silently', () => {
    expect(() => hasher.hash({ amount: 1n })).toThrow(TypeError);
  });

  it('hashes the real input-fingerprint builder output into the 64 hex characters of the column', () => {
    const input = buildCanonicalInput('2026-10', month());
    expect(hasher.hash(input)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('moves the input fingerprint when a writer changes an input', () => {
    const before = hasher.hash(buildCanonicalInput('2026-10', month()));
    const base = month();
    const changed = { ...base, tips: base.tips.map((tip) => ({ ...tip, amount: 6_001n })) };
    expect(hasher.hash(buildCanonicalInput('2026-10', changed))).not.toBe(before);
  });
});
