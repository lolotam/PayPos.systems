import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  choosePackageSaleCustomer as chooseCustomer,
  choosePackageSaleTypeAndSeller as chooseTypeAndSeller,
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

beforeEach(() => {
  sessionStorage.clear();
  resetPackageSaleFormTest(state);
});

afterEach(() => vi.restoreAllMocks());
const storageKey = `pospay:package-sale:${JSON.stringify(Object.values(packageSaleScope))}`;
const saleCalls = () => state.post.mock.calls.filter(([path]) => path === salePath);

async function uncertainSale() {
  const view = renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  state.post.mockRejectedValueOnce(new Error('Response lost'));
  await submitSale(state);
  await screen.findByText(t('en', 'packageSale.recoverOriginal'));
  return view;
}

it('restores the original body and key after reload and locks a second sale', async () => {
  const first = await uncertainSale();
  const original = saleCalls()[0]?.[1];
  expect(JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')).toMatchObject({
    key: original.params.header['Idempotency-Key'],
    body: original.body,
  });
  first.unmount();
  first.client.clear();
  renderForm();
  expect(await screen.findByText(t('en', 'packageSale.recoverOriginal'))).toBeTruthy();
  expect(
    screen.getByLabelText(t('en', 'packageSale.pricePaid')).closest('fieldset'),
  ).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageSale.retryOriginal') }));
  await waitFor(() => expect(saleCalls()).toHaveLength(2));
  expect(saleCalls()[1]?.[1].params.header['Idempotency-Key']).toBe(
    original.params.header['Idempotency-Key'],
  );
  expect(saleCalls()[1]?.[1].body).toEqual(original.body);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: t('en', 'packageSale.submitting') })).toHaveProperty(
      'disabled',
      true,
    ),
  );
  expect(sessionStorage.getItem(storageKey)).not.toBeNull();
});

it('releases recovery after the bounded request aborts', async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  state.post.mockImplementationOnce(
    (_path, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('timeout')));
      }),
  );
  await submitSale(state);
  expect(screen.getByRole('button', { name: t('en', 'packageSale.submitting') })).toHaveProperty(
    'disabled',
    true,
  );
  await act(async () => controller.abort());
  expect(
    await screen.findByRole('button', { name: t('en', 'packageSale.retryOriginal') }),
  ).toHaveProperty('disabled', false);
  expect(timeout).toHaveBeenCalledWith(15_000);
});

it('keeps recovery working in memory when storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('private');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('full');
  });
  await uncertainSale();
  const key = saleCalls()[0]?.[1].params.header['Idempotency-Key'];
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageSale.retryOriginal') }));
  await waitFor(() => expect(saleCalls()).toHaveLength(2));
  expect(saleCalls()[1]?.[1].params.header['Idempotency-Key']).toBe(key);
  expect(
    await screen.findByRole('button', { name: t('en', 'packageSale.submitting') }),
  ).toHaveProperty('disabled', true);
});

it.each(['ar', 'en'] as const)(
  'blocks expired replay with a visible %s explanation',
  async (locale) => {
    const first = await uncertainSale();
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ ...saved, createdAt: Date.now() - 24 * 60 * 60 * 1000 }),
    );
    first.unmount();
    first.client.clear();
    state.locale = locale;
    renderForm();
    expect(await screen.findByText(t(locale, 'packageSale.verificationRequired'))).toBeTruthy();
    const retry = screen.getByRole('button', { name: t(locale, 'packageSale.retryOriginal') });
    expect(retry).toHaveProperty('disabled', true);
    fireEvent.click(retry);
    expect(saleCalls()).toHaveLength(1);
  },
);

it('restores a known sale with status reads only and clears its confirmed outcome', async () => {
  const first = await uncertainSale();
  const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
  sessionStorage.setItem(
    storageKey,
    JSON.stringify({ ...saved, saleId: '01920000-0000-7000-8000-000000000034' }),
  );
  first.unmount();
  first.client.clear();
  state.outcome = 'completed';
  renderForm();
  expect(await screen.findByText(t('en', 'packageSale.completed'))).toBeTruthy();
  await waitFor(() => expect(sessionStorage.getItem(storageKey)).toBeNull());
  expect(saleCalls()).toHaveLength(1);
  expect(screen.getByRole('button', { name: t('en', 'packageSale.submit') })).toHaveProperty(
    'disabled',
    true,
  );
});
