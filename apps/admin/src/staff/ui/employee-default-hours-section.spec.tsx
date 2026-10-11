import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EmployeeDefaultHoursSection } from './employee-default-hours-section';
const mocks = vi.hoisted(() => ({ useEmployeeDefaultHours: vi.fn() }));
vi.mock('../api/use-employee-default-hours', () => mocks);
vi.mock('../api/use-schedule-settings', () => ({ useScheduleWorkspaceBranches: () => [{ id: 'b', name_en: 'Salmiya', name_ar: null }] }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const props = { companyId: 'c', businessId: 'b', userId: 'u', employeeId: 'e' };
function setup(can_manage: boolean) {
  mocks.useEmployeeDefaultHours.mockReturnValue({ current: { isFetchedAfterMount: true,
    data: { can_manage, branches: [{ branch_id: 'b', linked: true, shifts: [], updated_at: null },
      { branch_id: 'old', linked: false, shifts: [{ day: 0, start: '09:00', end: '17:00' }], updated_at: null }] } }, save: { mutate: vi.fn() } });
}
it('shows linked branches, missing hours notice and stored unlinked defaults read-only', () => {
  setup(false); render(<EmployeeDefaultHoursSection {...props} />);
  expect(screen.getByText('Salmiya')).toBeTruthy();
  expect(screen.getByText('Her default hours are not recorded')).toBeTruthy();
  expect(screen.getByText('No longer linked')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Save default hours' })).toBeNull();
});
it('allows editing linked branches only when can_manage', () => {
  setup(true); render(<EmployeeDefaultHoursSection {...props} />);
  expect(screen.getAllByRole('button', { name: 'Save default hours' })).toHaveLength(1);
});

it('clears unsaved days after a successful no-op with updated_at still null', async () => {
  setup(true);
  const result = mocks.useEmployeeDefaultHours();
  result.save.mutate.mockImplementation((_variables: unknown, options: { onSuccess: () => void }) => options.onSuccess());
  const view = render(<EmployeeDefaultHoursSection {...props} />);
  fireEvent.click(screen.getByLabelText('Saturday'));
  fireEvent.change(screen.getByLabelText('Start'), { target: { value: '11:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Clear default hours' }));
  await waitFor(() => expect(screen.queryByLabelText('Start')).toBeNull());
  view.rerender(<EmployeeDefaultHoursSection {...props} />);
  expect(result.current.data.branches[0].updated_at).toBeNull();
  expect(result.save.mutate).toHaveBeenCalledWith({ branchId: 'b', input: { shifts: [] } },
    { onSuccess: expect.any(Function) });
  expect(screen.getAllByRole('checkbox').every((field) => !(field as HTMLInputElement).checked)).toBe(true);
});

it('keeps unsaved days and times when clear fails', () => {
  setup(true);
  const result = mocks.useEmployeeDefaultHours();
  const view = render(<EmployeeDefaultHoursSection {...props} />);
  fireEvent.click(screen.getByLabelText('Saturday'));
  fireEvent.change(screen.getByLabelText('Start'), { target: { value: '11:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Clear default hours' }));
  result.save.isError = true;
  result.save.error = { code: 'SCHEDULE_SHIFT_INVALID', message_en: 'Synthetic clear failure', message_ar: '' };
  view.rerender(<EmployeeDefaultHoursSection {...props} />);
  expect(screen.getByRole('alert').textContent).toBe('Synthetic clear failure');
  expect((screen.getByLabelText('Saturday') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Start') as HTMLInputElement).value).toBe('11:00');
  expect((screen.getByLabelText('End') as HTMLInputElement).value).toBe('17:00');
});
