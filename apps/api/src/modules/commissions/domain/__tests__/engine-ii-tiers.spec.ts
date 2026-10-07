import { expect, it } from 'vitest';

import { computePeriod } from '../period-commission.ts';
import type { CommissionTierStep } from '../plan-types.ts';
import { fixed, line, pct, period, version } from './engine-ii-fixtures.ts';

const steps = (
  first: CommissionTierStep['calc'],
  second: CommissionTierStep['calc'],
): CommissionTierStep[] => [
  { from: { kind: 'AMOUNT', value: 0n }, calc: first },
  { from: { kind: 'AMOUNT', value: 50000n }, calc: second },
];

it.each([
  // PCT→PCT: 50000 × 5% + 50000 × 10% = 7500 فلس.
  [pct(500n), pct(1000n), 'MARGINAL', 7500n],
  // PCT→FIXED: لمس الثابت يثبت القديم، 100000 × 5% = 5000.
  [pct(500n), fixed(2000n), 'MARGINAL', 5000n],
  // FIXED→PCT: لمس الثابت يثبت القديم، 2000 × 100% = 2000.
  [fixed(2000n), pct(1000n), 'MARGINAL', 2000n],
  // WHOLE وصل للنسبة الثانية: 100000 × 10% = 10000.
  [pct(500n), pct(1000n), 'WHOLE', 10000n],
  // WHOLE وصل للثابت الثاني: 2000 × 100% = 2000.
  [pct(500n), fixed(2000n), 'WHOLE', 2000n],
  // WHOLE يستبدل الثابت بالنِسبة الثانية: 100000 × 10% = 10000.
  [fixed(2000n), pct(1000n), 'WHOLE', 10000n],
] as const)('crossing %o → %o in %s', (first, second, mode, expected) => {
  expect(
    computePeriod(
      period({
        lines: [line()],
        versions: [
          version({
            base: { enabled: false },
            tiers: { enabled: true, accumulator: 'AMOUNT', mode, steps: steps(first, second) },
          }),
        ],
      }),
    ),
  ).toEqual({ ok: true, perSource: new Map([['line:a', expected]]), total: expected });
});

it.each(['MARGINAL', 'WHOLE'] as const)(
  'counts=false earns without moving %s accumulator',
  (mode) => {
    const input = period({
      lines: [
        line({ lineId: 'a', ruleSnapshot: { kind: 'ZERO' } }),
        line({ lineId: 'b', occurredAt: 2n, counts: false, netShare: 900000n }),
        line({ lineId: 'c', occurredAt: 3n }),
      ],
      versions: [
        version({
          base: { enabled: false },
          tiers: {
            enabled: true,
            mode,
            accumulator: 'AMOUNT',
            steps: [
              { from: { kind: 'AMOUNT', value: 100000n }, calc: pct(1000n) },
              { from: { kind: 'AMOUNT', value: 300000n }, calc: pct(2000n) },
            ],
          },
        }),
      ],
    });
    // فقط a وc يجمعان 200000؛ المستبعد b يكسب 900000 × 10% = 90000، وc يكسب 10000.
    expect(computePeriod(input)).toEqual({
      ok: true,
      perSource: new Map([
        ['line:a', 0n],
        ['line:b', 90000n],
        ['line:c', 10000n],
      ]),
      total: 100000n,
    });
  },
);

it('SESSIONS MARGINAL uses the step before a half-share line; all rules advance counted lines', () => {
  const selected = version({
    base: { enabled: false },
    tiers: {
      enabled: true,
      mode: 'MARGINAL',
      accumulator: 'SESSIONS',
      steps: [
        { from: { kind: 'SESSIONS', value: 1n }, calc: fixed(2000n) },
        { from: { kind: 'SESSIONS', value: 2n }, calc: pct(2000n) },
      ],
    },
  });
  // a يعد جلسة رغم ZERO؛ b عند 1 يدفع 2000 × نصف = 1000؛ c عند 2 يدفع 50000 × 20% = 10000.
  const lines = [
    line({ ruleSnapshot: { kind: 'ZERO' } }),
    line({ lineId: 'b', occurredAt: 2n, netShare: 50000n, shareBps: 5000n }),
    line({ lineId: 'c', occurredAt: 3n, netShare: 50000n, shareBps: 5000n }),
  ];
  expect(computePeriod(period({ lines, versions: [selected] }))).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', 0n],
      ['line:b', 1000n],
      ['line:c', 10000n],
    ]),
    total: 11000n,
  });
});

it('WHOLE reaches x=from exactly and scales FIXED by a half share', () => {
  // النهائي جلستان = الحد؛ الثابت 2000 × نصف = 1000 لكل بند، مجموع 2000.
  expect(
    computePeriod(
      period({
        lines: [line({ shareBps: 5000n }), line({ lineId: 'b', occurredAt: 2n, shareBps: 5000n })],
        versions: [
          version({
            base: { enabled: false },
            tiers: {
              enabled: true,
              mode: 'WHOLE',
              accumulator: 'SESSIONS',
              steps: [{ from: { kind: 'SESSIONS', value: 2n }, calc: fixed(2000n) }],
            },
          }),
        ],
      }),
    ),
  ).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', 1000n],
      ['line:b', 1000n],
    ]),
    total: 2000n,
  });
});

it('WHOLE below its first step pays no tiers', () => {
  // جلسة واحدة أقل من حد جلستين: الشريحة صفر، الأساسي 100000 × 10% = 10000.
  expect(
    computePeriod(
      period({
        lines: [line()],
        versions: [
          version({
            tiers: {
              enabled: true,
              accumulator: 'SESSIONS',
              mode: 'WHOLE',
              steps: [{ from: { kind: 'SESSIONS', value: 2n }, calc: fixed(2000n) }],
            },
          }),
        ],
      }),
    ),
  ).toEqual({ ok: true, perSource: new Map([['line:a', 10000n]]), total: 10000n });
});

it.each([
  // المستبعد b لا يعد جلسة: عند x=1 يدفع الثابت 2000 × نصف = 1000، وc نفس الثابت؛ المجموع 2000.
  ['MARGINAL', 1000n, 2000n],
  // النهائي جلستان من a وc فقط: WHOLE يدفع 50000 × 20% = 10000 لكل من b وc؛ المجموع 20000.
  ['WHOLE', 10000n, 20000n],
] as const)(
  'SESSIONS counts=false stays eligible without advancing %s',
  (mode, expected, total) => {
    expect(
      computePeriod(
        period({
          lines: [
            line({ ruleSnapshot: { kind: 'ZERO' } }),
            line({ lineId: 'b', occurredAt: 2n, counts: false, netShare: 50000n, shareBps: 5000n }),
            line({ lineId: 'c', occurredAt: 3n, netShare: 50000n, shareBps: 5000n }),
          ],
          versions: [
            version({
              base: { enabled: false },
              tiers: {
                enabled: true,
                accumulator: 'SESSIONS',
                mode,
                steps: [
                  { from: { kind: 'SESSIONS', value: 1n }, calc: fixed(2000n) },
                  { from: { kind: 'SESSIONS', value: 2n }, calc: pct(2000n) },
                  { from: { kind: 'SESSIONS', value: 3n }, calc: fixed(90000n) },
                ],
              },
            }),
          ],
        }),
      ),
    ).toEqual({
      ok: true,
      perSource: new Map([
        ['line:a', 0n],
        ['line:b', expected],
        ['line:c', expected],
      ]),
      total,
    });
  },
);
