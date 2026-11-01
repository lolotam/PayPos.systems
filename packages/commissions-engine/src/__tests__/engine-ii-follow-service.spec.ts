import { expect, it } from 'vitest';

import type { ServiceCommissionOverride, ServiceCommissionRule } from '../commission-types.ts';
import { computePeriod } from '../period-commission.ts';
import { fixed, line, pct, period } from './engine-ii-fixtures.ts';

const override = (patch: Partial<ServiceCommissionOverride> = {}): ServiceCommissionOverride => ({
  id: 'override-a',
  employeeId: 'employee-a',
  serviceId: 'service-a',
  effectiveFrom: '2026-10-10',
  createdAt: 1n,
  rule: { kind: 'FOLLOW_SERVICE' },
  ...patch,
});

it.each([
  // ZERO: صفر.
  { snapshot: { kind: 'ZERO' } as const, amount: 0n },
  // PCT 1000 على نصيب 100000: 100000 × 1000 ÷ 10000 = 10000 فلس.
  { snapshot: pct(1000n), amount: 10000n },
  // FIXED 2000 على حصة كاملة: 10000 × 2000 ÷ 10000 = 2000 فلس.
  { snapshot: fixed(2000n), amount: 2000n },
] satisfies { snapshot: ServiceCommissionRule; amount: bigint }[])(
  'a winning reset prices the standalone snapshot %o without any plan',
  ({ snapshot, amount }) => {
    const input = period({
      lines: [line({ ruleSnapshot: snapshot })],
      versions: [],
      overrides: [override()],
    });
    expect(computePeriod(input)).toEqual({
      ok: true,
      perSource: new Map([['line:a', amount]]),
      total: amount,
    });
  },
);

it('a winning reset to FOLLOW_PLAN prices the employee plan', () => {
  const input = period({
    lines: [line({ ruleSnapshot: { kind: 'FOLLOW_PLAN' } })],
    overrides: [override()],
  });
  // الأساسي 10% من نصيب 100000 = 10000 فلس.
  expect(computePeriod(input)).toEqual({
    ok: true,
    perSource: new Map([['line:a', 10000n]]),
    total: 10000n,
  });
});

it('a reset to FOLLOW_PLAN still needs a plan and returns NO_PLAN without one', () => {
  const input = period({
    lines: [line({ ruleSnapshot: { kind: 'FOLLOW_PLAN' } })],
    versions: [],
    overrides: [override()],
  });
  expect(computePeriod(input)).toEqual({ ok: false, code: 'NO_PLAN' });
});

it('an explicit override still wins over the saved snapshot', () => {
  const input = period({
    lines: [line({ ruleSnapshot: pct(1000n) })],
    overrides: [override({ rule: pct(1500n) })],
  });
  // 100000 × 1500 ÷ 10000 = 15000 فلس، مش 10000 بتاع اللقطة.
  expect(computePeriod(input)).toEqual({
    ok: true,
    perSource: new Map([['line:a', 15000n]]),
    total: 15000n,
  });
});

it('the reset does not resume an older override, and each line keeps its own saved snapshot', () => {
  const older = override({
    id: 'override-old',
    createdAt: 1n,
    effectiveFrom: '2026-10-01',
    rule: pct(1500n),
  });
  const reset = override({ id: 'override-reset', createdAt: 2n, effectiveFrom: '2026-10-10' });
  const input = period({
    lines: [
      // 9 أكتوبر: التجاوز الأقدم هو الساري — 100000 × 1500 ÷ 10000 = 15000 فلس.
      line({ businessDate: '2026-10-09', ruleSnapshot: pct(1000n) }),
      // 10 أكتوبر: إعادة التوجيه ترجع لقطة السطر نفسه — 10000 × 2000 ÷ 10000 = 2000 فلس.
      line({ lineId: 'b', occurredAt: 2n, businessDate: '2026-10-10', ruleSnapshot: fixed(2000n) }),
    ],
    overrides: [older, reset],
  });
  expect(computePeriod(input)).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', 15000n],
      ['line:b', 2000n],
    ]),
    total: 17000n,
  });
});

it('an override reaches only its own service line', () => {
  const input = period({
    lines: [
      line({ ruleSnapshot: pct(1000n) }),
      line({ lineId: 'b', occurredAt: 2n, serviceId: 'service-b', ruleSnapshot: pct(1000n) }),
    ],
    overrides: [override({ rule: pct(1500n) })],
  });
  // خدمة a: 15000 فلس من التجاوز؛ خدمة b: 10000 فلس من لقطة سطرها.
  expect(computePeriod(input)).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', 15000n],
      ['line:b', 10000n],
    ]),
    total: 25000n,
  });
});
