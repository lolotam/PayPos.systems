import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  choosePackageSaleCustomer as chooseCustomer,
  choosePackageSaleTypeAndSeller as chooseTypeAndSeller,
  failedPackageSale,
  packageSalePath as salePath,
  packageSaleScope,
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

function saleCalls() {
  return state.post.mock.calls.filter(([path]) => path === salePath);
}

function keyOf(index: number) {
  return saleCalls()[index]?.[1].params.header['Idempotency-Key'] as string;
}

beforeEach(() => {
  resetPackageSaleFormTest(state);
});

it('releases the failed attempt so a corrected sale sends a new key and completes', async () => {
  renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  state.outcome = 'failed';
  await submitSale(state);
  expect(await screen.findByText(failedPackageSale.error.message_en)).toBeTruthy();
  expect(saleCalls()).toHaveLength(1);
  const firstKey = keyOf(0);

  // الموظفة تصحّح السعر وتبعت تاني؛ المفتاح لازم يكون جديد لأن المحاولة الأولى فشلت.
  state.outcome = 'completed';
  fireEvent.change(screen.getByLabelText(t('en', 'packageSale.pricePaid')), {
    target: { value: '1200.000' },
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await submitSale(state);
  await waitFor(() => expect(saleCalls()).toHaveLength(2));
  expect(keyOf(1)).not.toBe(firstKey);
  expect(await screen.findByText(t('en', 'packageSale.completed'))).toBeTruthy();
});

it('keeps the failure visible until the corrected attempt is accepted', async () => {
  renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  state.outcome = 'failed';
  await submitSale(state);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText(failedPackageSale.error.message_en)).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'packageSale.submit') })).toHaveProperty(
    'disabled',
    false,
  );
  expect(packageSaleScope.branchId).toBeTruthy();
});
