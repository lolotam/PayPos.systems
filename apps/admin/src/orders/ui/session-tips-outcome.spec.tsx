import type { SessionTips } from '@pospay/contracts';
import { serviceSessionErrors, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { id, scope } from '../model/session-recording-result.fixture';
import type { TipSourceLine } from '../model/session-tip-source';
import { sessionTipsPath } from '../api/use-session-tips';
import { SessionTipsLauncher } from './session-tips-launcher';

const api = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ PUT: api.put, GET: api.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const lines: readonly TipSourceLine[] = [
  {
    status: 'ACTIVE',
    net: '8.000',
    performers: [
      { employee_id: id(6), share_bps: 7500, name_ar: null, name_en: 'Ada' },
      { employee_id: id(7), share_bps: 2500, name_ar: null, name_en: 'Bea' },
    ],
  },
];
const kept = [
  [422, 'TIP_WINDOW_CLOSED'],
  [422, 'TIP_SELF_FORBIDDEN'],
  [422, 'TIP_IDENTITY_UNKNOWN'],
  [422, 'TIP_EMPLOYEE_NOT_PERFORMER'],
  [422, 'TIP_TOTAL_TOO_LARGE'],
  [422, 'TIP_REASON_REQUIRED'],
  [422, 'TIP_NO_CHANGE'],
  [422, 'VALIDATION_FAILED'],
  [404, 'SESSION_NOT_FOUND'],
  [422, 'IDEMPOTENCY_KEY_REUSED'],
] as const;

function refused(status: number, code: string, details?: unknown) {
  return {
    error: { code, message_ar: `${code} AR`, message_en: `${code} EN`, details },
    response: { status },
  };
}
function ok(data: SessionTips) {
  return { data, response: { status: 200 } };
}
function emptyTips(): SessionTips {
  return { revision: 0, tips: [], total_cash: '0.000', total_card: '0.000' };
}
function tipped(revision: number, amount: string): SessionTips {
  return {
    revision,
    tips: [{ employee_id: id(6), method: 'CASH', amount }],
    total_cash: amount,
    total_card: '0.000',
  };
}
function bodyOf(index: number) {
  return api.put.mock.calls[index]?.[1].body as { expected_revision: number; reason?: string };
}
function keyOf(index: number) {
  return api.put.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;
}
function installRead(tips: SessionTips = emptyTips()) {
  api.get.mockImplementation((path: string) =>
    Promise.resolve(path === sessionTipsPath ? ok(tips) : refused(404, 'SESSION_NOT_FOUND')),
  );
}
function catalog(code: keyof typeof serviceSessionErrors | 'IDEMPOTENCY_KEY_REUSED'): string {
  if (code === 'IDEMPOTENCY_KEY_REUSED') return t('en', 'errors.IDEMPOTENCY_KEY_REUSED');
  return serviceSessionErrors[code].message_en;
}
function renderTips() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionTipsLauncher
        scope={scope}
        sessionId={id(12)}
        lines={lines}
        online
        onAccessDenied={() => undefined}
      />
    </QueryClientProvider>,
  );
}
async function openAndSave() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  await screen.findByLabelText(t('en', 'sessionTips.total'));
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.total')), {
    target: { value: '8.000' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.useSuggestion') }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function hide(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  api.put.mockReset();
  api.get.mockReset();
  installRead();
});

it.each(kept)('shows the catalog sentence for %s %s', async (status, code) => {
  api.put.mockResolvedValue(refused(status, code));
  renderTips();
  await openAndSave();
  expect(await screen.findByText(catalog(code))).toBeTruthy();
  expect(screen.queryByText(`${code} EN`)).toBeNull();
  expect(screen.getByLabelText(t('en', 'sessionTips.total'))).toBeTruthy();
});

it('refetches the current set after 409 and saves that revision with a new key', async () => {
  let reads = 0;
  let release: (value: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  api.get.mockImplementation((path: string) => {
    if (path !== sessionTipsPath) return Promise.resolve(refused(404, 'SESSION_NOT_FOUND'));
    reads += 1;
    return reads === 1 ? Promise.resolve(ok(tipped(1, '1.000'))) : pending;
  });
  api.put.mockResolvedValueOnce(refused(409, 'TIP_REVISION_CONFLICT', { current_revision: 2 }));
  api.put.mockResolvedValue(ok(tipped(3, '3.000')));
  renderTips();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  expect(await screen.findByDisplayValue('1.000')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(`${'Ada'} ${t('en', 'sessionTips.cashAmount')}`), {
    target: { value: '4.000' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.reason')), {
    target: { value: 'because' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  expect(await screen.findByRole('button', { name: t('en', 'sessionTips.saving') })).toBeTruthy();
  expect(api.put).toHaveBeenCalledTimes(1);
  await act(async () => {
    release(ok(tipped(2, '3.000')));
  });
  expect(await screen.findByDisplayValue('3.000')).toBeTruthy();
  expect(screen.getByText(catalog('TIP_REVISION_CONFLICT'))).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.reason')), {
    target: { value: 'updated' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  expect(bodyOf(0).expected_revision).toBe(1);
  expect(bodyOf(1).expected_revision).toBe(2);
  expect(bodyOf(1).reason).toBe('updated');
  expect(api.put.mock.calls[1]?.[1].body.tips[0].amount).toBe('3.000');
  expect(typeof api.put.mock.calls[1]?.[1].body.tips[0].amount).toBe('string');
  expect(keyOf(1)).not.toBe(keyOf(0));
});

it('replays one key after a network error and mints another after a definitive 422', async () => {
  api.put.mockRejectedValueOnce(new Error('offline'));
  api.put.mockResolvedValueOnce(refused(422, 'TIP_NO_CHANGE'));
  api.put.mockResolvedValue(ok(tipped(1, '6.000')));
  renderTips();
  await openAndSave();
  expect(await screen.findByText(t('en', 'sessionTips.outcomeUnknown'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.retrySame') }));
  expect(await screen.findByText(catalog('TIP_NO_CHANGE'))).toBeTruthy();
  expect(api.put).toHaveBeenCalledTimes(2);
  expect(keyOf(1)).toBe(keyOf(0));
  expect(api.put.mock.calls[1]?.[1].body).toEqual(api.put.mock.calls[0]?.[1].body);
  expect(typeof api.put.mock.calls[0]?.[1].body.tips[0].amount).toBe('string');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(3));
  expect(keyOf(2)).not.toBe(keyOf(1));
});

it('holds the key when the transaction asks for a retry', async () => {
  api.put.mockResolvedValueOnce(refused(409, 'TRANSACTION_RETRY_REQUIRED'));
  api.put.mockResolvedValue(ok(tipped(1, '6.000')));
  renderTips();
  await openAndSave();
  expect(await screen.findByText(t('en', 'errors.TRANSACTION_RETRY_REQUIRED'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.retrySame') }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).toBe(keyOf(0));
});

it('keeps a removed performer on the loaded set', async () => {
  const active: TipSourceLine[] = [
    {
      status: 'ACTIVE',
      net: '8.000',
      performers: [{ employee_id: id(6), share_bps: 10000, name_ar: null, name_en: 'Ada' }],
    },
  ];
  installRead({
    revision: 1,
    tips: [{ employee_id: id(9), method: 'CASH', amount: '1.500' }],
    total_cash: '1.500',
    total_card: '0.000',
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionTipsLauncher
        scope={scope}
        sessionId={id(12)}
        lines={active}
        online
        onAccessDenied={() => undefined}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  expect(await screen.findByDisplayValue('1.500')).toBeTruthy();
  expect(screen.getByText(id(9))).toBeTruthy();
});
