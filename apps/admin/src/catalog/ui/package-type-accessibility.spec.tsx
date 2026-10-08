import type { PackageTypeDetail } from '@pospay/contracts';
import { t, type Locale, type MessageKey } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PackageTypeForm } from './package-type-form';
import { EditPackageTypeForm } from './edit-package-type-form';

const state = vi.hoisted(() => ({ locale: 'en' as Locale }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-package-services', () => ({
  usePackageServices: () => ({ isPending: false, isError: false, hasNextPage: false }),
}));
const id = '01920000-0000-7000-8000-000000000001';
const scope = { companyId: id, businessId: id, userId: id };
const record: PackageTypeDetail = {
  id,
  business_id: id,
  name_en: 'Package',
  name_ar: null,
  price: '1.000',
  validity_days: 90,
  revision: 1,
  created_at: '2026-10-08T00:00:00Z',
  updated_at: '2026-10-08T00:00:00Z',
  components: [{ service_id: id, sessions: 1, name_en: 'Service', name_ar: null, price: '1.000' }],
};

function renderForm(edit: boolean) {
  const save = vi.fn();
  render(
    edit ? (
      <EditPackageTypeForm {...scope} record={record} pending={false} onSave={save} />
    ) : (
      <PackageTypeForm {...scope} pending={false} onSave={save} />
    ),
  );
  return save;
}

function expectDescription(field: HTMLElement, message: MessageKey) {
  expect(field.getAttribute('aria-invalid')).toBe('true');
  const ids = field.getAttribute('aria-describedby')?.split(' ') ?? [];
  expect(ids.length).toBeGreaterThan(0);
  const descriptions = ids.map((descriptionId) => {
    const element = document.getElementById(descriptionId);
    expect(element).not.toBeNull();
    return element?.textContent;
  });
  expect(descriptions).toContain(t(state.locale, message));
}

it.each([
  ['en', false],
  ['ar', false],
  ['en', true],
  ['ar', true],
] as const)(
  'associates every invalid field with its %s message (edit=%s)',
  async (locale, edit) => {
    state.locale = locale;
    const save = renderForm(edit);
    const cases: [MessageKey, string, MessageKey][] = [
      ['catalogPackageTypes.nameEn', '', 'errors.PACKAGE_TYPE_NAME_INVALID'],
      ['catalogPackageTypes.nameAr', 'a'.repeat(256), 'errors.PACKAGE_TYPE_NAME_INVALID'],
      ['catalogPackageTypes.price', '-1.000', 'errors.PACKAGE_TYPE_PRICE_INVALID'],
      ['catalogPackageTypes.validity', '731', 'errors.PACKAGE_TYPE_VALIDITY_INVALID'],
      ['catalogPackageTypes.service', '', 'catalogPackageTypes.selectService'],
      ['catalogPackageTypes.sessions', '366', 'errors.PACKAGE_TYPE_INVALID_SESSIONS'],
    ];
    for (const [label, value] of cases)
      fireEvent.change(screen.getByLabelText(t(locale, label)), { target: { value } });
    fireEvent.click(
      screen.getByRole('button', {
        name: t(locale, edit ? 'catalogPackageTypes.save' : 'catalogPackageTypes.create'),
      }),
    );
    await waitFor(() => {
      for (const [label, , message] of cases)
        expectDescription(screen.getByLabelText(t(locale, label)), message);
    });
    expect(save).not.toHaveBeenCalled();
  },
);

it.each(['en', 'ar'] as const)(
  'identifies removal rows and the empty component error in %s',
  async (locale) => {
    state.locale = locale;
    renderForm(false);
    const removeName = (row: number) =>
      t(locale, 'catalogPackageTypes.removeComponentRow').replace('{row}', String(row));
    for (let i = 0; i < 2; i++)
      fireEvent.click(
        screen.getByRole('button', { name: t(locale, 'catalogPackageTypes.addComponent') }),
      );
    fireEvent.change(
      screen.getAllByLabelText(t(locale, 'catalogPackageTypes.sessions'))[2] as HTMLElement,
      { target: { value: '3' } },
    );
    fireEvent.click(screen.getByRole('button', { name: removeName(2) }));
    expect(screen.queryByRole('button', { name: removeName(3) })).toBeNull();
    expect(
      (screen.getAllByLabelText(t(locale, 'catalogPackageTypes.sessions'))[1] as HTMLInputElement)
        .value,
    ).toBe('3');
    fireEvent.click(screen.getByRole('button', { name: removeName(2) }));
    fireEvent.click(screen.getByRole('button', { name: removeName(1) }));
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'catalogPackageTypes.create') }));
    await waitFor(() =>
      expectDescription(
        screen.getByRole('group', { name: t(locale, 'catalogPackageTypes.components') }),
        'errors.PACKAGE_TYPE_INVALID_COMPONENTS',
      ),
    );
  },
);

it.each(['en', 'ar'] as const)('describes a duplicate service on its row in %s', async (locale) => {
  state.locale = locale;
  const save = renderForm(true);
  fireEvent.click(
    screen.getByRole('button', { name: t(locale, 'catalogPackageTypes.addComponent') }),
  );
  const select = screen.getAllByRole('combobox')[1] as HTMLElement;
  fireEvent.change(select, { target: { value: id } });
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'catalogPackageTypes.save') }));
  await waitFor(() => expectDescription(select, 'errors.PACKAGE_TYPE_DUPLICATE_SERVICE'));
  expect(save).not.toHaveBeenCalled();
});
