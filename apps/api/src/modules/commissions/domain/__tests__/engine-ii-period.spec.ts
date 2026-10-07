import { expect, it, vi } from 'vitest';
import * as kernel from '@pospay/domain';

import { allocateLineShares } from '../line-shares.ts';
import { computePeriod } from '../period-commission.ts';
import type { ServiceCommissionRule } from '../commission-types.ts';
import { fixed, line, pct, period, sale, version } from './engine-ii-fixtures.ts';

it.each([
  // ZERO يستبدل الأساسي والشريحة: صفر.
  [{ kind: 'ZERO' }, 0n],
  // نصف النصيب 50000 × 5% = 2500 فلس.
  [pct(500n), 2500n],
  // الثابت 2000 × نصف المؤدية = 1000 فلس.
  [fixed(2000n), 1000n],
  // غياب التجاوز: الأساسي 50000 × 10% = 5000 والشريحة الثابتة 2000 × نصف = 1000؛ 6000.
  [null, 6000n],
] satisfies [ServiceCommissionRule | null, bigint][])(
  'override %o on a half share',
  (rule, expected) => {
    const input = period({
      lines: [line({ netShare: 50000n, shareBps: 5000n })],
      versions: [
        version({
          tiers: {
            enabled: true,
            mode: 'WHOLE',
            accumulator: 'SESSIONS',
            steps: [{ from: { kind: 'SESSIONS', value: 1n }, calc: fixed(2000n) }],
          },
        }),
      ],
      overrides:
        rule === null
          ? []
          : [
              {
                id: 'override-a',
                employeeId: 'employee-a',
                serviceId: 'service-a',
                effectiveFrom: '2026-10-10',
                createdAt: 1n,
                rule,
              },
            ],
    });
    expect(computePeriod(input)).toEqual({
      ok: true,
      perSource: new Map([['line:a', expected]]),
      total: expected,
    });
  },
);

it('ties, permutation and late insertion change only chronological pricing, never inputs', () => {
  const selected = version({
    base: { enabled: false },
    tiers: {
      enabled: true,
      accumulator: 'SESSIONS',
      mode: 'MARGINAL',
      steps: [{ from: { kind: 'SESSIONS', value: 1n }, calc: pct(1000n) }],
    },
  });
  const a = Object.freeze(line({ netShare: 10000n, occurredAt: 2n, recordedAt: 2n }));
  const b = Object.freeze(line({ lineId: 'b', netShare: 20000n, occurredAt: 2n, recordedAt: 2n }));
  const c = Object.freeze(line({ lineId: 'c', netShare: 30000n, occurredAt: 2n, recordedAt: 1n }));
  // عند تساوي وقت الخدمة: c يسجل أولاً فيكسب صفر؛ a قبل b بالهوية: 1000 ثم 2000؛ مجموع 3000.
  const expected = {
    ok: true,
    perSource: new Map([
      ['line:c', 0n],
      ['line:a', 1000n],
      ['line:b', 2000n],
    ]),
    total: 3000n,
  };
  for (const lines of [
    [a, b, c],
    [c, a, b],
    [b, c, a],
    [c, b, a],
    [a, c, b],
    [b, a, c],
  ]) {
    expect(computePeriod(period({ lines: Object.freeze(lines), versions: [selected] }))).toEqual(
      expected,
    );
  }
  // قبل إدخال المتأخر: a صفر وb = 2000؛ المتأخر 5000 × لا شريحة = صفر ويفتح الشريحة لكل اللاحقين.
  expect(computePeriod(period({ lines: [a, b], versions: [selected] }))).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', 0n],
      ['line:b', 2000n],
    ]),
    total: 2000n,
  });
  expect(
    computePeriod(
      period({
        lines: [a, b, line({ lineId: 'late', occurredAt: 1n, recordedAt: 99n, netShare: 5000n })],
        versions: [selected],
      }),
    ),
  ).toEqual({
    ok: true,
    perSource: new Map([
      ['line:late', 0n],
      ['line:a', 1000n],
      ['line:b', 2000n],
    ]),
    total: 3000n,
  });
});

it.each([
  // 5 ÷ 2 أرضية 2 لكل موظفة؛ الفلس الباقي للأولى: 3 + 2 = 5.
  { net: 5n, bps: [5000n, 5000n], shares: [3n, 2n] },
  // 7 × [3333,3333,3334] ÷ 10000 أرضية [2,2,2]؛ الباقي للأولى: 3 + 2 + 2 = 7.
  { net: 7n, bps: [3333n, 3333n, 3334n], shares: [3n, 2n, 2n] },
] as const)('remainder shares sum to literal net $net', (fixture) => {
  const ids = ['employee-a', 'employee-b', 'employee-c'];
  const performers = fixture.bps.map((shareBps, index) => ({
    employeeId: ids[index] ?? '',
    shareBps,
  }));
  const actual = allocateLineShares(fixture.net, [...performers].reverse());
  expect([...actual.values()]).toEqual(fixture.shares);
  expect([...actual.values()].reduce((sum, share) => sum + share, 0n)).toBe(fixture.net);
});

it('package redemption prices literal slot unit values and sums rounded lines', () => {
  // باقة 10001 توزع إلى slots 3333،3334،3334؛ عند 10%: 333،333،333؛ المجموع 999 لا 1000.
  const lines = [
    line({ netShare: 3333n }),
    line({ lineId: 'b', occurredAt: 2n, netShare: 3334n }),
    line({ lineId: 'c', occurredAt: 3n, netShare: 3334n }),
  ];
  expect(computePeriod(period({ lines }))).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', 333n],
      ['line:b', 333n],
      ['line:c', 333n],
    ]),
    total: 999n,
  });
});

it('tiny base plus WHOLE tier rounds once per line; total is the sum of rounded lines', () => {
  const spy = vi.spyOn(kernel, 'roundKwd');
  try {
    const selected = version({
      base: { enabled: true, calc: pct(2500n) },
      tiers: {
        enabled: true,
        accumulator: 'SESSIONS',
        mode: 'WHOLE',
        steps: [{ from: { kind: 'SESSIONS', value: 1n }, calc: pct(2500n) }],
      },
    });
    // كل فلس × (25% + 25%) = نصف فلس → 1؛ البندان يجمعان 2 لا 1.
    expect(
      computePeriod(
        period({
          lines: [line({ netShare: 1n }), line({ lineId: 'b', occurredAt: 2n, netShare: 1n })],
          versions: [selected],
        }),
      ),
    ).toEqual({
      ok: true,
      perSource: new Map([
        ['line:a', 1n],
        ['line:b', 1n],
      ]),
      total: 2n,
    });
    expect(spy).toHaveBeenCalledTimes(2);
  } finally {
    spy.mockRestore();
  }
});

it('missing plans reject FOLLOW_PLAN and any seller sale, but standalone rules need no plan', () => {
  expect(computePeriod(period({ lines: [line({ netShare: 0n })], versions: [] }))).toEqual({
    ok: false,
    code: 'NO_PLAN',
  });
  expect(computePeriod(period({ sales: [sale()], versions: [] }))).toEqual({
    ok: false,
    code: 'NO_PLAN',
  });
  // صفر + نسبة 50000 × 10% + ثابت 2000 × نصف = 6000 دون خطة.
  expect(
    computePeriod(
      period({
        versions: [],
        lines: [
          line({ ruleSnapshot: { kind: 'ZERO' } }),
          line({ lineId: 'b', ruleSnapshot: pct(1000n), netShare: 50000n }),
          line({ lineId: 'c', ruleSnapshot: fixed(2000n), shareBps: 5000n }),
        ],
      }),
    ),
  ).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', 0n],
      ['line:b', 5000n],
      ['line:c', 1000n],
    ]),
    total: 6000n,
  });
});

it('empty period and out-of-scope sources have literal zero total', () => {
  // لا مصادر مؤهلة: مجموع فارغ = صفر دون طلب إعداد.
  expect(
    computePeriod(
      period({
        versions: [],
        lines: [
          line({ employeeId: 'employee-b' }),
          line({ lineId: 'november', businessDate: '2026-11-01' }),
        ],
        sales: [sale({ sellerEmployeeId: null })],
      }),
    ),
  ).toEqual({ ok: true, perSource: new Map(), total: 0n });
});
