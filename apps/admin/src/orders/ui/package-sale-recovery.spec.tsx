import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  localStorage.clear();
  resetPackageSaleFormTest(state);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'locks');
  vi.restoreAllMocks();
});
const storageKey = `pospay:package-sale:${JSON.stringify(Object.values(packageSaleScope))}`;
const saleCalls = () => state.post.mock.calls.filter(([path]) => path === salePath);
const quoteChanged = (locale: 'ar' | 'en') =>
  new RegExp(failedPackageSale.error[`message_${locale}`]);

async function uncertainSale(locale: 'ar' | 'en') {
  const view = renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  state.post.mockRejectedValueOnce(new Error('Response lost'));
  await submitSale(state);
  await screen.findByText(t(locale, 'packageSale.recoverOriginal'));
  return view;
}

async function restoresBodyAndKeyAfterReload(locale: 'ar' | 'en') {
  const first = await uncertainSale(locale);
  const original = saleCalls()[0]?.[1];
  expect(JSON.parse(localStorage.getItem(storageKey) ?? 'null')).toMatchObject({
    key: original.params.header['Idempotency-Key'],
    body: original.body,
  });
  first.unmount();
  first.client.clear();
  renderForm();
  expect(await screen.findByText(t(locale, 'packageSale.recoverOriginal'))).toBeTruthy();
  expect(
    screen.getByLabelText(t(locale, 'packageSale.pricePaid')).closest('fieldset'),
  ).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'packageSale.retryOriginal') }));
  await waitFor(() => expect(saleCalls()).toHaveLength(2));
  expect(saleCalls()[1]?.[1].params.header['Idempotency-Key']).toBe(
    original.params.header['Idempotency-Key'],
  );
  expect(saleCalls()[1]?.[1].body).toEqual(original.body);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: t(locale, 'packageSale.submitting') }),
    ).toHaveProperty('disabled', true),
  );
  expect(localStorage.getItem(storageKey)).not.toBeNull();
}

async function releasesRecoveryAfterAbort(locale: 'ar' | 'en') {
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
  expect(screen.getByRole('button', { name: t(locale, 'packageSale.submitting') })).toHaveProperty(
    'disabled',
    true,
  );
  await act(async () => controller.abort());
  expect(
    await screen.findByRole('button', { name: t(locale, 'packageSale.retryOriginal') }),
  ).toHaveProperty('disabled', false);
  expect(timeout).toHaveBeenCalledWith(15_000);
}

async function keepsRecoveryInMemoryWithoutStorage(locale: 'ar' | 'en') {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('private');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('full');
  });
  await uncertainSale(locale);
  const key = saleCalls()[0]?.[1].params.header['Idempotency-Key'];
  expect(await screen.findByText(t(locale, 'packageSale.journalUnsaved'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'packageSale.retryOriginal') }));
  await waitFor(() => expect(saleCalls()).toHaveLength(2));
  expect(saleCalls()[1]?.[1].params.header['Idempotency-Key']).toBe(key);
  expect(
    await screen.findByRole('button', { name: t(locale, 'packageSale.submitting') }),
  ).toHaveProperty('disabled', true);
}

async function blocksExpiredReplay(locale: 'ar' | 'en') {
  const first = await uncertainSale(locale);
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
  localStorage.setItem(
    storageKey,
    JSON.stringify({ ...saved, createdAt: Date.now() - 24 * 60 * 60 * 1000 }),
  );
  first.unmount();
  first.client.clear();
  renderForm();
  expect(await screen.findByText(t(locale, 'packageSale.verificationRequired'))).toBeTruthy();
  const retry = screen.getByRole('button', { name: t(locale, 'packageSale.retryOriginal') });
  expect(retry).toHaveProperty('disabled', true);
  fireEvent.click(retry);
  expect(saleCalls()).toHaveLength(1);
}

async function restoresKnownSaleWithStatusReads(locale: 'ar' | 'en') {
  const first = await uncertainSale(locale);
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
  localStorage.setItem(
    storageKey,
    JSON.stringify({ ...saved, saleId: '01920000-0000-7000-8000-000000000034' }),
  );
  first.unmount();
  first.client.clear();
  state.outcome = 'completed';
  renderForm();
  expect(await screen.findByText(t(locale, 'packageSale.completed'))).toBeTruthy();
  await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
  expect(saleCalls()).toHaveLength(1);
  expect(screen.getByRole('button', { name: t(locale, 'packageSale.submit') })).toHaveProperty(
    'disabled',
    true,
  );
}

async function rereadsAnotherTabJournal(locale: 'ar' | 'en') {
  const first = await uncertainSale(locale);
  const saved = localStorage.getItem(storageKey) ?? '';
  const original = saleCalls()[0]?.[1];
  first.unmount();
  first.client.clear();
  localStorage.clear();
  renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  localStorage.setItem(storageKey, saved);
  state.post.mockRejectedValueOnce(new Error('Response lost again'));
  await submitSale(state);
  expect(await screen.findByText(t(locale, 'packageSale.recoverOriginal'))).toBeTruthy();
  expect(
    screen.getByLabelText(t(locale, 'packageSale.pricePaid')).closest('fieldset'),
  ).toHaveProperty('disabled', true);
  expect(saleCalls()[1]?.[1].params.header['Idempotency-Key']).toBe(
    original.params.header['Idempotency-Key'],
  );
  expect(saleCalls()[1]?.[1].body).toEqual(original.body);
}

async function updatesFormOnOtherTabWrite(locale: 'ar' | 'en') {
  const first = await uncertainSale(locale);
  const saved = localStorage.getItem(storageKey) ?? '';
  first.unmount();
  first.client.clear();
  localStorage.clear();
  renderForm();
  await chooseCustomer(state);
  await act(async () => {
    localStorage.setItem(storageKey, saved);
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
  });
  expect(await screen.findByText(t(locale, 'packageSale.recoverOriginal'))).toBeTruthy();
  expect(
    screen.getByLabelText(t(locale, 'packageSale.pricePaid')).closest('fieldset'),
  ).toHaveProperty('disabled', true);
  await act(async () => {
    localStorage.removeItem(storageKey);
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
  });
  await waitFor(() =>
    expect(screen.queryByText(t(locale, 'packageSale.recoverOriginal'))).toBeNull(),
  );
  expect(
    screen.getByLabelText(t(locale, 'packageSale.pricePaid')).closest('fieldset'),
  ).toHaveProperty('disabled', false);
}

async function allowsCorrectedSaleAfterFailure(locale: 'ar' | 'en') {
  state.outcome = 'failed';
  renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  await submitSale(state);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: t(locale, 'packageSale.submit') })).toHaveProperty(
      'disabled',
      false,
    ),
  );
  expect(localStorage.getItem(storageKey)).toBeNull();
  fireEvent.change(screen.getByLabelText(t(locale, 'packageSale.pricePaid')), {
    target: { value: '25.000' },
  });
  expect(screen.getByText(quoteChanged(locale))).toBeTruthy();
  state.outcome = 'pending';
  let accept!: () => void;
  state.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        accept = () =>
          resolve({
            data: { sale_request_id: '01920000-0000-7000-8000-000000000099' },
            response: { status: 202 },
          });
      }),
  );
  await submitSale(state);
  await waitFor(() => expect(screen.queryByText(quoteChanged(locale))).toBeNull());
  await act(async () => accept());
  await waitFor(() => expect(saleCalls()).toHaveLength(2));
  expect(saleCalls()[1]?.[1].params.header['Idempotency-Key']).not.toBe(
    saleCalls()[0]?.[1].params.header['Idempotency-Key'],
  );
  expect(
    await screen.findByRole('button', { name: t(locale, 'packageSale.submitting') }),
  ).toHaveProperty('disabled', true);
}

async function reservesOneKeyForRacingTabs(locale: 'ar' | 'en') {
  let queue = Promise.resolve();
  const request = vi.fn((_name: string, callback: () => unknown) => {
    const next = queue.then(callback);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  const first = renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  // Temporarily detach the first form so the shared fixture can prepare the second tab.
  first.container.remove();
  const second = renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  document.body.append(first.container);
  state.post.mockImplementationOnce(() => new Promise(() => {}));
  const firstForm = first.container.querySelector('form');
  const secondForm = second.container.querySelector('form');
  if (!firstForm || !secondForm) throw new Error('Missing sale forms');
  await act(async () => {
    fireEvent.submit(firstForm);
    fireEvent.submit(secondForm);
  });
  expect(
    await within(second.container).findByText(t(locale, 'packageSale.recoverOriginal')),
  ).toBeTruthy();
  expect(
    within(second.container).getByLabelText(t(locale, 'packageSale.pricePaid')).closest('fieldset'),
  ).toHaveProperty('disabled', true);
  expect(saleCalls()).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem(storageKey) ?? 'null').key).toBe(
    saleCalls()[0]?.[1].params.header['Idempotency-Key'],
  );
  expect(request.mock.calls[0]?.[0]).toBe(request.mock.calls[1]?.[0]);
}

async function keepsNewerReservationOnOlderFailure(locale: 'ar' | 'en') {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: vi.fn((_name, callback) => Promise.resolve().then(callback)) },
  });
  const seed = await uncertainSale(locale);
  const older = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
  seed.unmount();
  seed.client.clear();
  localStorage.setItem(storageKey, JSON.stringify({ ...older, saleId: 'older-sale' }));
  const read = state.get.getMockImplementation();
  let failOlder!: () => void;
  state.get.mockImplementation((path, init) => {
    if (String(path).endsWith('/{saleRequestId}')) {
      return new Promise((resolve) => {
        failOlder = () => resolve({ data: failedPackageSale, response: { status: 200 } });
      });
    }
    return read?.(path, init);
  });
  const tabB = renderForm();
  await waitFor(() => expect(failOlder).toBeTypeOf('function'));
  tabB.container.remove();
  // Another tab has already confirmed the older sale and released its journal.
  localStorage.removeItem(storageKey);
  const tabA = await uncertainSale(locale);
  const newer = localStorage.getItem(storageKey);
  expect(JSON.parse(newer ?? 'null').key).not.toBe(older.key);
  document.body.append(tabB.container);
  await act(async () => failOlder());
  expect(await within(tabB.container).findByText(quoteChanged(locale))).toBeTruthy();
  expect(localStorage.getItem(storageKey)).toBe(newer);
  expect(
    within(tabA.container).getByLabelText(t(locale, 'packageSale.pricePaid')).closest('fieldset'),
  ).toHaveProperty('disabled', true);
}

describe.each(['ar', 'en'] as const)('package sale recovery (%s)', (locale) => {
  beforeEach(() => {
    state.locale = locale;
  });
  it('restores the original body and key after reload and locks a second sale', () =>
    restoresBodyAndKeyAfterReload(locale));
  it('releases recovery after the bounded request aborts', () =>
    releasesRecoveryAfterAbort(locale));
  it('keeps recovery working in memory when storage is unavailable', () =>
    keepsRecoveryInMemoryWithoutStorage(locale));
  it('blocks expired replay with a visible explanation', () => blocksExpiredReplay(locale));
  it('restores a known sale with status reads only and clears its confirmed outcome', () =>
    restoresKnownSaleWithStatusReads(locale));
  it('re-reads another tab journal before submitting and reuses its key', () =>
    rereadsAnotherTabJournal(locale));
  it('updates an open form when another tab writes and clears recovery', () =>
    updatesFormOnOtherTabWrite(locale));
  it('allows a corrected new sale with a new key after confirmed failure', () =>
    allowsCorrectedSaleAfterFailure(locale));
  it('reserves one key for racing tabs and locks the second form into recovery', () =>
    reservesOneKeyForRacingTabs(locale));
  it('keeps a newer tab reservation when an older sale failure arrives', () =>
    keepsNewerReservationOnOlderFailure(locale));
});
