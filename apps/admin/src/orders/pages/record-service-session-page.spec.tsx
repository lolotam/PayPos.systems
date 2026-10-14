import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionAttemptJournal } from '../model/session-attempt-journal';
import { sessionLocalTime } from '../model/session-local-time';
import { id, instant, response, scope } from '../model/session-recording-result.fixture';
import type { SessionServiceScope } from '../api/use-session-services';
import { RecordServiceSessionPage } from './record-service-session-page';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const service = { id: id(5), name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 1 };
const performer = { id: id(6), name_ar: null, name_en: 'Synthetic performer', not_clocked_in_warning: false, approved_leave_warning: false };
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
function renderPage(user: SessionServiceScope = scope) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const ui = (next: SessionServiceScope = user) => (
    <QueryClientProvider client={client}><RecordServiceSessionPage key={next.userId} scope={next} /></QueryClientProvider>
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
  expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.save') })).toBeNull();
  const posts = state.post.mock.calls.length;
  installReads();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.retryContext') }));
  expect(await screen.findByRole('button', { name: t('en', 'serviceSessions.save') })).toBeTruthy();
  expect(state.post.mock.calls.length).toBe(posts);
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
