import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { parseMoney } from '@pospay/domain';
import { formatKwd, t } from '@pospay/i18n';
import { beforeEach, expect, it, vi } from 'vitest';
import { PackageSaleForm } from './package-sale-form';
import {
  choosePackageSaleCustomer as chooseCustomer,
  choosePackageSalePageTwoSeller as choosePageTwoTypeAndSeller,
  choosePackageSaleTypeAndSeller as chooseTypeAndSeller,
  completedPackageSale,
  failedPackageSale as failedSale,
  expectCustomerSelectionUnavailable,
  holdPackageSaleSecondPage as holdRefreshedSecondPage,
  packageSaleAnswerRead,
  packageSaleCustomer,
  packageSaleEntitlement,
  packageSalePath as salePath,
  packageSaleRecorderId,
  packageSaleScope,
  packageSaleSeller,
  packageSaleType,
  renderPackageSaleForm as renderForm,
  resetPackageSaleFormTest,
  submitPackageSale as submitSale,
} from './package-sale-status.fixture';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  locale: 'en' as 'ar' | 'en',
  outcome: 'pending' as 'pending' | 'completed' | 'failed',
  sellerFailures: 0,
  recorderIds: null as string[] | null,
  sellerIds: null as string[] | null,
  sellerPages: null as Record<string, string[]> | null,
  entryScope: 'BRANCH' as 'COMPANY' | 'BUSINESS' | 'BRANCH' | null,
  contextAnchor: '2026-10-01T08:00:00.000Z',
}));
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: state.get, POST: state.post }),
}));
vi.mock('@/shared/locale/locale-context', () => ({
  useLocale: () => state.locale,
}));

const answerRead = (path: string, query?: Record<string, unknown>) =>
  packageSaleAnswerRead(state, path, query);

beforeEach(() => resetPackageSaleFormTest(state));

it('submits the exact accepted quote and recorder without sold_at, then renders the server summary', async () => {
  const view = renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  expect((screen.getByLabelText(t('en', 'packageSale.pricePaid')) as HTMLInputElement).value).toBe(
    packageSaleType.price,
  );
  await submitSale(state);
  expect(await screen.findByText(t('en', 'packageSale.pending'))).toBeTruthy();
  const sent = state.post.mock.calls.find(([path]) => path === salePath)?.[1];
  expect(sent.body).toEqual({
    customer_id: packageSaleCustomer.id,
    package_type_id: packageSaleType.id,
    expected_type_revision: packageSaleType.revision,
    expected_service_revisions: [
      { service_id: packageSaleType.components[0]?.service_id, revision: 4 },
    ],
    price_paid: packageSaleType.price,
    paid_method: 'CASH',
    seller_employee_id: packageSaleSeller.id,
    recorder_membership_id: packageSaleRecorderId,
  });
  expect(sent.body).not.toHaveProperty('sold_at');
  state.outcome = 'completed';
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['package-sale-status'] });
  });
  const summary = await screen.findByText(t('en', 'packageSale.completed'));
  expect(summary.parentElement?.textContent).toContain(
    formatKwd(parseMoney(packageSaleEntitlement.price_paid)),
  );
  expect(summary.parentElement?.textContent).toContain(completedPackageSale.entitlement.expires_on);
  expect(state.post.mock.calls.filter(([path]) => path === salePath)).toHaveLength(1);
});

it('requires a visible recorder choice when two memberships are sale-eligible', async () => {
  const second = '01920000-0000-7000-8000-00000000003c';
  state.recorderIds = [packageSaleRecorderId, second];
  renderForm();
  await screen.findByLabelText(t('en', 'packageSale.recorder'));
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageSale.submit') }));
  expect(await screen.findByText(t('en', 'packageSale.invalid'))).toBeTruthy();
  expect(state.post.mock.calls.some(([path]) => path === salePath)).toBe(false);
  fireEvent.change(screen.getByLabelText(t('en', 'packageSale.recorder')), {
    target: { value: second },
  });
  await submitSale(state);
  const sent = state.post.mock.calls.find(([path]) => path === salePath)?.[1];
  expect(sent.body.recorder_membership_id).toBe(second);
});

it.each([
  ['COMPANY', '/v1/customers/find-or-create'],
  ['BUSINESS', '/v1/businesses/{businessId}/customers/find-or-create'],
  ['BRANCH', '/v1/branches/{branchId}/customers/find-or-create'],
] as const)(
  'selects a customer through the %s route allowed independently of the recorder scope',
  async (scope, expected) => {
    state.entryScope = scope;
    renderForm();
    await chooseCustomer(state);
    const call = state.post.mock.calls.find(([path]) =>
      String(path).includes('/customers/find-or-create'),
    );
    expect(call?.[0]).toBe(expected);
  },
);

it('explicitly accepts a refreshed one-option quote without replacing the intentional price paid', async () => {
  const view = renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  fireEvent.change(screen.getByLabelText(t('en', 'packageSale.pricePaid')), {
    target: { value: '22.500' },
  });
  const component = packageSaleType.components[0];
  if (!component) throw new Error('Missing component fixture');
  const refreshed = {
    ...packageSaleType,
    revision: 3,
    price: '30.000',
    components: [{ ...component, service_revision: 5, list_price: '3.500' }],
  };
  state.get.mockImplementation((path) =>
    Promise.resolve(
      String(path).includes('/sellable-package-types')
        ? {
            data: { items: [refreshed], next_cursor: null },
            response: { status: 200 },
          }
        : answerRead(String(path)),
    ),
  );
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['sellable-package-types'] });
  });
  const confirm = await screen.findByRole('button', {
    name: t('en', 'packageSale.confirmRefreshedQuote'),
  });
  expect(state.post.mock.calls.some(([path]) => path === salePath)).toBe(false);
  fireEvent.click(confirm);
  await submitSale(state);
  const sent = state.post.mock.calls.find(([path]) => path === salePath)?.[1];
  expect(sent.body).toMatchObject({
    expected_type_revision: 3,
    expected_service_revisions: [{ service_id: component.service_id, revision: 5 }],
    price_paid: '22.500',
  });
});

it('clears an invalidated seller after a fresh context anchor and shows reconfirmation', async () => {
  const view = renderForm();
  await chooseTypeAndSeller(state);
  state.contextAnchor = '2026-10-02T08:00:00.000Z';
  state.sellerIds = [];
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['package-sale-context'] });
  });
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    t('en', 'packageSale.reconfirmSeller'),
  );
  await waitFor(() =>
    expect((screen.getByLabelText(t('en', 'packageSale.seller')) as HTMLSelectElement).value).toBe(
      '',
    ),
  );
  const sellerReads = state.get.mock.calls.filter(([path]) =>
    String(path).endsWith('/seller-options'),
  );
  expect(sellerReads.at(-1)?.[1].params.query.occurred_at).toBe(state.contextAnchor);
});

it('keeps an eligible page-two seller identifiable and blocks only until refresh verification finishes', async () => {
  state.sellerPages = { first: [], 'page-2': [packageSaleSeller.id] };
  const view = renderForm();
  await chooseCustomer(state);
  await choosePageTwoTypeAndSeller(state);
  state.contextAnchor = '2026-10-02T08:00:00.000Z';
  const finishSecondPage = holdRefreshedSecondPage(state);
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['package-sale-context'] });
  });
  await waitFor(() => {
    expect(
      state.get.mock.calls.some(
        ([path, init]) =>
          String(path).endsWith('/seller-options') &&
          init.params.query.occurred_at === state.contextAnchor &&
          init.params.query.cursor === 'page-2',
      ),
    ).toBe(true);
  });
  expect((screen.getByLabelText(t('en', 'packageSale.seller')) as HTMLSelectElement).value).toBe(
    packageSaleSeller.id,
  );
  expect(screen.getByRole('option', { name: packageSaleSeller.name_en })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageSale.submit') }));
  expect(await screen.findByText(t('en', 'packageSale.reconfirmSeller'))).toBeTruthy();
  expect(state.post.mock.calls.some(([path]) => path === salePath)).toBe(false);
  await act(async () => {
    finishSecondPage();
  });
  await waitFor(() =>
    expect(screen.queryByText(t('en', 'packageSale.reconfirmSeller'))).toBeNull(),
  );
  expect((screen.getByLabelText(t('en', 'packageSale.seller')) as HTMLSelectElement).value).toBe(
    packageSaleSeller.id,
  );
  await submitSale(state);
  const sent = state.post.mock.calls.find(([path]) => path === salePath)?.[1];
  expect(sent.body.seller_employee_id).toBe(packageSaleSeller.id);
});

it('clears an ineligible page-two seller after a nonterminal refreshed first page', async () => {
  state.sellerPages = { first: [], 'page-2': [packageSaleSeller.id] };
  const view = renderForm();
  await chooseCustomer(state);
  await choosePageTwoTypeAndSeller(state);
  state.contextAnchor = '2026-10-02T08:00:00.000Z';
  state.sellerPages = { first: [], 'page-2': [] };
  const finishSecondPage = holdRefreshedSecondPage(state);
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['package-sale-context'] });
  });
  await waitFor(() => {
    expect(
      state.get.mock.calls.some(
        ([path, init]) =>
          String(path).endsWith('/seller-options') &&
          init.params.query.occurred_at === state.contextAnchor &&
          init.params.query.cursor === 'page-2',
      ),
    ).toBe(true);
  });
  expect((screen.getByLabelText(t('en', 'packageSale.seller')) as HTMLSelectElement).value).toBe(
    packageSaleSeller.id,
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageSale.submit') }));
  expect(state.post.mock.calls.some(([path]) => path === salePath)).toBe(false);
  await act(async () => {
    finishSecondPage();
  });
  await waitFor(() =>
    expect((screen.getByLabelText(t('en', 'packageSale.seller')) as HTMLSelectElement).value).toBe(
      '',
    ),
  );
  expect(await screen.findByText(t('en', 'packageSale.reconfirmSeller'))).toBeTruthy();
  expect(state.post.mock.calls.some(([path]) => path === salePath)).toBe(false);
  const refreshedReads = state.get.mock.calls.filter(
    ([path, init]) =>
      String(path).endsWith('/seller-options') &&
      init.params.query.occurred_at === state.contextAnchor,
  );
  expect(refreshedReads.at(-2)?.[1].params.query.cursor).toBeUndefined();
  expect(refreshedReads.at(-1)?.[1].params.query.cursor).toBe('page-2');
});

it('retries a failed seller lookup and renders localized stale-quote details after submission', async () => {
  state.locale = 'ar';
  state.outcome = 'failed';
  state.sellerFailures = 1;
  renderForm();
  expect((await screen.findByRole('alert')).textContent).toContain('Synthetic seller failure AR');
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'packageSale.retrySellers') }));
  await screen.findByRole('option', { name: packageSaleSeller.name_ar });
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  await submitSale(state);
  const failure = await screen.findByRole('alert');
  expect(failure.textContent).toContain('Synthetic quote changed AR');
  expect(failure.textContent).toContain(JSON.stringify(failedSale.error.details));
  expect(state.post.mock.calls.filter(([path]) => path === salePath)).toHaveLength(1);
});

it.each(['ar', 'en'] as const)(
  'shows each component list price before confirming in %s',
  async (locale) => {
    state.locale = locale;
    const first = packageSaleType.components[0];
    if (!first) throw new Error('Missing component fixture');
    const components = [
      {
        ...first,
        name_en: 'Component Alpha',
        name_ar: 'Component Alpha AR',
        list_price: '2.500',
      },
      {
        ...first,
        service_id: '01920000-0000-7000-8000-00000000004a',
        name_en: 'Component Beta',
        name_ar: 'Component Beta AR',
        list_price: '7.750',
      },
    ];
    state.get.mockImplementation((path) =>
      Promise.resolve(
        String(path).includes('/sellable-package-types')
          ? {
              data: {
                items: [{ ...packageSaleType, components }],
                next_cursor: null,
              },
              response: { status: 200 },
            }
          : answerRead(String(path)),
      ),
    );
    renderForm();
    for (const component of components) {
      const label = locale === 'ar' ? component.name_ar : component.name_en;
      const item = (await screen.findByText(label, { exact: false })).closest('li');
      expect(item).not.toBeNull();
      if (!item) throw new Error('Missing visible component item');
      expect(within(item).getByText(formatKwd(parseMoney(component.list_price)))).toBeTruthy();
      expect(item.textContent).toContain(t(locale, 'packageSale.price'));
    }
    expect(state.post).not.toHaveBeenCalled();
  },
);

it('submits a verified first-page seller without fetching the remaining pages', async () => {
  state.sellerPages = { first: [packageSaleSeller.id], 'page-2': [] };
  renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  await submitSale(state);
  expect(
    state.get.mock.calls.filter(([path]) => String(path).endsWith('/seller-options')),
  ).toHaveLength(1);
  expect(state.post.mock.calls.some(([path]) => path === salePath)).toBe(true);
});

it('fails closed on actual submission when the selected seller refresh fails', async () => {
  const view = renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  state.sellerFailures = 1;
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['package-sale-sellers'] });
  });
  expect(await screen.findByText('Seller lookup failed')).toBeTruthy();
  expect(await screen.findByText(t('en', 'packageSale.reconfirmSeller'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageSale.submit') }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(state.post.mock.calls.some(([path]) => path === salePath)).toBe(false);
});

it('clears the selected seller and stale option when the seller scope changes', async () => {
  const view = renderForm();
  await chooseTypeAndSeller(state);
  state.sellerIds = [];
  view.rerender(
    <PackageSaleForm scope={{ ...packageSaleScope, branchId: 'replacement-branch' }} />,
  );
  await waitFor(() =>
    expect((screen.getByLabelText(t('en', 'packageSale.seller')) as HTMLSelectElement).value).toBe(
      '',
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole('option', { name: packageSaleSeller.name_en })).toBeNull(),
  );
  const sellerRead = state.get.mock.calls
    .filter(([path]) => String(path).endsWith('/seller-options'))
    .at(-1);
  expect(sellerRead?.[1].params.path.branchId).toBe('replacement-branch');
  expect(state.post.mock.calls.some(([path]) => path === salePath)).toBe(false);
});

it('submits a fresh selected seller without waiting for an in-flight later page', async () => {
  state.sellerPages = { first: [packageSaleSeller.id], 'page-2': [] };
  const finishSecondPage = holdRefreshedSecondPage(state);
  renderForm();
  await chooseCustomer(state);
  fireEvent.click(await screen.findByRole('radio', { name: /Synthetic package|باقة اختبار/ }));
  await screen.findByRole('option', { name: packageSaleSeller.name_en });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageSale.moreSellers') }));
  await waitFor(() =>
    expect(
      state.get.mock.calls.some(
        ([path, init]) =>
          String(path).endsWith('/seller-options') && init.params.query.cursor === 'page-2',
      ),
    ).toBe(true),
  );
  fireEvent.change(screen.getByLabelText(t('en', 'packageSale.seller')), {
    target: { value: packageSaleSeller.id },
  });
  await submitSale(state);
  expect(state.post.mock.calls.some(([path]) => path === salePath)).toBe(true);
  await act(async () => {
    finishSecondPage();
  });
});

it('blocks submission when customer selection is unavailable', async () => {
  state.entryScope = null;
  renderForm();
  await expectCustomerSelectionUnavailable();
});
