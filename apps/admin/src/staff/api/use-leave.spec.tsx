import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { leaveDecisionRecord, leaveId as id } from './leave-decision.fixture';
import { historyLeaveRow, historyPage, openPage } from './leave-history.fixture';
import { EmployeeLeaveSection } from '../ui/employee-leave-section';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const prefix = ['leave', id, id, id, id];
const applied = {
  from: '2026-01-01',
  to: '2026-10-24',
  'types[]': [],
  'statuses[]': [],
  limit: 20,
};
const props = {
  companyId: id,
  businessId: id,
  userId: id,
  employeeId: id,
  branches: [
    {
      id,
      name_en: 'Synthetic branch',
      name_ar: null,
      is_active: true,
      effective_timezone: 'Asia/Kuwait',
    },
  ],
  timeZone: 'Asia/Kuwait',
};
let client: QueryClient;

function seedCache() {
  client.setQueryData(
    [...prefix, 'history', applied, undefined],
    historyPage({
      items: [historyLeaveRow({ note: 'Synthetic cached history' })],
    }),
  );
  client.setQueryData(
    [...prefix, 'open', undefined, undefined],
    openPage({
      items: [{ ...leaveDecisionRecord, decision_reason: 'Synthetic cached open' }],
    }),
  );
}
function renderSection() {
  seedCache();
  return render(
    <QueryClientProvider client={client}>
      <EmployeeLeaveSection {...props} />
    </QueryClientProvider>,
  );
}
function failure(status: number) {
  return {
    error: { code: 'NOT_FOUND', message_en: 'Synthetic denial', message_ar: 'Synthetic denial' },
    response: { status },
  };
}
function expectFreshLoading() {
  expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  expect(screen.queryByText('Synthetic cached history')).toBeNull();
  expect(screen.queryByText('Synthetic cached open')).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each([403, 404])(
  'hides cached history on a history-only %s and evicts everything on an open denial and on close',
  async (status) => {
    let denyHistory!: (value: unknown) => void;
    let denyOpen!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      denyHistory = resolve;
    });
    const openPending = new Promise((resolve) => {
      denyOpen = resolve;
    });
    api.GET.mockImplementation(async (path: string) =>
      path.endsWith('/leave-history') ? pending : openPending,
    );
    const view = renderSection();
    expectFreshLoading();
    await act(async () => {
      denyHistory(failure(status));
      denyOpen(failure(status));
    });
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: prefix })).toEqual([]));
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    view.unmount();

    client.clear();
    let denyOnlyHistory!: (value: unknown) => void;
    let allowOpen!: (value: unknown) => void;
    const historyPending = new Promise((resolve) => {
      denyOnlyHistory = resolve;
    });
    const allowedOpen = new Promise((resolve) => {
      allowOpen = resolve;
    });
    api.GET.mockImplementation(async (path: string) =>
      path.endsWith('/leave-history') ? historyPending : allowedOpen,
    );
    const second = renderSection();
    expectFreshLoading();
    await act(async () => {
      denyOnlyHistory(failure(status));
      allowOpen({
        data: openPage({
          items: [{ ...leaveDecisionRecord, decision_reason: 'Synthetic allowed open' }],
        }),
      });
    });
    await screen.findByText('Synthetic allowed open');
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.queryByText('Synthetic cached history')).toBeNull();
    second.unmount();
    expect(client.getQueryCache().findAll({ queryKey: prefix })).toEqual([]);
  },
);

it('a reader without create authority sees history but no on-behalf form', async () => {
  api.GET.mockImplementation(async (path: string) =>
    path.endsWith('/leave-history')
      ? {
          data: historyPage({
            items: [historyLeaveRow({ note: 'Synthetic readable history' })],
            request_branch_ids: [],
          }),
        }
      : {
          data: openPage({
            items: [{ ...leaveDecisionRecord, decision_reason: 'Synthetic readable open' }],
            request_branch_ids: [],
          }),
        },
  );
  render(
    <QueryClientProvider client={client}>
      <EmployeeLeaveSection {...props} />
    </QueryClientProvider>,
  );
  await screen.findByText('Synthetic readable history');
  expect(await screen.findByText('Synthetic readable open')).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'leave.submit') })).toBeNull();
});
