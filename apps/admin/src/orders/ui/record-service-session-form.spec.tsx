import type { RecordingContext } from '@pospay/contracts';
import { serviceSessionErrors, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SESSION_ATTEMPT_RETENTION_MS, SESSION_ATTEMPT_SAFETY_MARGIN_MS } from '../model/session-attempt';
import { createSessionAttemptJournal, type SessionAttemptJournal } from '../model/session-attempt-journal';
import { createSessionDraft, type SessionDraftForm } from '../model/session-drafts';
import { emptySessionRecordingResult, sessionResultCommand, transitionSessionRecordingResult, type SessionRecordingResult } from '../model/session-recording-result';
import { attempt as savedAttempt, id, inputLine, instant, response, scope } from '../model/session-recording-result.fixture';
import type { SessionRecordingController } from '../model/use-session-recording';
import { RecordServiceSessionForm } from './record-service-session-form';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en', get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const service = { id: id(5), name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 1 };
const performer = { id: id(6), name_ar: null, name_en: 'Synthetic performer', employee_number: null, not_clocked_in_warning: false, approved_leave_warning: false };
const customer = { id: id(7), name: 'Synthetic customer', phone: '***001' };
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
function installReads(performers: typeof performer[] = []) {
  state.get.mockImplementation((path: string, init?: { params?: { query?: { recorder_membership_id?: string } } }) => {
    if (String(path).endsWith('/recording-context')) {
      const chosen = init?.params?.query?.recorder_membership_id ?? id(8);
      return Promise.resolve({ data: { ...context, recorder_membership_ids: [id(8), id(9)], recorder_membership_id: chosen } });
    }
    return Promise.resolve({ data: { items: String(path).endsWith('/performer-options') ? performers : [service], next_cursor: null } });
  });
}
function Harness({ online, store, initial, submit = async () => undefined, retry = async () => undefined }: {
  online: boolean; store: SessionAttemptJournal | null; initial: SessionRecordingResult;
  submit?: SessionRecordingController['submit']; retry?: SessionRecordingController['retry'];
}) {
  const [result, setResult] = useState(initial);
  const recording: SessionRecordingController = {
    result, journal: store, submit, retry, selectCustomer: () => undefined, replaceResult: setResult,
  };
  return <RecordServiceSessionForm scope={scope} context={context} online={online} recording={recording} onRefreshScope={() => undefined} />;
}
function renderForm(online: boolean, initial: SessionRecordingResult, store: SessionAttemptJournal | null, submit?: SessionRecordingController['submit'], retry?: SessionRecordingController['retry']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (nextOnline: boolean) => (
    <QueryClientProvider client={client}><Harness online={nextOnline} store={store} initial={initial} {...(submit ? { submit } : {})} {...(retry ? { retry } : {})} /></QueryClientProvider>
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
  const other = locale === 'ar' ? 'en' : 'ar';
  expect(t('ar', 'serviceSessions.save').length).toBeGreaterThan(0);
  expect(t('en', 'serviceSessions.save').length).toBeGreaterThan(0);
  expect(t('ar', 'serviceSessions.save')).not.toBe(t('en', 'serviceSessions.save'));
  state.locale = locale;
  renderForm(true, emptySessionRecordingResult(), null);
  expect(screen.getByRole('button', { name: t(locale, 'serviceSessions.save') }).textContent).toBe(t(locale, 'serviceSessions.save'));
  expect(document.body.textContent ?? '').not.toContain(t(other, 'serviceSessions.save'));
});

async function chooseService() {
  await screen.findByRole('option', { name: 'Synthetic service' });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.service')), { target: { value: id(5) } });
}
function membership() { return screen.getByLabelText(t('en', 'serviceSessions.recorderMembership')) as HTMLSelectElement; }

it('sends the chosen recorder membership and locks it after the visit is saved', async () => {
  installReads([performer]);
  const submitted: SessionDraftForm[] = [];
  const view = renderForm(true, emptySessionRecordingResult(customer), openJournal(), async (drafts) => { submitted.push(drafts); });
  await chooseService();
  await screen.findByRole('option', { name: 'Synthetic performer —' });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.performerNumber').replace('{n}', '1')), { target: { value: id(6) } });
  await screen.findByRole('option', { name: id(9) });
  fireEvent.change(membership(), { target: { value: id(9) } });
  await waitFor(() => expect(membership().value).toBe(id(9)));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.save') }));
  await waitFor(() => expect(submitted).toHaveLength(1));
  const drafts = submitted[0];
  if (!drafts) throw new Error('Missing submission');
  expect(sessionResultCommand({ ...emptySessionRecordingResult(customer), drafts }, []).body.recorder_membership_id).toBe(id(9));
  view.unmount();
  renderForm(true, { ...saved, drafts: { lines: [], recorder_membership_id: id(9) } }, openJournal());
  expect(membership().disabled).toBe(true);
  expect(membership().closest('fieldset')?.disabled).toBe(false);
});

it('keeps the discount limit and the draft total after the membership is read-only', async () => {
  const correcting: SessionRecordingResult = {
    ...saved,
    drafts: { lines: [{ ...createSessionDraft('kept'), price: '7.125' }], recorder_membership_id: id(8) },
  };
  renderForm(true, correcting, openJournal());
  await waitFor(() => expect(screen.getAllByText('10.00%')).toHaveLength(2));
  expect(membership().disabled).toBe(true);
  expect(membership().closest('fieldset')?.disabled).toBe(false);
  const summary = screen.getByText(t('en', 'serviceSessions.draftTotal'), { exact: false }).parentElement;
  expect(summary?.textContent).toContain('7.125');
  expect(summary?.textContent).toContain('10.00%');
  expect(summary?.textContent).toContain(t('en', 'serviceSessions.limitPerson'));
});

it('shows the discount limit and the draft total in the summary', async () => {
  renderForm(true, emptySessionRecordingResult(), openJournal());
  await chooseService();
  const summary = screen.getByText(t('en', 'serviceSessions.draftTotal'), { exact: false }).parentElement;
  expect(summary?.textContent).toContain('7.125');
  expect(summary?.textContent).toContain('10.00%');
  expect(summary?.textContent).toContain(t('en', 'serviceSessions.limitPerson'));
});

it('hides the original-attempt retry while offline and shows it when the connection returns', () => {
  const unresolved: SessionRecordingResult = { ...emptySessionRecordingResult(), feedback: { kind: 'UNRESOLVED' }, attempt: savedAttempt };
  const view = renderForm(false, unresolved, null);
  expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.retryOriginal') })).toBeNull();
  view.rerender(view.ui(true));
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.retryOriginal') })).toBeTruthy();
});

it('disables find-or-create, fresh reads and submit while offline and keeps the draft', async () => {
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
});

it('does not replay an unresolved attempt when the connection returns', async () => {
  const retry = vi.fn(async () => undefined);
  const unresolved: SessionRecordingResult = { ...emptySessionRecordingResult(), feedback: { kind: 'UNRESOLVED' }, attempt: savedAttempt };
  const view = renderForm(false, unresolved, openJournal(), undefined, retry);
  expect(screen.queryByRole('button', { name: t('en', 'serviceSessions.retryOriginal') })).toBeNull();
  view.rerender(view.ui(true));
  await act(async () => { await Promise.resolve(); });
  expect(retry).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.retryOriginal') })).toBeTruthy();
});

it('reopens the recorder picker after the saved membership is forbidden and submits the replacement', async () => {
  state.get.mockImplementation((path: string, init?: { params?: { query?: { recorder_membership_id?: string } } }) => {
    const membershipId = init?.params?.query?.recorder_membership_id;
    if (String(path).endsWith('/recording-context') && membershipId === id(8)) {
      return Promise.resolve({ error: { code: 'FORBIDDEN', message_ar: 'Refusal AR', message_en: 'Refusal EN' }, response: { status: 403 } });
    }
    if (String(path).endsWith('/recording-context')) {
      return Promise.resolve({ data: { ...context, recorder_membership_ids: [id(9), id(10)], recorder_membership_id: null, discount_limit: null } });
    }
    return Promise.resolve({ data: { items: String(path).endsWith('/performer-options') ? [performer] : [service], next_cursor: null } });
  });
  const submitted: SessionDraftForm[] = [];
  const savedVisit: SessionRecordingResult = { ...saved, drafts: { lines: [], recorder_membership_id: id(8) } };
  renderForm(true, savedVisit, openJournal(), async (drafts) => { submitted.push(drafts); });
  await chooseService();
  await screen.findByRole('option', { name: 'Synthetic performer —' });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.performerNumber').replace('{n}', '1')), { target: { value: id(6) } });
  await screen.findByRole('option', { name: id(9) });
  await waitFor(() => expect(membership().disabled).toBe(false));
  fireEvent.change(membership(), { target: { value: id(9) } });
  await waitFor(() => expect(membership().value).toBe(id(9)));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.correctAndAppend') }));
  await waitFor(() => expect(submitted).toHaveLength(1));
  const drafts = submitted[0];
  if (!drafts) throw new Error('Missing submission');
  const command = sessionResultCommand({ ...savedVisit, drafts }, []);
  expect(command.kind).toBe('append');
  expect(command.body.recorder_membership_id).toBe(id(9));
});

it.each(['ar', 'en'] as const)('warns and keeps corrections off when the restored visit time is unknown in %s', async (locale) => {
  state.locale = locale;
  const restored: SessionRecordingResult = {
    ...emptySessionRecordingResult(customer), sessionId: id(12), feedback: { kind: 'PARTIAL' }, drafts: { lines: [] }, visitTimeUnknown: true,
  };
  renderForm(true, restored, openJournal());
  expect(screen.getByRole('alert').textContent).toBe(t(locale, 'serviceSessions.unknownVisitTime'));
  expect(screen.queryByText(t(locale, 'serviceSessions.now'))).toBeNull();
  expect((screen.getByRole('button', { name: t(locale, 'serviceSessions.correctAndAppend') }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { await Promise.resolve(); });
  expect(state.get.mock.calls.some((call) => String(call[0]).endsWith('/performer-options'))).toBe(false);
});

it.each(['ar', 'en'] as const)('leaves the unknown-time visit and re-enables the time field in %s', (locale) => {
  state.locale = locale;
  const restored: SessionRecordingResult = {
    ...emptySessionRecordingResult(customer), sessionId: id(12), feedback: { kind: 'PARTIAL' }, drafts: { lines: [] }, visitTimeUnknown: true,
  };
  renderForm(true, restored, openJournal());
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'serviceSessions.newVisitSameCustomer') }));
  expect(screen.queryByText(t(locale, 'serviceSessions.unknownVisitTime'))).toBeNull();
  expect((screen.getByLabelText(t(locale, 'serviceSessions.occurredAt')) as HTMLInputElement).disabled).toBe(false);
});

it('confirms an expired attempt from the panel and revokes once through the header', async () => {
  let now = Date.parse(instant);
  const journal = createSessionAttemptJournal(scope, { now: () => now, newId: () => id(80) });
  journals.push(journal);
  const started = journal.begin({ kind: 'record', body: { customer_id: id(7), lines: [inputLine] } }, [id(9)]);
  await expect(journal.run(started, () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
  now += SESSION_ATTEMPT_RETENTION_MS + SESSION_ATTEMPT_SAFETY_MARGIN_MS;
  const entry = journal.read();
  if (entry?.state !== 'EXPIRED') throw new Error('expected EXPIRED');
  state.post.mockResolvedValue({ response: { status: 204 } });
  renderForm(true, transitionSessionRecordingResult(emptySessionRecordingResult(customer), { type: 'JOURNAL', entry }), journal);
  const missed = screen.getByRole('button', { name: t('en', 'serviceSessions.recoveryNotRecorded') }) as HTMLButtonElement;
  const recorded = screen.getByRole('button', { name: t('en', 'serviceSessions.recoveryRecorded') }) as HTMLButtonElement;
  expect(missed.disabled).toBe(false); expect(recorded.disabled).toBe(false);
  fireEvent.click(missed);
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
  const [path, init] = state.post.mock.calls[0] as [string, { params: { header: Record<string, string>; query?: unknown }; body: unknown }];
  expect(path).toBe('/v1/businesses/{businessId}/branches/{branchId}/service-sessions/recovery/confirm');
  expect(init.params.header['x-recovery-key']).toBe(entry.key);
  expect(init.params.query).toBeUndefined(); expect(path).not.toContain(entry.key);
  expect(init.body).toEqual({ operation: 'record-service-session', outcome: 'NOT_RECORDED' });
  expect(screen.queryByRole('alert')).toBeNull(); expect(journal.read()).toBeNull();
});

function storageThatRejectsClear() {
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem(key: string, value: string) {
      const parsed = JSON.parse(value) as { envelope?: { state?: string } };
      if (parsed.envelope?.state === 'IDLE') throw new Error('full');
      memory.set(key, value);
    },
    removeItem: (key: string) => { memory.delete(key); },
  };
}
async function expireUntilClearFails() {
  let now = Date.parse(instant);
  const journal = createSessionAttemptJournal(scope, { now: () => now, newId: () => id(81) }, storageThatRejectsClear());
  journals.push(journal);
  const started = journal.begin({ kind: 'record', body: { customer_id: id(7), lines: [inputLine] } }, [id(9)]);
  await expect(journal.run(started, () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
  now += SESSION_ATTEMPT_RETENTION_MS + SESSION_ATTEMPT_SAFETY_MARGIN_MS;
  if (journal.read()?.state !== 'EXPIRED') throw new Error('expected EXPIRED');
  return journal;
}

it.each(['ar', 'en'] as const)('shows the not-persisted message and keeps the marker when confirm cannot clear storage in %s', async (locale) => {
  state.locale = locale;
  const journal = await expireUntilClearFails();
  const entry = journal.read();
  renderForm(true, transitionSessionRecordingResult(emptySessionRecordingResult(customer), { type: 'JOURNAL', entry }), journal);
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'serviceSessions.recoveryNotRecorded') }));
  const message = serviceSessionErrors.SESSION_ATTEMPT_NOT_PERSISTED[locale === 'ar' ? 'message_ar' : 'message_en'];
  expect(screen.getByText(message)).toBeTruthy();
  expect(journal.read()?.state).toBe('EXPIRED');
  expect(state.post).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: t(locale, 'serviceSessions.recoveryRecorded') }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: t(locale, 'serviceSessions.recoveryNotRecorded') }) as HTMLButtonElement).disabled).toBe(false);
});

async function expireReloadedAppend() {
  let now = Date.parse(instant);
  const journal = createSessionAttemptJournal(scope, { now: () => now, newId: () => id(82) });
  journals.push(journal);
  const started = journal.begin({ kind: 'append', sessionId: id(12), body: { lines: [inputLine] } }, [id(9)]);
  await expect(journal.run(started, () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
  now += SESSION_ATTEMPT_RETENTION_MS + SESSION_ATTEMPT_SAFETY_MARGIN_MS;
  const entry = journal.read();
  if (entry?.state !== 'EXPIRED') throw new Error('expected EXPIRED');
  return { journal, entry };
}

it.each(['RECORDED_ELSEWHERE', 'NOT_RECORDED'] as const)('shows the unknown-visit exit and skips performer facts after a reloaded append is confirmed %s', async (outcome) => {
  const { journal, entry } = await expireReloadedAppend();
  renderForm(true, transitionSessionRecordingResult(emptySessionRecordingResult(customer), { type: 'JOURNAL', entry }), journal);
  state.get.mockClear();
  fireEvent.click(screen.getByRole('button', { name: t('en', outcome === 'RECORDED_ELSEWHERE' ? 'serviceSessions.recoveryRecorded' : 'serviceSessions.recoveryNotRecorded') }));
  expect(screen.getByText(t('en', 'serviceSessions.unknownVisitTime'))).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.newVisitSameCustomer') })).toBeTruthy();
  await act(async () => { await Promise.resolve(); });
  expect(state.get.mock.calls.some(([path]) => String(path).endsWith('/performer-options'))).toBe(false);
});

it('keeps the membership selectable for a restored partial visit whose membership is unknown', async () => {
  const restored: SessionRecordingResult = { ...saved, session: null, feedback: { kind: 'PARTIAL' }, drafts: { lines: [] } };
  const submitted: SessionDraftForm[] = [];
  renderForm(true, restored, openJournal(), async (drafts) => { submitted.push(drafts); });
  await screen.findByRole('option', { name: id(9) });
  await waitFor(() => expect(membership().disabled).toBe(false));
  fireEvent.change(membership(), { target: { value: id(9) } });
  await waitFor(() => expect(membership().value).toBe(id(9)));
});
