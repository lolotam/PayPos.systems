import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { id, savedLine, scope } from '../model/session-recording-result.fixture';
import { CancelServiceLineDialog } from './cancel-service-line-dialog';

const state = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const saved = {
  data: {
    line: {
      ...savedLine,
      id: id(20),
      status: 'CANCELLED' as const,
      cancelled_at: '2026-10-15T11:00:00.000Z',
      revision: 4,
    },
    session: { id: id(12), total_net: '6.412' },
  },
  response: { status: 200 },
};
function refused(status: number, code: string, details?: unknown) {
  return {
    error: { code, message_ar: `${code} AR`, message_en: `${code} EN`, details },
    response: { status },
  };
}
function shown() {
  const handlers = {
    onSaved: vi.fn(),
    onForbidden: vi.fn(),
    onAccessDenied: vi.fn(),
    onClose: vi.fn(),
  };
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CancelServiceLineDialog
        scope={scope}
        sessionId={id(12)}
        line={{ id: id(20), revision: 3 }}
        online
        {...handlers}
      />
    </QueryClientProvider>,
  );
  return handlers;
}
const reasonBox = () => screen.getByLabelText(t('en', 'serviceLineCancel.reason'));
const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineCancel.submit') }));
const bodyOf = (index: number) =>
  state.post.mock.calls[index]?.[1].body as {
    reason: string;
    expected_revision: number;
    canceller_membership_id?: string;
  };
const keyOf = (index: number) =>
  state.post.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  state.post.mockReset();
});

it('rejects an empty, blank, or 501-character reason before posting', async () => {
  shown();
  submit();
  expect(await screen.findByText(t('en', 'serviceLineCancel.reasonInvalid'))).toBeTruthy();
  fireEvent.change(reasonBox(), { target: { value: ' \t\r\n ' } });
  submit();
  fireEvent.change(reasonBox(), { target: { value: '😀'.repeat(501) } });
  submit();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(state.post).not.toHaveBeenCalled();
  expect(
    screen.getByText(t('en', 'serviceLineCancel.reasonCount').replace('{count}', '501')),
  ).toBeTruthy();
});

it('sends a trimmed reason and a reason of 500 characters', async () => {
  state.post.mockResolvedValue(saved);
  shown();
  fireEvent.change(reasonBox(), { target: { value: ' \thello\r\n ' } });
  submit();
  await waitFor(() => expect(bodyOf(0).reason).toBe('hello'));
  fireEvent.change(reasonBox(), { target: { value: '😀'.repeat(500) } });
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
  expect(Array.from(bodyOf(1).reason)).toHaveLength(500);
  expect(bodyOf(0).expected_revision).toBe(3);
  expect(keyOf(0)).toEqual(expect.any(String));
  expect(keyOf(1)).not.toBe(keyOf(0));
});

it.each([
  [422, 'SESSION_CANCEL_BLOCKED_BY_TIP'],
  [422, 'SESSION_LINE_ALREADY_CANCELLED'],
  [422, 'SESSION_CANCEL_REASON_INVALID'],
  [422, 'SESSION_LINE_IDENTITY_UNKNOWN'],
  [422, 'SESSION_LINE_NOT_CANCELLABLE'],
  [422, 'SESSION_TIME_TOO_OLD'],
  [422, 'IDEMPOTENCY_KEY_REUSED'],
  [409, 'SESSION_LINE_REVISION_STALE'],
] as const)('shows the %s %s message', async (status, code) => {
  state.post.mockResolvedValue(
    refused(status, code, status === 409 ? { current_revision: 2 } : undefined),
  );
  const view = shown();
  fireEvent.change(reasonBox(), { target: { value: 'because' } });
  submit();
  expect(await screen.findByText(`${code} EN`)).toBeTruthy();
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(view.onForbidden).not.toHaveBeenCalled();
});

it.each(['FORBIDDEN', 'SESSION_PERFORMER_SELF_FORBIDDEN'] as const)(
  'closes on 403 %s',
  async (code) => {
    state.post.mockResolvedValue(refused(403, code));
    const view = shown();
    fireEvent.change(reasonBox(), { target: { value: 'because' } });
    submit();
    await waitFor(() => expect(view.onForbidden).toHaveBeenCalledWith(`${code} EN`));
    expect(view.onClose).toHaveBeenCalled();
  },
);

it('shows the tip refusal without rendering the employee id', async () => {
  state.post.mockResolvedValue(
    refused(422, 'SESSION_CANCEL_BLOCKED_BY_TIP', { employee_ids: [id(6)] }),
  );
  shown();
  fireEvent.change(reasonBox(), { target: { value: 'because' } });
  submit();
  expect(await screen.findByText('SESSION_CANCEL_BLOCKED_BY_TIP EN')).toBeTruthy();
  expect(screen.queryByText(id(6))).toBeNull();
});

it('shows the membership choices and sends the chosen one next', async () => {
  state.post
    .mockResolvedValueOnce(
      refused(422, 'SESSION_CANCELLER_MEMBERSHIP_REQUIRED', {
        canceller_membership_ids: [id(30), id(31)],
      }),
    )
    .mockResolvedValue(saved);
  shown();
  fireEvent.change(reasonBox(), { target: { value: 'because' } });
  submit();
  expect(await screen.findByText('SESSION_CANCELLER_MEMBERSHIP_REQUIRED EN')).toBeTruthy();
  fireEvent.change(
    await screen.findByRole('combobox', { name: t('en', 'serviceLineCancel.membership') }),
    { target: { value: id(31) } },
  );
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
  expect(bodyOf(1).canceller_membership_id).toBe(id(31));
});

it('waits after a stale revision and sends the newer one with a new key', async () => {
  state.post
    .mockResolvedValueOnce(refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 5 }))
    .mockResolvedValue(saved);
  shown();
  fireEvent.change(reasonBox(), { target: { value: 'because' } });
  submit();
  expect(await screen.findByText('SESSION_LINE_REVISION_STALE EN')).toBeTruthy();
  expect(state.post).toHaveBeenCalledTimes(1);
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
  expect(bodyOf(1).expected_revision).toBe(5);
  expect(keyOf(1)).not.toBe(keyOf(0));
});

it('replays the same key and body after a network error', async () => {
  state.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(saved);
  const view = shown();
  fireEvent.change(reasonBox(), { target: { value: '  hello  ' } });
  submit();
  expect(await screen.findByText(t('en', 'serviceLineCancel.outcomeUnknown'))).toBeTruthy();
  expect((reasonBox() as HTMLInputElement).disabled).toBe(true);
  expect(
    (screen.getByRole('button', { name: t('en', 'serviceLineCancel.submit') }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  fireEvent.change(reasonBox(), { target: { value: 'other reason' } });
  const sent = bodyOf(0);
  submit();
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).toBe(keyOf(0));
  expect(bodyOf(1)).toEqual(sent);
  expect(sent.reason).toBe('hello');
  await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(1));
});
