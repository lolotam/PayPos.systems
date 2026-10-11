import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EmployeeDefaultHoursForm } from './employee-default-hours-form';
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const shift = { day: 0, start: '09:00', end: '17:00', break_start: '13:00', break_end: '14:00' };
it('shows seven weekdays and break-inclusive day minutes, and saves and clears', async () => {
  const onSave = vi.fn();
  render(<EmployeeDefaultHoursForm shifts={[shift]} pending={false} onSave={onSave} />);
  expect(screen.getAllByRole('checkbox')).toHaveLength(7);
  expect(screen.getByText('480 minutes including break')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save default hours' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ shifts: [shift] }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear default hours' }));
  expect(onSave).toHaveBeenLastCalledWith({ shifts: [] }, expect.any(Function));
});
it('adds exactly one weekday and removes an unchecked day', async () => {
  const onSave = vi.fn();
  render(<EmployeeDefaultHoursForm shifts={[]} pending={false} onSave={onSave} />);
  fireEvent.click(screen.getByLabelText('Saturday'));
  fireEvent.click(screen.getByRole('button', { name: 'Save default hours' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ shifts: [{ day: 0, start: '09:00', end: '17:00', break_start: null, break_end: null }] }));
  fireEvent.click(screen.getByLabelText('Saturday'));
  fireEvent.click(screen.getByRole('button', { name: 'Save default hours' }));
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith({ shifts: [] }));
});
