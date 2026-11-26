import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { SellablePackageType } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  choosePackageSaleCustomer as chooseCustomer,
  choosePackageSaleTypeAndSeller as chooseTypeAndSeller,
  packageSaleAnswerRead,
  packageSaleCustomer,
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

const refreshedType: SellablePackageType = {
  ...packageSaleType,
  revision: 3,
  price: '30.000',
  components: packageSaleType.components.map((component) => ({
    ...component,
    service_revision: 5,
    list_price: '3.500',
  })),
};

function answerRead(path: string) {
  return packageSaleAnswerRead(state, path);
}

// الباقات هي اللي بتتغيّر؛ باقي القراءات لازم تفضل شغالة عشان الفورم يعرض
function mockTypes(items: SellablePackageType[]) {
  state.get.mockImplementation((path) =>
    Promise.resolve(
      String(path).includes('/sellable-package-types')
        ? { data: { items, next_cursor: null }, response: { status: 200 } }
        : answerRead(String(path)),
    ),
  );
}

function saleCalls() {
  return state.post.mock.calls.filter(([path]) => path === salePath);
}

async function reloadTypes(view: { client: QueryClient }) {
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['sellable-package-types'] });
  });
}

async function renderWithReloadedTypes(items: SellablePackageType[]) {
  const view = renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  mockTypes(items);
  await reloadTypes(view);
}

async function blocksNewSaleUntilConfirmed(locale: 'ar' | 'en') {
  await renderWithReloadedTypes([refreshedType]);
  expect(
    await screen.findByRole('button', { name: t(locale, 'packageSale.confirmRefreshedQuote') }),
  ).toBeTruthy();
  const submit = screen.getByRole('button', { name: t(locale, 'packageSale.submit') });
  expect(submit).toHaveProperty('disabled', true);
  fireEvent.click(submit);
  fireEvent.submit(submit.closest('form') as HTMLFormElement);
  // الإرسال بيعدّي على فحص الفورم والقفل قبل الطلب، فلازم ننتظر قبل ما نتأكد إنه ما اتبعتش
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(saleCalls()).toHaveLength(0);
  expect(submit).toHaveProperty('disabled', true);
}

async function sellsOnTheRefreshedQuote(locale: 'ar' | 'en') {
  await renderWithReloadedTypes([refreshedType]);
  fireEvent.click(
    await screen.findByRole('button', { name: t(locale, 'packageSale.confirmRefreshedQuote') }),
  );
  expect(
    screen.queryByRole('button', { name: t(locale, 'packageSale.confirmRefreshedQuote') }),
  ).toBeNull();
  expect(screen.getByRole('button', { name: t(locale, 'packageSale.submit') })).toHaveProperty(
    'disabled',
    false,
  );
  await submitSale(state);
  const sent = saleCalls()[0]?.[1];
  expect(sent.body).toMatchObject({
    expected_type_revision: refreshedType.revision,
    expected_service_revisions: refreshedType.components.map((component) => ({
      service_id: component.service_id,
      revision: component.service_revision,
    })),
  });
}

async function keepsTheSaleSubmittableOnTheSameQuote(locale: 'ar' | 'en') {
  await renderWithReloadedTypes([packageSaleType]);
  expect(
    screen.queryByRole('button', { name: t(locale, 'packageSale.confirmRefreshedQuote') }),
  ).toBeNull();
  expect(screen.getByRole('button', { name: t(locale, 'packageSale.submit') })).toHaveProperty(
    'disabled',
    false,
  );
}

const storageKey = `pospay:package-sale:${JSON.stringify(Object.values(packageSaleScope))}`;

/** حقل السعر المعروض؛ بيتعبّى مرة واحدة قبل كل اختبار. */
function priceInput(locale: 'ar' | 'en'): HTMLInputElement {
  return screen.getByLabelText(t(locale, 'packageSale.pricePaid')) as HTMLInputElement;
}

/** السعر اللي لسه تلقائي بيتحدّث مع العرض الجديد؛ سعر كتبته الموظفة بيفضل زي ما هو. */
async function movesTheAutoFilledPriceToTheRefreshedQuote(locale: 'ar' | 'en') {
  await renderWithReloadedTypes([refreshedType]);
  await waitFor(() => expect(priceInput(locale).value).toBe(packageSaleType.price));
  fireEvent.click(
    await screen.findByRole('button', { name: t(locale, 'packageSale.confirmRefreshedQuote') }),
  );
  await waitFor(() => expect(priceInput(locale).value).toBe(refreshedType.price));
}

/** سعر عدّته الموظفة ما بيتلمسش بتأكيد العرض الجديد. */
async function keepsTheTypedPriceOnTheRefreshedQuote(locale: 'ar' | 'en') {
  await renderWithReloadedTypes([refreshedType]);
  await waitFor(() => expect(priceInput(locale).value).toBe(packageSaleType.price));
  fireEvent.change(priceInput(locale), { target: { value: '27.500' } });
  fireEvent.click(
    await screen.findByRole('button', { name: t(locale, 'packageSale.confirmRefreshedQuote') }),
  );
  await waitFor(() => expect(priceInput(locale).value).toBe('27.500'));
}

// محاولة أصلية سجّلها تبويب تاني بالعرض القديم، والفورم ده شايف العرض اتغيّر
function unresolvedAttemptFromAnotherTab() {
  return {
    key: '01920000-0000-7000-8000-0000000000b2',
    scope: JSON.stringify(Object.values(packageSaleScope)),
    createdAt: Date.now(),
    body: {
      customer_id: packageSaleCustomer.id,
      package_type_id: packageSaleType.id,
      expected_type_revision: packageSaleType.revision,
      expected_service_revisions: packageSaleType.components.map((component) => ({
        service_id: component.service_id,
        revision: component.service_revision,
      })),
      price_paid: packageSaleType.price,
      paid_method: 'CASH',
      seller_employee_id: packageSaleSeller.id,
      recorder_membership_id: packageSaleRecorderId,
    },
  };
}

async function keepsTheOriginalRetryAvailable(locale: 'ar' | 'en') {
  await renderWithReloadedTypes([refreshedType]);
  expect(
    await screen.findByRole('button', { name: t(locale, 'packageSale.confirmRefreshedQuote') }),
  ).toBeTruthy();
  const attempt = unresolvedAttemptFromAnotherTab();
  await act(async () => {
    localStorage.setItem(storageKey, JSON.stringify(attempt));
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
  });
  expect(await screen.findByText(t(locale, 'packageSale.recoverOriginal'))).toBeTruthy();
  const retry = screen.getByRole('button', { name: t(locale, 'packageSale.retryOriginal') });
  expect(retry).toHaveProperty('disabled', false);
  fireEvent.click(retry);
  await waitFor(() => expect(saleCalls()).toHaveLength(1));
  expect(saleCalls()[0]?.[1].params.header['Idempotency-Key']).toBe(attempt.key);
  expect(saleCalls()[0]?.[1].body.expected_type_revision).toBe(packageSaleType.revision);
}

beforeEach(() => {
  localStorage.clear();
  resetPackageSaleFormTest(state);
});

describe.each(['ar', 'en'] as const)('package sale stale quote (%s)', (locale) => {
  beforeEach(() => {
    state.locale = locale;
  });
  it('blocks a new sale until the refreshed package quote is confirmed', () =>
    blocksNewSaleUntilConfirmed(locale));
  it('sells on the refreshed quote once the operator confirms it', () =>
    sellsOnTheRefreshedQuote(locale));
  it('keeps the sale submittable when the reloaded quote is the confirmed one', () =>
    keepsTheSaleSubmittableOnTheSameQuote(locale));
  it('keeps the original sale retry available while that sale is unresolved', () =>
    keepsTheOriginalRetryAvailable(locale));
  it('moves the auto-filled price to the refreshed quote', () =>
    movesTheAutoFilledPriceToTheRefreshedQuote(locale));
  it('keeps a price the operator typed when the quote is refreshed', () =>
    keepsTheTypedPriceOnTheRefreshedQuote(locale));
});
