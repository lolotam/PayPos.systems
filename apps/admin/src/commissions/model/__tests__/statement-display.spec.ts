import { expect, it } from 'vitest';
import {
  branchView,
  businessView,
  closedBranchView,
  closedView,
  correctionRow,
  dyeRow,
  statementEmployee,
  statementRow,
} from '../../api/__tests__/statement-http';
import {
  correctionDate,
  correctionsTotal,
  employeeName,
  formatAmount,
  groupRows,
  statementActions,
  statusOf,
} from '../statement-display';
import { approvalDay, dayBefore, defaultStatementPeriod } from '../statement-period';

const PLAN_ISSUE = { kind: 'PRICING' as const, code: 'NO_PLAN' as const, source_period: null };

it('offers generate and review on a clean draft, and review stays closed while an employee has an issue', () => {
  expect(statementActions(businessView())).toEqual({
    generate: 'enabled',
    review: 'enabled',
    returnToDraft: 'hidden',
    approve: 'hidden',
    pay: 'hidden',
  });
  const blocked = businessView({ employees: [statementEmployee({ issues: [PLAN_ISSUE] })] });
  expect(statementActions(blocked).review).toBe('disabled');
});

it('offers only generate before the first generation, and refresh, return and approve on a reviewed one', () => {
  expect(statementActions(businessView({ generated: false }))).toEqual({
    generate: 'enabled',
    review: 'hidden',
    returnToDraft: 'hidden',
    approve: 'hidden',
    pay: 'hidden',
  });
  expect(statementActions(businessView({ status: 'REVIEWED' }))).toEqual({
    generate: 'enabled',
    review: 'hidden',
    returnToDraft: 'enabled',
    approve: 'enabled',
    pay: 'hidden',
  });
});

const NO_ACTIONS = { generate: 'hidden', review: 'hidden', returnToDraft: 'hidden', approve: 'hidden', pay: 'hidden' };

it('hides every write action from a branch reader and from a paid month', () => {
  expect(statementActions(branchView())).toEqual(NO_ACTIONS);
  expect(statementActions(closedBranchView())).toEqual(NO_ACTIONS);
  expect(statementActions(closedView({ status: 'PAID' }))).toEqual(NO_ACTIONS);
});

it('offers only the payment on an approved month for a whole-business reader', () => {
  expect(statementActions(closedView())).toEqual({ ...NO_ACTIONS, pay: 'enabled' });
});

it('closes approve on a reviewed statement that changed since the review or has an issue, keeping return open', () => {
  const changed = businessView({ status: 'REVIEWED', changed_since_review: true, change_cause: 'STATEMENT' });
  expect(statementActions(changed)).toMatchObject({ approve: 'disabled', returnToDraft: 'enabled' });
  const blocked = businessView({ status: 'REVIEWED', employees: [statementEmployee({ issues: [PLAN_ISSUE] })] });
  expect(statementActions(blocked)).toMatchObject({ approve: 'disabled', returnToDraft: 'enabled' });
});

it('names a closed month by its frozen status, whatever else the reading carries', () => {
  expect(statusOf(closedView())).toBe('APPROVED');
  expect(statusOf(closedView({ status: 'PAID' }))).toBe('PAID');
  expect(statusOf(closedBranchView())).toBe('APPROVED');
});

it('names the status from the generation flag first and the stored status second', () => {
  expect(statusOf(businessView({ generated: false }))).toBe('NONE');
  expect(statusOf(businessView({ status: 'REVIEWED' }))).toBe('REVIEWED');
  expect(statusOf(businessView())).toBe('DRAFT');
});

it('puts each row kind in its own section, keeping the server order', () => {
  const rows = [
    dyeRow(),
    statementRow('tip:1', 'TIP_CARD', '2.000'),
    correctionRow('c:1', '-1.000', '5.000', '4.000'),
    statementRow('carry:1', 'CARRY_COMMISSION', '-3.000'),
    statementRow('sale:1', 'SALE', '1.500'),
  ];
  const groups = groupRows(rows);
  expect(groups.work.map((row) => row.source_ref)).toEqual(['line:1', 'sale:1']);
  expect(groups.tips.map((row) => row.source_ref)).toEqual(['tip:1']);
  expect(groups.corrections.map((row) => row.source_ref)).toEqual(['c:1']);
  expect(groups.carries.map((row) => row.source_ref)).toEqual(['carry:1']);
});

it('totals the corrections section from commission and card-tip corrections only', () => {
  const rows = [
    statementRow('a', 'CORRECTION', '-6.250'),
    statementRow('b', 'CORRECTION_TIP_CARD', '-1.000'),
    statementRow('c', 'CORRECTION_TIP_CASH', '-9.000'),
  ];
  expect(correctionsTotal(rows)).toBe('-7.250');
  expect(correctionsTotal([statementRow('d', 'CORRECTION', '1250.500')])).toBe('1,250.500');
});

it('dates a correction by its original day, falling back to the day it was posted', () => {
  expect(correctionDate(correctionRow('c', '-1.000', '2.000', '1.000'))).toBe('2026-09-20');
  expect(correctionDate(statementRow('c', 'CORRECTION', '-1.000', { source_business_date: '2026-10-03' }))).toBe('2026-10-03');
  expect(correctionDate(statementRow('c', 'CORRECTION', '-1.000'))).toBeNull();
});

it('formats amounts with three decimals and thousands separators, keeping the sign', () => {
  expect(formatAmount('-25.000')).toBe('-25.000');
  expect(formatAmount('1234567.500')).toBe('1,234,567.500');
  expect(formatAmount('0.005')).toBe('0.005');
});

it('formats a statement total wider than the money kernel accepts instead of failing', () => {
  expect(formatAmount('-1234567890123456.250')).toBe('-1,234,567,890,123,456.250');
});

it('shows the Arabic employee name in Arabic and falls back to the English one', () => {
  expect(employeeName(statementEmployee(), 'ar')).toBe('سارة');
  expect(employeeName(statementEmployee({ name_ar: null }), 'ar')).toBe('Sara');
  expect(employeeName(statementEmployee(), 'en')).toBe('Sara');
});

it('reads the approval day from the approval instant and steps one day back across a month edge', () => {
  expect(approvalDay('2026-11-02T22:30:00.000Z')).toBe('2026-11-02');
  expect(approvalDay('2026-11-03T01:30:00+03:00')).toBe('2026-11-02');
  expect(dayBefore('2026-11-01')).toBe('2026-10-31');
  expect(dayBefore('2027-01-01')).toBe('2026-12-31');
});

it('opens on the month before the current one, across the new year too', () => {
  expect(defaultStatementPeriod(new Date(2026, 10, 20))).toBe('2026-10');
  expect(defaultStatementPeriod(new Date(2027, 0, 5))).toBe('2026-12');
});
