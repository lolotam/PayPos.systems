import { expect, it } from 'vitest';

import { computePeriod } from '../period-commission.ts';
import { selectCommissionPlanVersion } from '../plan-version.ts';
import {
  parseSalaryMultiple,
  resolveCommissionPlan,
  selectSalaryOnLastDay,
} from '../salary-thresholds.ts';
import { fixed, line, pct, period, sale, version } from './engine-ii-fixtures.ts';

const salaryPlan = version({
  base: { enabled: false },
  tiers: {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'MARGINAL',
    steps: [{ from: { kind: 'SALARY_MULTIPLE', value: 125n }, calc: pct(1000n) }],
  },
});

it.each([
  ['1', 100n],
  ['1.2', 120n],
  ['1.25', 125n],
  ['0.01', 1n],
  ['9007199254740993.25', 900719925474099325n],
] as const)('parses k=%s exactly into hundredths', (input, expected) => {
  // كل k يُضرب في 100؛ مثلاً 1.25 × 100 = 125، بلا تحويل عشري عائم.
  expect(parseSalaryMultiple(input)).toEqual({ ok: true, hundredths: expected });
});

it.each(['0', '0.00', '-1.25', '1.251', '1e2', 'NaN', '', ' 1.25', '.25', '1.'])(
  'rejects invalid salary multiple %s without rounding',
  (input) => {
    expect(parseSalaryMultiple(input)).toEqual({ ok: false, code: 'INVALID_THRESHOLD' });
  },
);

it('salary selection uses latest effective date through the last day, scoped by employee', () => {
  const salaries = [
    { employeeId: 'employee-a', effectiveFrom: '2026-10-01', amount: 500000n },
    { employeeId: 'employee-b', effectiveFrom: '2026-10-31', amount: 999999n },
    { employeeId: 'employee-a', effectiveFrom: '2026-11-01', amount: 900000n },
    { employeeId: 'employee-a', effectiveFrom: '2026-10-31', amount: 1001n },
  ];
  // راتب 31 أكتوبر هو 1001 فلس؛ راتب نوفمبر والموظفة الأخرى لا يدخلان أكتوبر.
  expect(selectSalaryOnLastDay('employee-a', '2026-10-31', salaries)).toBe(1001n);
  expect(selectSalaryOnLastDay('employee-a', '2026-09-30', salaries)).toBeNull();
  expect(
    selectSalaryOnLastDay('employee-a', '2026-10-31', [
      { employeeId: 'employee-a', effectiveFrom: '2026-10-31', amount: 0n },
    ]),
  ).toBe(0n);
});

it('fractional-mill salary threshold stays exact through marginal pricing', () => {
  const input = period({
    lines: [line({ netShare: 2000n })],
    versions: [salaryPlan],
    salaries: [{ employeeId: 'employee-a', effectiveFrom: '2026-10-31', amount: 1001n }],
  });
  // 1.25 × 1001 = 1251.25؛ (2000 − 1251.25) × 10% = 74.875 → 75 فلس.
  expect(computePeriod(input)).toEqual({
    ok: true,
    perSource: new Map([['line:a', 75n]]),
    total: 75n,
  });
  // الحد الدقيق على مقياس 100 هو 125125؛ هذا ليس 1251 فلساً مقرباً.
  expect(resolveCommissionPlan(salaryPlan, 1001n)).toEqual({
    ok: true,
    plan: {
      base: { enabled: false },
      tiers: {
        enabled: true,
        accumulator: 'AMOUNT',
        mode: 'MARGINAL',
        thresholdScale: 100n,
        steps: [{ from: 125125n, calc: pct(1000n) }],
      },
    },
  });
});

it('WHOLE does not prematurely reach a fractional salary threshold', () => {
  const tiers = {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'WHOLE',
    steps: [{ from: { kind: 'SALARY_MULTIPLE', value: 125n }, calc: fixed(2000n) }],
  } as const;
  const input = period({
    lines: [line({ netShare: 1251n })],
    versions: [version({ base: { enabled: false }, tiers })],
    salaries: [{ employeeId: 'employee-a', effectiveFrom: '2026-10-01', amount: 1001n }],
  });
  // 1251 < 1251.25: صفر؛ إضافة فلس ترفع 1252 فوق الحد فتدفع الثابت 2000.
  expect(computePeriod(input)).toEqual({
    ok: true,
    perSource: new Map([['line:a', 0n]]),
    total: 0n,
  });
  expect(computePeriod({ ...input, lines: [line({ netShare: 1252n })] })).toEqual({
    ok: true,
    perSource: new Map([['line:a', 2000n]]),
    total: 2000n,
  });
});

it('ordinary and whole-period versions use createdAt then version, with accumulators spanning changes', () => {
  const tiers = {
    enabled: true,
    accumulator: 'AMOUNT',
    mode: 'MARGINAL',
    steps: [{ from: { kind: 'AMOUNT', value: 100000n }, calc: pct(1000n) }],
  } as const;
  const old = version({ base: { enabled: false }, tiers });
  const whole = version({
    effectiveFrom: '2026-10-20',
    wholePeriod: true,
    createdAt: 2n,
    version: 2n,
    base: { enabled: true, calc: pct(100n) },
    tiers,
  });
  const ordinary = version({
    effectiveFrom: '2026-10-25',
    createdAt: 3n,
    version: 3n,
    base: { enabled: true, calc: pct(200n) },
    tiers,
  });
  const versions = Object.freeze([ordinary, old, whole]);
  expect(selectCommissionPlanVersion('employee-a', '2026-10-10', versions)).toBe(whole);
  expect(selectCommissionPlanVersion('employee-a', '2026-10-25', versions)).toBe(ordinary);
  expect(selectCommissionPlanVersion('employee-a', '2026-09-30', versions)).toBeNull();
  expect(selectCommissionPlanVersion('employee-b', '2026-10-25', versions)).toBeNull();
  // قبل الحد: 100000 × 1% = 1000؛ الإصدار اللاحق لا يصفر الحد: 2% + 10% = 12000.
  expect(
    computePeriod(
      period({
        versions,
        lines: [line(), line({ lineId: 'b', occurredAt: 2n, businessDate: '2026-10-25' })],
      }),
    ),
  ).toEqual({
    ok: true,
    perSource: new Map([
      ['line:a', 1000n],
      ['line:b', 12000n],
    ]),
    total: 13000n,
  });
});

it('equal createdAt picks greatest version, and whole-period does not reach the previous month', () => {
  const first = version({ version: 1n, createdAt: 10n });
  const winner = version({ version: 3n, createdAt: 10n });
  expect(selectCommissionPlanVersion('employee-a', '2026-10-01', [winner, first])).toBe(winner);
  expect(
    selectCommissionPlanVersion('employee-a', '2026-10-31', [
      version({
        effectiveFrom: '2026-11-20',
        wholePeriod: true,
      }),
    ]),
  ).toBeNull();
});

it('business date at 21:30 UTC uses the next Kuwait date for version eligibility', () => {
  // 30 سبتمبر 21:30 UTC = 1 أكتوبر 00:30 بالكويت؛ 100000 × 10% = 10000.
  expect(
    computePeriod(
      period({
        lines: [
          line({
            occurredAt: 1790803800000000n,
            businessDate: '2026-10-01',
          }),
        ],
      }),
    ),
  ).toEqual({ ok: true, perSource: new Map([['line:a', 10000n]]), total: 10000n });
});

it.each(['line', 'sale'] as const)(
  'D-57 missing salary rejects a %s even when its value is zero',
  (kind) => {
    const input = period({
      versions: [salaryPlan],
      lines: kind === 'line' ? [line({ netShare: 0n })] : [],
      sales: kind === 'sale' ? [sale({ pricePaid: 0n })] : [],
    });
    expect(computePeriod(input)).toEqual({ ok: false, code: 'NO_SALARY' });
    expect(resolveCommissionPlan(salaryPlan, null)).toEqual({ ok: false, code: 'NO_SALARY' });
  },
);

it('a zero salary exists and disabled tiers do not require salary', () => {
  // راتب صفر يجعل الحد صفر؛ 100000 × 10% = 10000.
  expect(
    computePeriod(
      period({
        versions: [salaryPlan],
        lines: [line()],
        salaries: [{ employeeId: 'employee-a', effectiveFrom: '2026-10-01', amount: 0n }],
      }),
    ),
  ).toEqual({ ok: true, perSource: new Map([['line:a', 10000n]]), total: 10000n });
  expect(resolveCommissionPlan(version(), null).ok).toBe(true);
});
