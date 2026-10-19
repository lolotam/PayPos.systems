import { t } from '@pospay/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CreateEmployeePage } from './create-employee-page';

const state = vi.hoisted(() => ({
  locale: 'en' as 'ar' | 'en',
  error: true,
  canType: false,
  code: 'FORBIDDEN',
  messageEn: 'Synthetic refusal',
  variables: undefined as { employee_number?: number } | undefined,
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-employee-name-matches', () => ({
  useEmployeeNameMatches: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../api/use-employee-number-capability', () => ({
  useEmployeeNumberCapability: () => ({
    data: state.canType ? { can_type_number: true } : undefined,
  }),
}));
vi.mock('../api/use-create-employee', () => ({
  useCreateEmployee: () => ({
    isPending: false,
    isSuccess: !state.error,
    isError: state.error,
    mutate: vi.fn(),
    error: {
      code: state.code,
      message_ar: t('ar', 'errors.FORBIDDEN'),
      message_en: state.messageEn,
    },
    variables: state.variables,
    data: {
      name_en: 'Synthetic employee',
      name_ar: t('ar', 'roles.staff'),
      hire_date: '2026-01-01',
    },
  }),
}));
beforeEach(() => {
  state.variables = undefined;
});
const id = '01920000-0000-7000-8000-0000000000a2';
const business = {
  id,
  name_en: 'Synthetic business',
  name_ar: null,
  branches: [
    {
      id,
      name_en: 'Synthetic branch',
      name_ar: null,
      effective_timezone: 'Asia/Kuwait',
      is_active: true,
    },
  ],
};
it.each(['ar', 'en'] as const)(
  'renders the server refusal and confirmed creation in %s',
  (locale) => {
    state.locale = locale;
    state.error = true;
    state.canType = false;
    state.code = 'FORBIDDEN';
    state.messageEn = 'Synthetic refusal';
    const view = render(<CreateEmployeePage companyId={id} business={business} userId={id} />);
    expect(screen.getByRole('alert').textContent).toBe(
      locale === 'ar' ? t('ar', 'errors.FORBIDDEN') : 'Synthetic refusal',
    );
    state.error = false;
    view.rerender(<CreateEmployeePage companyId={id} business={business} userId={id} />);
    expect(screen.getByRole('status').textContent).toContain(t(locale, 'staff.created'));
    expect(screen.getByRole('status').textContent).toContain(
      locale === 'ar' ? t('ar', 'roles.staff') : 'Synthetic employee',
    );
    expect(screen.getByRole('status').textContent).toContain('2026');
  },
);
it('keeps a typed number and shows the server refusal on the field', () => {
  state.locale = 'en';
  state.error = true;
  state.canType = true;
  state.code = 'EMPLOYEE_NUMBER_TAKEN';
  state.messageEn = 'Synthetic taken';
  render(<CreateEmployeePage companyId={id} business={business} userId={id} />);
  const input = screen.getByLabelText(t('en', 'staff.employeeNumber'));
  fireEvent.change(input, { target: { value: '007' } });
  expect((input as HTMLInputElement).value).toBe('007');
  expect(screen.getByRole('alert').textContent).toBe('Synthetic taken');
});
it('shows a bare forbidden refusal on the page when no number was sent', () => {
  state.locale = 'en';
  state.error = true;
  state.canType = true;
  state.code = 'FORBIDDEN';
  state.messageEn = 'Synthetic refusal';
  render(<CreateEmployeePage companyId={id} business={business} userId={id} />);
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toBe('Synthetic refusal');
  expect(alert.closest('form')).toBeNull();
  expect(screen.getByLabelText(t('en', 'staff.employeeNumber'))).toBeTruthy();
});
it('shows a forbidden refusal on the field when the create sent a number', () => {
  state.locale = 'en';
  state.error = true;
  state.canType = true;
  state.code = 'FORBIDDEN';
  state.messageEn = 'Synthetic refusal';
  state.variables = { employee_number: 7 };
  render(<CreateEmployeePage companyId={id} business={business} userId={id} />);
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toBe('Synthetic refusal');
  expect(alert.closest('form')).toBeTruthy();
  expect(screen.getByLabelText(t('en', 'staff.employeeNumber'))).toBeTruthy();
});
it('shows another error with its own envelope on the page', () => {
  state.locale = 'en';
  state.error = true;
  state.canType = true;
  state.code = 'VALIDATION';
  state.messageEn = 'Synthetic other';
  render(<CreateEmployeePage companyId={id} business={business} userId={id} />);
  expect(screen.getByRole('alert').textContent).toBe('Synthetic other');
  expect(screen.queryByText(t('en', 'errors.EMPLOYEE_NUMBER_TAKEN'))).toBeNull();
});
