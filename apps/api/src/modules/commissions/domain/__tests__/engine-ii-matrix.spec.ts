import { describe, expect, it } from 'vitest';

import { computePeriod } from '../period-commission.ts';
import type { CommissionThreshold } from '../plan-types.ts';
import { line, pct, period, version } from './engine-ii-fixtures.ts';

const thresholdRows = [
  { accumulator: 'AMOUNT', kind: 'AMOUNT', value: 100000n },
  { accumulator: 'AMOUNT', kind: 'SALARY_MULTIPLE', value: 100n },
  { accumulator: 'SESSIONS', kind: 'SESSIONS', value: 1n },
] as const;

const expectations = [
  // بلا أساسي ولا شرائح: صفر + صفر = صفر في كل الأنواع والأوضاع.
  { mode: 'MARGINAL', base: false, tiers: false, amounts: [0n, 0n], total: 0n },
  // الأساسي 100000 × 1% = 1000 لكل بند؛ المجموع 2000 فلس.
  { mode: 'MARGINAL', base: true, tiers: false, amounts: [1000n, 1000n], total: 2000n },
  // الحد مئة دينار أو جلسة أو راتب واحد: الأول صفر والثاني 100000 × 10% = 10000.
  { mode: 'MARGINAL', base: false, tiers: true, amounts: [0n, 10000n], total: 10000n },
  // الأساسي 1000 لكل بند يضاف إلى صفر ثم 10000؛ المجموع 12000.
  { mode: 'MARGINAL', base: true, tiers: true, amounts: [1000n, 11000n], total: 12000n },
  // المكوّنان معطلان: صفر + صفر = صفر حتى في WHOLE.
  { mode: 'WHOLE', base: false, tiers: false, amounts: [0n, 0n], total: 0n },
  // الأساسي وحده 1000 لكل بند، مجموع 2000 فلس.
  { mode: 'WHOLE', base: true, tiers: false, amounts: [1000n, 1000n], total: 2000n },
  // النهائي تجاوز الحد: كل بند 100000 × 10% = 10000؛ المجموع 20000.
  { mode: 'WHOLE', base: false, tiers: true, amounts: [10000n, 10000n], total: 20000n },
  // الأساسي 1000 + الشريحة 10000 = 11000 لكل بند، مجموع 22000.
  { mode: 'WHOLE', base: true, tiers: true, amounts: [11000n, 11000n], total: 22000n },
] as const;

const cases = thresholdRows.flatMap((row) =>
  expectations.map((expected) => ({ ...row, ...expected })),
);

it.each(cases)('§5.8 $kind/$mode base=$base tiers=$tiers', (fixture) => {
  const from: CommissionThreshold = { kind: fixture.kind, value: fixture.value };
  const selected = version({
    base: fixture.base ? { enabled: true, calc: pct(100n) } : { enabled: false },
    tiers: fixture.tiers
      ? {
          enabled: true,
          accumulator: fixture.accumulator,
          mode: fixture.mode,
          steps: [{ from, calc: pct(1000n) }],
        }
      : { enabled: false },
  });
  const result = computePeriod(
    period({
      lines: [line(), line({ lineId: 'b', occurredAt: 2n })],
      versions: [selected],
      salaries: [{ employeeId: 'employee-a', effectiveFrom: '2026-10-01', amount: 100000n }],
    }),
  );
  expect(result).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', fixture.amounts[0]],
      ['line:b', fixture.amounts[1]],
    ]),
    total: fixture.total,
  });
});

// TODO(spec) D-55: قواعد الصالون الفعلية مطلوبة قبل الدمج؛ الأرقام الاصطناعية ليست بديلاً عنها.
describe('D-55 real salon plans (merge blocker)', () => {
  it.todo(
    'TODO(spec) D-55 — one hand-calculated fixture per real plan after owner supplies salon rules',
  );
});
