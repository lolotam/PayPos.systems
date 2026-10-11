import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import type { SetScheduleInput } from '@pospay/contracts';
import { expect, it, vi } from 'vitest';
import { ScheduleDayWarning } from './schedule-day-warning';
import { ScheduleDayForm } from './schedule-day-form';
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const entry = { day: 0, start: '09:00', end: '17:00', break_start: '13:00', break_end: '14:00' };
it('shows a nonblocking warning when times or breaks differ', () => {
  render(<ScheduleDayWarning shifts={[{ ...entry, start: '10:00' }]} entry={entry} name="Sara" />);
  expect(screen.getByRole('status').textContent).toBe('This differs from Sara’s default hours');
  expect(screen.queryByRole('alert')).toBeNull();
});
it.each([{ shifts: [entry] }, { shifts: [] }])('hides the warning for equal or empty days', ({ shifts }) => {
  render(<ScheduleDayWarning shifts={shifts} entry={entry} name="Sara" />);
  expect(screen.queryByRole('status')).toBeNull();
});
it('hides it without a weekday default', () => {
  render(<ScheduleDayWarning shifts={[entry]} entry={null} name="Sara" />);
  expect(screen.queryByRole('status')).toBeNull();
});

function DayEditor({ onSave }: { onSave: (input: SetScheduleInput) => void }) {
  const form = useForm<SetScheduleInput>({ defaultValues: { week_start: '2026-10-10', expected_revision: 0, shifts: [] } });
  return <FormProvider {...form}><form onSubmit={form.handleSubmit((input) => onSave(input))}>
    <ScheduleDayForm day={0} past={false} pending={false} error={null} onClose={() => undefined}
      defaultShifts={[entry]} employeeName="Sara" />
  </form></FormProvider>;
}
it('prefills the first shift and break; warns on a changed day without blocking save', async () => {
  const onSave = vi.fn();
  render(<DayEditor onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add shift' }));
  expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('09:00');
  expect((screen.getByLabelText('Break start') as HTMLInputElement).value).toBe('13:00');
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.change(screen.getByLabelText('Start'), { target: { value: '10:00' } });
  expect(screen.getByRole('status').textContent).toContain('Sara');
  fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ shifts: [{ ...entry, start: '10:00' }] })));
});
