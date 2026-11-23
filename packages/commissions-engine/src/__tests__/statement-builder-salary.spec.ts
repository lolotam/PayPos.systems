import { describe, expect, it } from 'vitest';

import { buildStatement } from '../statement-builder.ts';
import type { StatementBuildInput } from '../statement-types.ts';
import { at, NOOR, octoberInput, octoberRows, SARA } from './statement-fixtures.ts';

/** خطة سارة فيها شريحة بحد مضاعف راتب (2 × الراتب، 5% فوقه)، فتسعير أي مصدر بيحتاج راتب. */
function salaryMultiplePlan() {
  const version = at(octoberRows().versions, 0);
  return {
    ...version,
    base: { enabled: false } as const,
    tiers: {
      enabled: true,
      accumulator: 'AMOUNT',
      mode: 'MARGINAL',
      steps: [
        { from: { kind: 'SALARY_MULTIPLE', value: 200n }, calc: { kind: 'PCT', value: 500n } },
      ],
    } as const,
  };
}

/** أكتوبر بخطة الراتب: بنود سارة تتبع الخطة، وراتب نور وحده موجود، ومفيش تجاوز يغلب الخطة. */
function salaryInput(withHerOwnSalary: boolean): StatementBuildInput {
  const rows = octoberRows();
  const followPlan = (line: (typeof rows.lines)[number]) => ({
    ...line,
    ruleSnapshot: { kind: 'FOLLOW_PLAN' as const },
  });
  const noorSalary = {
    employeeId: NOOR,
    effectiveFrom: '2026-10-01',
    amount: 300_000n,
    revision: 1n,
  };
  const saraSalary = at(rows.salaries, 0);
  return octoberInput({
    ...rows,
    lines: rows.lines.map((line) => (line.employeeId === SARA ? followPlan(line) : line)),
    versions: [salaryMultiplePlan()],
    overrides: [],
    salaries: withHerOwnSalary ? [saraSalary, noorSalary] : [noorSalary],
  });
}

describe('the statement builder with a plan that needs the salary (D-57)', () => {
  it('reports NO_SALARY for the employee whose salary is missing and prices no source of hers', () => {
    const built = buildStatement(salaryInput(false));
    expect(built.failures).toEqual([
      { employeeId: SARA, code: 'NO_SALARY', attachedBranchIds: expect.any(Array) },
    ]);
    const mine = built.rows
      .filter((row) => row.employeeId === SARA)
      .map((row) => row.kind)
      .sort();
    expect(mine).toEqual([
      'CARRY_COMMISSION',
      'CARRY_TIP_CARD',
      'CORRECTION',
      'EMPLOYEE',
      'TIP_CARD',
      'TIP_CASH',
    ]);
  });

  it("does not borrow another employee's salary, and still prices that employee", () => {
    const built = buildStatement(salaryInput(false));
    const noor = built.rows.filter((row) => row.employeeId === NOOR);
    expect(noor.map((row) => [row.kind, row.amount])).toEqual([
      ['COMMISSION', '2.000'],
      ['EMPLOYEE', '0.000'],
    ]);
  });

  it('prices her sources once her own salary is on record', () => {
    // الحد 2 × 400.000 = 800.000 ومبيعات سارة 150.000 تحته: البندان بصفر وصفّهما متجمد، وبيع الباقة
    // مستقل عن الشرائح: (50.000 − 10.000 مرتجع) × 10% = 4.000.
    const built = buildStatement(salaryInput(true));
    expect(built.failures).toEqual([]);
    const priced = built.rows
      .filter(
        (row) => row.employeeId === SARA && (row.kind === 'COMMISSION' || row.kind === 'SALE'),
      )
      .map((row) => [row.sourceRef, row.amount]);
    expect(priced).toEqual([
      ['line:line-1', '0.000'],
      ['line:line-2', '0.000'],
      ['sale:sale-1', '4.000'],
    ]);
  });
});
