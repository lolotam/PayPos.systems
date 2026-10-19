import type { SessionTips } from '@pospay/contracts';
import { serviceSessionErrors, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { sessionTipsPath } from '../api/use-session-tips';
import { id, scope } from '../model/session-recording-result.fixture';
import type { TipSourceLine } from '../model/session-tip-source';
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

function refused(status: number, code: string, details?: unknown) {
  return {
    error: { code, message_ar: `${code} AR`, message_en: `${code} EN`, details },
    response: { status },
  };
}
function ok(data: SessionTips) {
  return { data, response: { status: 200 } };
}
function tipped(revision: number, amount: string): SessionTips {
  return {
    revision,
    tips: [{ employee_id: id(6), method: 'CASH', amount }],
    total_cash: amount,
    total_card: '0.000',
  };
}
function keyOf(index: number) {
  return api.put.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;
}
function bodyOf(index: number) {
  return api.put.mock.calls[index]?.[1].body as { expected_revision: number };
}
function membership(n: number, role: string, scopeId: string, scopeName: string) {
  return {
    id: id(n),
    role_code: role,
    role_is_system: true,
    role_name_ar: null,
    role_name_en: role,
    scope_type: n === 31 ? 'COMPANY' : 'BRANCH',
    scope_id: scopeId,
    scope_name_ar: null,
    scope_name_en: scopeName,
  };
}
function renderTips() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
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
async function typeReplacement(amount: string) {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  expect(await screen.findByDisplayValue('1.000')).toBeTruthy();
  fireEvent.change(screen.getByLabelText(`${'Ada'} ${t('en', 'sessionTips.cashAmount')}`), {
    target: { value: amount },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.reason')), {
    target: { value: 'because' },
  });
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
});

it('reloads after a revision conflict that carries no current_revision', async () => {
  let reads = 0;
  api.get.mockImplementation((path: string) => {
    if (path !== sessionTipsPath) return Promise.resolve(refused(404, 'SESSION_NOT_FOUND'));
    reads += 1;
    return Promise.resolve(ok(reads === 1 ? tipped(1, '1.000') : tipped(2, '3.000')));
  });
  api.put.mockResolvedValueOnce(refused(409, 'TIP_REVISION_CONFLICT'));
  api.put.mockResolvedValue(ok(tipped(3, '4.000')));
  renderTips();
  await typeReplacement('4.000');
  expect(await screen.findByDisplayValue('3.000')).toBeTruthy();
  expect(screen.getByText(serviceSessionErrors.TIP_REVISION_CONFLICT.message_en)).toBeTruthy();
  expect(screen.queryByText(t('en', 'sessionTips.outcomeUnknown'))).toBeNull();
  expect(screen.getByRole('button', { name: t('en', 'sessionTips.save') })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.reason')), {
    target: { value: 'updated' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  expect(bodyOf(0).expected_revision).toBe(1);
  expect(bodyOf(1).expected_revision).toBe(2);
  expect(keyOf(1)).not.toBe(keyOf(0));
});

it('keeps the same key when a 409 says the idempotency key is in progress', async () => {
  api.get.mockImplementation((path: string) =>
    Promise.resolve(
      path === sessionTipsPath ? ok(tipped(1, '1.000')) : refused(404, 'SESSION_NOT_FOUND'),
    ),
  );
  api.put.mockResolvedValueOnce(refused(409, 'IDEMPOTENCY_KEY_IN_PROGRESS'));
  api.put.mockResolvedValue(ok(tipped(2, '4.000')));
  renderTips();
  await typeReplacement('4.000');
  expect(await screen.findByText(t('en', 'errors.IDEMPOTENCY_KEY_IN_PROGRESS'))).toBeTruthy();
  expect(screen.getByText(t('en', 'sessionTips.outcomeUnknown'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'sessionTips.save') })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.retrySame') }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).toBe(keyOf(0));
  expect(api.put.mock.calls[1]?.[1].body).toEqual(api.put.mock.calls[0]?.[1].body);
});

it('keeps the chosen membership when a conflict reload replaces the amounts', async () => {
  let reads = 0;
  api.get.mockImplementation((path: string) => {
    if (path === '/v1/me/memberships') {
      return Promise.resolve({
        data: {
          items: [
            membership(30, 'branch_manager', id(3), 'Salmiya'),
            membership(31, 'owner', id(1), 'PosPay'),
          ],
        },
      });
    }
    if (path !== sessionTipsPath) return Promise.resolve(refused(404, 'SESSION_NOT_FOUND'));
    reads += 1;
    return Promise.resolve(ok(reads === 1 ? tipped(1, '1.000') : tipped(2, '3.000')));
  });
  api.put.mockResolvedValueOnce(
    refused(400, 'SESSION_RECORDER_MEMBERSHIP_REQUIRED', {
      recorder_membership_ids: [id(30), id(31)],
    }),
  );
  api.put.mockResolvedValueOnce(refused(409, 'TIP_REVISION_CONFLICT'));
  renderTips();
  await typeReplacement('4.000');
  fireEvent.change(
    await screen.findByRole('combobox', { name: t('en', 'sessionTips.membership') }),
    { target: { value: id(31) } },
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  expect(await screen.findByDisplayValue('3.000')).toBeTruthy();
  const choice = screen.getByRole('combobox', { name: t('en', 'sessionTips.membership') });
  expect((choice as HTMLSelectElement).value).toBe(id(31));
});
