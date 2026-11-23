import { Profiler, type ReactNode } from 'react';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { id, instant, scope } from '../model/session-recording-result.fixture';
import { ServiceSessionDayPage } from './service-session-day-page';

const state = vi.hoisted(() => ({ get: vi.fn(), online: true as boolean | null }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, PATCH: vi.fn() }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' as const }));
vi.mock('../model/use-browser-connectivity', () => ({ useBrowserConnectivity: () => state.online }));

type Line = DayPage['items'][number]['lines'][number];
const line: Line = {
  id: id(20), service_id: id(5), ordinal: 1, name_en: 'Service 20', name_ar: null, status: 'ACTIVE',
  revision: 1, edited: false, late: false, list_price: '10.000', price: '10.000', discount: '1.000',
  net: '9.000', effective_discount_bps: 1000, recorded_by: id(4), recorded_at: instant,
  has_performer_warning: false,
  performers: [{ employee_id: id(6), name_en: 'Nada', name_ar: null, share_bps: 10000, not_clocked_in_warning: false, approved_leave_warning: false }],
};
const visit = {
  id: id(12), business_id: scope.businessId, branch_id: scope.branchId, customer: { id: id(7), name: 'Synthetic customer' },
  occurred_at: instant, recorded_at: instant, business_date: '2026-10-13', business_timezone: 'Asia/Kuwait',
  recorded_by: scope.userId, late: false, lines: [line],
};
const page = (nextCursor: string | null) => ({ data: { items: [visit], next_cursor: nextCursor }, response: { status: 200 } });

function renderPage(onCommit?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const page = <ServiceSessionDayPage scope={scope} timezone="Asia/Kuwait" />;
  return { client, ...render(onCommit ? <Profiler id="day" onRender={onCommit}>{page}</Profiler> : page, { wrapper }) };
}

beforeEach(() => {
  state.online = true;
  state.get.mockReset();
});

it('holds the filter bar, the visits and the load-more action in one card, in that order', async () => {
  state.get.mockResolvedValue(page('more'));
  renderPage();
  const customer = await screen.findByText('Synthetic customer');
  const date = screen.getByLabelText('Date');
  const more = screen.getByRole('button', { name: 'Load more' });
  const card = date.closest('.rounded-card') as HTMLElement;
  expect(card.contains(customer)).toBe(true);
  expect(card.contains(more)).toBe(true);
  expect(date.compareDocumentPosition(customer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(customer.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const heading = screen.getByRole('heading', { level: 1, name: 'Day list' });
  expect(heading.closest('[data-page-shell="list"]')?.contains(card)).toBe(true);
});

it('shows no load-more action on the last page', async () => {
  state.get.mockResolvedValue(page(null));
  renderPage();
  await screen.findByText('Synthetic customer');
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});

it('keeps the filter bar in the card when access is refused and the retry action beside the message', async () => {
  state.get.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Denied AR', message_en: 'Denied EN' },
    response: { status: 403 },
  });
  renderPage();
  const alert = await screen.findByRole('alert');
  const card = alert.closest('.rounded-card') as HTMLElement;
  expect(within(card).getByLabelText('Date')).toBeTruthy();
  expect(within(card).getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(screen.queryByText('Synthetic customer')).toBeNull();
});

it('keeps the same date input, and keyboard focus on it, when a later read is refused', async () => {
  state.get.mockResolvedValue(page(null));
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  const date = screen.getByLabelText('Date');
  date.focus();
  state.get.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Denied AR', message_en: 'Denied EN' },
    response: { status: 403 },
  });
  await act(async () => {
    await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] });
  });
  expect((await screen.findByRole('alert')).textContent).toContain('Denied EN');
  expect(screen.getByLabelText('Date')).toBe(date);
  expect(document.activeElement).toBe(date);
});

// الـProfiler يستدعي بعد كل commit والـDOM محدَّث، فنفحص كل رندر مُلتزَم به لا الحالة النهائية فقط.
it('never commits a render that shows Load more beside a refused or emptied list', async () => {
  const first = page('more');
  state.get.mockResolvedValue(first);
  const stale: string[] = [];
  let refused = false;
  renderPage(() => {
    if (!refused) return;
    const more = screen.queryByRole('button', { name: 'Load more' });
    const listGone = screen.queryByText('Synthetic customer') === null;
    if (more && (listGone || screen.queryByRole('alert'))) stale.push(document.body.textContent ?? '');
  });
  await screen.findByText('Synthetic customer');
  state.get.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Denied AR', message_en: 'Denied EN' },
    response: { status: 403 },
  });
  refused = true;
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Denied EN');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull());
  expect(stale).toEqual([]);
});

const dayReads = () => state.get.mock.calls.filter(([path]) => !String(path).includes('/capabilities')).length;

it('makes no day request while a refused capability read keeps the screen closed, until Retry succeeds', async () => {
  const allowed = { data: { can_cancel_lines: true, can_change_performers: false, can_record_sessions: false }, response: { status: 200 } };
  const refused = { error: { code: 'FORBIDDEN', message_ar: 'Denied AR', message_en: 'Denied EN' }, response: { status: 403 } };
  let capability: unknown = allowed;
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/capabilities') ? capability : page(null)));
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  capability = refused;
  await act(async () => { await view.client.refetchQueries({ queryKey: ['service-session-capabilities'] }); });
  expect((await screen.findByRole('alert')).textContent).toContain('Denied EN');
  await waitFor(() => expect(screen.queryByText('Synthetic customer')).toBeNull());
  const before = dayReads();
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-14' } });
  fireEvent.click(screen.getByLabelText('Late only'));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(dayReads()).toBe(before);
  capability = allowed;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  expect(dayReads()).toBeGreaterThan(before);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('never commits a visit row together with, or after, a refusal that arrives on a background refetch', async () => {
  state.get.mockResolvedValue(page(null));
  const violations: string[] = [];
  let refused = false;
  let sawAlert = false;
  const view = renderPage(() => {
    if (!refused) return;
    const alert = screen.queryByRole('alert') !== null;
    sawAlert = sawAlert || alert;
    const rows = screen.queryByText('Synthetic customer') !== null || screen.queryAllByText('9.000').length > 0;
    if (rows && (alert || sawAlert)) violations.push(document.body.textContent ?? '');
  });
  await screen.findByText('Synthetic customer');
  const reads = dayReads();
  state.get.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Denied AR', message_en: 'Denied EN' },
    response: { status: 403 },
  });
  refused = true;
  await act(async () => { await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] }); });
  expect((await screen.findByRole('alert')).textContent).toContain('Denied EN');
  expect(screen.queryByText('Synthetic customer')).toBeNull();
  expect(violations).toEqual([]);
  expect(dayReads() - reads).toBe(1);
});

it('sends one day request on first mount, so a single observer does not change the request count', async () => {
  state.get.mockResolvedValue(page(null));
  renderPage();
  await screen.findByText('Synthetic customer');
  expect(dayReads()).toBe(1);
});
