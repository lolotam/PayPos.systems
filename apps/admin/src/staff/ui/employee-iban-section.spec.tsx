import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EmployeeIbanSection } from './employee-iban-section';
const mocks = vi.hoisted(() => ({ useEmployeeIban: vi.fn() }));
vi.mock('../api/use-employee-iban', () => mocks);
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const props = {
  companyId: 'company',
  businessId: 'business',
  userId: 'user',
  employeeId: 'employee',
};
const current = {
  status: 'SET',
  iban: 'KW81CBKU0000000000001234560101',
  iban_last4: '0101',
  bank_id: 'kw-cbk',
  holder_name_en: 'SYNTHETIC HOLDER',
  revision: 1,
  can_read_full: true,
  can_manage: false,
};
it('shows full details to read-only salary readers without a form', () => {
  mocks.useEmployeeIban.mockReturnValue({
    current: { data: current, isFetchedAfterMount: true },
    history: { data: { items: [], next_cursor: null }, isFetchedAfterMount: true },
    save: {},
  });
  render(<EmployeeIbanSection {...props} />);
  expect(screen.getByText('KW81 CBKU 0000 0000 0000 1234 5601 01').getAttribute('dir')).toBe('ltr');
  expect(screen.getByText('Commercial Bank of Kuwait')).toBeTruthy();
  expect(screen.getByText('SYNTHETIC HOLDER')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Save bank account' })).toBeNull();
});
it('shows a missing-account message to masked readers without bank or history', () => {
  mocks.useEmployeeIban.mockReturnValue({
    current: {
      data: {
        ...current,
        status: 'NOT_SET',
        iban: null,
        iban_last4: null,
        bank_id: null,
        holder_name_en: null,
        can_read_full: false,
      },
      isFetchedAfterMount: true,
    },
    history: {},
    save: {},
  });
  render(<EmployeeIbanSection {...props} />);
  expect(screen.getByText('No IBAN on file')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});
