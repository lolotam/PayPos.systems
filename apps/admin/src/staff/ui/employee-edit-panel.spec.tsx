import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EmployeeEditPanel } from './employee-edit-panel';

const id = '01920000-0000-7000-8000-0000000000a2';
const state = vi.hoisted(() => ({ number: 15 as number | null }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('../api/use-employees', () => ({
  useEmployeeEdit: () => ({
    record: {
      isPending: false,
      isError: false,
      isFetching: false,
      data: {
        id,
        business_id: id,
        primary_branch_id: id,
        name_en: 'Synthetic employee',
        name_ar: null,
        role_code: 'staff',
        hire_date: '2026-01-01',
        contract_end: null,
        user_id: null,
        created_at: '2026-10-03T00:00:00Z',
        branch_ids: [id],
        revision: 3,
        employee_number: state.number,
      },
      refetch: vi.fn(),
    },
    save: { isPending: false, isError: false, isSuccess: false, mutate: vi.fn(), reset: vi.fn() },
  }),
}));
vi.mock('../api/use-employee-name-matches', () => ({
  useEmployeeNameMatches: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./employee-record-sections', () => ({ EmployeeRecordSections: () => null }));
vi.mock('./employee-leave-section', () => ({ EmployeeLeaveSection: () => null }));
const business = {
  id,
  name_en: 'Synthetic salon',
  name_ar: null,
  vertical_type: 'salon' as const,
  timezone: 'Asia/Kuwait',
  branches: [
    {
      id,
      name_ar: null,
      name_en: 'Synthetic primary',
      effective_timezone: 'Asia/Kuwait',
      is_active: true,
    },
  ],
};
function renderPanel() {
  render(
    <EmployeeEditPanel
      companyId={id}
      business={business}
      userId={id}
      employeeId={id}
      onClose={vi.fn()}
    />,
  );
}
it('shows the employee number beside the name', () => {
  state.number = 15;
  renderPanel();
  expect(screen.getByRole('heading', { name: t('en', 'staff.editTitle') })).toBeTruthy();
  expect(screen.getByText('Synthetic employee').parentElement?.textContent).toContain('15');
  expect(screen.getByText('15').getAttribute('aria-label')).toBe(`${t('en', 'staff.employeeNumber')} 15`);
});
it('shows an em dash beside the name when the employee has no number', () => {
  state.number = null;
  renderPanel();
  expect(screen.getByText('Synthetic employee').parentElement?.textContent).toContain('\u2014');
});
