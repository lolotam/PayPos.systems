import type { SavedServiceLine, SessionTips } from '@pospay/contracts';
import { moneyToString, parseMoney, performerNetWeights, suggestTipSplit } from '@pospay/domain';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { sessionTipsPath } from '../api/use-session-tips';
import {
  id,
  initial,
  recordAttempt,
  response,
  savedLine,
  scope,
} from '../model/session-recording-result.fixture';
import {
  transitionSessionRecordingResult as transition,
  type SessionRecordingResult,
} from '../model/session-recording-result';
import { SessionSavedResult } from './session-saved-result';

const api = vi.hoisted(() => ({ patch: vi.fn(), get: vi.fn(), put: vi.fn() }));
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ PATCH: api.patch, GET: api.get, PUT: api.put }),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const emptyTips: SessionTips = { revision: 0, tips: [], total_cash: '0.000', total_card: '0.000' };

function person(employee: number, name: string, performerId: number) {
  const base = savedLine.performers[0];
  if (!base) throw new Error('missing performer');
  return {
    ...base,
    id: id(performerId),
    employee_id: id(employee),
    share_bps: 10000,
    name_en: name,
    performer_ordinal: 1,
  };
}
function line(lineId: number, net: string, employee: number, name: string): SavedServiceLine {
  return {
    ...savedLine,
    id: id(lineId),
    ordinal: lineId,
    net,
    price: net,
    discount: '0.000',
    name_en: name,
    performers: [person(employee, name, lineId + 40)],
  };
}
const ada = line(11, '6.000', 6, 'Ada');
const bea = line(14, '2.000', 7, 'Bea');

function suggested(nets: readonly string[], employee: number) {
  const weights = performerNetWeights(
    nets.map((net, index) => ({
      status: 'ACTIVE' as const,
      net: parseMoney(net),
      performers: [{ employee_id: id(index === 0 ? 6 : 7), share_bps: 10000 }],
    })),
  );
  const amount = suggestTipSplit(parseMoney('8.000'), weights).find(
    (row) => row.employee_id === id(employee),
  )?.amount;
  if (amount === undefined) throw new Error('missing suggestion');
  return moneyToString(amount);
}
function visit(): SessionRecordingResult {
  return transition(initial, {
    type: 'RECORDED',
    attempt: recordAttempt,
    response: {
      outcome: 'COMPLETE',
      session: { ...response.session, total_net: '8.000', lines: [ada, bea] },
      rejected_lines: [],
    },
  });
}
function renderVisit() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SessionSavedResult
        result={visit()}
        journal={{ leaveVisit: vi.fn() }}
        onNewVisit={vi.fn()}
        scope={scope}
        online
      />
    </QueryClientProvider>,
  );
}
function editFirstLine() {
  const edit = screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') })[0];
  if (!edit) throw new Error('missing edit');
  fireEvent.click(edit);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.price')), {
    target: { value: '2.000' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.discountAmount')), {
    target: { value: '0.000' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), {
    target: { value: 'because' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
}
function cash(name: string) {
  return screen.getByLabelText(`${name} ${t('en', 'sessionTips.cashAmount')}`) as HTMLInputElement;
}
async function openTips() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  await screen.findByLabelText(t('en', 'sessionTips.total'));
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function hide(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  api.patch.mockReset();
  api.put.mockReset();
  api.get.mockReset();
  api.get.mockImplementation((path: string) =>
    Promise.resolve(
      path === sessionTipsPath
        ? { data: emptyTips, response: { status: 200 } }
        : {
            error: { code: 'SESSION_NOT_FOUND', message_ar: 'x', message_en: 'x' },
            response: { status: 404 },
          },
    ),
  );
});

it('uses the edited line net for the tip suggestion', async () => {
  const edited = {
    ...ada,
    price: '2.000',
    discount: '0.000',
    net: '2.000',
    revision: 2,
    edited: true as const,
  };
  api.patch.mockResolvedValue({
    data: { line: edited, session: { id: id(12), total_net: '4.000' } },
    response: { status: 200 },
  });
  renderVisit();
  editFirstLine();
  expect(await screen.findByText(t('en', 'serviceLineEdit.edited'))).toBeTruthy();
  await openTips();
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.total')), {
    target: { value: '8.000' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.useSuggestion') }));
  expect(cash('Ada').value).toBe(suggested(['2.000', '2.000'], 6));
  expect(cash('Ada').value).not.toBe(suggested(['6.000', '2.000'], 6));
  expect(cash('Bea').value).toBe(suggested(['2.000', '2.000'], 7));
});

it('hides the suggestion and the visit warning when edited figures are unknown', async () => {
  api.patch.mockResolvedValue({ data: { saved: true, edited: true }, response: { status: 200 } });
  api.put.mockResolvedValue({ data: emptyTips, response: { status: 200 } });
  renderVisit();
  editFirstLine();
  expect(await screen.findByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeTruthy();
  await openTips();
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.total')), {
    target: { value: '8.000' },
  });
  const apply = screen.getByRole('button', { name: t('en', 'sessionTips.useSuggestion') });
  expect((apply as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('list', { name: t('en', 'sessionTips.suggestion') }).textContent).toBe(
    '',
  );
  fireEvent.change(cash('Ada'), { target: { value: '9.000' } });
  expect(screen.queryByText(t('en', 'sessionTips.exceedsVisit'))).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
  expect(api.put.mock.calls[0]?.[1].body.tips[0].amount).toBe('9.000');
});
