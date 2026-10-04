import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PasskeyEmployeesPanel } from './passkey-employees-panel';
const state = vi.hoisted(() => ({ cursor: '', selected: vi.fn(), denied: false }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'ar' }));
vi.mock('../api/use-passkeys', () => ({
  usePasskeyEmployees: (_company: string, _business: string, _user: string, cursor?: string) => {
    state.cursor = cursor ?? '';
    return {
      isFetchedAfterMount: true,
      isError: state.denied,
      data: {
        items: [
          {
            id: 'employee',
            name_ar: t('ar', 'staff.listTitle'),
            name_en: 'Synthetic staff',
            primary_branch_id: 'branch',
          },
        ],
        next_cursor: 'next',
      },
    };
  },
}));
vi.mock('./employee-passkey-section', () => ({
  EmployeePasskeySection: (props: object) => {
    state.selected(props);
    return <span>synthetic selected</span>;
  },
}));
const business = {
  id: 'business',
  name_ar: null,
  name_en: 'Synthetic business',
  vertical_type: 'salon' as const,
  timezone: 'Asia/Kuwait',
  branches: [
    {
      id: 'branch',
      name_ar: null,
      name_en: 'Synthetic branch',
      is_active: true,
      effective_timezone: 'Asia/Kuwait',
    },
  ],
};
it('opens the scoped Arabic employee without requiring edit permission, resets on page change and hides revoked rows', () => {
  state.denied = false;
  const view = render(
    <PasskeyEmployeesPanel companyId="company" userId="manager" business={business} />,
  );
  expect(screen.getByText(t('ar', 'staff.listTitle'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'passkeyAdmin.select') }));
  expect(state.selected).toHaveBeenLastCalledWith(
    expect.objectContaining({ employeeId: 'employee', timeZone: 'Asia/Kuwait' }),
  );
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'staff.next') }));
  expect(state.cursor).toBe('next');
  expect(screen.queryByText('synthetic selected')).toBeNull();
  state.denied = true;
  view.rerender(<PasskeyEmployeesPanel companyId="company" userId="manager" business={business} />);
  expect(screen.queryByText(t('ar', 'staff.listTitle'))).toBeNull();
});
