import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PackageTypeForm } from './package-type-form';
import { EditPackageTypeForm } from './edit-package-type-form';

const id = '01920000-0000-7000-8000-000000000001';
const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-package-services', () => ({
  usePackageServices: () => ({
    data: {
      pages: [
        {
          items: [
            {
              id: '01920000-0000-7000-8000-000000000001',
              name_en: 'Free service',
              name_ar: null,
              price: '0.000',
            },
          ],
        },
      ],
    },
    isPending: false,
    isError: false,
    hasNextPage: false,
  }),
}));
const scope = { companyId: id, businessId: id, userId: id };

it.each(['en', 'ar'] as const)(
  'creates with contract validation, free-service warning and date help in %s',
  async (locale) => {
    state.locale = locale;
    const save = vi.fn();
    render(<PackageTypeForm {...scope} pending={false} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'catalogPackageTypes.create') }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(t(locale, 'catalogPackageTypes.nameEn')), {
      target: { value: ' Package ' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'catalogPackageTypes.price')), {
      target: { value: '25.5' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'catalogPackageTypes.service')), {
      target: { value: id },
    });
    expect(screen.getByText(t(locale, 'catalogPackageTypes.freeWarning'))).toBeTruthy();
    expect(screen.getByText(t(locale, 'catalogPackageTypes.validityHelp'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'catalogPackageTypes.create') }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0]).toEqual({
      name_en: 'Package',
      name_ar: null,
      price: '25.500',
      validity_days: 90,
      components: [{ service_id: id, sessions: 1 }],
    });
  },
);
it('caps component rows at 20 and permits removing rows', () => {
  state.locale = 'en';
  render(<PackageTypeForm {...scope} pending={false} onSave={vi.fn()} />);
  const add = screen.getByRole('button', { name: t('en', 'catalogPackageTypes.addComponent') });
  for (let i = 1; i < 20; i++) fireEvent.click(add);
  expect((add as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByRole('combobox')).toHaveLength(20);
  fireEvent.click(
    screen.getByRole('button', {
      name: t('en', 'catalogPackageTypes.removeComponentRow').replace('{row}', '1'),
    }),
  );
  expect(screen.getAllByRole('combobox')).toHaveLength(19);
  expect((add as HTMLButtonElement).disabled).toBe(false);
});
it('edit sends the full definition and expected revision without display-only service fields', async () => {
  state.locale = 'en';
  const save = vi.fn();
  render(
    <EditPackageTypeForm
      {...scope}
      pending={false}
      onSave={save}
      record={{
        id,
        business_id: id,
        name_en: 'Existing',
        name_ar: null,
        price: '99999999999.999',
        validity_days: 730,
        revision: 8,
        created_at: '2026-10-08T00:00:00Z',
        updated_at: '2026-10-08T00:00:00Z',
        components: [
          { service_id: id, sessions: 365, name_en: 'Free service', name_ar: null, price: '0.000' },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogPackageTypes.save') }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0]?.[0]).toEqual({
    expected_revision: 8,
    name_en: 'Existing',
    name_ar: null,
    price: '99999999999.999',
    validity_days: 730,
    components: [{ service_id: id, sessions: 365 }],
  });
});
it('disables submission while pending', () => {
  render(<PackageTypeForm {...scope} pending={true} onSave={vi.fn()} />);
  expect(
    screen
      .getByRole('button', { name: t(state.locale, 'catalogPackageTypes.create') })
      .closest('fieldset')?.disabled,
  ).toBe(true);
});
