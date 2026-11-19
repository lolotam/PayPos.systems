import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  choosePackageSaleCustomer as chooseCustomer,
  choosePackageSaleTypeAndSeller as chooseTypeAndSeller,
  packageSalePath as salePath,
  packageSaleRequestId,
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
  vi.restoreAllMocks();
});
const storageKey = `pospay:package-sale:${JSON.stringify(Object.values(packageSaleScope))}`;
const saleCalls = () => state.post.mock.calls.filter(([path]) => path === salePath);

function mockUnavailableStorage() {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('private');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('full');
  });
}

async function uncertainSale(locale: 'ar' | 'en') {
  const view = renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  state.post.mockRejectedValueOnce(new Error('Response lost'));
  await submitSale(state);
  await screen.findByText(t(locale, 'packageSale.recoverOriginal'));
  return view;
}

async function seedJournal(locale: 'ar' | 'en', override: Record<string, unknown>) {
  const view = await uncertainSale(locale);
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Record<string, unknown>;
  localStorage.setItem(storageKey, JSON.stringify({ ...saved, ...override }));
  view.unmount();
  view.client.clear();
}

async function expiredReplayIsBlocked(locale: 'ar' | 'en') {
  renderForm();
  expect(await screen.findByText(t(locale, 'packageSale.verificationRequired'))).toBeTruthy();
  const retry = screen.getByRole('button', { name: t(locale, 'packageSale.retryOriginal') });
  expect(retry).toHaveProperty('disabled', true);
  fireEvent.click(retry);
  expect(saleCalls()).toHaveLength(1);
}

async function futureAttemptBlocksReplay(locale: 'ar' | 'en') {
  await seedJournal(locale, { createdAt: Date.now() + 2 * 60 * 60 * 1000 });
  await expiredReplayIsBlocked(locale);
}

async function seenAtHighWaterBlocksReplay(locale: 'ar' | 'en') {
  await seedJournal(locale, {
    createdAt: Date.now() - 60 * 60 * 1000,
    seenAt: Date.now() + 22 * 60 * 60 * 1000,
  });
  await expiredReplayIsBlocked(locale);
}

async function focusRefreshesExpiry(locale: 'ar' | 'en') {
  await seedJournal(locale, { createdAt: Date.now() - (23 * 60 * 60 * 1000 - 60_000) });
  renderForm();
  expect(await screen.findByText(t(locale, 'packageSale.recoverOriginal'))).toBeTruthy();
  const retry = screen.getByRole('button', { name: t(locale, 'packageSale.retryOriginal') });
  expect(retry).toHaveProperty('disabled', false);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 60_000);
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(await screen.findByText(t(locale, 'packageSale.verificationRequired'))).toBeTruthy();
  expect(
    screen.getByRole('button', { name: t(locale, 'packageSale.retryOriginal') }),
  ).toHaveProperty('disabled', true);
  expect(saleCalls()).toHaveLength(1);
}

async function discardAcknowledgedExpiredAttempt(locale: 'ar' | 'en') {
  await seedJournal(locale, { createdAt: Date.now() - 24 * 60 * 60 * 1000 });
  renderForm();
  expect(await screen.findByText(t(locale, 'packageSale.verificationRequired'))).toBeTruthy();
  const discard = screen.getByRole('button', { name: t(locale, 'packageSale.discardExpired') });
  expect(discard).toHaveProperty('disabled', true);
  fireEvent.click(
    screen.getByRole('checkbox', { name: t(locale, 'packageSale.verifiedWithManager') }),
  );
  expect(discard).toHaveProperty('disabled', false);
  fireEvent.click(discard);
  await waitFor(() =>
    expect(screen.queryByText(t(locale, 'packageSale.verificationRequired'))).toBeNull(),
  );
  expect(localStorage.getItem(storageKey)).toBeNull();
  expect(
    screen.getByLabelText(t(locale, 'packageSale.pricePaid')).closest('fieldset'),
  ).toHaveProperty('disabled', false);
  expect(screen.getByRole('button', { name: t(locale, 'packageSale.submit') })).toBeTruthy();
  expect(saleCalls()).toHaveLength(1);
}

async function acknowledgementBindsToItsAttempt(locale: 'ar' | 'en') {
  await seedJournal(locale, { createdAt: Date.now() - 24 * 60 * 60 * 1000 });
  renderForm();
  expect(await screen.findByText(t(locale, 'packageSale.verificationRequired'))).toBeTruthy();
  const checkbox = screen.getByRole('checkbox', {
    name: t(locale, 'packageSale.verifiedWithManager'),
  });
  fireEvent.click(checkbox);
  expect(
    screen.getByRole('button', { name: t(locale, 'packageSale.discardExpired') }),
  ).toHaveProperty('disabled', false);
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Record<string, unknown>;
  localStorage.setItem(storageKey, JSON.stringify({ ...saved, key: 'replaced-attempt-key' }));
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
  });
  expect(
    screen.getByRole('checkbox', { name: t(locale, 'packageSale.verifiedWithManager') }),
  ).toHaveProperty('checked', false);
  expect(
    screen.getByRole('button', { name: t(locale, 'packageSale.discardExpired') }),
  ).toHaveProperty('disabled', true);
}

async function acceptedSaleStoresStatusOnlyRecord(locale: 'ar' | 'en') {
  const view = renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  await submitSale(state);
  await waitFor(() => expect(localStorage.getItem(storageKey)).not.toBeNull());
  const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Record<string, unknown>;
  expect(Object.keys(stored).sort()).toEqual(['createdAt', 'key', 'saleId', 'scope']);
  expect(stored.saleId).toBe(packageSaleRequestId);
  view.unmount();
  view.client.clear();
  renderForm();
  expect(await screen.findByText(t(locale, 'packageSale.pending'))).toBeTruthy();
  expect(state.get.mock.calls.some(([path]) => String(path).endsWith('/{saleRequestId}'))).toBe(
    true,
  );
  expect(saleCalls()).toHaveLength(1);
}

async function hidesUnsavedWarningAfterCompletion(locale: 'ar' | 'en') {
  mockUnavailableStorage();
  state.outcome = 'completed';
  renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  await submitSale(state);
  await screen.findByText(t(locale, 'packageSale.completed'));
  expect(screen.queryByText(t(locale, 'packageSale.journalUnsaved'))).toBeNull();
}

async function keepsUnsavedWarningWhilePending(locale: 'ar' | 'en') {
  mockUnavailableStorage();
  state.outcome = 'pending';
  renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  await submitSale(state);
  expect(await screen.findByText(t(locale, 'packageSale.pending'))).toBeTruthy();
  expect(screen.getByText(t(locale, 'packageSale.journalUnsaved'))).toBeTruthy();
}

async function ignoresInvalidRecords(locale: 'ar' | 'en') {
  const seeded = await uncertainSale(locale);
  const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Record<string, unknown>;
  const invalidRecords = [
    { ...saved, saleId: 'a'.repeat(65) },
    { key: saved.key, scope: saved.scope, createdAt: saved.createdAt },
  ];
  let view = seeded;
  for (const record of invalidRecords) {
    view.unmount();
    view.client.clear();
    localStorage.setItem(storageKey, JSON.stringify(record));
    view = renderForm();
    expect(
      await screen.findByRole('button', { name: t(locale, 'packageSale.submit') }),
    ).toBeTruthy();
    expect(screen.queryByText(t(locale, 'packageSale.recoverOriginal'))).toBeNull();
    expect(
      screen.getByLabelText(t(locale, 'packageSale.pricePaid')).closest('fieldset'),
    ).toHaveProperty('disabled', false);
  }
  view.unmount();
}

describe.each(['ar', 'en'] as const)('package sale recovery window (%s)', (locale) => {
  beforeEach(() => {
    state.locale = locale;
  });
  it('blocks a stored attempt whose clock is two hours in the future', () =>
    futureAttemptBlocksReplay(locale));
  it('blocks replay on the seenAt high-water mark one hour after creation', () =>
    seenAtHighWaterBlocksReplay(locale));
  it('flips to verification on focus after time crosses the expiry instant', () =>
    focusRefreshesExpiry(locale));
  it('discards an expired attempt only after the manager acknowledgement', () =>
    discardAcknowledgedExpiredAttempt(locale));
  it('rebinds the acknowledgement when another attempt replaces the stored journal record', () =>
    acknowledgementBindsToItsAttempt(locale));
  it('stores a status-only record for an accepted sale and polls without reselling', () =>
    acceptedSaleStoresStatusOnlyRecord(locale));
  it('hides the unsaved-device warning once the sale reaches a confirmed completion', () =>
    hidesUnsavedWarningAfterCompletion(locale));
  it('keeps the unsaved-device warning while the accepted sale is still pending', () =>
    keepsUnsavedWarningWhilePending(locale));
  it('ignores a long saleId and a body-less record when opening the form', () =>
    ignoresInvalidRecords(locale));
});
