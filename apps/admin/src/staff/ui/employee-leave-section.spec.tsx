import { formatDate, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { leaveDecisionRecord, leaveId } from '../api/leave-decision.fixture';
import {
  absenceRow,
  coveredRow,
  historyLeaveRow,
  historyPage,
  openPage,
} from '../api/leave-history.fixture';
import { EmployeeLeaveSection } from './employee-leave-section';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

type GetOptions = { params: { query: Record<string, unknown> } };
type GetResult =
  | { data: unknown }
  | {
      error: { code: string; message_en: string; message_ar: string };
      response: { status: number };
    };
type GetHandler = (query: Record<string, unknown>) => GetResult | Promise<GetResult>;
const secondId = '01920000-0000-7000-8000-000000000a02';
const thirdId = '01920000-0000-7000-8000-000000000a03';
const props = {
  companyId: leaveId,
  businessId: leaveId,
  userId: leaveId,
  employeeId: leaveId,
  branches: [
    {
      id: leaveId,
      name_en: 'Synthetic branch',
      name_ar: null,
      is_active: true,
      effective_timezone: 'Asia/Kuwait',
    },
  ],
  timeZone: 'Asia/Kuwait',
};
let client: QueryClient;

function routeGets(handlers: { history?: GetHandler; open?: GetHandler } = {}) {
  const history = handlers.history ?? (() => ({ data: historyPage() }));
  const open = handlers.open ?? (() => ({ data: openPage() }));
  api.GET.mockImplementation(async (path: string, options: GetOptions) => {
    if (path.endsWith('/leave-history')) return history(options.params.query);
    if (path.endsWith('/leave-requests')) return open(options.params.query);
    throw new Error(`Unexpected GET ${path}`);
  });
}
function queries(pathEnd: string) {
  return api.GET.mock.calls
    .filter((call) => (call[0] as string).endsWith(pathEnd))
    .map((call) => (call[1] as GetOptions).params.query);
}
function renderSection() {
  return render(
    <QueryClientProvider client={client}>
      <EmployeeLeaveSection {...props} />
    </QueryClientProvider>,
  );
}
function openRegion() {
  return screen.getByRole('region', { name: t(state.locale, 'leaveHistory.openTitle') });
}
function historyRegion() {
  return screen.getByRole('region', { name: t(state.locale, 'leaveHistory.historyTitle') });
}
function upcoming() {
  return { ...leaveDecisionRecord, id: secondId, decision_reason: 'Synthetic upcoming annual' };
}
function pending() {
  return {
    ...leaveDecisionRecord,
    id: thirdId,
    decision_reason: 'Synthetic pending request',
    status: 'PENDING' as const,
  };
}
function past() {
  return historyLeaveRow({
    id: thirdId,
    type: 'SICK',
    note: 'Synthetic past sick',
    can_revoke: false,
  });
}
function partitionReads() {
  routeGets({
    history: () => ({ data: historyPage({ items: [past()] }) }),
    open: () => ({ data: openPage({ items: [upcoming(), pending()] }) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
  state.locale = 'en';
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  routeGets();
  api.POST.mockResolvedValue({ data: leaveDecisionRecord });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('opens on 1 January to today in the zone', async () => {
  renderSection();
  await screen.findByRole('button', { name: t('en', 'leave.submit') });
  expect(within(historyRegion()).getByLabelText(t('en', 'leave.from'))).toHaveProperty(
    'value',
    '2026-01-01',
  );
  expect(within(historyRegion()).getByLabelText(t('en', 'leave.to'))).toHaveProperty(
    'value',
    '2026-10-24',
  );
});

it("uses the zone's local day near midnight", async () => {
  vi.setSystemTime(new Date('2026-12-31T22:30:00Z'));
  renderSection();
  await screen.findByRole('button', { name: t('en', 'leave.submit') });
  expect(within(historyRegion()).getByLabelText(t('en', 'leave.from'))).toHaveProperty(
    'value',
    '2027-01-01',
  );
  expect(within(historyRegion()).getByLabelText(t('en', 'leave.to'))).toHaveProperty(
    'value',
    '2027-01-01',
  );
});

it('shows upcoming and pending requests in the top part and not in the history', async () => {
  partitionReads();
  renderSection();
  await screen.findByText('Synthetic past sick');
  await screen.findByText('Synthetic upcoming annual');
  await screen.findByText('Synthetic pending request');
  expect(within(openRegion()).getByText('Synthetic upcoming annual')).toBeTruthy();
  expect(within(openRegion()).getByText('Synthetic pending request')).toBeTruthy();
  expect(within(historyRegion()).getByText('Synthetic past sick')).toBeTruthy();
  expect(within(historyRegion()).queryByText('Synthetic upcoming annual')).toBeNull();
  expect(within(historyRegion()).queryByText('Synthetic pending request')).toBeNull();
  expect(within(openRegion()).queryByText('Synthetic past sick')).toBeNull();
});

it('shows each request once', async () => {
  partitionReads();
  renderSection();
  await screen.findByText('Synthetic past sick');
  await screen.findByText('Synthetic upcoming annual');
  await screen.findByText('Synthetic pending request');
  for (const note of [
    'Synthetic upcoming annual',
    'Synthetic pending request',
    'Synthetic past sick',
  ]) {
    expect(screen.getAllByText(note)).toHaveLength(1);
  }
});

it('sends open=true with the history boundary to the open list', async () => {
  partitionReads();
  renderSection();
  await screen.findByText('Synthetic upcoming annual');
  expect(within(historyRegion()).getByText('Synthetic past sick')).toBeTruthy();
  expect(queries('/leave-requests').at(-1)).toMatchObject({
    open: 'true',
    as_of: '2026-10-24T09:00:00.000Z',
  });
});

it('the open list waits for the history', async () => {
  let resolve!: (value: GetResult) => void;
  const pendingHistory = new Promise<GetResult>((done) => {
    resolve = done;
  });
  routeGets({ history: () => pendingHistory });
  renderSection();
  expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  expect(queries('/leave-requests')).toHaveLength(0);
  await act(async () => {
    resolve({ data: historyPage({ items: [past()] }) });
  });
  await screen.findByText('Synthetic past sick');
  await waitFor(() => expect(queries('/leave-requests')).toHaveLength(1));
});

it('last-taken line shows the latest of each type and none', async () => {
  routeGets({
    history: () => ({
      data: historyPage({
        last_taken: {
          annual: { from: '2026-10-20', to: '2026-10-20' },
          sick: { from: '2026-10-14', to: '2026-10-15' },
          unpaid: null,
          unexcused_absence: '2026-10-12',
        },
      }),
    }),
  });
  renderSection();
  const annual = await screen.findByText(t('en', 'leaveHistory.lastAnnual'), { exact: false });
  const line = annual.closest('p');
  const date = formatDate(new Date('2026-10-20T12:00Z'), {
    locale: 'en',
    calendar: 'gregorian',
    timeZone: 'UTC',
  });
  expect(line?.textContent).toContain(`${t('en', 'leaveHistory.lastAnnual')}: ${date}`);
  expect(line?.textContent).toContain(t('en', 'leaveHistory.lastSick'));
  expect(line?.textContent).toContain(
    `${t('en', 'leaveHistory.lastUnpaid')}: ${t('en', 'leaveHistory.none')}`,
  );
  expect(line?.textContent).toContain(t('en', 'leaveHistory.lastAbsence'));
});

it('hides the absence item and options for a caller without absence scope', async () => {
  routeGets({
    history: () => ({
      data: historyPage({
        absence_branch_ids: [],
        last_taken: {
          annual: null,
          sick: null,
          unpaid: null,
          unexcused_absence: null,
        },
      }),
    }),
  });
  const view = renderSection();
  await screen.findByText(t('en', 'leaveHistory.lastAnnual'), { exact: false });
  expect(screen.queryByText(t('en', 'leaveHistory.lastAbsence'), { exact: false })).toBeNull();
  expect(
    within(historyRegion()).queryByRole('option', { name: t('en', 'leaveHistory.absenceType') }),
  ).toBeNull();
  expect(
    within(historyRegion()).queryByRole('option', { name: t('en', 'leaveHistory.absentStatus') }),
  ).toBeNull();
  view.unmount();
  client.clear();
  routeGets({
    history: () => ({
      data: historyPage({
        last_taken: {
          annual: null,
          sick: null,
          unpaid: null,
          unexcused_absence: null,
        },
      }),
    }),
  });
  renderSection();
  await screen.findByRole('option', { name: t('en', 'leaveHistory.absenceType') });
  expect(screen.getByText(t('en', 'leaveHistory.lastAbsence'), { exact: false })).toBeTruthy();
  expect(screen.getByRole('option', { name: t('en', 'leaveHistory.absentStatus') })).toBeTruthy();
});

it('shows the absence row with its shifts and no action', async () => {
  routeGets({
    history: () => ({
      data: historyPage({
        items: [
          absenceRow({
            shifts: [
              { start: '09:00', end: '13:00' },
              { start: '17:00', end: '21:00' },
            ],
          }),
        ],
      }),
    }),
  });
  renderSection();
  const row = (await screen.findByText('09:00–13:00')).closest('tr');
  if (!row) throw new Error('Missing absence row');
  expect(within(row).getByText(t('en', 'leaveHistory.absentStatus'))).toBeTruthy();
  expect(within(row).getByText('09:00–13:00')).toBeTruthy();
  expect(within(row).getByText('17:00–21:00')).toBeTruthy();
  expect(within(row).queryByRole('button')).toBeNull();
});

it('shows the covered-elsewhere row with the date and shift only', async () => {
  routeGets({ history: () => ({ data: historyPage({ items: [coveredRow()] }) }) });
  renderSection();
  const row = (await screen.findByText(t('en', 'leaveHistory.coveredElsewhere'))).closest('tr');
  if (!row) throw new Error('Missing covered row');
  expect(within(row).getByText('14:00–18:00')).toBeTruthy();
  expect(row.textContent).toContain('2026');
  expect(within(row).queryByRole('button')).toBeNull();
  expect(row.textContent).not.toContain('Synthetic branch');
});

it('keeps the cancel, decide and revoke actions in both parts', async () => {
  const flags = { can_cancel: true, can_decide: true, can_revoke: true };
  routeGets({
    history: () => ({
      data: historyPage({ items: [historyLeaveRow({ ...flags, note: 'Synthetic past action' })] }),
    }),
    open: () => ({
      data: openPage({
        items: [{ ...leaveDecisionRecord, ...flags, decision_reason: 'Synthetic open action' }],
      }),
    }),
  });
  renderSection();
  await screen.findByText('Synthetic past action');
  await screen.findByText('Synthetic open action');
  for (const region of [openRegion(), historyRegion()]) {
    for (const key of ['leave.cancel', 'leave.approve', 'leave.reject', 'leave.revoke'] as const) {
      expect(within(region).getByRole('button', { name: t('en', key) })).toBeTruthy();
    }
  }
  expect(screen.getByRole('button', { name: t('en', 'leave.submit') })).toBeTruthy();
});

it('a cancel in the history refetches both parts', async () => {
  routeGets({
    history: () => ({
      data: historyPage({ items: [historyLeaveRow({ can_cancel: true, can_revoke: false })] }),
    }),
    open: () => ({ data: openPage({ items: [upcoming()] }) }),
  });
  renderSection();
  await screen.findByText('Synthetic upcoming annual');
  const before = [queries('/leave-history').length, queries('/leave-requests').length];
  fireEvent.click(within(historyRegion()).getByRole('button', { name: t('en', 'leave.cancel') }));
  await screen.findByText(t('en', 'leave.cancelled'));
  await waitFor(() => {
    expect(queries('/leave-history').length).toBeGreaterThan(before[0] ?? 0);
    expect(queries('/leave-requests').length).toBeGreaterThan(before[1] ?? 0);
  });
});

it('renders Arabic headings', async () => {
  state.locale = 'ar';
  renderSection();
  expect(
    await screen.findByRole('heading', { name: t('ar', 'leaveHistory.openTitle') }),
  ).toBeTruthy();
  expect(screen.getByRole('heading', { name: t('ar', 'leaveHistory.historyTitle') })).toBeTruthy();
});

it('falls back to the server clock when the history refetch fails and keeps the open list', async () => {
  let denyHistory = false;
  routeGets({
    history: () => {
      if (denyHistory) {
        return {
          error: {
            code: 'NOT_FOUND',
            message_en: 'Synthetic failure',
            message_ar: 'Synthetic failure',
          },
          response: { status: 404 },
        };
      }
      return { data: historyPage({ items: [past()] }) };
    },
    open: () => ({ data: openPage({ items: [upcoming()] }) }),
  });
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
  renderSection();
  await screen.findByText('Synthetic upcoming annual');
  expect(queries('/leave-requests').at(-1)).toHaveProperty('as_of');
  denyHistory = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
  expect(await within(historyRegion()).findByRole('alert')).toBeTruthy();
  await waitFor(() => {
    expect(queries('/leave-requests').at(-1)).toMatchObject({ open: 'true' });
    expect(queries('/leave-requests').at(-1)).not.toHaveProperty('as_of');
  });
  expect(within(openRegion()).getByText('Synthetic upcoming annual')).toBeTruthy();
});
