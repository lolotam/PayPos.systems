import type { ScheduleShift } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeDefaultHoursForm } from './employee-default-hours-form';

const state = vi.hoisted(() => ({ locale: 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const range = { start: '09:00', end: '17:00', break_start: '13:00', break_end: '14:00' };
const week = Array.from({ length: 6 }, (_, day) => ({ ...range, day }));
beforeEach(() => { state.locale = 'en'; });

function openBulk(shifts: ScheduleShift[] = week, pending = false) {
  const onSave = vi.fn();
  render(<EmployeeDefaultHoursForm shifts={shifts} pending={pending} onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: 'Same hours for all days' }));
  return { onSave, panel: within(screen.getByRole('group', { name: 'Hours to copy' })) };
}
function apply() {
  fireEvent.click(screen.getByRole('button', { name: 'Apply to working days' }));
}
async function save() {
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Hours to copy' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Save default hours' }));
}
function dayFields(day: string) {
  const row = screen.getAllByRole('checkbox', { name: day }).at(-1)?.closest('label')?.parentElement;
  if (!row) throw new Error(`Missing weekday row: ${day}`);
  return within(row);
}

it('fills all except Friday, then allows a 12-hour Thursday without changing other days', async () => {
  const { onSave, panel } = openBulk([{ ...range, day: 0 }]);
  for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'])
    fireEvent.click(panel.getByRole('checkbox', { name: day }));
  expect((panel.getByRole('checkbox', { name: 'Friday' }) as HTMLInputElement).checked).toBe(true);
  apply();
  await waitFor(() => expect(screen.getAllByText('480 minutes including break')).toHaveLength(6));
  fireEvent.change(dayFields('Thursday').getByLabelText('End'), { target: { value: '21:00' } });
  fireEvent.change(dayFields('Thursday').getByLabelText('Break start'), { target: { value: '14:00' } });
  fireEvent.change(dayFields('Thursday').getByLabelText('Break end'), { target: { value: '15:00' } });
  expect(screen.getByText('720 minutes including break')).toBeTruthy();
  expect(screen.getAllByText('480 minutes including break')).toHaveLength(5);
  expect(onSave).not.toHaveBeenCalled();
  await save();
  const expected = week.map((shift) => shift.day === 5 ? { ...shift, end: '21:00', break_start: '14:00', break_end: '15:00' } : shift);
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ shifts: expected }));
  expect((screen.getByRole('checkbox', { name: 'Friday' }) as HTMLInputElement).checked).toBe(false);
});

it('respects multiple days off, clearing an existing day and keeping an empty day off', async () => {
  const { onSave, panel } = openBulk();
  fireEvent.click(panel.getByRole('checkbox', { name: 'Tuesday' }));
  fireEvent.change(panel.getByLabelText('Start'), { target: { value: '10:00' } });
  apply();
  await save();
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ shifts: week.filter((shift) => shift.day !== 3)
    .map((shift) => ({ ...shift, start: '10:00' })) }));
  expect((screen.getByRole('checkbox', { name: 'Tuesday' }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('checkbox', { name: 'Friday' }) as HTMLInputElement).checked).toBe(false);
});

it('enters a new range and optional break on an empty week without submitting', async () => {
  const { onSave, panel } = openBulk([]);
  expect(panel.getAllByRole('checkbox').every((field) => (field as HTMLInputElement).checked)).toBe(true);
  fireEvent.change(panel.getByLabelText('Start'), { target: { value: '10:00' } });
  fireEvent.change(panel.getByLabelText('End'), { target: { value: '22:00' } });
  fireEvent.click(panel.getByRole('button', { name: 'Add break' }));
  fireEvent.change(panel.getByLabelText('Break start'), { target: { value: '15:00' } });
  fireEvent.change(panel.getByLabelText('Break end'), { target: { value: '16:00' } });
  for (const checkbox of panel.getAllByRole('checkbox').slice(0, 6)) fireEvent.click(checkbox);
  apply();
  await waitFor(() => expect(screen.getAllByText('720 minutes including break')).toHaveLength(6));
  expect(onSave).not.toHaveBeenCalled();
  await save();
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ shifts: week.map(({ day }) =>
    ({ day, start: '10:00', end: '22:00', break_start: '15:00', break_end: '16:00' })) }));
});

it('copies a filled source with no break over days that previously had a break', async () => {
  const source = { day: 5, start: '22:00', end: '06:00', break_start: null, break_end: null };
  const { onSave, panel } = openBulk([...week.slice(0, 5), source]);
  fireEvent.change(panel.getByLabelText('Copy from a filled day'), { target: { value: '5' } });
  expect((panel.getByLabelText('Start') as HTMLInputElement).value).toBe('22:00');
  expect(panel.queryByLabelText('Break start')).toBeNull();
  apply();
  await save();
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ shifts: week.map(({ day }) => ({ ...source, day })) }));
});

it('defaults days off from the current unsaved form and uses its current source times', () => {
  const onSave = vi.fn();
  render(<EmployeeDefaultHoursForm shifts={week} pending={false} onSave={onSave} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Monday' }));
  fireEvent.change(dayFields('Saturday').getByLabelText('Start'), { target: { value: '11:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Same hours for all days' }));
  const panel = within(screen.getByRole('group', { name: 'Hours to copy' }));
  expect((panel.getByRole('checkbox', { name: 'Monday' }) as HTMLInputElement).checked).toBe(true);
  expect((panel.getByLabelText('Start') as HTMLInputElement).value).toBe('11:00');
  expect(onSave).not.toHaveBeenCalled();
});

it('can mark the entire week off without saving until Save', async () => {
  const { onSave, panel } = openBulk();
  for (const checkbox of panel.getAllByRole('checkbox').slice(0, 6)) fireEvent.click(checkbox);
  apply();
  await waitFor(() => expect(screen.queryByLabelText('Start')).toBeNull());
  expect(onSave).not.toHaveBeenCalled();
  await save();
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ shifts: [] }));
});

it('leaves the existing week intact when the bulk panel is closed without applying', () => {
  const { onSave, panel } = openBulk();
  fireEvent.change(panel.getByLabelText('End'), { target: { value: '21:00' } });
  fireEvent.click(panel.getByRole('checkbox', { name: 'Saturday' }));
  fireEvent.click(screen.getByRole('button', { name: 'Same hours for all days' }));
  expect(screen.getAllByText('480 minutes including break')).toHaveLength(6);
  expect((dayFields('Saturday').getByLabelText('End') as HTMLInputElement).value).toBe('17:00');
  expect(onSave).not.toHaveBeenCalled();
});

it('rejects an incomplete range without changing the existing form', async () => {
  const { onSave, panel } = openBulk();
  fireEvent.change(panel.getByLabelText('End'), { target: { value: '' } });
  apply();
  await waitFor(() => expect(panel.getByRole('alert')).toBeTruthy());
  expect((dayFields('Saturday').getByLabelText('End') as HTMLInputElement).value).toBe('17:00');
  expect(onSave).not.toHaveBeenCalled();
});

it('keeps the existing contract validation after applying and editing a day', async () => {
  const { onSave } = openBulk();
  apply();
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Hours to copy' })).toBeNull());
  fireEvent.change(dayFields('Thursday').getByLabelText('Break end'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save default hours' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(onSave).not.toHaveBeenCalled();
});

it('disables the bulk action while saving', () => {
  render(<EmployeeDefaultHoursForm shifts={week} pending onSave={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Same hours for all days' }).matches(':disabled')).toBe(true);
});

it.each(['en', 'ar'] as const)('renders the bulk labels in %s', (locale) => {
  state.locale = locale;
  render(<EmployeeDefaultHoursForm shifts={week} pending={false} onSave={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'employeeDefaultHours.sameHours') }));
  const panel = within(screen.getByRole('group', { name: t(locale, 'employeeDefaultHours.hoursToCopy') }));
  expect(panel.getByRole('group', { name: t(locale, 'employeeDefaultHours.daysOff') })).toBeTruthy();
  expect(panel.getByRole('combobox', { name: t(locale, 'employeeDefaultHours.sourceDay') })).toBeTruthy();
  expect(panel.getByRole('button', { name: t(locale, 'employeeDefaultHours.applyHours') })).toBeTruthy();
});
