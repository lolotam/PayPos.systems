import { expect, it } from 'vitest';
import { computeAttendanceMonthlyReport } from '../attendance-monthly-report.js';
import type { ReportBranchInputs, ReportContract, ReportLeave } from '../attendance-report-types.js';

const contract: ReportContract = {
  hire_date: '2026-01-01', contract_end: null, links: [],
  entries: Array.from({ length: 7 }, (_, day) => ({ day, start: '09:00', end: '17:00' })),
};
function leave(date: string, kind: ReportLeave['kind'] = 'FULL_DAY'): ReportLeave {
  return { id: 'synthetic-leave', type: 'ANNUAL', kind, from: date, to: date,
    starts_at: `${date}T07:00:00Z`, ends_at: `${date}T09:00:00Z` };
}
function branch(links: ReportContract['links'], leaves: readonly ReportLeave[]): ReportBranchInputs {
  return { timezone: 'Asia/Kuwait', sessions: [], shifts: [], contract: { ...contract, links },
    leave_for_branch: leaves };
}
function movingBranches(leaves: readonly ReportLeave[]) {
  return [branch([{ from: '2026-01-01', to: '2026-10-15' }], leaves),
    branch([{ from: '2026-10-15', to: null }], leaves.map((entry) => ({ ...entry })))];
}
function annual(branches: readonly ReportBranchInputs[]) {
  return computeAttendanceMonthlyReport(branches, '2026-10').leave.find((entry) => entry.type === 'ANNUAL');
}

it.each([
  ['2026-10-10', [1, 0, 1]],
  ['2026-10-15', [0, 1, 1]],
  ['2026-10-20', [0, 1, 1]],
] as const)('full-day leave on %s follows the October 15 move from A to B', (date, days) => {
  const branches = movingBranches([leave(date)]);
  expect(annual(branches.slice(0, 1))).toEqual({ type: 'ANNUAL', days: days[0], partial_minutes: 0 });
  expect(annual(branches.slice(1))).toEqual({ type: 'ANNUAL', days: days[1], partial_minutes: 0 });
  expect(annual(branches)).toEqual({ type: 'ANNUAL', days: days[2], partial_minutes: 0 });
  const baseline = movingBranches([]);
  for (const [index, row] of branches.entries()) {
    expect(computeAttendanceMonthlyReport(baseline.slice(index, index + 1), '2026-10').contracted_minutes -
      computeAttendanceMonthlyReport([row], '2026-10').contracted_minutes).toBe((days[index] ?? 0) * 480);
  }
});

it.each([
  ['2026-10-10', [120, 0, 120]],
  ['2026-10-15', [0, 120, 120]],
  ['2026-10-20', [0, 120, 120]],
] as const)('PARTIAL leave on %s is excluded outside the branch link window', (date, minutes) => {
  const branches = movingBranches([leave(date, 'PARTIAL')]);
  expect(annual(branches.slice(0, 1))).toEqual({ type: 'ANNUAL', days: 0, partial_minutes: minutes[0] });
  expect(annual(branches.slice(1))).toEqual({ type: 'ANNUAL', days: 0, partial_minutes: minutes[1] });
  expect(annual(branches)).toEqual({ type: 'ANNUAL', days: 0, partial_minutes: minutes[2] });
});

it('clips a full-day request spanning the move separately and counts its dates once in all branches', () => {
  const branches = movingBranches([{ ...leave('2026-10-10'), to: '2026-10-20' }]);
  expect(annual(branches.slice(0, 1))?.days).toBe(5);
  expect(annual(branches.slice(1))?.days).toBe(6);
  expect(annual(branches)?.days).toBe(11);
});

it.each(['FULL_DAY', 'PARTIAL'] as const)('all branches exclude %s leave in a gap between link windows', (kind) => {
  const leaves = [leave('2026-10-15', kind)];
  const branches = [branch([{ from: '2026-10-01', to: '2026-10-15' }], leaves),
    branch([{ from: '2026-10-16', to: null }], leaves)];
  expect(annual(branches)).toEqual({ type: 'ANNUAL', days: 0, partial_minutes: 0 });
});

it.each(['FULL_DAY', 'PARTIAL'] as const)('overlapping branch links count %s leave once per employee', (kind) => {
  const row = branch([{ from: '2026-10-01', to: null }], [leave('2026-10-15', kind)]);
  expect(annual([row, row])).toEqual({ type: 'ANNUAL', days: kind === 'FULL_DAY' ? 1 : 0,
    partial_minutes: kind === 'PARTIAL' ? 120 : 0 });
});

it.each(['FULL_DAY', 'PARTIAL'] as const)('leave summary respects hire and contract bounds for %s leave', (kind) => {
  const leaves = ['2026-10-09', '2026-10-10', '2026-10-20', '2026-10-21'].map((date) =>
    ({ ...leave(date, kind), id: date }));
  const row = branch([{ from: '2026-01-01', to: null }], leaves);
  row.contract = { ...contract, links: row.contract?.links ?? [], hire_date: '2026-10-10', contract_end: '2026-10-20' };
  expect(annual([row])).toEqual({ type: 'ANNUAL', days: kind === 'FULL_DAY' ? 2 : 0,
    partial_minutes: kind === 'PARTIAL' ? 240 : 0 });
});

it('a session-only branch with no contract or an empty link list contributes no leave dates', () => {
  const row = branch([], [leave('2026-10-15'), { ...leave('2026-10-16', 'PARTIAL'), id: 'partial' }]);
  expect(annual([row, { ...row, contract: null }])).toEqual({ type: 'ANNUAL', days: 0, partial_minutes: 0 });
});
