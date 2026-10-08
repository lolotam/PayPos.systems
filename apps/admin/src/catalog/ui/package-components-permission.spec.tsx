import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PackageTypeForm } from './package-type-form';
import { EditPackageTypeForm } from './edit-package-type-form';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-package-services', () => ({
  usePackageServices: () => ({
    isPending: false,
    isError: true,
    error: {
      code: 'FORBIDDEN',
      message_en: t('en', 'errors.FORBIDDEN'),
      message_ar: t('ar', 'errors.FORBIDDEN'),
    },
  }),
}));
const id = '01920000-0000-7000-8000-000000000001';
const props = { companyId: id, businessId: id, userId: id, pending: false, onSave: vi.fn() };
const record = {
  id,
  business_id: id,
  name_en: 'Existing',
  name_ar: null,
  price: '10.000',
  validity_days: 90,
  revision: 1,
  created_at: '2026-10-08T00:00:00Z',
  updated_at: '2026-10-08T00:00:00Z',
  components: [{ service_id: id, sessions: 1, name_en: 'Service', name_ar: null, price: '1.000' }],
};

it.each(['en', 'ar'] as const)(
  'names the missing permission instead of an empty create picker in %s',
  (locale) => {
    state.locale = locale;
    render(<PackageTypeForm {...props} />);
    assertPermissionMessage(locale);
  },
);

it.each(['en', 'ar'] as const)(
  'names the missing permission instead of an edit picker in %s',
  (locale) => {
    state.locale = locale;
    render(<EditPackageTypeForm {...props} record={record} />);
    assertPermissionMessage(locale);
  },
);

function assertPermissionMessage(locale: 'en' | 'ar') {
  expect(screen.getByRole('alert').textContent).toBe(
    t(locale, 'catalogPackageTypes.serviceOptionsForbidden'),
  );
  expect(screen.getByRole('alert').textContent).toContain('read:package-types:business');
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(
    screen.queryByRole('button', { name: t(locale, 'catalogPackageTypes.addComponent') }),
  ).toBeNull();
}
