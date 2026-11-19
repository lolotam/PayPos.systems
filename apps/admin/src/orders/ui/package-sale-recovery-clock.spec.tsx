import { act, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  localStorage.clear();
  resetPackageSaleFormTest(state);
});

afterEach(() => {
  vi.restoreAllMocks();
});
const storageKey = `pospay:package-sale:${JSON.stringify(Object.values(packageSaleScope))}`;
const saleCalls = () => state.post.mock.calls.filter(([path]) => path === salePath);
const replayWindow = 23 * 60 * 60 * 1000;

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

async function expectVerificationWithLockedRetry(locale: 'ar' | 'en') {
  expect(await screen.findByText(t(locale, 'packageSale.verificationRequired'))).toBeTruthy();
  expect(
    screen.getByRole('button', { name: t(locale, 'packageSale.retryOriginal') }),
  ).toHaveProperty('disabled', true);
}

async function rollbackLatchSurvivesRestore(locale: 'ar' | 'en') {
  const realNow = Date.now();
  await seedJournal(locale, { createdAt: realNow - 60 * 60 * 1000 });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(realNow - 3 * 60 * 60 * 1000);
  const view = renderForm();
  await expectVerificationWithLockedRetry(locale);
  clock.mockRestore();
  view.unmount();
  view.client.clear();
  renderForm();
  await expectVerificationWithLockedRetry(locale);
  const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Record<string, unknown>;
  expect(Number(stored.seenAt) - Number(stored.createdAt)).toBeGreaterThanOrEqual(
    23 * 60 * 60 * 1000,
  );
  expect(saleCalls()).toHaveLength(1);
}

async function smallBackwardCorrectionKeepsRecoveryOpen(locale: 'ar' | 'en') {
  await seedJournal(locale, { createdAt: Date.now() + 30_000 });
  renderForm();
  expect(await screen.findByText(t(locale, 'packageSale.recoverOriginal'))).toBeTruthy();
  expect(
    screen.getByRole('button', { name: t(locale, 'packageSale.retryOriginal') }),
  ).toHaveProperty('disabled', false);
  expect(
    screen.queryByRole('button', { name: t(locale, 'packageSale.discardExpired') }),
  ).toBeNull();
  expect(saleCalls()).toHaveLength(1);
}

async function observedExpiryStaysExpired(locale: 'ar' | 'en') {
  const createdAt = Date.now() - (replayWindow - 60_000);
  await seedJournal(locale, { createdAt });
  const view = renderForm();
  expect(await screen.findByText(t(locale, 'packageSale.recoverOriginal'))).toBeTruthy();
  expect(
    screen.getByRole('button', { name: t(locale, 'packageSale.retryOriginal') }),
  ).toHaveProperty('disabled', false);
  vi.spyOn(Date, 'now').mockReturnValue(createdAt + replayWindow + 2 * 60_000);
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await expectVerificationWithLockedRetry(locale);
  view.unmount();
  view.client.clear();
  vi.spyOn(Date, 'now').mockReturnValue(createdAt + 18 * 60 * 60 * 1000);
  renderForm();
  await expectVerificationWithLockedRetry(locale);
  expect(saleCalls()).toHaveLength(1);
}

describe.each(['ar', 'en'] as const)('package sale recovery clock (%s)', (locale) => {
  beforeEach(() => {
    state.locale = locale;
  });
  it('keeps an attempt expired when the clock jumps back beyond the tolerance', () =>
    rollbackLatchSurvivesRestore(locale));
  it('keeps recovery open for a backward correction within the tolerance', () =>
    smallBackwardCorrectionKeepsRecoveryOpen(locale));
  it('keeps an observed expiry expired after the clock moves back', () =>
    observedExpiryStaysExpired(locale));
});
