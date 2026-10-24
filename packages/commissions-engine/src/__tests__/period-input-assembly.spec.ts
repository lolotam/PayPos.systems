import { expect, it } from 'vitest';

import { computePeriod } from '../period-commission.ts';
import { assembleCommissionPeriodInput } from '../period-input-assembly.ts';
import type { CommissionPeriodProjection } from '../period-input-types.ts';
import type { CommissionPeriodInput } from '../plan-types.ts';
import { selectSalaryEntryOnLastDay, selectSalaryOnLastDay } from '../salary-thresholds.ts';
import { pct, version } from './engine-ii-fixtures.ts';
import {
  correction,
  projectedLine,
  projectedSale,
  projection,
  salaryEntry,
  serviceOverride,
  tip,
} from './period-input-fixtures.ts';

const assemble = (patch: Partial<CommissionPeriodProjection> = {}) =>
  assembleCommissionPeriodInput(projection(patch));

function computedTotal(input: CommissionPeriodInput): bigint {
  const result = computePeriod(input);
  if (!result.ok) throw new Error(`Expected a priced period, received ${result.code}`);
  return result.total;
}

function deepFreezeProjection(source: CommissionPeriodProjection): void {
  for (const rows of Object.values(source).filter(Array.isArray)) {
    rows.forEach(Object.freeze);
    Object.freeze(rows);
  }
  Object.freeze(source);
}

it('passes every input kind through for the employee and month', () => {
  const activeLine = projectedLine();
  const activeSale = projectedSale();
  const selectedSalary = salaryEntry('employee-a', '2026-10-01', 500000n);
  const selectedVersion = version();
  const selectedOverride = serviceOverride();
  const receivedTip = tip();
  const receivedCorrection = correction();
  const assembled = assemble({
    lines: [activeLine],
    sales: [activeSale],
    salaries: [selectedSalary],
    versions: [selectedVersion],
    overrides: [selectedOverride],
    tips: [receivedTip],
    corrections: [receivedCorrection],
  });
  expect(assembled.input).toEqual({
    employeeId: 'employee-a',
    period: '2026-10',
    periodLastDay: '2026-10-31',
    lines: [activeLine],
    sales: [activeSale],
    versions: [selectedVersion],
    overrides: [selectedOverride],
    salaries: [selectedSalary],
  });
  expect(assembled.tips).toEqual([receivedTip]);
  expect(assembled.corrections).toEqual([receivedCorrection]);
});

it('drops cancelled lines that would otherwise be priced', () => {
  const active = projectedLine({ lineId: 'active' });
  const cancelled = projectedLine({ lineId: 'cancelled', status: 'CANCELLED' });
  const assembled = assemble({ lines: [active, cancelled] });
  expect(assembled.input.lines).toEqual([active]);
  expect(computedTotal(assembled.input)).toBe(10000n);
  expect(computedTotal({ ...assembled.input, lines: [active, cancelled] })).toBe(20000n);
});

it('keeps only active sales explicitly sold by this employee', () => {
  const active = projectedSale({ saleId: 'active' });
  const assembled = assemble({
    sales: [
      active,
      projectedSale({ saleId: 'cancelled', status: 'CANCELLED' }),
      projectedSale({ saleId: 'imported', sellerEmployeeId: null }),
      projectedSale({ saleId: 'other', sellerEmployeeId: 'employee-b' }),
    ],
  });
  expect(assembled.input.sales).toEqual([active]);
});

it('drops every kind of row belonging to another employee', () => {
  const assembled = assemble({
    lines: [projectedLine({ employeeId: 'employee-b' })],
    sales: [projectedSale({ sellerEmployeeId: 'employee-b' })],
    salaries: [salaryEntry('employee-b', '2026-10-01', 500000n)],
    versions: [version({ employeeId: 'employee-b' })],
    overrides: [serviceOverride({ employeeId: 'employee-b' })],
    tips: [tip({ employeeId: 'employee-b' })],
    corrections: [correction({ employeeId: 'employee-b' })],
  });
  expect(assembled.input.lines).toEqual([]);
  expect(assembled.input.sales).toEqual([]);
  expect(assembled.input.versions).toEqual([]);
  expect(assembled.input.overrides).toEqual([]);
  expect(assembled.input.salaries).toEqual([]);
  expect(assembled.tips).toEqual([]);
  expect(assembled.corrections).toEqual([]);
});

it('drops adjacent-month activity and selects corrections by target month', () => {
  const received = correction({ sourcePeriod: '2025-01', sourceRef: 'line:old' });
  const assembled = assemble({
    lines: [
      projectedLine({ lineId: 'previous', businessDate: '2026-09-30' }),
      projectedLine({ lineId: 'next', businessDate: '2026-11-01' }),
    ],
    sales: [
      projectedSale({ saleId: 'previous', businessDate: '2026-09-30' }),
      projectedSale({ saleId: 'next', businessDate: '2026-11-01' }),
    ],
    tips: [tip({ businessDate: '2026-09-30' }), tip({ businessDate: '2026-11-01' })],
    corrections: [received, correction({ targetPeriod: '2026-11', sourceRef: 'line:later' })],
  });
  expect(assembled.input.lines).toEqual([]);
  expect(assembled.input.sales).toEqual([]);
  expect(assembled.tips).toEqual([]);
  expect(assembled.corrections).toEqual([received]);
});

it('selects the salary entry and preserves amount-selection behavior', () => {
  const september = salaryEntry('employee-a', '2026-09-01', 400000n);
  const october = salaryEntry('employee-a', '2026-10-15', 500000n);
  const november = salaryEntry('employee-a', '2026-11-01', 600000n);
  const salaries = [september, october, november];
  const assembled = assemble({ salaries });
  expect(assembled.salary).toBe(october);
  expect(assembled.input.salaries).toEqual([october]);
  expect(selectSalaryEntryOnLastDay('employee-a', '2026-10-31', salaries)).toBe(october);
  expect(selectSalaryOnLastDay('employee-a', '2026-10-31', salaries)).toBe(october.amount);
  expect(selectSalaryEntryOnLastDay('employee-a', '2026-08-31', salaries)).toBeNull();
  const lastDay = salaryEntry('employee-a', '2026-10-31', 550000n);
  expect(assemble({ salaries: [october, lastDay] }).salary).toBe(lastDay);
  const empty = assemble({ salaries: [november] });
  expect(empty.salary).toBeNull();
  expect(empty.input.salaries).toEqual([]);
});

it('preserves NO_SALARY and NO_PLAN instead of hiding missing configuration', () => {
  const salaryPlan = version({
    base: { enabled: false },
    tiers: {
      enabled: true,
      accumulator: 'AMOUNT',
      mode: 'MARGINAL',
      steps: [{ from: { kind: 'SALARY_MULTIPLE', value: 200n }, calc: pct(500n) }],
    },
  });
  const noSalary = assemble({ lines: [projectedLine()], versions: [salaryPlan] });
  expect(computePeriod(noSalary.input)).toEqual({ ok: false, code: 'NO_SALARY' });
  const noPlan = assemble({ lines: [projectedLine()], versions: [] });
  expect(computePeriod(noPlan.input)).toEqual({ ok: false, code: 'NO_PLAN' });
});

it.each([
  ['2026-02', '2026-02-28'],
  ['2028-02', '2028-02-29'],
  ['2100-02', '2100-02-28'],
  ['2000-02', '2000-02-29'],
  ['2026-11', '2026-11-30'],
  ['2026-12', '2026-12-31'],
])('computes the calendar last day for %s', (period, expected) => {
  expect(assemble({ period }).input.periodLastDay).toBe(expected);
});

it('drops future versions and overrides but keeps a whole-period version inside the month', () => {
  const whole = version({ effectiveFrom: '2026-10-20', wholePeriod: true });
  const currentOverride = serviceOverride();
  const assembled = assemble({
    versions: [version({ effectiveFrom: '2026-11-01' }), whole],
    overrides: [currentOverride, serviceOverride({ id: 'future', effectiveFrom: '2026-11-01' })],
  });
  expect(assembled.input.versions).toEqual([whole]);
  expect(assembled.input.overrides).toEqual([currentOverride]);
});

it('passes tips and corrections through unchanged without pricing them', () => {
  const base = projection({ lines: [projectedLine()] });
  const receivedTip = tip({ amount: 7000n });
  const receivedCorrection = correction({ amount: -300n, newAmount: 700n });
  const assembled = assembleCommissionPeriodInput({
    ...base,
    tips: [receivedTip],
    corrections: [receivedCorrection],
  });
  expect(assembled.tips[0]).toBe(receivedTip);
  expect(assembled.corrections[0]).toBe(receivedCorrection);
  expect(assembled.tips[0]?.amount).toBe(7000n);
  expect(assembled.corrections[0]?.amount).toBe(-300n);
  expect(computedTotal(assembled.input)).toBe(computedTotal(assemble(base).input));
});

it.each(['2026-13', '2026-1', '26-10', ''])('rejects malformed period %s', (period) => {
  expect(() => assemble({ period })).toThrow(RangeError);
});

it('does not mutate projection arrays and always returns new arrays', () => {
  const source = projection({
    lines: [projectedLine()],
    sales: [projectedSale()],
    salaries: [salaryEntry('employee-a', '2026-10-01', 500000n)],
    versions: [version()],
    overrides: [serviceOverride()],
    tips: [tip()],
    corrections: [correction()],
  });
  const copies = {
    lines: [...source.lines],
    sales: [...source.sales],
    salaries: [...source.salaries],
    versions: [...source.versions],
    overrides: [...source.overrides],
    tips: [...source.tips],
    corrections: [...source.corrections],
  };
  deepFreezeProjection(source);
  const assembled = assembleCommissionPeriodInput(source);
  const pairs = [
    ['lines', assembled.input.lines, source.lines, copies.lines],
    ['sales', assembled.input.sales, source.sales, copies.sales],
    ['salaries', assembled.input.salaries, source.salaries, copies.salaries],
    ['versions', assembled.input.versions, source.versions, copies.versions],
    ['overrides', assembled.input.overrides, source.overrides, copies.overrides],
    ['tips', assembled.tips, source.tips, copies.tips],
    ['corrections', assembled.corrections, source.corrections, copies.corrections],
  ] as const;
  for (const [, output, sourceArray, copy] of pairs) {
    expect(output).not.toBe(sourceArray);
    expect(sourceArray).toHaveLength(copy.length);
    expect(sourceArray.every((row, rowIndex) => row === copy[rowIndex])).toBe(true);
  }
});

it('preserves caller subtype fields and shares kept arrays with engine input', () => {
  const activeLine = { ...projectedLine(), revision: 7n, branchId: 'branch-a' };
  const activeSale = { ...projectedSale(), revision: 8n, branchId: 'branch-a' };
  const selectedSalary = { ...salaryEntry('employee-a', '2026-10-01', 500000n), revision: 9n };
  const receivedTip = { ...tip(), revision: 10n };
  const attachedBranchIds = ['branch-a'] as const;
  const receivedCorrection = { ...correction(), attachedBranchIds };
  const assembled = assembleCommissionPeriodInput({
    employeeId: 'employee-a',
    period: '2026-10',
    lines: [activeLine],
    sales: [activeSale],
    salaries: [selectedSalary],
    versions: [version()],
    overrides: [],
    tips: [receivedTip],
    corrections: [receivedCorrection],
  });
  expect(assembled.lines[0]?.revision).toBe(7n);
  expect(assembled.lines[0]?.branchId).toBe('branch-a');
  expect(assembled.sales[0]?.revision).toBe(8n);
  expect(assembled.salary?.revision).toBe(9n);
  expect(assembled.tips[0]?.revision).toBe(10n);
  expect(assembled.corrections[0]?.attachedBranchIds).toBe(attachedBranchIds);
  expect(assembled.input.lines).toBe(assembled.lines);
  expect(assembled.input.sales).toBe(assembled.sales);
});

it('pruning never changes the priced result', () => {
  const based = (patch: Parameters<typeof version>[0], value: bigint) =>
    version({ ...patch, base: { enabled: true, calc: pct(value) } });
  const lines = [projectedLine(), projectedLine({ lineId: 'b', serviceId: 'service-b' })];
  const versions = [
    version({ effectiveFrom: '2026-09-01' }),
    based({ effectiveFrom: '2026-10-20', wholePeriod: true }, 2000n),
    based({ effectiveFrom: '2026-11-01' }, 5000n),
    version({ employeeId: 'employee-b' }),
  ];
  const overrides = ['2026-10-05', '2026-11-01'].map((effectiveFrom, index) =>
    serviceOverride({ id: `override-${index}`, effectiveFrom }),
  );
  const salaries = ['2026-09-01', '2026-10-15', '2026-11-01'].map((effectiveFrom) =>
    salaryEntry('employee-a', effectiveFrom, 500000n),
  );
  salaries.push(salaryEntry('employee-b', '2026-10-01', 900000n));
  const unfiltered: CommissionPeriodInput = {
    employeeId: 'employee-a',
    period: '2026-10',
    periodLastDay: '2026-10-31',
    lines,
    sales: [],
    versions,
    overrides,
    salaries,
  };
  const assembled = assemble({ lines, sales: [], versions, overrides, salaries });
  expect(computePeriod(assembled.input)).toEqual(computePeriod(unfiltered));
  expect(computePeriod(assembled.input)).toMatchObject({ ok: true, total: 25000n });
});
