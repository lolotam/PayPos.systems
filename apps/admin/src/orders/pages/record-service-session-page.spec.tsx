import { formatInstant, t } from '@pospay/i18n';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SESSION_ATTEMPT_RETENTION_MS, SESSION_ATTEMPT_SAFETY_MARGIN_MS } from '../model/session-attempt';
import { createSessionAttemptJournal } from '../model/session-attempt-journal';
import { sessionLocalTime } from '../model/session-local-time';
import { id, inputLine, instant, response, scope } from '../model/session-recording-result.fixture';
import type { SessionServiceScope } from '../api/use-session-services';
import { RecordServiceSessionPage } from './record-service-session-page';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const service = { id: id(5), name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 1 };
const performer = { id: id(6), name_ar: null, name_en: 'Synthetic performer', employee_number: null, not_clocked_in_warning: false, approved_leave_warning: false };
const context = {
  generated_at: instant, business_timezone: 'Asia/Kuwait', recorder_membership_ids: [id(8)],
  recorder_membership_id: id(8), discount_limit: { source: 'PERSON' as const, bps: 1000 },
};
const savedCustomer = { id: id(7), name: 'Synthetic customer', locale: 'en' as const, opted_out: false, phone: '***001' };
const visitAt = '2026-10-12T21:30:00.000Z';
const copyKeys = ['serviceSessions.save', 'serviceSessions.title', 'serviceSessions.offline'] as const;

function installReads() {
  state.get.mockImplementation((path: string) => Promise.resolve({ data: String(path).endsWith('/recording-context') ? context
    : { items: String(path).endsWith('/performer-options') ? [performer] : [service], next_cursor: null } }));
}
function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}
function renderPage(user: SessionServiceScope = scope, client?: QueryClient) {
  const owner = client ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const ui = (next: SessionServiceScope = user) => (
    <QueryClientProvider client={owner}><RecordServiceSessionPage key={next.userId} scope={next} /></QueryClientProvider>
  );
  return { ...render(ui()), ui };
}
function price() { return screen.getByLabelText(t('en', 'serviceSessions.price')) as HTMLInputElement; }
async function chooseService() {
  await waitFor(() => expect(screen.getAllByLabelText(t('en', 'serviceSessions.service')).some((node) => node.querySelector(`option[value="${id(5)}"]`))).toBe(true));
  const select = screen.getAllByLabelText(t('en', 'serviceSessions.service')).find((node) => node.querySelector(`option[value="${id(5)}"]`));
  if (!(select instanceof HTMLSelectElement)) throw new Error('Missing service');
  fireEvent.change(select, { target: { value: id(5) } });
}
async function choosePerformer() {
  const label = t('en', 'serviceSessions.performerNumber').replace('{n}', '1');
  await screen.findByRole('option', { name: 'Synthetic performer' });
  fireEvent.change(screen.getByLabelText(label), { target: { value: id(6) } });
}
function contextReads() {
  return state.get.mock.calls.filter((call) => String(call[0]).endsWith('/recording-context')).length;
}
async function fillVisit() {
  await screen.findByLabelText(t('en', 'serviceSessions.name'));
  for (const [key, value] of [['name', 'Synthetic customer'], ['callingCode', '999'], ['phone', '00000001']] as const) {
    fireEvent.change(screen.getByLabelText(t('en', `serviceSessions.${key}`)), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.findOrCreate') }));
  expect(await screen.findByText('***001')).toBeTruthy();
  await chooseService();
  await choosePerformer();
  await waitFor(() => expect((screen.getByLabelText(t('en', 'serviceSessions.recorderMembership')) as HTMLSelectElement).value).toBe(id(8)));
}
function recordKeys() {
  return state.post.mock.calls.flatMap((call) => String(call[0]).endsWith('/service-sessions')
    ? [(call[1] as { params: { header: Record<string, string> } }).params.header['Idempotency-Key']] : []);
}
beforeEach(() => { state.locale = 'en'; setOnline(true); });
afterEach(() => {
  const cleaner = createSessionAttemptJournal(scope, { now: () => Date.now(), newId: () => id(90) });
  cleaner.changeScope(null);
  cleaner.dispose();
  sessionStorage.clear();
  state.get.mockReset();
  state.post.mockReset();
  Reflect.deleteProperty(navigator, 'onLine');
  // TanStack بيسمع حدث الاتصال بس وهو عنده مشتركين؛ اختبار انتهى أوفلاين ممكن يسيبه فاكر إنه مقطوع للاختبار اللي بعده.
  onlineManager.setOnline(true);
});

it('shows a permission refusal in both locales and hides the editor', async () => {
  state.get.mockResolvedValue({ error: { message_ar: 'Refusal AR', message_en: 'Refusal EN' }, response: { status: 403 } });
  const view = renderPage();
  expect((await screen.findByRole('alert')).textContent).toBe('Refusal EN');
  expect(screen.getByRole('heading', { name: t('en', 'serviceSessions.title') })).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.save') })).toBeNull();
  state.locale = 'ar';
  view.rerender(view.ui());
  expect(screen.getByRole('alert').textContent).toBe('Refusal AR');
  expect(screen.getByRole('heading', { name: t('ar', 'serviceSessions.title') })).toBeTruthy();
});

it('does not resubmit an unresolved attempt when the connection returns', async () => {
  installReads();
  state.post.mockImplementation((path: string) => String(path).endsWith('/find-or-create')
    ? Promise.resolve({ data: savedCustomer }) : Promise.reject(new TypeError('Network loss')));
  const view = renderPage();
  await fillVisit();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.save') }));
  expect(await screen.findByText(t('en', 'serviceSessions.unresolved'))).toBeTruthy();
  const posts = state.post.mock.calls.length;
  setOnline(false);
  expect(await screen.findByText(t('en', 'serviceSessions.offline'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.retryOriginal') })).toBeNull();
  setOnline(true);
  await act(async () => { await Promise.resolve(); });
  expect(state.post.mock.calls.length).toBe(posts);
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.retryOriginal') })).toBeTruthy();
  view.unmount();
});

it('refetches the recording context once when an authority error asks for a new scope', async () => {
  installReads();
  state.post.mockImplementation((path: string) => String(path).endsWith('/find-or-create')
    ? Promise.resolve({ data: savedCustomer })
    : Promise.resolve({ error: { code: 'FORBIDDEN', message_ar: 'Refusal AR', message_en: 'Refusal EN' }, response: { status: 403 } }));
  renderPage();
  await fillVisit();
  const reads = contextReads();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.save') }));
  expect((await screen.findByRole('alert')).textContent).toBe('Refusal EN');
  await waitFor(() => expect(contextReads()).toBe(reads + 1));
  expect(contextReads()).toBe(reads + 1);
});

it('keeps an interrupted save unresolved and replays the same attempt while online', async () => {
  installReads();
  state.post.mockImplementation((path: string) => String(path).endsWith('/find-or-create')
    ? Promise.resolve({ data: savedCustomer }) : Promise.reject(new TypeError('Network loss')));
  renderPage();
  await screen.findByLabelText(t('en', 'serviceSessions.name'));
  for (const [key, value] of [['name', 'Synthetic customer'], ['callingCode', '999'], ['phone', '00000001']] as const) {
    fireEvent.change(screen.getByLabelText(t('en', `serviceSessions.${key}`)), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.findOrCreate') }));
  expect(await screen.findByText('***001')).toBeTruthy();
  await chooseService();
  await choosePerformer();
  await waitFor(() => expect((screen.getByLabelText(t('en', 'serviceSessions.recorderMembership')) as HTMLSelectElement).value).toBe(id(8)));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.save') }));
  expect(await screen.findByText(t('en', 'serviceSessions.unresolved'))).toBeTruthy();
  expect(navigator.onLine).toBe(true);
  state.post.mockImplementation((path: string) => String(path).endsWith('/find-or-create')
    ? Promise.resolve({ data: savedCustomer })
    : Promise.resolve({ data: { ...response, outcome: 'COMPLETE', rejected_lines: [] }, response: { status: 201 } }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.retryOriginal') }));
  await waitFor(() => expect(recordKeys()).toHaveLength(2));
  expect(recordKeys()[0]).toBe(recordKeys()[1]);
});

function recordBody(pathSuffix: string) {
  const call = state.post.mock.calls.find((entry) => String(entry[0]).endsWith(pathSuffix));
  return (call?.[1] as { body?: { occurred_at?: string } } | undefined)?.body;
}
function performerInstant() {
  const reads = state.get.mock.calls.filter((entry) => String(entry[0]).endsWith('/performer-options'));
  return (reads.at(-1)?.[1] as { params?: { query?: { occurred_at?: string } } } | undefined)?.params?.query?.occurred_at;
}

it('shows a recovered attempt when the context read fails and the form after it recovers', async () => {
  installReads();
  state.post.mockImplementation((path: string) => String(path).endsWith('/find-or-create')
    ? Promise.resolve({ data: savedCustomer }) : Promise.reject(new TypeError('Network loss')));
  const first = renderPage();
  await fillVisit();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.save') }));
  expect(await screen.findByText(t('en', 'serviceSessions.unresolved'))).toBeTruthy();
  first.unmount();
  state.get.mockImplementation((path: string) => String(path).endsWith('/recording-context')
    ? Promise.resolve({ error: { message_ar: 'Context AR', message_en: 'Context EN' }, response: { status: 500 } })
    : Promise.resolve({ data: { items: [], next_cursor: null } }));
  renderPage();
  expect(await screen.findByText(t('en', 'serviceSessions.unresolved'))).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.retryOriginal') })).toBeTruthy();
  expect(await screen.findByRole('button', { name: t('en', 'serviceSessions.retryContext') })).toBeTruthy();
  setOnline(false);
  await waitFor(() => expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.retryContext') })).toBeNull());
  setOnline(true);
  expect(await screen.findByRole('button', { name: t('en', 'serviceSessions.retryContext') })).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.save') })).toBeNull();
  const posts = state.post.mock.calls.length;
  installReads();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.retryContext') }));
  expect(await screen.findByRole('button', { name: t('en', 'serviceSessions.save') })).toBeTruthy();
  expect(state.post.mock.calls.length).toBe(posts);
});

it('shows only the forbidden message when an unresolved attempt meets a refused context', async () => {
  installReads();
  state.post.mockImplementation((path: string) => String(path).endsWith('/find-or-create')
    ? Promise.resolve({ data: savedCustomer }) : Promise.reject(new TypeError('Network loss')));
  const first = renderPage();
  await fillVisit();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.save') }));
  expect(await screen.findByText(t('en', 'serviceSessions.unresolved'))).toBeTruthy();
  first.unmount();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const refused = Object.assign(new Error('Refusal EN'), { message_ar: 'Refusal AR', message_en: 'Refusal EN', status: 403 });
  state.get.mockResolvedValue({ error: refused, response: { status: 403 } });
  renderPage(scope, client);
  expect(await screen.findByText(t('en', 'serviceSessions.unresolved'))).toBeTruthy();
  const query = client.getQueryCache().find({ queryKey: ['session-recording-context', scope.companyId, scope.businessId, scope.branchId, scope.userId, null] });
  if (!query) throw new Error('Missing context query');
  await act(async () => { query.setState({ status: 'error', fetchStatus: 'idle', error: refused, data: undefined }); });
  await waitFor(() => {
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual(['Refusal EN']);
    expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.retryOriginal') })).toBeNull();
    expect(screen.queryByText(t('en', 'serviceSessions.unresolved'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.retryContext') })).toBeNull();
  });
});

const retention = SESSION_ATTEMPT_RETENTION_MS + SESSION_ATTEMPT_SAFETY_MARGIN_MS;
const recoveryPage = { items: [], next_cursor: null, attempt: { business_date: '2026-10-13', business_timezone: 'Pacific/Auckland', issued_at: instant, expires_at: '2026-10-14T08:00:00.000Z' } };

async function seedExpired(sent: boolean) {
  let now = Date.parse(instant);
  const journal = createSessionAttemptJournal(scope, { now: () => now, newId: () => id(91) });
  const started = journal.begin({ kind: 'record', body: { customer_id: id(7), lines: [inputLine] } }, [id(9)]);
  if (sent) await expect(journal.run(started, () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
  now += retention;
  const entry = journal.read();
  journal.dispose();
  if (entry?.state !== 'EXPIRED' || (sent ? entry.lastSentAt === undefined : entry.lastSentAt !== undefined)) throw new Error('expected EXPIRED');
  return entry;
}
function recoveryButtons(locale: 'ar' | 'en') {
  const recorded = screen.getByRole('button', { name: t(locale, 'serviceSessions.recoveryRecorded') }) as HTMLButtonElement;
  const missed = screen.getByRole('button', { name: t(locale, 'serviceSessions.recoveryNotRecorded') }) as HTMLButtonElement;
  expect(recorded.disabled).toBe(false);
  expect(missed.disabled).toBe(false);
  return missed;
}
async function clearExpiredMarker(locale: 'ar' | 'en') {
  fireEvent.click(recoveryButtons(locale));
  await waitFor(() => expect(screen.queryByText(t(locale, 'serviceSessions.expired'))).toBeNull());
  const journal = createSessionAttemptJournal(scope, { now: () => Date.now(), newId: () => id(92) });
  expect(journal.read()).toBeNull();
  journal.dispose();
}

it.each(['ar', 'en'] as const)('keeps the recovery panel when an expired attempt meets a failed context in %s', async (locale) => {
  state.locale = locale;
  const entry = await seedExpired(true);
  state.get.mockImplementation((path: string) => String(path).endsWith('/recovery')
    ? Promise.resolve({ data: recoveryPage })
    : Promise.resolve({ error: { message_ar: 'Context AR', message_en: 'Context EN' }, response: { status: 500 } }));
  renderPage();
  expect(await screen.findByText(locale === 'ar' ? 'Context AR' : 'Context EN')).toBeTruthy();
  expect(await screen.findByText(t(locale, 'serviceSessions.recoveryAttemptAt').replace('{when}', formatInstant(new Date(entry.createdAt), locale, 'Pacific/Auckland')))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t(locale, 'serviceSessions.save') })).toBeNull();
  await clearExpiredMarker(locale);
});

it.each(['ar', 'en'] as const)('keeps both recovery buttons when an expired attempt meets a refused context in %s', async (locale) => {
  state.locale = locale;
  await seedExpired(true);
  const refused = Object.assign(new Error('Refusal EN'), { message_ar: 'Refusal AR', message_en: 'Refusal EN', status: 403 });
  state.get.mockResolvedValue({ error: refused, response: { status: 403 } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  renderPage(scope, client);
  expect(await screen.findByText(t(locale, 'serviceSessions.expired'))).toBeTruthy();
  const query = client.getQueryCache().find({ queryKey: ['session-recording-context', scope.companyId, scope.businessId, scope.branchId, scope.userId, null] });
  if (!query) throw new Error('Missing context query');
  await act(async () => { query.setState({ status: 'error', fetchStatus: 'idle', error: refused, data: undefined }); });
  expect(await screen.findByText(locale === 'ar' ? 'Refusal AR' : 'Refusal EN')).toBeTruthy();
  expect(screen.queryByRole('button', { name: t(locale, 'serviceSessions.save') })).toBeNull();
  expect(screen.queryByRole('button', { name: t(locale, 'serviceSessions.retryContext') })).toBeNull();
  await clearExpiredMarker(locale);
});

it.each(['ar', 'en'] as const)('shows never reached with both buttons when an expired attempt never left the browser in %s', async (locale) => {
  state.locale = locale;
  const entry = await seedExpired(false);
  setOnline(false);
  renderPage();
  expect(await screen.findByText(t(locale, 'serviceSessions.recoveryNeverReached'))).toBeTruthy();
  expect(screen.getByText(t(locale, 'serviceSessions.offline'))).toBeTruthy();
  expect(screen.getByText(t(locale, 'serviceSessions.recoveryAttemptAt').replace('{when}', formatInstant(new Date(entry.createdAt), locale, 'UTC')))).toBeTruthy();
  recoveryButtons(locale);
  expect(screen.queryByRole('button', { name: t(locale, 'serviceSessions.save') })).toBeNull();
  expect(state.get).not.toHaveBeenCalled();
});

it('shows a service choice error and does not record a priced line without a service', async () => {
  installReads();
  state.post.mockImplementation((path: string) => String(path).endsWith('/find-or-create')
    ? Promise.resolve({ data: savedCustomer }) : Promise.reject(new Error('unexpected record')));
  renderPage();
  await screen.findByLabelText(t('en', 'serviceSessions.name'));
  for (const [key, value] of [['name', 'Synthetic customer'], ['callingCode', '999'], ['phone', '00000001']] as const) {
    fireEvent.change(screen.getByLabelText(t('en', `serviceSessions.${key}`)), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.findOrCreate') }));
  expect(await screen.findByText('***001')).toBeTruthy();
  fireEvent.change(price(), { target: { value: '7.125' } });
  await choosePerformer();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.save') }));
  expect((await screen.findByRole('alert')).textContent).toBe(t('en', 'serviceSessions.chooseService'));
  expect(state.post.mock.calls.some((call) => String(call[0]).endsWith('/service-sessions'))).toBe(false);
});

it('uses the saved visit time for the display and a later append', async () => {
  installReads();
  const savedVisit = { ...response, outcome: 'COMPLETE' as const, rejected_lines: [], session: { ...response.session, occurred_at: visitAt } };
  state.post.mockImplementation((path: string) => {
    if (String(path).endsWith('/find-or-create')) return Promise.resolve({ data: savedCustomer });
    if (String(path).endsWith('/lines')) return Promise.resolve({ data: { ...savedVisit, added_lines: response.session.lines }, response: { status: 201 } });
    return Promise.resolve({ data: savedVisit, response: { status: 201 } });
  });
  renderPage();
  await fillVisit();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.save') }));
  expect(await screen.findByRole('button', { name: t('en', 'serviceSessions.correctAndAppend') })).toBeTruthy();
  expect(recordBody('/service-sessions')?.occurred_at).toBeUndefined();
  await waitFor(() => expect(performerInstant()).toBe(visitAt));
  await waitFor(() => expect((screen.getByLabelText(t('en', 'serviceSessions.occurredAt')) as HTMLInputElement).value).toBe(sessionLocalTime(visitAt, 'Asia/Kuwait').slice(0, 16)));
  await chooseService();
  await choosePerformer();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.correctAndAppend') }));
  await waitFor(() => expect(recordBody('/lines')).toBeTruthy());
  expect(recordBody('/lines')?.occurred_at).toBeUndefined();
  expect(performerInstant()).toBe(visitAt);
});

it('shows only the active locale for save, title and offline', async () => {
  for (const key of copyKeys) {
    expect(t('ar', key).length).toBeGreaterThan(0);
    expect(t('en', key).length).toBeGreaterThan(0);
    expect(t('ar', key)).not.toBe(t('en', key));
  }
  installReads();
  const view = renderPage();
  await screen.findByRole('button', { name: t('en', 'serviceSessions.save') });
  setOnline(false);
  expect((await screen.findByText(t('en', 'serviceSessions.offline'))).textContent).toBe(t('en', 'serviceSessions.offline'));
  for (const key of copyKeys) expect(document.body.textContent ?? '').not.toContain(t('ar', key));
  state.locale = 'ar';
  view.rerender(view.ui());
  expect(screen.getByRole('heading', { name: t('ar', 'serviceSessions.title') })).toBeTruthy();
  expect(screen.getByRole('button', { name: t('ar', 'serviceSessions.save') })).toBeTruthy();
  expect(screen.getByText(t('ar', 'serviceSessions.offline'))).toBeTruthy();
  for (const key of copyKeys) expect(document.body.textContent ?? '').not.toContain(t('en', key));
});

it('starts no read when the page opens while the browser is already offline', async () => {
  installReads();
  setOnline(false);
  renderPage();
  expect(await screen.findByText(t('en', 'serviceSessions.offline'))).toBeTruthy();
  await act(async () => { await Promise.resolve(); });
  expect(state.get).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.save') })).toBeNull();
});

it('drops the cached reads of its scope when it unmounts and keeps other scopes', async () => {
  installReads();
  const fresh = { ...scope, userId: id(77) };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } } });
  const other = ['session-services', 'other-company', fresh.businessId, fresh.branchId, fresh.userId, 'en', ''];
  client.setQueryData(other, { items: [], next_cursor: null });
  const view = renderPage(fresh, client);
  const own = () => client.getQueryCache().findAll({ predicate: ({ queryKey }) => queryKey[1] === fresh.companyId });
  await waitFor(() => expect(own().length).toBeGreaterThan(0));
  view.unmount();
  expect(own()).toHaveLength(0);
  expect(client.getQueryData(other)).toBeTruthy();
});

it('reads the scope again after a real reconnect and writes nothing', async () => {
  installReads();
  const fresh = { ...scope, userId: id(78) };
  renderPage(fresh, new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } } }));
  await screen.findByLabelText(t('en', 'serviceSessions.recorderMembership'));
  await waitFor(() => expect(contextReads()).toBeGreaterThan(0));
  const reads = contextReads();
  setOnline(false);
  expect(await screen.findByText(t('en', 'serviceSessions.offline'))).toBeTruthy();
  setOnline(true);
  await waitFor(() => expect(contextReads()).toBeGreaterThan(reads));
  expect(state.post).not.toHaveBeenCalled();
});
