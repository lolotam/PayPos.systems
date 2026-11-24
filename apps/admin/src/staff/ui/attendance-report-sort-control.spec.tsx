import { t } from '@pospay/i18n';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AttendanceReportSortControl } from './attendance-report-sort-control';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

afterEach(cleanup);

function renderControl(
  sorting: { id: string; desc: boolean }[],
  onSortingChange = vi.fn(),
): { select: HTMLSelectElement; onSortingChange: ReturnType<typeof vi.fn> } {
  render(
    <AttendanceReportSortControl
      sorting={sorting}
      onSortingChange={onSortingChange}
      disabled={false}
    />,
  );
  return {
    select: screen.getByLabelText(t('en', 'attendanceReport.sortBy')) as HTMLSelectElement,
    onSortingChange,
  };
}

it('shows the only active sort as selected', () => {
  const { select } = renderControl([{ id: 'worked_minutes', desc: false }]);
  expect(select.value).toBe('worked_minutes:asc');
});

it('shows the empty option when two sorts are active', () => {
  const { select } = renderControl([
    { id: 'worked_minutes', desc: false },
    { id: 'employee_number', desc: false },
  ]);
  expect(select.value).toBe('');
});

it('shows the empty option when no sort is active', () => {
  const { select } = renderControl([]);
  expect(select.value).toBe('');
});
