import { roleName, serviceSessionErrors, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
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
    performers: [{ employee_id: id(6), share_bps: 10000, name_ar: null, name_en: 'Ada' }],
  },
];
const empty = { revision: 0, tips: [], total_cash: '0.000', total_card: '0.000' };

function refused(status: number, code: string, details?: unknown) {
  return {
    error: { code, message_ar: `${code} AR`, message_en: `${code} EN`, details },
    response: { status },
  };
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
function RevokedScreen() {
  const [message, setMessage] = useState<string | null>(null);
  if (message) return <p role="alert">{message}</p>;
  return (
    <SessionTipsLauncher
      scope={scope}
      sessionId={id(12)}
      lines={lines}
      online
      onAccessDenied={setMessage}
    />
  );
}
function renderRevoked() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RevokedScreen />
    </QueryClientProvider>,
  );
}
async function openTips() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  await screen.findByLabelText(t('en', 'sessionTips.total'));
}
function keyOf(index: number) {
  return api.put.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;
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

it.each([
  [401, 'FORBIDDEN', 'errors.FORBIDDEN'],
  [403, 'FEATURE_DISABLED', 'errors.FEATURE_DISABLED'],
] as const)('clears the screen when reading tips returns %s %s', async (status, code, key) => {
  api.get.mockResolvedValue(refused(status, code));
  renderRevoked();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', key));
  expect(screen.queryByRole('button', { name: t('en', 'sessionTips.open') })).toBeNull();
  expect(screen.queryByLabelText(t('en', 'sessionTips.total'))).toBeNull();
});

it('clears the screen when saving tips is forbidden', async () => {
  api.get.mockResolvedValue({ data: empty, response: { status: 200 } });
  api.put.mockResolvedValue(refused(403, 'FORBIDDEN'));
  renderRevoked();
  await openTips();
  fireEvent.change(screen.getByLabelText(`${'Ada'} ${t('en', 'sessionTips.cashAmount')}`), {
    target: { value: '1.000' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(screen.queryByLabelText(t('en', 'sessionTips.total'))).toBeNull();
});

it('asks for a recorder membership and sends it on a new key', async () => {
  const label = `${roleName('en', 'owner', 'owner')} — PosPay`;
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
    if (path === sessionTipsPath)
      return Promise.resolve({ data: empty, response: { status: 200 } });
    return Promise.resolve(refused(404, 'SESSION_NOT_FOUND'));
  });
  api.put.mockResolvedValueOnce(
    refused(400, 'SESSION_RECORDER_MEMBERSHIP_REQUIRED', {
      recorder_membership_ids: [id(30), id(31)],
    }),
  );
  api.put.mockResolvedValue({
    data: { revision: 1, tips: [], total_cash: '1.000', total_card: '0.000' },
    response: { status: 200 },
  });
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
  await openTips();
  fireEvent.change(screen.getByLabelText(`${'Ada'} ${t('en', 'sessionTips.cashAmount')}`), {
    target: { value: '1.000' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  expect(
    await screen.findByText(serviceSessionErrors.SESSION_RECORDER_MEMBERSHIP_REQUIRED.message_en),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: t('en', 'sessionTips.membership') }), {
    target: { value: id(31) },
  });
  expect(await screen.findByRole('option', { name: label })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  expect(api.put.mock.calls[1]?.[1].body.recorder_membership_id).toBe(id(31));
  expect(typeof api.put.mock.calls[1]?.[1].body.tips[0].amount).toBe('string');
  expect(keyOf(1)).not.toBe(keyOf(0));
});
