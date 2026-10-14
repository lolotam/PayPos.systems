import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionAttemptJournal } from '../model/session-attempt-journal';
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

it('keeps a typed draft offline and does not submit when the connection returns', async () => {
  installReads();
  const view = renderPage();
  await screen.findByRole('option', { name: 'Synthetic performer' });
  fireEvent.change(price(), { target: { value: '20.5' } });
  const reads = state.get.mock.calls.length;
  setOnline(false);
  expect(await screen.findByText(t('en', 'serviceSessions.offline'))).toBeTruthy();
  expect(price().value).toBe('20.5');
  expect(state.get.mock.calls.length).toBe(reads);
  expect((screen.getByRole('button', { name: t('en', 'serviceSessions.save') }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.findOrCreate') }).closest('fieldset')?.disabled).toBe(true);
  setOnline(true);
  await act(async () => { await Promise.resolve(); });
  expect(navigator.onLine).toBe(true);
  expect(state.post).not.toHaveBeenCalled();
  expect(price().value).toBe('20.5');
  view.unmount();
});

it('clears a typed draft when the page scope key changes', async () => {
  installReads();
  const view = renderPage();
  await screen.findByLabelText(t('en', 'serviceSessions.price'));
  fireEvent.change(price(), { target: { value: '20.5' } });
  view.rerender(view.ui({ ...scope, userId: id(40) }));
  await waitFor(() => expect(price().value).toBe(''));
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
