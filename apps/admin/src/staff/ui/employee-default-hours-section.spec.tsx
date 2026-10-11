import { render, screen } from '@testing-library/react';
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
