import type { Service, ServiceCategoryListItem, UpdateServiceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ServiceCategoriesQuery } from '../api/use-service-categories';
import { EditServiceForm } from './edit-service-form';
import { ServiceForm } from './service-form';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const firstCategory: ServiceCategoryListItem = {
  id: '01920000-0000-7000-8000-0000000000c1',
  name_en: 'Hair',
  name_ar: 'Hair AR',
  visibility: 'BUSINESS',
  owner_branch_id: null,
  closed_at: null,
  revision: 1,
};
const secondCategory: ServiceCategoryListItem = {
  ...firstCategory,
  id: '01920000-0000-7000-8000-0000000000c2',
  name_en: 'Nails',
  name_ar: 'Nails AR',
};
const closedCategoryId = '01920000-0000-7000-8000-0000000000c3';
const record: Service = {
  id: '01920000-0000-7000-8000-0000000000a2',
  business_id: '01920000-0000-7000-8000-0000000000b1',
  name_en: 'Existing service',
  name_ar: null,
  price: '12.500',
  commission_rule: { kind: 'FOLLOW_PLAN' },
  counts_toward_threshold: true,
  duration_minutes: 45,
  category_id: closedCategoryId,
  category: {
    name_en: 'Legacy',
    name_ar: 'Legacy AR',
    closed_at: '2026-10-05T10:00:00Z',
  },
  revision: 2,
  created_at: '2026-10-05T10:00:00Z',
  updated_at: '2026-10-05T10:00:00Z',
};

function categoryQuery(overrides: Partial<ServiceCategoriesQuery> = {}): ServiceCategoriesQuery {
  return {
    data: [firstCategory, secondCategory],
    error: null,
    isError: false,
    isPending: false,
    ...overrides,
  };
}

beforeEach(() => {
  state.locale = 'en';
});

it.each(['ar', 'en'] as const)(
  'validates and submits blank optional attributes with bilingual labels in %s',
  async (locale) => {
    state.locale = locale;
    const save = vi.fn();
    render(<ServiceForm categoryQuery={categoryQuery()} pending={false} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'catalogServices.create') }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(t(locale, 'catalogServices.nameEn')), {
      target: { value: '  Synthetic service  ' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'catalogServices.price')), {
      target: { value: '12.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'catalogServices.create') }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0]).toEqual({
      name_en: 'Synthetic service',
      name_ar: null,
      price: '12.500',
      commission_rule: { kind: 'FOLLOW_PLAN' },
      counts_toward_threshold: true,
      duration_minutes: null,
      category_id: null,
    });
  },
);

it.each(['0', '601', '90.5', 'abc'])(
  'shows the duration field error instead of submitting %s',
  async (duration) => {
    const save = vi.fn();
    render(<ServiceForm categoryQuery={categoryQuery()} pending={false} onSave={save} />);
    fireEvent.change(screen.getByLabelText(t('en', 'catalogServices.nameEn')), {
      target: { value: 'Synthetic service' },
    });
    fireEvent.change(screen.getByLabelText(t('en', 'catalogServices.duration')), {
      target: { value: duration },
    });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServices.create') }));
    expect(
      await screen.findByText(t('en', 'catalogServices.durationInvalid')),
    ).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  },
);

it('offers exactly the open categories supplied to the picker', () => {
  render(<ServiceForm categoryQuery={categoryQuery()} pending={false} onSave={vi.fn()} />);
  const picker = screen.getByLabelText(t('en', 'catalogServices.category')) as HTMLSelectElement;
  const options = within(picker).getAllByRole('option') as HTMLOptionElement[];
  expect(options.map((option) => option.value)).toEqual(['', firstCategory.id, secondCategory.id]);
  expect(options.map((option) => option.textContent)).toEqual([
    t('en', 'catalogServices.noCategory'),
    firstCategory.name_en,
    secondCategory.name_en,
  ]);
});

it('keeps a closed current category selected and visibly marked', () => {
  render(
    <EditServiceForm
      categoryQuery={categoryQuery()}
      record={record}
      pending={false}
      onSave={vi.fn()}
    />,
  );
  const picker = screen.getByLabelText(t('en', 'catalogServices.category')) as HTMLSelectElement;
  expect(picker.value).toBe(closedCategoryId);
  expect(picker.selectedOptions[0]?.textContent).toBe(
    `Legacy (${t('en', 'catalogServices.categoryClosed')})`,
  );
});

it('keeps the current open category selected after the category query loads', () => {
  const openRecord: Service = {
    ...record,
    category_id: firstCategory.id,
    category: {
      name_en: firstCategory.name_en,
      name_ar: firstCategory.name_ar,
      closed_at: null,
    },
  };
  const view = render(
    <EditServiceForm
      categoryQuery={categoryQuery({ data: undefined, isPending: true })}
      record={openRecord}
      pending={false}
      onSave={vi.fn()}
    />,
  );
  view.rerender(
    <EditServiceForm
      categoryQuery={categoryQuery()}
      record={openRecord}
      pending={false}
      onSave={vi.fn()}
    />,
  );
  const picker = screen.getByLabelText(t('en', 'catalogServices.category')) as HTMLSelectElement;
  expect(picker.value).toBe(firstCategory.id);
  expect(picker.selectedOptions[0]?.textContent).toBe(firstCategory.name_en);
});

it('shows read-only category text and omits category_id when categories are refused', async () => {
  const save = vi.fn();
  render(
    <EditServiceForm
      categoryQuery={categoryQuery({
        data: undefined,
        error: { status: 403 },
        isError: true,
      })}
      record={record}
      pending={false}
      onSave={save}
    />,
  );
  expect(screen.queryByLabelText(t('en', 'catalogServices.category'))).toBeNull();
  expect(screen.getByText('Legacy')).toBeTruthy();
  expect(screen.getByText(t('en', 'catalogServices.categoriesUnavailable'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServices.save') }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  const terms = save.mock.calls[0]?.[0] as UpdateServiceInput;
  expect(terms).not.toHaveProperty('category_id');
  expect(terms.duration_minutes).toBe(45);
});

it('disables submission during the pending request', () => {
  render(<ServiceForm categoryQuery={categoryQuery()} pending={true} onSave={vi.fn()} />);
  expect(screen.getByRole('button').closest('fieldset')?.disabled).toBe(true);
});
