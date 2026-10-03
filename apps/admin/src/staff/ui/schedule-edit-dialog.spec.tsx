import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';
import { ScheduleEditDialog } from './schedule-edit-dialog';
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', save: vi.fn() }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-schedules', () => ({
  useScheduleSave: () => ({ mutateAsync: state.save, isPending: false, isError: false }),
}));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
const id = '01920000-0000-7000-8000-000000000101';
const scope = { companyId: id, businessId: id, branchId: id, userId: id };
const saved = {
  id,
  business_id: id,
  branch_id: id,
  employee_id: id,
  week_start: '2000-01-01',
  timezone: 'Asia/Kuwait',
  revision: 3,
  shifts: [
    {
      day: 1,
      start: '09:00',
      end: '13:00',
      working_date: '2000-01-02',
      starts_at: '2000-01-02T06:00:00.000Z',
      ends_at: '2000-01-02T10:00:00.000Z',
    },
  ],
};
const row = { employee_id: id, name_en: 'Synthetic employee', name_ar: null, schedule: saved };
const grid = {
  week_start: '2000-01-01',
  timezone: 'Asia/Kuwait',
  days: [
    '2000-01-01',
    '2000-01-02',
    '2000-01-03',
    '2000-01-04',
    '2000-01-05',
    '2000-01-06',
    '2000-01-07',
  ],
  items: [row],
  next_cursor: null,
};
it.each(['ar', 'en'] as const)(
  'requires a reason, preserves the other day and saves the read revision in %s',
  async (locale) => {
    state.locale = locale;
    state.save.mockReset().mockResolvedValue(saved);
    const close = vi.fn();
    const view = render(
      <ScheduleEditDialog scope={scope} row={row} grid={grid} day={0} onClose={close} />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(grid.timezone)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'shell.schedule_add') }));
    const form = view.container.querySelector('form');
    expect(form).not.toBeNull();
    if (form) fireEvent.submit(form);
    await screen.findByRole('alert');
    expect(state.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(t(locale, 'shell.schedule_reason')), {
      target: { value: 'Synthetic past correction' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'shell.schedule_start')), {
      target: { value: '22:00' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'shell.schedule_end')), {
      target: { value: '06:00' },
    });
    if (form) fireEvent.submit(form);
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(state.save).toHaveBeenCalledWith({
      week_start: '2000-01-01',
      expected_revision: 3,
      reason: 'Synthetic past correction',
      shifts: [
        { day: 1, start: '09:00', end: '13:00' },
        { day: 0, start: '22:00', end: '06:00' },
      ],
    });
  },
);
