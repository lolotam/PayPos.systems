import type { ReactNode } from 'react';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { id, instant, scope } from '../model/session-recording-result.fixture';
import { ServiceSessionDayPage } from './service-session-day-page';

const state = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), online: true as boolean | null, locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, PATCH: state.patch }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../model/use-browser-connectivity', () => ({ useBrowserConnectivity: () => state.online }));
type Line = DayPage['items'][number]['lines'][number];
const performer = { employee_id: id(6), name_en: 'Nada', name_ar: null, share_bps: 10000, not_clocked_in_warning: false, approved_leave_warning: false };
function line(n: number, status: Line['status'], revision: number, edited: boolean): Line {
  return { id: id(n), service_id: id(5), ordinal: 1, name_en: `Service ${n}`, name_ar: null, status, revision, edited, late: false,
    list_price: '10.000', price: '10.000', discount: '1.000', net: '9.000', effective_discount_bps: 1000, recorded_by: id(4),
    recorded_at: instant, has_performer_warning: false, performers: [{ ...performer, name_en: `Nada ${n}` }] };
}
const visit = { id: id(12), business_id: scope.businessId, branch_id: scope.branchId, customer: { id: id(7), name: 'Synthetic customer' },
  occurred_at: instant, recorded_at: instant, business_date: '2026-10-13', business_timezone: 'Asia/Kuwait', recorded_by: scope.userId, late: false,
  lines: [line(20, 'ACTIVE', 3, false), line(21, 'ACTIVE', 2, true), line(22, 'CANCELLED', 1, false)] };
const edit = { revision: 2, previous: { price: '10.000', discount: '1.000', net: '9.000' }, new: { price: '8.000', discount: '0.000', net: '8.000' },
  changed_at: instant, editor_label_ar: 'Label AR', editor_label_en: 'Label EN', reason: 'Wrong price' };
const listed = { data: { items: [visit], next_cursor: 'more' }, response: { status: 200 } };
const openHistory = { data: { items: [edit], next_cursor: 'more' }, response: { status: 200 } };
const serverDown = { error: { code: 'INTERNAL', message_ar: 'Down AR', message_en: 'Down EN' }, response: { status: 500 } };
function denial(status: number, message: string, code = 'FORBIDDEN') {
  return { error: { code, message_ar: 'Denied AR', message_en: message }, response: { status } };
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...render(<ServiceSessionDayPage scope={scope} timezone="Asia/Kuwait" />, { wrapper }) };
}
function reads(edits: boolean) {
  return state.get.mock.calls.filter((call) => String(call[0]).includes('/edits') === edits).length;
}
function prepare() {
  state.online = true; state.locale = 'en'; state.get.mockReset(); state.patch.mockReset();
}
function clickEdit() {
  const button = screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') })[0];
  if (!button) throw new Error('missing edit button');
  fireEvent.click(button);
}
const hidden = ['Synthetic customer', 'Service 20', 'Nada 20', '10.000', '1.000', '9.000', 'Wrong price', '8.000', 'Cached day', 'Late customer'];
function expectGone(message: string) {
  for (const text of hidden) expect(screen.queryByText(text)).toBeNull();
  expect(screen.queryByText('Label EN', { exact: false })).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.edit') })).toBeNull();
  expect(screen.queryByLabelText(t('en', 'serviceLineEdit.reason'))).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.loadMore') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.more') })).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain(message);
  expect(screen.getByRole('button', { name: t('en', 'serviceLineEdit.retry') })).toBeTruthy();
  expect(screen.getByLabelText(t('en', 'serviceLineEdit.date'))).toBeTruthy();
}
async function shown() {
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  clickEdit();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.history') }));
  expect(await screen.findByText('Wrong price')).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'serviceLineEdit.loadMore') })).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'serviceLineEdit.more') })).toBeTruthy();
  return view;
}
it.each([
  [403, 'FORBIDDEN', 'Denied EN'],
  [401, 'UNAUTHENTICATED', 'Signed out EN'],
  [409, 'FEATURE_DISABLED', 'Disabled EN'],
] as const)('hides every visit when a day refetch returns %s %s', async (status, code, message) => {
  prepare();
  let denied = false;
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits') ? openHistory : denied ? denial(status, message, code) : listed));
  const view = await shown();
  denied = true;
  await act(async () => { await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] }); });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(message));
  expectGone(message);
});
it.each([
  [401, 'UNAUTHENTICATED', 'History signed out EN'],
  [409, 'FEATURE_DISABLED', 'History disabled EN'],
] as const)('hides every visit when the open history panel returns %s %s', async (status, code, message) => {
  prepare();
  let historyDenied = false;
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits')
    ? historyDenied ? denial(status, message, code) : openHistory : listed));
  const view = await shown();
  historyDenied = true;
  await act(async () => { await view.client.refetchQueries({ queryKey: ['service-line-edits'] }); });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(message));
  expectGone(message);
});
it.each([
  [401, 'UNAUTHENTICATED', 'Signed out EN'],
  [403, 'FEATURE_DISABLED', 'Disabled EN'],
] as const)('hides every visit when the edit patch returns %s %s', async (status, code, message) => {
  prepare();
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits') ? openHistory : listed));
  state.patch.mockResolvedValue(denial(status, message, code));
  await shown();
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'because' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(message));
  expectGone(message);
});
it('shows only the denial error when Retry then fails with 500', async () => {
  prepare();
  let phase: 'ok' | 'denied' | 'down' = 'ok';
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits') ? openHistory
    : phase === 'ok' ? listed : phase === 'denied' ? denial(403, 'Denied EN') : serverDown));
  const view = await shown();
  phase = 'denied';
  await act(async () => { await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] }); });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Denied EN'));
  phase = 'down';
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.retry') }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Down EN'));
  expect(screen.getByRole('alert').textContent ?? '').not.toContain('Denied EN');
  expect(screen.queryByText(t('en', 'serviceLineEdit.empty'))).toBeNull();
  expectGone('Down EN');
});
it('does not fetch again when the page re-renders after a denial', async () => {
  prepare();
  let denied = false;
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits') ? openHistory : denied ? denial(403, 'Denied EN') : listed));
  const view = await shown();
  denied = true;
  await act(async () => { await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] }); });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Denied EN'));
  const dayReads = reads(false);
  const editReads = reads(true);
  view.rerender(<ServiceSessionDayPage scope={{ ...scope }} timezone="Asia/Riyadh" />);
  state.online = false;
  view.rerender(<ServiceSessionDayPage scope={{ ...scope }} timezone="Asia/Riyadh" />);
  state.online = true;
  await act(async () => { view.rerender(<ServiceSessionDayPage scope={{ ...scope }} timezone="Asia/Kuwait" />); });
  expect(reads(false)).toBe(dayReads);
  expect(reads(true)).toBe(editReads);
  expectGone('Denied EN');
});
it('shows no cached names when the date or late filter changes while denied', async () => {
  prepare();
  let denied = false;
  const cachedVisit = { ...visit, id: id(13), customer: { ...visit.customer, name: 'Cached day' } };
  const cached = { data: { items: [cachedVisit], next_cursor: null }, response: { status: 200 } };
  state.get.mockImplementation((path: string, init?: { params?: { query?: { date?: string } } }) => {
    if (String(path).includes('/edits')) return Promise.resolve(openHistory);
    if (init?.params?.query?.date === '2026-11-02') return Promise.resolve(cached);
    return Promise.resolve(denied ? denial(403, 'Denied EN') : listed);
  });
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  const dateBox = () => screen.getByLabelText(t('en', 'serviceLineEdit.date')) as HTMLInputElement;
  const today = dateBox().value;
  expect(today).not.toBe('2026-11-02');
  fireEvent.change(dateBox(), { target: { value: '2026-11-02' } });
  expect(await screen.findByText('Cached day')).toBeTruthy();
  fireEvent.change(dateBox(), { target: { value: today } });
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  denied = true;
  await act(async () => { await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] }); });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Denied EN'));
  const before = reads(false);
  fireEvent.change(dateBox(), { target: { value: '2026-11-02' } });
  fireEvent.click(screen.getByRole('checkbox', { name: t('en', 'serviceLineEdit.lateOnly') }));
  expect(dateBox().value).toBe('2026-11-02');
  expect((screen.getByRole('checkbox', { name: t('en', 'serviceLineEdit.lateOnly') }) as HTMLInputElement).checked).toBe(true);
  expect(reads(false)).toBe(before);
  expectGone('Denied EN');
});
it('does not rebuild the day query when a pending edit answers 409 stale after a denial removed it', async () => {
  prepare();
  let denied = false;
  let answerPatch: (value: unknown) => void = () => undefined;
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits') ? openHistory : denied ? denial(403, 'Denied EN') : listed));
  state.patch.mockImplementation(() => new Promise((resolve) => { answerPatch = resolve; }));
  const view = await shown();
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'because' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  denied = true;
  await act(async () => { await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] }); });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Denied EN'));
  const dayReads = reads(false);
  await act(async () => {
    answerPatch({ error: { code: 'SESSION_LINE_REVISION_STALE', message_ar: 'Stale AR', message_en: 'Stale EN', details: { current_revision: 4 } }, response: { status: 409 } });
    await Promise.resolve();
  });
  expect(reads(false)).toBe(dayReads);
  expectGone('Denied EN');
});
it('ignores a late day refetch success after a denial until Retry', async () => {
  prepare();
  let releaseLate: (value: unknown) => void = () => undefined;
  let dayPhase: 'ok' | 'held' | 'fresh' = 'ok';
  let historyDenied = false;
  const named = (name: string) => ({ ...visit, customer: { ...visit.customer, name } });
  state.get.mockImplementation((path: string) => {
    if (String(path).includes('/edits')) return Promise.resolve(historyDenied ? denial(401, 'History signed out EN', 'UNAUTHENTICATED') : openHistory);
    if (dayPhase === 'held') return new Promise((resolve) => { releaseLate = resolve; });
    if (dayPhase === 'fresh') return Promise.resolve({ data: { items: [named('Fresh customer')], next_cursor: null }, response: { status: 200 } });
    return Promise.resolve(listed);
  });
  const view = await shown();
  const before = reads(false);
  dayPhase = 'held';
  const pending = view.client.refetchQueries({ queryKey: ['branch-day-sessions'] });
  const guarded = pending.catch(() => undefined);
  await waitFor(() => expect(reads(false)).toBe(before + 1));
  historyDenied = true;
  await act(async () => { await view.client.refetchQueries({ queryKey: ['service-line-edits'] }); });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('History signed out EN'));
  await act(async () => {
    releaseLate({ data: { items: [named('Late customer')], next_cursor: null }, response: { status: 200 } });
    await guarded;
  });
  expect(screen.queryByText('Fresh customer')).toBeNull();
  expectGone('History signed out EN');
  dayPhase = 'fresh';
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.retry') }));
  expect(await screen.findByText('Fresh customer')).toBeTruthy();
  expect(screen.queryByText('Late customer')).toBeNull();
  expect(screen.queryByText('History signed out EN')).toBeNull();
  expect(screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') }).length).toBeGreaterThan(0);
});
