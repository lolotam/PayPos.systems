import type { RecordingContext } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionAttemptJournal, type SessionAttemptJournal } from '../model/session-attempt-journal';
import { emptySessionRecordingResult, type SessionRecordingResult } from '../model/session-recording-result';
import { id, instant, response, scope } from '../model/session-recording-result.fixture';
import type { SessionRecordingController } from '../model/use-session-recording';
import { RecordServiceSessionForm } from './record-service-session-form';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const service = { id: id(5), name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 1 };
const context = {
  generated_at: instant, business_timezone: 'Asia/Kuwait', recorder_membership_ids: [id(8)],
  recorder_membership_id: id(8), discount_limit: { source: 'PERSON', bps: 1000 },
} satisfies RecordingContext;
const saved: SessionRecordingResult = {
  ...emptySessionRecordingResult({ id: id(7), name: 'Synthetic customer', phone: '***001' }),
  session: response.session, sessionId: response.session.id, feedback: { kind: 'COMPLETE' }, drafts: { lines: [] },
  addedLineIds: response.session.lines.map((line) => line.id),
};
const journals: SessionAttemptJournal[] = [];
function openJournal() {
  const created = createSessionAttemptJournal(scope, { now: () => Date.now(), newId: () => id(70) });
  journals.push(created);
  return created;
}
function installReads() {
  state.get.mockImplementation((path: string) => Promise.resolve({ data: String(path).endsWith('/recording-context') ? context
    : { items: String(path).endsWith('/performer-options') ? [] : [service], next_cursor: null } }));
}
function Harness({ online, store, initial }: { online: boolean; store: SessionAttemptJournal | null; initial: SessionRecordingResult }) {
  const [result, setResult] = useState(initial);
  const recording: SessionRecordingController = {
    result, journal: store, submit: async () => undefined, retry: async () => undefined, selectCustomer: () => undefined, replaceResult: setResult,
  };
  return <RecordServiceSessionForm scope={scope} context={context} online={online} recording={recording} />;
}
function renderForm(online: boolean, initial: SessionRecordingResult, store: SessionAttemptJournal | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (nextOnline: boolean) => (
    <QueryClientProvider client={client}><Harness online={nextOnline} store={store} initial={initial} /></QueryClientProvider>
  );
  return { ...render(ui(online)), ui };
}
beforeEach(() => { state.locale = 'en'; installReads(); });
afterEach(() => {
  journals.splice(0).forEach((store) => { store.changeScope(null); store.dispose(); });
  sessionStorage.clear();
  state.get.mockReset();
  state.post.mockReset();
});

it('offers both new-visit actions after a complete save', () => {
  const cleared = renderForm(true, saved, openJournal());
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.correctAndAppend') })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.newVisit') }));
  expect(screen.queryByText('Synthetic customer')).toBeNull();
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.save') })).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.newVisit') })).toBeNull();
  cleared.unmount();
  renderForm(true, saved, openJournal());
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.newVisitSameCustomer') }));
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.correctAndAppend') })).toBeNull();
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.save') })).toBeTruthy();
});

it('shows only the unresolved expiry message', () => {
  const expired: SessionRecordingResult = { ...emptySessionRecordingResult(), feedback: { kind: 'EXPIRED' } };
  renderForm(true, expired, null);
  expect(screen.getByRole('alert').textContent).toBe(t('en', 'serviceSessions.expired'));
  expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.newVisit') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.retryOriginal') })).toBeNull();
});

it.each(['ar', 'en'] as const)('renders the save action from the catalog in %s', (locale) => {
  state.locale = locale;
  renderForm(true, emptySessionRecordingResult(), null);
  expect(screen.getByRole('button', { name: t(locale, 'serviceSessions.save') }).textContent).toBe(t(locale, 'serviceSessions.save'));
});

it('disables find-or-create, fresh reads and submit while offline without resubmitting', async () => {
  const view = renderForm(true, emptySessionRecordingResult(), openJournal());
  await screen.findByRole('option', { name: 'Synthetic service' });
  const price = () => screen.getByLabelText(t('en', 'serviceSessions.price')) as HTMLInputElement;
  fireEvent.change(price(), { target: { value: '20.5' } });
  const reads = state.get.mock.calls.length;
  view.rerender(view.ui(false));
  await act(async () => { await Promise.resolve(); });
  expect(price().value).toBe('20.5');
  expect(state.get.mock.calls.length).toBe(reads);
  expect((screen.getByRole('button', { name: t('en', 'serviceSessions.save') }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.findOrCreate') }).closest('fieldset')?.disabled).toBe(true);
  view.rerender(view.ui(true));
  await act(async () => { await Promise.resolve(); });
  expect(state.post).not.toHaveBeenCalled();
  expect(price().value).toBe('20.5');
});
