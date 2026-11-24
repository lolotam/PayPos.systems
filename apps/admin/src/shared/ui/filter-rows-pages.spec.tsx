import { t } from '@pospay/i18n';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LeaveHistoryFiltersForm } from '@/staff/ui/leave-history-filters-form';
import { LeaveInboxFilters } from '@/staff/ui/leave-inbox-filters';
import { AttendanceBoardFilters } from '@/staff/ui/attendance-board-filters';
import { AttendanceReportFilters } from '@/staff/ui/attendance-report-filters';
import { AttendanceRequestFilters } from '@/staff/ui/attendance-request-filters';
import { RatingsFiltersBar } from '@/ratings/ui/ratings-filters';
import { defaultLeaveFilters } from '@/staff/model/leave-history-filters';
import { boardBranches } from '@/staff/api/attendance-board.fixture';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

afterEach(cleanup);

/** كل عناصر التحكم لازم تكون كل واحد في FilterField، وكل الحقول أبناء مباشرين لنفس FilterRow. */
function expectOneWrappingRow(controls: HTMLElement[]) {
  const fields = controls.map((control) => control.closest<HTMLElement>('[data-filter-field]'));
  expect(fields.every((field) => field !== null)).toBe(true);
  const rows = new Set(fields.map((field) => field?.parentElement));
  expect(rows.size).toBe(1);
  const [row] = [...rows];
  expect(row?.hasAttribute('data-filter-row')).toBe(true);
  expect(row?.classList.contains('flex-wrap')).toBe(true);
  expect(new Set(fields).size).toBe(controls.length);
}

it('keeps the leave history date, type, status and branch filters in one wrapping row', () => {
  render(
    <LeaveHistoryFiltersForm
      initial={defaultLeaveFilters(new Date('2026-11-24T08:00:00Z'), 'Asia/Kuwait')}
      absenceOffered
      branches={boardBranches}
      onApply={vi.fn()}
    />,
  );
  expectOneWrappingRow([
    screen.getByLabelText(t('en', 'leave.from')),
    screen.getByLabelText(t('en', 'leave.to')),
    screen.getByLabelText(t('en', 'leave.type')),
    screen.getByLabelText(t('en', 'leave.status')),
    screen.getByLabelText(t('en', 'leave.branch')),
  ]);
  const apply = screen.getByRole('button', { name: t('en', 'leave.applyFilters') });
  expect(apply.parentElement?.hasAttribute('data-filter-row')).toBe(true);
});

it('keeps the leave inbox branch and date filters in one wrapping row', () => {
  render(<LeaveInboxFilters branches={boardBranches} onApply={vi.fn()} />);
  expectOneWrappingRow([
    screen.getByLabelText(t('en', 'leave.branch')),
    screen.getByLabelText(t('en', 'leave.from')),
    screen.getByLabelText(t('en', 'leave.to')),
  ]);
});

it('keeps the monthly attendance report month and branch filters in one wrapping row', () => {
  render(
    <AttendanceReportFilters
      branches={boardBranches}
      allowAllBranches
      branchId="all"
      month="2026-11"
      onBranch={vi.fn()}
      onMonth={vi.fn()}
    />,
  );
  expectOneWrappingRow([
    screen.getByLabelText(t('en', 'attendanceReport.month')),
    screen.getByLabelText(t('en', 'attendanceReport.branch')),
  ]);
});

it('keeps the ratings month, branch and employee filters in one wrapping row', () => {
  render(
    <RatingsFiltersBar
      filters={{ month: '2026-11', branchId: '', employeeId: '' }}
      branches={[]}
      employees={[]}
      onChange={vi.fn()}
    />,
  );
  expectOneWrappingRow([
    screen.getByLabelText(t('en', 'ratings.month')),
    screen.getByLabelText(t('en', 'ratings.branch')),
    screen.getByLabelText(t('en', 'ratings.employee')),
  ]);
});

it('keeps the attendance board branch and date filters and the Today button in one wrapping row', () => {
  render(
    <AttendanceBoardFilters
      branches={boardBranches}
      branchId={boardBranches[0]?.id ?? ''}
      date="2026-11-24"
      today="2026-11-24"
      onBranch={vi.fn()}
      onDate={vi.fn()}
    />,
  );
  expectOneWrappingRow([
    screen.getByLabelText(t('en', 'attendanceBoard.branch')),
    screen.getByLabelText(t('en', 'attendanceBoard.date')),
  ]);
  const today = screen.getByRole('button', { name: t('en', 'attendanceBoard.today') });
  expect(today.parentElement?.hasAttribute('data-filter-row')).toBe(true);
});

it('keeps the attendance requests branch and status filters in one wrapping row', () => {
  render(
    <AttendanceRequestFilters
      branches={boardBranches}
      branchId="all"
      status={undefined}
      allowAllBranches
      onBranch={vi.fn()}
      onStatus={vi.fn()}
    />,
  );
  expectOneWrappingRow([
    screen.getByLabelText(t('en', 'attendanceBoard.branch')),
    screen.getByLabelText(t('en', 'attendanceBoard.status')),
  ]);
});
