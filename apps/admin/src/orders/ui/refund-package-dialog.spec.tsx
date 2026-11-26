import type { CustomerPackageDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CustomerPackageRefundControls } from './customer-package-refund-controls';
import { RefundPackageDialog } from './refund-package-dialog';

const state = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: state.post, GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const scope = { companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' };
const customerId = '01920000-0000-7000-8000-000000000005';
const entitlementId = '01920000-0000-7000-8000-000000000006';
const componentId = '01920000-0000-7000-8000-000000000020';
const components = [
  {
    id: componentId,
    name_en: 'Cut',
    name_ar: t('ar', 'packageSale.cash'),
    remaining: 2,
    slots: [
      { ordinal: 1, state: 'USED' as const, unit_value: '2.250' },
      { ordinal: 2, state: 'FREE' as const, unit_value: '2.250' },
      { ordinal: 3, state: 'FREE' as const, unit_value: '2.250' },
    ],
  },
];
const saved = {
  data: {
    id: '01920000-0000-7000-8000-000000000007',
    entitlement_id: entitlementId,
    component_id: componentId,
    sessions: 1,
    amount: '2.250',
    method: 'CASH',
    refunded_amount: '2.250',
    revision: 2,
    refunded_at: '2026-11-20T09:30:00.000Z',
  },
  response: { status: 201 },
};

function refused(status: number, code: string) {
  return {
    error: { code, message_ar: 'Synthetic AR', message_en: 'Synthetic EN' },
    response: { status },
  };
}

function shown() {
  const handlers = { onClose: vi.fn(), onSaved: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Host() {
    const [open, setOpen] = useState(true);
    if (!open) return null;
    return (
      <RefundPackageDialog
        scope={scope}
        customerId={customerId}
        entitlementId={entitlementId}
        components={components}
        onSaved={handlers.onSaved}
        onClose={() => {
          handlers.onClose();
          setOpen(false);
        }}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );
  return { ...handlers, client };
}

const componentSelect = () =>
  screen.getByLabelText(t('en', 'packageRefund.component')) as HTMLSelectElement;
const sessionsInput = () =>
  screen.getByLabelText(t('en', 'packageRefund.sessions')) as HTMLInputElement;
const reasonInput = () => screen.getByLabelText(t('en', 'packageRefund.reason'));
const submitButton = () =>
  screen.getByRole('button', { name: t('en', 'packageRefund.submit') }) as HTMLButtonElement;
const submit = () => fireEvent.click(submitButton());
const bodyOf = (index: number) => state.post.mock.calls[index]?.[1].body as Record<string, unknown>;
const keyOf = (index: number) =>
  state.post.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;

function fillValid() {
  fireEvent.change(componentSelect(), { target: { value: componentId } });
  fireEvent.change(sessionsInput(), { target: { value: '1' } });
  fireEvent.change(reasonInput(), { target: { value: ' \tSynthetic reason\r\n ' } });
}

beforeEach(() => {
  state.post.mockReset();
  state.get.mockReset();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

it('shows the component in the viewer locale and the sessions, method and reason fields', async () => {
  shown();
  expect(await screen.findByLabelText(t('en', 'packageRefund.component'))).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Cut' })).toBeTruthy();
  expect(screen.getByLabelText(t('en', 'packageRefund.sessions'))).toBeTruthy();
  expect(screen.getByLabelText(t('en', 'packageRefund.method'))).toBeTruthy();
  expect(screen.getByLabelText(t('en', 'packageRefund.reason'))).toBeTruthy();
});

it('previews the refund total from the stored session values', async () => {
  shown();
  fireEvent.change(componentSelect(), { target: { value: componentId } });
  fireEvent.change(sessionsInput(), { target: { value: '2' } });
  expect(await screen.findByText('4.500')).toBeTruthy();
  fireEvent.change(sessionsInput(), { target: { value: '1' } });
  expect(await screen.findByText('2.250')).toBeTruthy();
});

it('rejects missing component, empty reason, zero sessions and more sessions than free without posting', async () => {
  shown();
  submit();
  expect(await screen.findByText(t('en', 'packageRefund.componentRequired'))).toBeTruthy();
  fireEvent.change(componentSelect(), { target: { value: componentId } });
  fireEvent.change(sessionsInput(), { target: { value: '0' } });
  submit();
  expect(await screen.findByText(t('en', 'packageRefund.sessionsRequired'))).toBeTruthy();
  expect(await screen.findByText(t('en', 'packageRefund.reasonRequired'))).toBeTruthy();
  fireEvent.change(reasonInput(), { target: { value: 'Synthetic reason' } });
  fireEvent.change(sessionsInput(), { target: { value: '5' } });
  submit();
  expect(
    await screen.findByText(t('en', 'packageRefund.sessionsTooMany').replace('{available}', '2')),
  ).toBeTruthy();
  expect(state.post).not.toHaveBeenCalled();
});

it('posts one trimmed request with the free sessions and the chosen method, then closes and saves', async () => {
  state.post.mockResolvedValueOnce(saved);
  const view = shown();
  fillValid();
  fireEvent.change(screen.getByLabelText(t('en', 'packageRefund.method')), {
    target: { value: 'CARD' },
  });
  submit();
  await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
  expect(view.onSaved).toHaveBeenCalledTimes(1);
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(bodyOf(0)).toEqual({
    component_id: componentId,
    sessions: 1,
    method: 'CARD',
    reason: 'Synthetic reason',
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('saves the refund without submitting a surrounding visit form', async () => {
  state.post.mockResolvedValueOnce(saved);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Host() {
    const [open, setOpen] = useState(true);
    const [outerStatus, setOuterStatus] = useState('Synthetic visit draft');
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setOuterStatus('Synthetic visit submitted');
        }}
      >
        <span>{outerStatus}</span>
        {open ? (
          <RefundPackageDialog
            scope={scope}
            customerId={customerId}
            entitlementId={entitlementId}
            components={components}
            onSaved={() => undefined}
            onClose={() => {
              setOpen(false);
            }}
          />
        ) : null}
      </form>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );
  fillValid();
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByText('Synthetic visit draft')).toBeTruthy();
  expect(screen.queryByText('Synthetic visit submitted')).toBeNull();
});

it('sends one request for two clicks in one tick and disables submit while pending', async () => {
  let finish: (value: typeof saved) => void = () => undefined;
  state.post.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  shown();
  fillValid();
  submit();
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
  const pending = screen.getByRole('button', { name: t('en', 'packageRefund.submitting') });
  expect((pending as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    finish(saved);
  });
});

it.each([
  ['PACKAGE_COMPONENT_NOT_FOUND', 'errorComponentNotFound'],
  ['INSUFFICIENT_SLOTS', 'errorInsufficientSlots'],
  ['PACKAGE_EXPIRED', 'errorExpired'],
  ['IMPORTED_REFUND_DISABLED', 'errorImportedDisabled'],
  ['PACKAGE_REFUND_REASON_INVALID', 'errorReasonInvalid'],
] as const)('shows the refusal %s', async (code, key) => {
  state.post.mockResolvedValueOnce(refused(422, code));
  shown();
  fillValid();
  submit();
  expect(await screen.findByText(t('en', `packageRefund.${key}`))).toBeTruthy();
});

it('shows forbidden and disables submit on 403', async () => {
  state.post.mockResolvedValueOnce(refused(403, 'FORBIDDEN'));
  shown();
  fillValid();
  submit();
  expect(await screen.findByText(t('en', 'packageRefund.errorForbidden'))).toBeTruthy();
  expect(submitButton().disabled).toBe(true);
});

it('reuses a key after a network error and changes it with the body', async () => {
  state.post
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(saved);
  shown();
  fillValid();
  submit();
  expect(await screen.findByText(t('en', 'packageRefund.errorNetwork'))).toBeTruthy();
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).toBe(keyOf(0));
  fireEvent.change(sessionsInput(), { target: { value: '2' } });
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(3));
  expect(keyOf(2)).not.toBe(keyOf(1));
});

it('keeps the held Idempotency-Key when closed and reopened after a network error', async () => {
  state.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(saved);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CustomerPackageRefundControls
        scope={scope}
        customerId={customerId}
        entitlementId={entitlementId}
        detail={{ components } as unknown as CustomerPackageDetail}
        onSaved={() => undefined}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageRefund.refund') }));
  fillValid();
  submit();
  expect(await screen.findByText(t('en', 'packageRefund.errorNetwork'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageRefund.cancel') }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'packageRefund.refund') }));
  fillValid();
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).toBe(keyOf(0));
});
