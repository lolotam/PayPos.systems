import type { CustomerPackageDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ExtendPackageDialog } from './extend-package-dialog';

const state = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: state.post, GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const scope = { companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' };
const customerId = '01920000-0000-7000-8000-000000000005';
const entitlementId = '01920000-0000-7000-8000-000000000006';
const OLD = '2026-12-30';
const NEW = '2027-01-31';
const saved = {
  data: {
    id: '01920000-0000-7000-8000-000000000007',
    entitlement_id: entitlementId,
    previous_expires_on: OLD,
    new_expires_on: NEW,
    extended_at: '2027-01-01T08:00:00.000Z',
  },
  response: { status: 201 },
};

function detail(expires_on = OLD): CustomerPackageDetail {
  return {
    id: entitlementId, customer_id: customerId, package_type_id: null, provenance: 'IMPORTED',
    name_en: 'Synthetic package', name_ar: null, validity_days: null, list_price: null,
    price_paid: '0.000', discount: null, discount_bps: null, paid_method: null,
    seller_employee_id: null, seller_linked_user_id: null, sold_branch_id: null,
    sold_at: null, sold_business_date: null, expires_on, refunded_amount: '0.000', revision: 1, can_extend: false,
    components: [], redemptions: [], extensions: [],
  };
}

function refused(status: number, code: string) {
  return { error: { code, message_ar: 'Synthetic AR', message_en: 'Synthetic EN' }, response: { status } };
}

function shown() {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Host() {
    const [open, setOpen] = useState(true);
    if (!open) return null;
    return <ExtendPackageDialog
      scope={scope} customerId={customerId} entitlementId={entitlementId} currentExpiresOn={OLD}
      onSaved={handlers.onSaved}
      onClose={() => { handlers.onClose(); setOpen(false); }}
    />;
  }
  render(<QueryClientProvider client={client}><Host /></QueryClientProvider>);
  return { ...handlers, client };
}

const dateInput = () => screen.getByLabelText(t('en', 'packageExtension.newDate')) as HTMLInputElement;
const reasonInput = () => screen.getByLabelText(t('en', 'packageExtension.reason'));
const submitButton = () => screen.getByRole('button', { name: t('en', 'packageExtension.submit') }) as HTMLButtonElement;
const submit = () => fireEvent.click(submitButton());
const bodyOf = (index: number) => state.post.mock.calls[index]?.[1].body as Record<string, string>;
const keyOf = (index: number) => state.post.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;

function fillValid() {
  fireEvent.change(dateInput(), { target: { value: NEW } });
  fireEvent.change(reasonInput(), { target: { value: ' \tSynthetic reason\r\n ' } });
}

beforeEach(() => {
  state.post.mockReset();
  state.get.mockReset();
  state.get.mockImplementation(() => Promise.resolve({ data: detail(), response: { status: 200 } }));
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

it('renders date and reason fields without a money field', async () => {
  shown();
  expect(await screen.findByLabelText(t('en', 'packageExtension.newDate'))).toBeTruthy();
  expect(screen.getByLabelText(t('en', 'packageExtension.reason'))).toBeTruthy();
  expect(screen.queryByLabelText(/KWD|price|amount/i)).toBeNull();
  expect(screen.queryByText(/KWD/)).toBeNull();
});

it('rejects empty and 501-code-point reasons without posting', async () => {
  shown();
  fireEvent.change(dateInput(), { target: { value: NEW } });
  submit();
  expect(await screen.findByText(t('en', 'packageExtension.reasonRequired'))).toBeTruthy();
  fireEvent.change(reasonInput(), { target: { value: '😀'.repeat(501) } });
  submit();
  expect(await screen.findByText(t('en', 'packageExtension.reasonTooLong'))).toBeTruthy();
  expect(state.post).not.toHaveBeenCalled();
});

it('rejects a date not later than the current expiry without posting', async () => {
  shown();
  fireEvent.change(dateInput(), { target: { value: OLD } });
  fireEvent.change(reasonInput(), { target: { value: 'Synthetic reason' } });
  submit();
  expect(await screen.findByText(t('en', 'packageExtension.dateNotLater'))).toBeTruthy();
  expect(state.post).not.toHaveBeenCalled();
});

it('posts one trimmed request with the opening expiry, then closes and saves', async () => {
  state.post.mockResolvedValueOnce(saved);
  const view = shown();
  fillValid();
  submit();
  await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
  expect(view.onSaved).toHaveBeenCalledTimes(1);
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(bodyOf(0)).toEqual({ new_expires_on: NEW, expected_expires_on: OLD, reason: 'Synthetic reason' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('sends one request for two clicks in one tick and disables submit while pending', async () => {
  let finish: (value: typeof saved) => void = () => undefined;
  state.post.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  shown();
  fillValid();
  submit();
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
  const pending = screen.getByRole('button', { name: t('en', 'packageExtension.saving') });
  expect((pending as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { finish(saved); });
});

it('refetches a stale expiry, resets min and resubmits with a new key', async () => {
  state.get.mockResolvedValueOnce({ data: detail(), response: { status: 200 } })
    .mockResolvedValueOnce({ data: detail(NEW), response: { status: 200 } });
  state.post.mockResolvedValueOnce(refused(409, 'PACKAGE_EXPIRY_STALE')).mockResolvedValueOnce(saved);
  shown();
  await act(async () => { await Promise.resolve(); });
  fillValid();
  submit();
  await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2));
  expect(await screen.findByText(t('en', 'packageExtension.errorStale').replace('{date}', NEW))).toBeTruthy();
  expect(dateInput().min).toBe('2027-02-01');
  fireEvent.change(dateInput(), { target: { value: '2027-02-28' } });
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
  expect(bodyOf(1).expected_expires_on).toBe(NEW);
  expect(keyOf(1)).not.toBe(keyOf(0));
});

it('keeps submit disabled when the stale detail refetch fails', async () => {
  state.get.mockResolvedValueOnce({ data: detail(), response: { status: 200 } })
    .mockResolvedValueOnce(refused(500, 'INTERNAL'));
  state.post.mockResolvedValueOnce(refused(409, 'PACKAGE_EXPIRY_STALE'));
  shown();
  await act(async () => { await Promise.resolve(); });
  fillValid();
  submit();
  expect(await screen.findByText(t('en', 'packageExtension.errorLoad'))).toBeTruthy();
  expect(submitButton().disabled).toBe(true);
});

it.each(['PACKAGE_EXTENSION_NOT_LATER', 'PACKAGE_EXTENSION_TOO_LONG'] as const)('shows %s', async (code) => {
  state.post.mockResolvedValueOnce(refused(422, code));
  shown();
  fillValid();
  submit();
  const key = code === 'PACKAGE_EXTENSION_NOT_LATER' ? 'errorNotLater' : 'errorTooLong';
  expect(await screen.findByText(t('en', `packageExtension.${key}`))).toBeTruthy();
});

it('shows forbidden and disables submit on 403', async () => {
  state.post.mockResolvedValueOnce(refused(403, 'FORBIDDEN'));
  shown();
  fillValid();
  submit();
  expect(await screen.findByText(t('en', 'packageExtension.errorForbidden'))).toBeTruthy();
  expect(submitButton().disabled).toBe(true);
});

it('reuses a key after network errors and changes it with the reason', async () => {
  state.post.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(saved);
  shown();
  fillValid();
  submit();
  expect(await screen.findByText(t('en', 'packageExtension.errorNetwork'))).toBeTruthy();
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).toBe(keyOf(0));
  fireEvent.change(reasonInput(), { target: { value: 'Changed synthetic reason' } });
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(3));
  expect(keyOf(2)).not.toBe(keyOf(1));
});

it('keeps the opening expected expiry after a background detail refetch', async () => {
  state.get.mockResolvedValueOnce({ data: detail(), response: { status: 200 } })
    .mockResolvedValueOnce({ data: detail(NEW), response: { status: 200 } });
  state.post.mockResolvedValueOnce(saved);
  const view = shown();
  await act(async () => { await Promise.resolve(); });
  fillValid();
  await act(() => view.client.invalidateQueries({ queryKey: ['customer-package-detail'] }));
  await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2));
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
  expect(bodyOf(0).expected_expires_on).toBe(OLD);
});
