import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeEditPanel } from './employee-edit-panel';

const id = '01920000-0000-7000-8000-0000000000a2';
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
        employee_number: 15,
      },
      refetch: vi.fn(),
    },
    save: { isPending: false, isError: false, isSuccess: false, mutate: vi.fn(), reset: vi.fn() },
  }),
}));
vi.mock('../api/use-employee-name-matches', () => ({
  useEmployeeNameMatches: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('./employee-number-edit', () => ({ EmployeeNumberEdit: () => null }));
vi.mock('./employee-record-sections', () => ({ EmployeeRecordSections: () => null }));
vi.mock('./edit-employee-form', () => ({ EditEmployeeForm: () => <input aria-label="draft" /> }));
vi.mock('./employee-leave-section', () => ({
  EmployeeLeaveSection: ({ timeZone }: { timeZone?: string }) => (
    <p>leave section {String(timeZone)}</p>
  ),
}));
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
function tab(name: 'leaveHistory.tabData' | 'leaveHistory.tabLeave') {
  return screen.getByRole('button', { name: t('en', name) });
}

beforeEach(() => {
  vi.clearAllMocks();
});

it('shows the details tab first and no leave section', () => {
  renderPanel();
  expect(tab('leaveHistory.tabData').getAttribute('aria-pressed')).toBe('true');
  expect(tab('leaveHistory.tabLeave').getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByLabelText('draft')).toBeTruthy();
  expect(screen.queryByText(/leave section/)).toBeNull();
});

it("mounts the leave section only when the leave tab is open, with the employee's branch zone", () => {
  renderPanel();
  expect(screen.queryByText(/leave section/)).toBeNull();
  fireEvent.click(tab('leaveHistory.tabLeave'));
  expect(screen.getByText('leave section Asia/Kuwait')).toBeTruthy();
  expect(tab('leaveHistory.tabData').getAttribute('aria-pressed')).toBe('false');
  expect(tab('leaveHistory.tabLeave').getAttribute('aria-pressed')).toBe('true');
});

it('keeps unsaved details edits when switching tabs back and forth', () => {
  renderPanel();
  fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'unsaved' } });
  fireEvent.click(tab('leaveHistory.tabLeave'));
  expect(screen.getByLabelText('draft').closest('[hidden]')).not.toBeNull();
  fireEvent.click(tab('leaveHistory.tabData'));
  expect(screen.getByLabelText('draft')).toHaveProperty('value', 'unsaved');
  expect(screen.getByLabelText('draft')).toBeTruthy();
});

it('the reload and close actions stay on both tabs', () => {
  renderPanel();
  expect(screen.getByRole('button', { name: t('en', 'staff.reload') })).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'staff.cancel') })).toBeTruthy();
  fireEvent.click(tab('leaveHistory.tabLeave'));
  expect(screen.getByRole('button', { name: t('en', 'staff.reload') })).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'staff.cancel') })).toBeTruthy();
});
