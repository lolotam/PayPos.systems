import type { RecordSessionTipsInput, SessionTips } from '@pospay/contracts';
import { moneyToString, parseMoney, performerNetWeights, suggestTipSplit } from '@pospay/domain';
import { formatKwd, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { id, scope } from '../model/session-recording-result.fixture';
import type { TipSourceLine } from '../model/session-tip-source';
import { sessionTipsPath } from '../api/use-session-tips';
import { ServiceSessionDayList } from './service-session-day-list';
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
function emptyTips(revision = 0): SessionTips {
  return { revision, tips: [], total_cash: '0.000', total_card: '0.000' };
}
function tipped(revision: number, amount: string, employee = id(6)): SessionTips {
  return {
    revision,
    tips: [{ employee_id: employee, method: 'CASH', amount }],
    total_cash: amount,
    total_card: '0.000',
  };
}
function sharedSplit() {
  const source = lines[0];
  if (!source) throw new Error('missing visit');
  const weights = performerNetWeights([
    {
      status: source.status,
      net: parseMoney(source.net),
      performers: source.performers.map((person) => ({
        employee_id: person.employee_id,
        share_bps: person.share_bps,
      })),
    },
  ]);
  return suggestTipSplit(parseMoney(source.net), weights);
}
function bodyOf(index: number) {
  return api.put.mock.calls[index]?.[1].body as RecordSessionTipsInput;
}
function installRead(tips: SessionTips = emptyTips()) {
  api.get.mockImplementation((path: string) => {
    if (path === sessionTipsPath) return Promise.resolve(ok(tips));
    return Promise.resolve(refused(404, 'SESSION_NOT_FOUND'));
  });
}
function renderTips(online = true, visit: readonly TipSourceLine[] = lines) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionTipsLauncher
        scope={scope}
        sessionId={id(12)}
        lines={visit}
        online={online}
        onAccessDenied={() => undefined}
      />
    </QueryClientProvider>,
  );
}
async function openTips() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  await screen.findByLabelText(t('en', 'sessionTips.total'));
}
function cashBox(name: string) {
  return screen.getByLabelText(`${name} ${t('en', 'sessionTips.cashAmount')}`) as HTMLInputElement;
}
function saveTips() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
}
function applySuggestion(total = '8.000') {
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.total')), {
    target: { value: total },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.useSuggestion') }));
}
function assertMills(body: RecordSessionTipsInput) {
  expect(typeof body.expected_revision).toBe('number');
  expect(body.tips.every((tip) => typeof tip.amount === 'string')).toBe(true);
  expect(body.tips.every((tip) => /^\d+\.\d{3}$/.test(tip.amount))).toBe(true);
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

it('shows the shared suggestion, keeps a hand edit, and sends money strings', async () => {
  const suggestion = sharedSplit();
  const saved = ok({ revision: 1, tips: [], total_cash: '9.000', total_card: '0.000' });
  api.put.mockResolvedValue(saved);
  renderTips();
  expect(api.get).not.toHaveBeenCalled();
  await openTips();
  applySuggestion();
  const list = screen.getByRole('list', { name: t('en', 'sessionTips.suggestion') });
  for (const row of suggestion) expect(list.textContent).toContain(formatKwd(row.amount));
  expect(cashBox('Ada').value).toBe(moneyToString(suggestion[0]?.amount ?? 0n));
  fireEvent.change(cashBox('Ada'), { target: { value: '7.000' } });
  expect(list.textContent).toContain(formatKwd(suggestion[0]?.amount ?? 0n));
  expect(screen.getByRole('status').textContent).toContain(t('en', 'sessionTips.exceedsVisit'));
  expect(screen.queryByLabelText(t('en', 'sessionTips.reason'))).toBeNull();
  saveTips();
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
  const body = bodyOf(0);
  assertMills(body);
  expect(body.expected_revision).toBe(0);
  expect(body.reason).toBeUndefined();
  expect(body.tips.map((tip) => tip.amount)).toEqual([
    '7.000',
    moneyToString(suggestion[1]?.amount ?? 0n),
  ]);
  expect(await screen.findByText(t('en', 'sessionTips.saved'))).toBeTruthy();
});

it('requires a written reason only when a saved set is replaced', async () => {
  installRead(tipped(2, '1.000'));
  api.put.mockResolvedValue(ok(tipped(3, '4.000')));
  renderTips();
  await openTips();
  expect(cashBox('Ada').value).toBe('1.000');
  saveTips();
  await settle();
  expect(api.put).not.toHaveBeenCalled();
  expect(screen.getByText(t('en', 'sessionTips.reasonInvalid'))).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.reason')), {
    target: { value: ' \thello\r\n ' },
  });
  fireEvent.change(cashBox('Ada'), { target: { value: '4.000' } });
  saveTips();
  await waitFor(() => expect(bodyOf(0).reason).toBe('hello'));
  expect(bodyOf(0).expected_revision).toBe(2);
  assertMills(bodyOf(0));
});

it('does not read tips until the visit button opens the dialog', () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    <ServiceSessionDayList
      scope={scope}
      visits={[]}
      locale="en"
      online
      timezone="Asia/Kuwait"
      canCancel={false}
      loadError={null}
      empty
      hasNext={false}
      onRetry={() => undefined}
      onMore={() => undefined}
      refetchPages={async () => null}
      mounted={{ current: true }}
      onAccessDenied={() => undefined}
    />,
    { wrapper },
  );
  expect(screen.queryByRole('button', { name: t('en', 'sessionTips.open') })).toBeNull();
  expect(api.get).not.toHaveBeenCalled();
});
