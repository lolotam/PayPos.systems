import { errorMessages, t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';
import { ScheduleEditDialog } from './schedule-edit-dialog';
import { ScheduleGridTable } from './schedule-grid';
const state = vi.hoisted(() => ({
  locale: 'en' as 'ar' | 'en',
  save: vi.fn(),
  error: null as unknown,
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-schedules', () => ({
  useScheduleSave: () => ({
    mutateAsync: state.save,
    isPending: false,
    isError: state.error !== null,
    error: state.error,
  }),
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
      break_start: null,
      break_end: null,
      break_starts_at: null,
      break_ends_at: null,
    },
  ],
};
const row = { employee_id: id, name_en: 'Synthetic employee', name_ar: null, schedule: saved };
function savedShift() {
  const shift = saved.shifts[0];
  if (!shift) throw new Error('Missing saved shift');
  return shift;
}
function submitForm(container: HTMLElement) {
  const form = container.querySelector('form');
  if (!form) throw new Error('Missing schedule form');
  fireEvent.submit(form);
}
const grid = {
  max_shifts_per_day: 3,
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
        { day: 1, start: '09:00', end: '13:00', break_start: null, break_end: null },
        { day: 0, start: '22:00', end: '06:00' },
      ],
    });
  },
);

it.each(['ar', 'en'] as const)('adds, preserves and removes a break in %s', async (locale) => {
  state.locale = locale;
  state.error = null;
  const shift = { ...savedShift(), day: 0, end: '17:00' };
  const current = { ...row, schedule: { ...saved, week_start: '2099-01-03', shifts: [shift] } };
  const future = { ...grid, week_start: '2099-01-03', days: ['2099-01-03'], items: [current] };
  const mount = (break_start: string | null, break_end: string | null) =>
    render(
      <ScheduleEditDialog
        scope={scope}
        row={{
          ...current,
          schedule: { ...current.schedule, shifts: [{ ...shift, break_start, break_end }] },
        }}
        grid={future}
        day={0}
        onClose={vi.fn()}
      />,
    );
  state.save.mockReset().mockResolvedValue(saved);
  let view = mount(null, null);
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'shell.schedule_break_add') }));
  expect(
    (screen.getByLabelText(t(locale, 'shell.schedule_break_start')) as HTMLInputElement).value,
  ).toBe('13:00');
  expect(
    (screen.getByLabelText(t(locale, 'shell.schedule_break_end')) as HTMLInputElement).value,
  ).toBe('14:00');
  submitForm(view.container);
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
  expect(state.save.mock.calls[0]?.[0].shifts[0]).toMatchObject({
    break_start: '13:00',
    break_end: '14:00',
  });
  view.unmount();
  view = mount('13:00', '14:00');
  submitForm(view.container);
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
  expect(state.save.mock.calls[1]?.[0].shifts[0]).toMatchObject({
    break_start: '13:00',
    break_end: '14:00',
  });
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'shell.schedule_break_remove') }));
  submitForm(view.container);
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(3));
  expect(state.save.mock.calls[2]?.[0].shifts[0]).toMatchObject({
    break_start: null,
    break_end: null,
  });
});

it.each(['ar', 'en'] as const)('shows the break and API rejection in %s', (locale) => {
  state.locale = locale;
  const messages = errorMessages('SCHEDULE_BREAK_INVALID');
  state.error = {
    code: 'SCHEDULE_BREAK_INVALID',
    ...messages,
  };
  const current = {
    ...row,
    schedule: {
      ...saved,
      shifts: [{ ...savedShift(), break_start: '10:00', break_end: '11:00' }],
    },
  };
  render(<ScheduleEditDialog scope={scope} row={current} grid={grid} day={1} onClose={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toContain(
    locale === 'ar' ? messages.message_ar : messages.message_en,
  );
  render(<ScheduleGridTable data={{ ...grid, items: [current] }} onEdit={vi.fn()} />);
  expect(screen.getByText(t(locale, 'shell.schedule_break'))).toBeTruthy();
  expect(screen.getByText('10:00–11:00')).toBeTruthy();
  state.error = null;
});
