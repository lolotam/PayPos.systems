import { describe, expect, it } from 'vitest';

import {
  projectStatementView,
  type StatementViewInput,
  type StatementViewScope,
} from '../statement-view.ts';
import type { StatementRow, StatementRowKind } from '../statement-types.ts';

const SALMIYA = '01920000-0000-7000-8000-0000000000b1';
const HAWALLI = '01920000-0000-7000-8000-0000000000b2';
const RANA = '01920000-0000-7000-8000-0000000000e1';
const SARA = '01920000-0000-7000-8000-0000000000e2';

/** صف كشف بأقل الحقول، والباقي فاضي؛ الفروع والنوع والمبلغ هي اللي بتتغيّر بين الاختبارات. */
function row(
  employeeId: string,
  kind: StatementRowKind,
  sourceRef: string,
  amount: string,
  attachedBranchIds: readonly string[],
): StatementRow {
  return {
    employeeId,
    employeeNumber: employeeId === RANA ? 1 : 2,
    employeeNameAr: null,
    employeeNameEn: employeeId === RANA ? 'Rana' : 'Sara',
    sourceRef,
    kind,
    amount,
    previousAmount: null,
    newAmount: null,
    sourcePeriod: null,
    sourceBranchId: null,
    sourceBranchNameAr: null,
    sourceBranchNameEn: null,
    sourceBusinessDate: null,
    attachedBranchIds,
    lineId: null,
    sessionId: null,
    serviceId: null,
    serviceNameAr: null,
    serviceNameEn: null,
    customerId: null,
    customerName: null,
    businessDate: null,
  };
}

const ALL_BUSINESS: StatementViewScope = { businessWide: true, branchIds: [SALMIYA, HAWALLI] };
const SALMIYA_ONLY: StatementViewScope = { businessWide: false, branchIds: [SALMIYA] };

/**
 * رنا في السالمية الشهر كله وحولي من منتصفه (CM-23h): صفوفها الأولى {السالمية} والتانية {السالمية، حولي}؛
 * سارا في حولي بس ومعاها مرحّل داخل مالوش فرع.
 */
const rows: readonly StatementRow[] = [
  row(RANA, 'EMPLOYEE', `employee:${RANA}`, '0.000', [SALMIYA, HAWALLI]),
  row(RANA, 'COMMISSION', 'line:early', '10.000', [SALMIYA]),
  row(RANA, 'COMMISSION', 'line:late', '4.000', [SALMIYA, HAWALLI]),
  row(SARA, 'EMPLOYEE', `employee:${SARA}`, '0.000', [HAWALLI]),
  row(SARA, 'COMMISSION', 'line:sara', '8.000', [HAWALLI]),
  row(SARA, 'CARRY_COMMISSION', 'carry:old:COMMISSION', '-3.000', []),
];

const project = (scope: StatementViewScope, extra: Partial<StatementViewInput> = {}) =>
  projectStatementView({ rows, failures: [], blocked: [], unlisted: [], scope, ...extra });

describe('the statement view for a reader on the whole business', () => {
  it('shows every employee with every source row and does not mark any partial', () => {
    const view = project(ALL_BUSINESS);
    expect(view.map((employee) => employee.employeeId)).toEqual([RANA, SARA]);
    expect(view.map((employee) => employee.rows.length)).toEqual([2, 2]);
    expect(view.every((employee) => !employee.partial)).toBe(true);
  });

  it('never lists the EMPLOYEE marker as a source row', () => {
    const view = project(ALL_BUSINESS);
    expect(view.flatMap((employee) => employee.rows.map((entry) => entry.kind))).not.toContain(
      'EMPLOYEE',
    );
  });

  it('sees the carry of an employee and subtracts it in her commission subtotal (BR-06)', () => {
    const sara = project(ALL_BUSINESS).find((employee) => employee.employeeId === SARA);
    expect(sara?.payable.commissionSubtotal).toBe(5_000n);
    expect(sara?.payable.payable).toBe(5_000n);
  });
});

describe('the statement view for a branch-scoped reader (CS-Q20, CS-Q23)', () => {
  it('shows only the employees attached to her branches and only the rows overlapping them', () => {
    const view = project(SALMIYA_ONLY);
    expect(view.map((employee) => employee.employeeId)).toEqual([RANA]);
    expect(view[0]?.rows.map((entry) => entry.sourceRef)).toEqual(['line:early', 'line:late']);
  });

  it('labels an employee partial when a row of her month is outside the reader scope', () => {
    const view = project({ businessWide: false, branchIds: [HAWALLI] });
    const rana = view.find((employee) => employee.employeeId === RANA);
    // رنا اتضافت لحولي من منتصف الشهر: مدير حولي بيشوف الصف التاني بس، فرقمها جزئي.
    expect(rana?.rows.map((entry) => entry.sourceRef)).toEqual(['line:late']);
    expect(rana?.partial).toBe(true);
    expect(rana?.payable.payable).toBe(4_000n);
  });

  it('hides the carry from a branch reader and marks that employee partial (D-22)', () => {
    const sara = project({ businessWide: false, branchIds: [HAWALLI] }).find(
      (employee) => employee.employeeId === SARA,
    );
    expect(sara?.rows.map((entry) => entry.kind)).toEqual(['COMMISSION']);
    expect(sara?.partial).toBe(true);
    expect(sara?.payable.commissionSubtotal).toBe(8_000n);
  });

  it('does not show an employee whose only attachment is outside her scope', () => {
    const view = project(SALMIYA_ONLY);
    expect(view.map((employee) => employee.employeeId)).not.toContain(SARA);
  });
});

describe('the blocking issues of the view (FR-027)', () => {
  const blocked = [
    { employeeId: RANA, sourcePeriod: '2026-09', code: 'NO_PLAN' as const },
    { employeeId: RANA, sourcePeriod: '2026-08', code: 'NO_SALARY' as const },
    { employeeId: SARA, sourcePeriod: '2026-09', code: 'NO_PLAN' as const },
  ];

  it('lists the pricing failure and the open blocked corrections of an employee in a fixed order', () => {
    const view = project(ALL_BUSINESS, {
      failures: [{ employeeId: RANA, code: 'NO_SALARY', attachedBranchIds: [SALMIYA] }],
      blocked,
    });
    expect(view.find((employee) => employee.employeeId === RANA)?.issues).toEqual([
      { kind: 'PRICING', code: 'NO_SALARY', sourcePeriod: null },
      { kind: 'BLOCKED_CORRECTION', code: 'NO_SALARY', sourcePeriod: '2026-08' },
      { kind: 'BLOCKED_CORRECTION', code: 'NO_PLAN', sourcePeriod: '2026-09' },
    ]);
    expect(view.find((employee) => employee.employeeId === SARA)?.issues).toHaveLength(1);
  });

  it('does not show the issues of an employee the reader cannot see', () => {
    const view = project(SALMIYA_ONLY, {
      failures: [{ employeeId: SARA, code: 'NO_PLAN', attachedBranchIds: [HAWALLI] }],
    });
    expect(view.map((employee) => employee.employeeId)).toEqual([RANA]);
    expect(view[0]?.issues).toEqual([]);
  });

  it('shows a branch reader a pricing failure only when its failed source falls on her branch days', () => {
    const failures = [
      { employeeId: RANA, code: 'NO_PLAN' as const, attachedBranchIds: [SALMIYA] },
    ];
    const salmiya = project(SALMIYA_ONLY, { failures });
    const hawalli = project({ businessWide: false, branchIds: [HAWALLI] }, { failures });
    expect(salmiya.find((employee) => employee.employeeId === RANA)?.issues).toHaveLength(1);
    // رنا ظاهرة لمدير حولي بس بعد 15 الشهر، والمصدر الفاشل قبلها (فرع السالمية بس): الفشل ما يظهرلوش.
    expect(hawalli.find((employee) => employee.employeeId === RANA)?.issues).toEqual([]);
  });

  it('never shows an open blocked correction to a branch reader, who cannot tie it to a source she sees', () => {
    const view = project(SALMIYA_ONLY, { blocked });
    expect(view.flatMap((employee) => employee.issues)).toEqual([]);
  });

  it('keeps an employee outside the statement set whose only entry is an open blocker, for the business-wide reader only', () => {
    const LEFT = '01920000-0000-7000-8000-0000000000e9';
    const unlisted = [{ employeeId: LEFT, employeeNumber: 9, nameAr: null, nameEn: 'Lina' }];
    const blockers = [{ employeeId: LEFT, sourcePeriod: '2026-09', code: 'NO_PLAN' as const }];

    const wide = project(ALL_BUSINESS, { unlisted, blocked: blockers });
    const branch = project(SALMIYA_ONLY, { unlisted, blocked: blockers });

    expect(wide.find((employee) => employee.employeeId === LEFT)).toMatchObject({
      rows: [],
      partial: false,
      issues: [{ kind: 'BLOCKED_CORRECTION', code: 'NO_PLAN', sourcePeriod: '2026-09' }],
    });
    expect(branch.map((employee) => employee.employeeId)).not.toContain(LEFT);
  });

  it('does not list an unlisted employee twice when the builder already has her', () => {
    const unlisted = [{ employeeId: RANA, employeeNumber: 1, nameAr: null, nameEn: 'Rana' }];
    const ids = project(ALL_BUSINESS, { unlisted }).map((employee) => employee.employeeId);
    expect(ids).toEqual([RANA, SARA]);
  });
});

describe('the departed flag of the statement view (CM-50)', () => {
  it('marks a departed employee, listed or unlisted, and leaves the rest not departed', () => {
    const LEFT = '01920000-0000-7000-8000-0000000000e9';
    const unlisted = [{ employeeId: LEFT, employeeNumber: 9, nameAr: null, nameEn: 'Lina' }];
    const view = project(ALL_BUSINESS, { unlisted, departed: new Set([RANA, LEFT]) });
    const flags = Object.fromEntries(view.map((employee) => [employee.employeeId, employee.departed]));
    expect(flags).toEqual({ [RANA]: true, [SARA]: false, [LEFT]: true });
    expect(project(ALL_BUSINESS).every((employee) => !employee.departed)).toBe(true);
  });

  it('reads the departed flag from the single input set, never from the label', () => {
    const LEFT = '01920000-0000-7000-8000-0000000000e9';
    const unlisted = [
      { employeeId: LEFT, employeeNumber: 9, nameAr: null, nameEn: 'Lina', departed: true },
    ];
    expect(project(ALL_BUSINESS, { unlisted }).find((e) => e.employeeId === LEFT)?.departed).toBe(false);
    const withSet = project(ALL_BUSINESS, { unlisted, departed: new Set([LEFT]) });
    expect(withSet.find((e) => e.employeeId === LEFT)?.departed).toBe(true);
  });
});
