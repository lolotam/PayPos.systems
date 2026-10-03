import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CreateEmployeePage } from './create-employee-page';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', error: true }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-create-employee', () => ({
  useCreateEmployee: () => ({
    isPending: false,
    isSuccess: !state.error,
    isError: state.error,
    mutate: vi.fn(),
    error: {
      code: 'FORBIDDEN',
      message_ar: t('ar', 'errors.FORBIDDEN'),
      message_en: 'Synthetic refusal',
    },
    data: {
      name_en: 'Synthetic employee',
      name_ar: t('ar', 'roles.staff'),
      hire_date: '2026-01-01',
    },
  }),
}));
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
