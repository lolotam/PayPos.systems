import type { RecordSessionTipsInput, SessionTips } from '@pospay/contracts';
import { serviceSessionErrors, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { sessionTipsKey, sessionTipsPath } from '../api/use-session-tips';
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
    performers: [{ employee_id: id(6), share_bps: 10000, name_ar: null, name_en: 'Ada' }],
  },
];
const member = id(31);

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
function installReads(tips: SessionTips) {
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
    return Promise.resolve(path === sessionTipsPath ? ok(tips) : refused(404, 'SESSION_NOT_FOUND'));
  });
}
function renderTips(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
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
function cashBox() {
  return screen.getByLabelText(`${'Ada'} ${t('en', 'sessionTips.cashAmount')}`) as HTMLInputElement;
}
function keyOf(index: number) {
  return api.put.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;
}
async function loseTheSave() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  await screen.findByLabelText(t('en', 'sessionTips.total'));
  fireEvent.change(cashBox(), { target: { value: '4.000' } });
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.reason')), {
    target: { value: 'because' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  expect(
    await screen.findByText(serviceSessionErrors.SESSION_RECORDER_MEMBERSHIP_REQUIRED.message_en),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: t('en', 'sessionTips.membership') }), {
    target: { value: member },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  expect(await screen.findByText(t('en', 'sessionTips.outcomeUnknown'))).toBeTruthy();
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

it('restores the unresolved save when the dialog opens again', async () => {
  installReads(tipped(2, '1.000'));
  api.put.mockResolvedValueOnce(
    refused(400, 'SESSION_RECORDER_MEMBERSHIP_REQUIRED', {
      recorder_membership_ids: [id(30), member],
    }),
  );
  api.put.mockRejectedValueOnce(new Error('offline'));
  api.put.mockResolvedValue(ok(tipped(3, '4.000')));
  renderTips();
  await loseTheSave();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.close') }));
  await waitFor(() => expect(screen.queryByLabelText(t('en', 'sessionTips.total'))).toBeNull());
  installReads(tipped(9, '9.000'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  const cash = (await screen.findByLabelText(
    `${'Ada'} ${t('en', 'sessionTips.cashAmount')}`,
  )) as HTMLInputElement;
  expect(cash.value).toBe('4.000');
  const group = cash.closest('fieldset');
  if (!(group instanceof HTMLFieldSetElement)) throw new Error('missing tip row');
  expect(group.disabled).toBe(true);
  expect(screen.queryByDisplayValue('9.000')).toBeNull();
  const reason = screen.getByLabelText(t('en', 'sessionTips.reason')) as HTMLInputElement;
  expect(reason.value).toBe('because');
  expect(reason.disabled).toBe(true);
  const choice = screen.getByRole('combobox', { name: t('en', 'sessionTips.membership') });
  expect((choice as HTMLSelectElement).value).toBe(member);
  expect((choice as HTMLSelectElement).disabled).toBe(true);
  expect(screen.getByText(t('en', 'sessionTips.outcomeUnknown'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'sessionTips.save') })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.retrySame') }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(3));
  expect(keyOf(2)).toBe(keyOf(1));
  const replay = api.put.mock.calls[2]?.[1].body as RecordSessionTipsInput;
  expect(replay).toEqual(api.put.mock.calls[1]?.[1].body);
  expect(replay.expected_revision).toBe(2);
  expect(replay.recorder_membership_id).toBe(member);
});

it('keeps a newer revision when a replay returns the original save', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  installReads(tipped(2, '1.000'));
  api.put.mockResolvedValueOnce(
    refused(400, 'SESSION_RECORDER_MEMBERSHIP_REQUIRED', {
      recorder_membership_ids: [id(30), member],
    }),
  );
  api.put.mockRejectedValueOnce(new Error('offline'));
  renderTips(client);
  await loseTheSave();
  client.setQueryData(sessionTipsKey(scope, id(12)), tipped(3, '9.000'));
  installReads(tipped(3, '9.000'));
  api.put.mockResolvedValueOnce(ok(tipped(2, '4.000')));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.retrySame') }));
  await waitFor(() => expect(cashBox().value).toBe('9.000'));
  expect(client.getQueryData<SessionTips>(sessionTipsKey(scope, id(12)))?.revision).toBe(3);
  expect(screen.queryByDisplayValue('4.000')).toBeNull();
});

it('does not show a performer added after an unresolved tip was retained', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const visit = (performers: TipSourceLine['performers']) => (
    <QueryClientProvider client={client}>
      <SessionTipsLauncher
        scope={scope}
        sessionId={id(12)}
        lines={[{ status: 'ACTIVE', net: '8.000', performers }]}
        online
        onAccessDenied={() => undefined}
      />
    </QueryClientProvider>
  );
  installReads(tipped(2, '1.000'));
  api.put.mockResolvedValueOnce(
    refused(400, 'SESSION_RECORDER_MEMBERSHIP_REQUIRED', {
      recorder_membership_ids: [id(30), member],
    }),
  );
  api.put.mockRejectedValueOnce(new Error('offline'));
  const view = render(visit(lines[0]?.performers ?? []));
  await loseTheSave();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.close') }));
  await waitFor(() => expect(screen.queryByLabelText(t('en', 'sessionTips.total'))).toBeNull());
  const ada = lines[0]?.performers[0];
  if (!ada) throw new Error('missing performer');
  view.rerender(
    visit([
      { ...ada, share_bps: 5000 },
      { employee_id: id(7), share_bps: 5000, name_ar: null, name_en: 'Bea' },
    ]),
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  const cash = (await screen.findByLabelText(
    `${'Ada'} ${t('en', 'sessionTips.cashAmount')}`,
  )) as HTMLInputElement;
  expect(cash.value).toBe('4.000');
  expect(screen.queryByLabelText(`${'Bea'} ${t('en', 'sessionTips.cashAmount')}`)).toBeNull();
});

it('ignores the cached tip set until the read for this opening finishes', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(sessionTipsKey(scope, id(12)), tipped(1, '1.000'));
  let release: (value: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  api.get.mockImplementation((path: string) =>
    path === sessionTipsPath ? pending : Promise.resolve(refused(404, 'SESSION_NOT_FOUND')),
  );
  api.put.mockResolvedValue(ok(tipped(3, '2.500')));
  renderTips(client);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  expect(await screen.findByText(t('en', 'admin.loading'))).toBeTruthy();
  expect(screen.queryByDisplayValue('1.000')).toBeNull();
  await act(async () => {
    release(ok(tipped(2, '2.500')));
  });
  expect(await screen.findByDisplayValue('2.500')).toBeTruthy();
  expect(screen.queryByDisplayValue('1.000')).toBeNull();
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.reason')), {
    target: { value: 'fresh' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
  const body = api.put.mock.calls[0]?.[1].body as RecordSessionTipsInput;
  expect(body.expected_revision).toBe(2);
  expect(body.tips[0]?.amount).toBe('2.500');
});
