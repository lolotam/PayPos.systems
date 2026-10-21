import type { ReactNode } from 'react';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { sessionTipsPath } from '../api/use-session-tips';
import { id, instant, scope } from '../model/session-recording-result.fixture';
import { ServiceSessionDayPage } from './service-session-day-page';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  online: true as boolean | null,
  recording: 'ok' as 'ok' | 'down' | 'denied',
  tips: 'ok' as 'ok' | 'forbidden',
}));
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: state.get, PUT: state.put }),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('../model/use-browser-connectivity', () => ({
  useBrowserConnectivity: () => state.online,
}));

type Line = DayPage['items'][number]['lines'][number];
const performer = {
  employee_id: id(6),
  name_en: 'Nada 20',
  name_ar: null,
  share_bps: 10000,
  not_clocked_in_warning: false,
  approved_leave_warning: false,
};
function line(): Line {
  return {
    id: id(20),
    service_id: id(5),
    ordinal: 1,
    name_en: 'Service 20',
    name_ar: null,
    status: 'ACTIVE',
    revision: 1,
    edited: false,
    late: false,
    list_price: '10.000',
    price: '10.000',
    discount: '1.000',
    net: '9.000',
    effective_discount_bps: 1000,
    recorded_by: id(4),
    recorded_at: instant,
    has_performer_warning: false,
    performers: [performer],
  };
}
const day = {
  data: {
    items: [
      {
        id: id(12),
        business_id: scope.businessId,
        branch_id: scope.branchId,
        customer: { id: id(7), name: 'Synthetic customer' },
        occurred_at: instant,
        recorded_at: instant,
        business_date: '2026-10-13',
        business_timezone: 'Asia/Kuwait',
        recorded_by: scope.userId,
        late: false,
        lines: [line()],
      },
    ],
    next_cursor: null,
  },
  response: { status: 200 },
};
const emptyDay = { data: { items: [], next_cursor: null }, response: { status: 200 } };
const recorded = {
  data: {
    generated_at: instant,
    business_timezone: 'Asia/Kuwait',
    recorder_membership_ids: [id(8)],
    recorder_membership_id: id(8),
    discount_limit: { source: 'OWNER' as const, bps: null },
  },
  response: { status: 200 },
};
const emptyTips = { revision: 0, tips: [], total_cash: '0.000', total_card: '0.000' };
const forbidden = {
  error: { code: 'FORBIDDEN', message_ar: 'Forbidden AR', message_en: 'Forbidden EN' },
  response: { status: 403 },
};
const unavailable = {
  error: { code: 'INTERNAL_ERROR', message_ar: 'Error AR', message_en: 'Error EN' },
  response: { status: 500 },
};

function lateQuery(init: unknown): boolean {
  if (!init || typeof init !== 'object') return false;
  const query = (init as { params?: { query?: { late?: unknown } } }).params?.query;
  return query?.late === 'true';
}

function answer() {
  state.get.mockImplementation((path: string, init?: unknown) => {
    const name = String(path);
    // زرار البقشيش بيتبع can_record_sessions (PP-19)؛ «down» فشل إعادة جلب، و«denied» الصلاحية اتشالت.
    if (name.includes('/capabilities')) {
      if (state.recording === 'down') return Promise.resolve(unavailable);
      return Promise.resolve({
        data: {
          can_cancel_lines: false,
          can_change_performers: false,
          can_record_sessions: state.recording !== 'denied',
        },
        response: { status: 200 },
      });
    }
    if (name.includes('recording-context')) return Promise.resolve(recorded);
    if (name === sessionTipsPath) {
      if (state.tips === 'forbidden') return Promise.resolve(forbidden);
      return Promise.resolve({ data: emptyTips, response: { status: 200 } });
    }
    return Promise.resolve(lateQuery(init) ? emptyDay : day);
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    ...render(<ServiceSessionDayPage scope={scope} timezone="Asia/Kuwait" />, { wrapper }),
  };
}

const tipsButton = () => screen.queryByRole('button', { name: t('en', 'sessionTips.open') });
const cash = () => screen.getByLabelText(`Nada 20 ${t('en', 'sessionTips.cashAmount')}`);

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function hide(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  state.online = true;
  state.recording = 'ok';
  state.tips = 'ok';
  state.get.mockReset();
  state.put.mockReset();
  answer();
});

it('keeps the day list when reading tips is forbidden', async () => {
  state.tips = 'forbidden';
  renderPage();
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'sessionTips.open') }));
  expect((await screen.findByRole('status')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
  expect(tipsButton()).toBeNull();
  expect(screen.queryByLabelText(t('en', 'sessionTips.total'))).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps the day list when saving tips is forbidden', async () => {
  state.put.mockResolvedValue(forbidden);
  renderPage();
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'sessionTips.open') }));
  await screen.findByLabelText(t('en', 'sessionTips.total'));
  fireEvent.change(cash(), { target: { value: '1.000' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  expect((await screen.findByRole('status')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
  expect(tipsButton()).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps Record tip through a failed capability refetch and hides it once recording is withdrawn', async () => {
  const { client } = renderPage();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'sessionTips.open') }));
  expect(await screen.findByLabelText(t('en', 'sessionTips.total'))).toBeTruthy();
  state.recording = 'down';
  await act(async () => {
    await client.refetchQueries({ queryKey: ['service-session-capabilities'] });
  });
  expect(screen.getByLabelText(t('en', 'sessionTips.total'))).toBeTruthy();
  expect(tipsButton()).toBeTruthy();
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
  state.recording = 'denied';
  await act(async () => {
    await client.refetchQueries({ queryKey: ['service-session-capabilities'] });
  });
  await waitFor(() => expect(tipsButton()).toBeNull());
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('retries the same tip save after the day filter hides the visit', async () => {
  state.put.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
    data: { revision: 1, tips: [], total_cash: '4.000', total_card: '0.000' },
    response: { status: 200 },
  });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'sessionTips.open') }));
  await screen.findByLabelText(t('en', 'sessionTips.total'));
  fireEvent.change(cash(), { target: { value: '4.000' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  expect(await screen.findByText(t('en', 'sessionTips.outcomeUnknown'))).toBeTruthy();
  const firstKey = state.put.mock.calls[0]?.[1].params.header['Idempotency-Key'];
  const firstBody = state.put.mock.calls[0]?.[1].body;
  fireEvent.click(screen.getByRole('checkbox', { name: t('en', 'serviceLineEdit.lateOnly') }));
  expect(await screen.findByText(t('en', 'serviceLineEdit.empty'))).toBeTruthy();
  expect(screen.queryByText('Synthetic customer')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: t('en', 'serviceLineEdit.lateOnly') }));
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'sessionTips.open') }));
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'sessionTips.retrySame') }));
  await waitFor(() => expect(state.put).toHaveBeenCalledTimes(2));
  expect(state.put.mock.calls[1]?.[1].params.header['Idempotency-Key']).toBe(firstKey);
  expect(state.put.mock.calls[1]?.[1].body).toEqual(firstBody);
});
