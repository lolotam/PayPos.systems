import type {
  PackageSaleContext,
  SoldPackageEntitlement,
  SellablePackageType,
} from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { expect, type Mock } from 'vitest';
import { t } from '@pospay/i18n';
import { PackageSaleForm } from './package-sale-form';

export const packageSaleScope = {
  companyId: '01920000-0000-7000-8000-000000000030',
  businessId: '01920000-0000-7000-8000-000000000031',
  branchId: '01920000-0000-7000-8000-000000000032',
  userId: '01920000-0000-7000-8000-000000000033',
};
export const packageSaleRequestId = '01920000-0000-7000-8000-000000000034';
export const packageSaleType: SellablePackageType = {
  id: '01920000-0000-7000-8000-000000000035',
  revision: 2,
  name_en: 'Synthetic package',
  name_ar: 'Synthetic package AR',
  price: '1234.500',
  validity_days: 90,
  components: [
    {
      service_id: '01920000-0000-7000-8000-000000000036',
      service_revision: 4,
      name_en: 'Synthetic service',
      name_ar: 'Synthetic service AR',
      sessions: 10,
      list_price: '2.500',
    },
  ],
};
export const packageSaleEntitlement: SoldPackageEntitlement = {
  id: '01920000-0000-7000-8000-000000000037',
  business_id: packageSaleScope.businessId,
  customer_id: '01920000-0000-7000-8000-000000000038',
  package_type_id: packageSaleType.id,
  sold_branch_id: packageSaleScope.branchId,
  name_en: packageSaleType.name_en,
  name_ar: packageSaleType.name_ar,
  validity_days: packageSaleType.validity_days,
  list_price: '1259.500',
  price_paid: '1234.500',
  discount: '25.000',
  discount_bps: 198,
  paid_method: 'CASH',
  seller_employee_id: '01920000-0000-7000-8000-000000000039',
  sold_at: '2026-10-01T08:00:00.000Z',
  sold_business_date: '2026-10-01',
  late: false,
  expires_on: '2026-12-30',
  refunded_amount: '0.000',
  revision: 1,
  components: [
    {
      id: '01920000-0000-7000-8000-00000000003a',
      service_id: packageSaleType.components[0]?.service_id ?? '',
      position: 1,
      name_en: 'Synthetic service',
      name_ar: 'Synthetic service AR',
      list_price_snapshot: '2.500',
      sessions_total: 10,
      component_value: '1234.500',
    },
  ],
};
export const completedPackageSale = {
  status: 'completed' as const,
  entitlement: packageSaleEntitlement,
};
export const packageSaleCustomer = {
  id: packageSaleEntitlement.customer_id,
  name: 'Synthetic customer',
  locale: 'ar' as const,
  opted_out: false,
  phone: '***001',
};
export const packageSaleSeller = {
  id: packageSaleEntitlement.seller_employee_id,
  name_ar: 'Synthetic seller AR',
  name_en: 'Synthetic seller',
  employee_number: 7,
};
export const packageSaleRecorderId = '01920000-0000-7000-8000-00000000003b';
export const packageSaleContext: PackageSaleContext = {
  generated_at: '2026-10-01T08:00:00.000Z',
  business_timezone: 'Asia/Kuwait',
  customer_entry_scope: 'branch',
  recorders: [
    {
      membership_id: packageSaleRecorderId,
      scope_type: 'BRANCH',
      scope_id: packageSaleScope.branchId,
    },
  ],
};

export type PackageSaleFormTestState = {
  get: Mock;
  post: Mock;
  locale: 'ar' | 'en';
  outcome: 'pending' | 'completed' | 'failed';
  sellerFailures: number;
  recorderIds: string[] | null;
  sellerIds: string[] | null;
  sellerPages: Record<string, string[]> | null;
  entryScope: 'COMPANY' | 'BUSINESS' | 'BRANCH' | null;
  contextAnchor: string;
};

export const packageSalePath = '/v1/businesses/{businessId}/branches/{branchId}/package-sales';
export const failedPackageSale = {
  status: 'failed' as const,
  error: {
    code: 'PACKAGE_SALE_QUOTE_STALE' as const,
    message_ar: 'Synthetic quote changed AR',
    message_en: 'The quote changed',
    details: {
      current_service_revisions: [
        { service_id: packageSaleType.components[0]?.service_id, revision: 5 },
      ],
    },
  },
};

function contextRead(state: PackageSaleFormTestState) {
  const template = packageSaleContext.recorders[0];
  if (!template) throw new Error('Missing recorder fixture');
  const ids = state.recorderIds ?? [packageSaleRecorderId];
  return {
    data: {
      ...packageSaleContext,
      generated_at: state.contextAnchor,
      customer_entry_scope: state.entryScope?.toLowerCase() ?? null,
      recorders: ids.map((membership_id) => ({
        ...template,
        membership_id,
        scope_type: 'COMPANY',
        scope_id: packageSaleScope.companyId,
      })),
    },
    response: { status: 200 },
  };
}

function sellerRead(state: PackageSaleFormTestState, query?: Record<string, unknown>) {
  if (state.sellerFailures > 0) {
    state.sellerFailures -= 1;
    return {
      error: {
        code: 'TEMPORARY',
        message_ar: 'Synthetic seller failure AR',
        message_en: 'Seller lookup failed',
      },
      response: { status: 500 },
    };
  }
  const page = typeof query?.cursor === 'string' ? query.cursor : 'first';
  const ids = state.sellerPages?.[page] ?? state.sellerIds ?? [packageSaleSeller.id];
  return {
    data: {
      sale_anchor: state.contextAnchor,
      items: ids.includes(packageSaleSeller.id) ? [packageSaleSeller] : [],
      next_cursor: state.sellerPages === null ? null : page === 'first' ? 'page-2' : null,
    },
    response: { status: 200 },
  };
}

export function packageSaleAnswerRead(
  state: PackageSaleFormTestState,
  path: string,
  query?: Record<string, unknown>,
) {
  if (path.includes('/sellable-package-types')) {
    return { data: { items: [packageSaleType], next_cursor: null }, response: { status: 200 } };
  }
  if (path.endsWith('/package-sales/context')) return contextRead(state);
  if (path.endsWith('/package-sales/seller-options')) return sellerRead(state, query);
  const data =
    state.outcome === 'completed'
      ? completedPackageSale
      : state.outcome === 'failed'
        ? failedPackageSale
        : { status: 'pending' };
  return { data, response: { status: 200 } };
}

export function installPackageSaleNetwork(state: PackageSaleFormTestState) {
  state.get.mockImplementation((path, init) =>
    Promise.resolve(packageSaleAnswerRead(state, String(path), init?.params?.query)),
  );
  state.post.mockImplementation((path) =>
    Promise.resolve(
      String(path) === packageSalePath
        ? { data: { sale_request_id: packageSaleRequestId }, response: { status: 202 } }
        : { data: packageSaleCustomer, response: { status: 200 } },
    ),
  );
}

export function holdPackageSaleSecondPage(state: PackageSaleFormTestState) {
  let finish!: () => void;
  state.get.mockImplementation((path, init) => {
    const query = init?.params?.query;
    if (String(path).endsWith('/seller-options') && query?.cursor === 'page-2') {
      return new Promise((resolve) => {
        finish = () => resolve(packageSaleAnswerRead(state, String(path), query));
      });
    }
    return Promise.resolve(packageSaleAnswerRead(state, String(path), query));
  });
  return () => finish();
}

export function renderPackageSaleForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return {
    client,
    ...render(createElement(PackageSaleForm, { scope: packageSaleScope }), { wrapper }),
  };
}

export async function choosePackageSaleCustomer(state: PackageSaleFormTestState) {
  const findOrCreate = screen.getByRole('button', {
    name: t(state.locale, 'serviceSessions.findOrCreate'),
  });
  await waitFor(() => expect(findOrCreate.closest('fieldset')).toHaveProperty('disabled', false));
  for (const [key, value] of [
    ['name', 'Entered customer'],
    ['callingCode', '999'],
    ['phone', '00000001'],
  ] as const) {
    fireEvent.change(screen.getByLabelText(t(state.locale, `serviceSessions.${key}`)), {
      target: { value },
    });
  }
  fireEvent.click(findOrCreate);
  await screen.findByText(packageSaleCustomer.name);
}

export async function choosePackageSaleTypeAndSeller(state: PackageSaleFormTestState) {
  fireEvent.click(await screen.findByRole('radio', { name: /Synthetic package|باقة اختبار/ }));
  await screen.findByRole('option', { name: /Synthetic seller|بائعة اختبار/ });
  fireEvent.change(screen.getByLabelText(t(state.locale, 'packageSale.seller')), {
    target: { value: packageSaleSeller.id },
  });
}

export async function choosePackageSalePageTwoSeller(state: PackageSaleFormTestState) {
  fireEvent.click(await screen.findByRole('radio', { name: /Synthetic package|باقة اختبار/ }));
  const optionName = /Synthetic seller|بائعة اختبار/;
  await waitFor(() => {
    if (screen.queryByRole('option', { name: optionName })) return;
    const more = screen.queryByRole('button', {
      name: t(state.locale, 'packageSale.moreSellers'),
    });
    expect(more).not.toBeNull();
    if (more && !(more as HTMLButtonElement).disabled) fireEvent.click(more);
  });
  await screen.findByRole('option', { name: optionName });
  fireEvent.change(screen.getByLabelText(t(state.locale, 'packageSale.seller')), {
    target: { value: packageSaleSeller.id },
  });
}

export async function submitPackageSale(state: PackageSaleFormTestState) {
  fireEvent.click(screen.getByRole('button', { name: t(state.locale, 'packageSale.submit') }));
  await waitFor(() =>
    expect(state.post.mock.calls.some(([path]) => path === packageSalePath)).toBe(true),
  );
}

export function resetPackageSaleFormTest(state: PackageSaleFormTestState) {
  sessionStorage.clear();
  state.get.mockReset();
  state.post.mockReset();
  state.locale = 'en';
  state.outcome = 'pending';
  state.sellerFailures = 0;
  state.recorderIds = null;
  state.sellerIds = null;
  state.sellerPages = null;
  state.entryScope = 'BRANCH';
  state.contextAnchor = packageSaleContext.generated_at;
  installPackageSaleNetwork(state);
}

export function packageSaleSellerCalls(get: Mock) {
  return get.mock.calls.filter(([path]) => String(path).endsWith('/seller-options'));
}

export function mockPackageSaleSellerPages(
  get: Mock,
  items: Array<typeof packageSaleSeller>,
  nextCursor: string | null,
) {
  get.mockImplementation((path, init) => {
    if (String(path).endsWith('/context')) {
      return Promise.resolve({ data: packageSaleContext, response: { status: 200 } });
    }
    const secondPage = init.params.query.cursor === 'page-2';
    return Promise.resolve({
      data: {
        sale_anchor: packageSaleContext.generated_at,
        items: secondPage ? items : [],
        next_cursor: secondPage ? nextCursor : 'page-2',
      },
      response: { status: 200 },
    });
  });
}

export function mockPackageSaleSellerRefresh(get: Mock, anchor: () => string) {
  get.mockImplementation((path, init) => {
    if (String(path).endsWith('/context')) {
      return Promise.resolve({
        data: { ...packageSaleContext, generated_at: anchor() },
        response: { status: 200 },
      });
    }
    if (init.params.query.cursor === 'next-page') return new Promise(() => {});
    return Promise.resolve({
      data: {
        sale_anchor: anchor(),
        items: [],
        next_cursor: anchor() === packageSaleContext.generated_at ? 'next-page' : null,
      },
      response: { status: 200 },
    });
  });
}

export async function expectCustomerSelectionUnavailable() {
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    t('en', 'packageSale.customerUnavailable'),
  );
  expect(screen.getByRole('button', { name: t('en', 'packageSale.submit') })).toHaveProperty(
    'disabled',
    true,
  );
}
