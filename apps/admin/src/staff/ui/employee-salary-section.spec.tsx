import { t } from '@pospay/i18n';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EmployeeSalarySection } from './employee-salary-section';
const state = vi.hoisted(() => ({ read: true, manage: false, denied: false, cursor: '' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('../api/use-salaries', () => ({
  useSalaries: (
    _company: string,
    _business: string,
    _user: string,
    _employee: string,
    cursor?: string,
  ) => {
    state.cursor = cursor ?? '';
    return {
      history: {
        data: state.read
          ? { items: [], next_cursor: '2026-01-01', can_manage: state.manage }
          : undefined,
        isError: state.denied,
      },
      save: { isPending: false, isError: false, isSuccess: false, mutate: vi.fn() },
    };
  },
}));
const props = {
  companyId: 'company',
  businessId: 'business',
  userId: 'user',
  employeeId: 'employee',
};
it('hides unreadable and revoked cached history, permits history-only and uses server cursor', () => {
  state.read = false;
  const view = render(<EmployeeSalarySection {...props} />);
  expect(screen.queryByRole('region')).toBeNull();
  state.read = true;
  view.rerender(<EmployeeSalarySection {...props} />);
  expect(screen.queryByRole('button', { name: t('en', 'salary.set') })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'staff.next') }));
  expect(state.cursor).toBe('2026-01-01');
  state.manage = true;
  view.rerender(<EmployeeSalarySection {...props} />);
  expect(screen.getByRole('button', { name: t('en', 'salary.set') })).toBeTruthy();
  state.denied = true;
  view.rerender(<EmployeeSalarySection {...props} />);
  expect(screen.queryByRole('region')).toBeNull();
});
