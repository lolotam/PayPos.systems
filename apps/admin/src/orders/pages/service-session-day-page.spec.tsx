import type { ReactNode } from 'react';
import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { formatInstant, t } from '@pospay/i18n';
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
function line(n: number, status: Line['status'], revision: number, edited: boolean, late = false): Line {
  return { id: id(n), service_id: id(5), ordinal: 1, name_en: `Service ${n}`, name_ar: null, status, revision, edited, late,
    list_price: '10.000', price: '10.000', discount: '1.000', net: '9.000', effective_discount_bps: 1000, recorded_by: id(4),
    recorded_at: instant, has_performer_warning: false, performers: [{ ...performer, name_en: `Nada ${n}` }] };
}
const visit = { id: id(12), business_id: scope.businessId, branch_id: scope.branchId, customer: { id: id(7), name: 'Synthetic customer' },
  occurred_at: instant, recorded_at: instant, business_date: '2026-10-13', business_timezone: 'Asia/Kuwait', recorded_by: scope.userId, late: false,
  lines: [line(20, 'ACTIVE', 3, false), line(21, 'ACTIVE', 2, true), line(22, 'CANCELLED', 1, false)] };
const edit = { revision: 2, previous: { price: '10.000', discount: '1.000', net: '9.000' }, new: { price: '8.000', discount: '0.000', net: '8.000' },
  changed_at: instant, editor_label_ar: 'Label AR', editor_label_en: 'Label EN', reason: 'Wrong price' };
const day = { data: { items: [visit], next_cursor: null }, response: { status: 200 } };
const historyPage = { data: { items: [edit], next_cursor: null }, response: { status: 200 } };
function denial(status: number, message: string, code = 'FORBIDDEN') {
  return { error: { code, message_ar: 'Denied AR', message_en: message }, response: { status } };
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...render(<ServiceSessionDayPage scope={scope} timezone="Asia/Kuwait" />, { wrapper }) };
}

it('marks a line only when edited is true, hides edit on a cancelled line, and shows history in the locale', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset();
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits') ? { data: { items: [edit], next_cursor: null }, response: { status: 200 } } : day));
  renderPage();
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  expect(screen.getAllByText(t('en', 'serviceLineEdit.edited'))).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.history') })).toHaveLength(1);
  expect(screen.getByText('Nada 21')).toBeTruthy();
  expect(screen.getByText(formatInstant(new Date(instant), 'en', 'Asia/Kuwait'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.history') }));
  expect(await screen.findByText('Label EN', { exact: false })).toBeTruthy();
  expect(screen.getByText('Wrong price')).toBeTruthy();
});

it('retries a failed history read and pauses the list while offline', async () => {
  state.online = true; state.locale = 'en'; let fail = true; state.get.mockReset();
  state.get.mockImplementation((path: string) => {
    if (!String(path).includes('/edits')) return Promise.resolve(day);
    return Promise.resolve(fail ? { error: { code: 'X', message_ar: 'Hist AR', message_en: 'Hist EN' }, response: { status: 503 } } : { data: { items: [edit], next_cursor: null }, response: { status: 200 } });
  });
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.history') }));
  expect(await screen.findByRole('button', { name: t('en', 'serviceLineEdit.retry') })).toBeTruthy();
  fail = false; fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.retry') }));
  expect(await screen.findByText('Wrong price')).toBeTruthy();
  view.unmount(); state.online = false; state.get.mockClear(); renderPage();
  expect(screen.getByText(t('en', 'serviceSessions.offline'))).toBeTruthy();
  expect(state.get).not.toHaveBeenCalled();
});

it('keeps the other line draft when an earlier save settles', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset(); state.patch.mockReset();
  state.get.mockResolvedValue(day);
  let settle: (value: { data: { saved: true; edited: true }; response: { status: 200 } }) => void = () => undefined;
  state.patch.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
  renderPage();
  await screen.findByText('Synthetic customer');
  const edit = t('en', 'serviceLineEdit.edit');
  const buttons = screen.getAllByRole('button', { name: edit });
  const first = buttons[0];
  const second = buttons[1];
  if (!first || !second) throw new Error('missing edit buttons');
  fireEvent.click(first);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'from a' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  fireEvent.click(second);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'from b' } });
  await act(async () => { settle({ data: { saved: true, edited: true }, response: { status: 200 } }); });
  expect(await screen.findByText(t('en', 'serviceLineEdit.saved'))).toBeTruthy();
  expect((screen.getByLabelText(t('en', 'serviceLineEdit.reason')) as HTMLInputElement).value).toBe('from b');
});

it('keeps a reopened line draft when its earlier save settles', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset(); state.patch.mockReset();
  state.get.mockResolvedValue(day);
  let settle: (value: { data: { saved: true; edited: true }; response: { status: 200 } }) => void = () => undefined;
  state.patch.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
  renderPage();
  await screen.findByText('Synthetic customer');
  const editName = t('en', 'serviceLineEdit.edit');
  const first = screen.getAllByRole('button', { name: editName })[0];
  if (!first) throw new Error('missing edit button');
  fireEvent.click(first);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'from a' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.close') }));
  const reopened = screen.getAllByRole('button', { name: editName })[0];
  if (!reopened) throw new Error('missing edit button');
  fireEvent.click(reopened);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'reopened' } });
  await act(async () => { settle({ data: { saved: true, edited: true }, response: { status: 200 } }); });
  expect(await screen.findByText(t('en', 'serviceLineEdit.saved'))).toBeTruthy();
  expect((screen.getByLabelText(t('en', 'serviceLineEdit.reason')) as HTMLInputElement).value).toBe('reopened');
});

it('closes the open form when the same edit button is clicked during a pending save', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset(); state.patch.mockReset();
  state.get.mockResolvedValue(day);
  let settle: (value: { data: { saved: true; edited: true }; response: { status: 200 } }) => void = () => undefined;
  state.patch.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
  renderPage();
  await screen.findByText('Synthetic customer');
  const editName = t('en', 'serviceLineEdit.edit');
  const first = screen.getAllByRole('button', { name: editName })[0];
  if (!first) throw new Error('missing edit button');
  fireEvent.click(first);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'from a' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  const again = screen.getAllByRole('button', { name: editName })[0];
  if (!again) throw new Error('missing edit button');
  fireEvent.click(again);
  expect((screen.getByLabelText(t('en', 'serviceLineEdit.reason')) as HTMLInputElement).value).toBe('from a');
  await act(async () => { settle({ data: { saved: true, edited: true }, response: { status: 200 } }); });
  expect(await screen.findByText(t('en', 'serviceLineEdit.saved'))).toBeTruthy();
  expect(screen.queryByLabelText(t('en', 'serviceLineEdit.reason'))).toBeNull();
});

it('sends the revision from the stale refetch on the next save', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset(); state.patch.mockReset();
  const freshVisit = { ...visit, lines: visit.lines.map((item) => item.id === id(20) ? { ...item, revision: 5, price: '13.000', discount: '0.000', net: '13.000' } : item) };
  let phase: 'open' | 'fresh' = 'open';
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits')
    ? { data: { items: [edit], next_cursor: null }, response: { status: 200 } }
    : phase === 'open' ? day : { data: { items: [freshVisit], next_cursor: null }, response: { status: 200 } }));
  let patches = 0;
  state.patch.mockImplementation(() => {
    patches += 1; phase = 'fresh';
    return Promise.resolve(patches === 1
      ? { error: { code: 'SESSION_LINE_REVISION_STALE', message_ar: 'AR', message_en: 'EN' }, response: { status: 409 } }
      : { data: { saved: true, edited: true }, response: { status: 200 } });
  });
  renderPage();
  await screen.findByText('Synthetic customer');
  const editName = t('en', 'serviceLineEdit.edit');
  const first = screen.getAllByRole('button', { name: editName })[0];
  if (!first) throw new Error('missing edit button');
  fireEvent.click(first);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'because' } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.price')), { target: { value: '12.000' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
  await waitFor(() => expect(screen.getByText(t('en', 'serviceLineEdit.current'), { exact: false }).textContent).toContain('13.000'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
  const body = (index: number) => state.patch.mock.calls[index]?.[1].body as { expected_revision: number };
  expect(body(0).expected_revision).toBe(3);
  expect(body(1).expected_revision).toBe(5);
});

it('hides the loaded day when a refetch returns 403', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset();
  let gate: 'ok' | 'denied' = 'ok';
  const listed = { data: { items: [visit], next_cursor: 'more' }, response: { status: 200 } };
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits') ? historyPage : gate === 'ok' ? listed : denial(403, 'Denied EN')));
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  expect(screen.getByRole('button', { name: t('en', 'serviceLineEdit.loadMore') })).toBeTruthy();
  const editName = t('en', 'serviceLineEdit.edit');
  const first = screen.getAllByRole('button', { name: editName })[0];
  if (!first) throw new Error('missing edit button');
  fireEvent.click(first);
  expect(screen.getByLabelText(t('en', 'serviceLineEdit.reason'))).toBeTruthy();
  gate = 'denied';
  await act(async () => { await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] }); });
  await waitFor(() => expect(screen.queryByText('Synthetic customer')).toBeNull());
  for (const text of ['Service 20', 'Nada 20', '10.000', '1.000', '9.000']) expect(screen.queryByText(text)).toBeNull();
  expect(screen.queryByLabelText(t('en', 'serviceLineEdit.reason'))).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.loadMore') })).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Denied EN');
  gate = 'ok';
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.retry') }));
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  expect(screen.queryByLabelText(t('en', 'serviceLineEdit.reason'))).toBeNull();
});

it('hides an open history panel when a refetch returns 403', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset();
  let dayGate: 'ok' | 'denied' = 'ok';
  let historyGate: 'ok' | 'denied' = 'ok';
  const openHistory = { data: { items: [edit], next_cursor: 'more' }, response: { status: 200 } };
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits')
    ? historyGate === 'ok' ? openHistory : denial(403, 'History denied EN', 'FEATURE_DISABLED')
    : dayGate === 'ok' ? day : denial(403, 'Denied EN')));
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.history') }));
  expect(await screen.findByText('Wrong price')).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'serviceLineEdit.more') })).toBeTruthy();
  historyGate = 'denied';
  await act(async () => { await view.client.refetchQueries({ queryKey: ['service-line-edits'] }); });
  await waitFor(() => expect(screen.queryByText('Wrong price')).toBeNull());
  expect(screen.queryByText('8.000')).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.more') })).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('History denied EN');
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
  dayGate = 'denied';
  await act(async () => { await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] }); });
  await waitFor(() => expect(screen.queryByText('Synthetic customer')).toBeNull());
  for (const text of ['Wrong price', '10.000', 'Service 21', 'Nada 21']) expect(screen.queryByText(text)).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Denied EN');
  dayGate = 'ok';
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.retry') }));
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  expect(screen.queryByText('Wrong price')).toBeNull();
  expect(screen.queryByText('History denied EN')).toBeNull();
});

it('keeps the visits visible when a refetch returns 500', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset();
  let failed = false;
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits') ? historyPage
    : failed ? { error: { code: 'INTERNAL', message_ar: 'Down AR', message_en: 'Down EN' }, response: { status: 500 } } : day));
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  failed = true;
  await act(async () => { await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] }); });
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Down EN'));
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
  expect(screen.getAllByText('10.000').length).toBeGreaterThan(0);
});

it('hides the loaded day when a refetch returns FEATURE_DISABLED', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset();
  let denied = false;
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits') ? historyPage
    : denied ? denial(409, 'Disabled EN', 'FEATURE_DISABLED') : day));
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  denied = true;
  await act(async () => { await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] }); });
  await waitFor(() => expect(screen.queryByText('Synthetic customer')).toBeNull());
  expect(screen.queryByText('10.000')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Disabled EN');
});

it('keeps the day hidden when a retry after 403 fails with 500', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset();
  let phase: 'ok' | 'denied' | 'down' = 'ok';
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits') ? historyPage
    : phase === 'ok' ? day
    : phase === 'denied' ? denial(403, 'Denied EN')
    : { error: { code: 'INTERNAL', message_ar: 'Down AR', message_en: 'Down EN' }, response: { status: 500 } }));
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  phase = 'denied';
  await act(async () => { await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] }); });
  await waitFor(() => expect(screen.queryByText('Synthetic customer')).toBeNull());
  phase = 'down';
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.retry') }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Down EN'));
  expect(screen.queryByText('Synthetic customer')).toBeNull();
  for (const text of ['10.000', '1.000', '9.000']) expect(screen.queryByText(text)).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.edit') })).toBeNull();
  phase = 'ok';
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.retry') }));
  expect(await screen.findByText('Synthetic customer')).toBeTruthy();
  expect(screen.getAllByText('10.000').length).toBeGreaterThan(0);
  expect(screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') }).length).toBeGreaterThan(0);
});

it('keeps history edits hidden when a retry after 403 fails with 500', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset();
  let phase: 'ok' | 'denied' | 'down' = 'ok';
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits')
    ? phase === 'ok' ? historyPage : phase === 'denied' ? denial(403, 'History denied EN') : { error: { code: 'INTERNAL', message_ar: 'Down AR', message_en: 'Hist down EN' }, response: { status: 500 } }
    : day));
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.history') }));
  expect(await screen.findByText('Wrong price')).toBeTruthy();
  phase = 'denied';
  await act(async () => { await view.client.refetchQueries({ queryKey: ['service-line-edits'] }); });
  await waitFor(() => expect(screen.queryByText('Wrong price')).toBeNull());
  phase = 'down';
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.retry') }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Hist down EN'));
  expect(screen.queryByText('Wrong price')).toBeNull();
  expect(screen.queryByText('8.000')).toBeNull();
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
});

it('hides the loaded day when a refetch returns 401', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset();
  let gate: 'ok' | 'expired' = 'ok';
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits') ? historyPage
    : gate === 'ok' ? day : denial(401, 'Signed out EN', 'UNAUTHENTICATED')));
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  const editName = t('en', 'serviceLineEdit.edit');
  const first = screen.getAllByRole('button', { name: editName })[0];
  if (!first) throw new Error('missing edit button');
  fireEvent.click(first);
  expect(screen.getByLabelText(t('en', 'serviceLineEdit.reason'))).toBeTruthy();
  gate = 'expired';
  await act(async () => { await view.client.refetchQueries({ queryKey: ['branch-day-sessions'] }); });
  await waitFor(() => expect(screen.queryByText('Synthetic customer')).toBeNull());
  for (const text of ['10.000', '1.000', '9.000', 'Service 20', 'Nada 20']) expect(screen.queryByText(text)).toBeNull();
  expect(screen.queryByLabelText(t('en', 'serviceLineEdit.reason'))).toBeNull();
  expect(screen.queryByRole('button', { name: editName })).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Signed out EN');
});

it('hides an open history panel when a refetch returns 401', async () => {
  state.online = true; state.locale = 'en'; state.get.mockReset();
  let historyGate: 'ok' | 'expired' = 'ok';
  state.get.mockImplementation((path: string) => Promise.resolve(String(path).includes('/edits')
    ? historyGate === 'ok' ? historyPage : denial(401, 'History signed out EN', 'UNAUTHENTICATED')
    : day));
  const view = renderPage();
  await screen.findByText('Synthetic customer');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.history') }));
  expect(await screen.findByText('Wrong price')).toBeTruthy();
  historyGate = 'expired';
  await act(async () => { await view.client.refetchQueries({ queryKey: ['service-line-edits'] }); });
  await waitFor(() => expect(screen.queryByText('Wrong price')).toBeNull());
  expect(screen.queryByText('8.000')).toBeNull();
  expect(screen.queryByText('Label EN')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('History signed out EN');
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
  expect(screen.getAllByText('10.000').length).toBeGreaterThan(0);
});

it('uses the locale direction on the day list', async () => {
  state.online = true; state.locale = 'ar'; state.get.mockReset();
  state.get.mockResolvedValue({ data: { items: [], next_cursor: null }, response: { status: 200 } });
  const view = renderPage();
  expect(view.container.querySelector('section')?.getAttribute('dir')).toBe('rtl');
  expect(await screen.findByRole('heading', { name: t('ar', 'serviceLineEdit.title') })).toBeTruthy();
  state.locale = 'en';
});
