import { parseMoney } from '@pospay/domain';
import { formatKwd, t } from '@pospay/i18n';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PackageSaleResult } from './package-sale-result';
import {
  choosePackageSaleCustomer as chooseCustomer,
  choosePackageSaleTypeAndSeller as chooseTypeAndSeller,
  completedPackageSale,
  packageSalePath as salePath,
  packageSaleRecorderId,
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
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

it.each(['ar', 'en'] as const)(
  'shows the localized stale quote and structured current revisions in %s',
  (locale) => {
    state.locale = locale;
    const details = {
      current_service_revisions: [
        { service_id: '01920000-0000-7000-8000-000000000036', revision: 5 },
      ],
    };
    render(
      <PackageSaleResult
        status={{
          status: 'failed',
          error: {
            code: 'PACKAGE_SALE_QUOTE_STALE',
            message_ar: 'Stale AR',
            message_en: 'Stale EN',
            details,
          },
        }}
        timedOut={false}
        recheck={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(locale === 'ar' ? 'Stale AR' : 'Stale EN');
    expect(alert.textContent).toContain(JSON.stringify(details));
    expect(alert.textContent).toContain(t(locale, 'packageSale.details'));
  },
);

it.each(['ar', 'en'] as const)(
  'shows formatted server amounts and the exact expiry date in %s',
  (locale) => {
    state.locale = locale;
    render(<PackageSaleResult status={completedPackageSale} timedOut={false} recheck={vi.fn()} />);
    const summary = screen.getByRole('status');
    const entitlement = completedPackageSale.entitlement;
    expect(summary.textContent).toContain(formatKwd(parseMoney(entitlement.price_paid)));
    expect(summary.textContent).toContain(formatKwd(parseMoney(entitlement.discount)));
    expect(summary.textContent).toContain(entitlement.expires_on);
    expect(summary.textContent).toContain(t(locale, 'packageSale.completed'));
    expect(summary.textContent).toContain('1,234.500');
  },
);

it('offers a visible status-only recheck after the pending timeout', () => {
  const recheck = vi.fn();
  render(<PackageSaleResult status={{ status: 'pending' }} timedOut recheck={recheck} />);
  expect(screen.getByRole('status').textContent).toContain(t('en', 'packageSale.timeout'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageSale.recheck') }));
  expect(recheck).toHaveBeenCalledTimes(1);
});

beforeEach(() => resetPackageSaleFormTest(state));

it('locks edits and retries only the original sale after an ambiguous response', async () => {
  const view = renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  state.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
    data: { sale_request_id: '01920000-0000-7000-8000-000000000034' },
    response: { status: 202 },
  });
  await submitSale(state);
  expect(await screen.findByText(t('en', 'packageSale.recoverOriginal'))).toBeTruthy();
  expect(
    screen.getByLabelText(t('en', 'packageSale.pricePaid')).closest('fieldset'),
  ).toHaveProperty('disabled', true);
  const first = state.post.mock.calls.find(([path]) => path === salePath)?.[1];
  state.entryScope = null;
  await act(async () => view.client.invalidateQueries({ queryKey: ['package-sale-context'] }));
  expect(await screen.findByText(t('en', 'packageSale.customerUnavailable'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageSale.retryOriginal') }));
  expect(await screen.findByText(t('en', 'packageSale.pending'))).toBeTruthy();
  const sales = state.post.mock.calls.filter(([path]) => path === salePath);
  expect(sales).toHaveLength(2);
  expect(sales[1]?.[1].body).toEqual(first.body);
  expect(sales[1]?.[1].params.header['Idempotency-Key']).toBe(
    first.params.header['Idempotency-Key'],
  );
});

it('latches rapid and overlapping submits until the real sale mutation settles', async () => {
  const view = renderForm();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  const defaultPost = state.post.getMockImplementation();
  if (!defaultPost) throw new Error('Missing POST fixture');
  let finish!: () => void;
  state.post.mockImplementation((path, init) =>
    path === salePath
      ? new Promise((resolve) => {
          finish = () =>
            resolve({
              data: { sale_request_id: '01920000-0000-7000-8000-000000000034' },
              response: { status: 202 },
            });
        })
      : defaultPost(path, init),
  );
  const form = view.container.querySelector('form');
  if (!form) throw new Error('Missing sale form');
  await act(async () => {
    fireEvent.submit(form);
    fireEvent.submit(form);
    await Promise.resolve();
  });
  await waitFor(() =>
    expect(state.post.mock.calls.filter(([path]) => path === salePath)).toHaveLength(1),
  );
  await act(async () => {
    fireEvent.submit(form);
    await Promise.resolve();
  });
  expect(state.post.mock.calls.filter(([path]) => path === salePath)).toHaveLength(1);
  await act(async () => finish());
  expect(await screen.findByText(t('en', 'packageSale.pending'))).toBeTruthy();
  expect(state.post.mock.calls.filter(([path]) => path === salePath)).toHaveLength(1);
});

it('releases the synchronous submit latch after invalid validation', async () => {
  renderForm();
  const submit = screen.getByRole('button', { name: t('en', 'packageSale.submit') });
  await waitFor(() => expect(submit).toHaveProperty('disabled', false));
  fireEvent.click(submit);
  expect(await screen.findByText(t('en', 'packageSale.invalid'))).toBeTruthy();
  expect(state.post.mock.calls.some(([path]) => path === salePath)).toBe(false);
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  await submitSale(state);
  expect(state.post.mock.calls.filter(([path]) => path === salePath)).toHaveLength(1);
});

it('requires an explicit replacement after the chosen recorder is invalidated', async () => {
  const replacement = '01920000-0000-7000-8000-00000000003c';
  state.recorderIds = [packageSaleRecorderId, replacement];
  const view = renderForm();
  const selector = await screen.findByLabelText(t('en', 'packageSale.recorder'));
  fireEvent.change(selector, { target: { value: packageSaleRecorderId } });
  state.recorderIds = [replacement];
  state.contextAnchor = '2026-10-02T08:00:00.000Z';
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['package-sale-context'] });
  });
  await waitFor(() => expect(selector).toHaveProperty('value', ''));
  expect(within(selector).getAllByRole('option')).toHaveLength(2);
  expect(selector.querySelector(`option[value="${replacement}"]`)).not.toBeNull();
  await chooseCustomer(state);
  await chooseTypeAndSeller(state);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageSale.submit') }));
  expect(await screen.findByText(t('en', 'packageSale.invalid'))).toBeTruthy();
  expect(state.post.mock.calls.some(([path]) => path === salePath)).toBe(false);
  fireEvent.change(selector, { target: { value: replacement } });
  await submitSale(state);
  const sent = state.post.mock.calls.find(([path]) => path === salePath)?.[1];
  expect(sent.body.recorder_membership_id).toBe(replacement);
});
