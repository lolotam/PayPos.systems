import type { RecordingContext } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSessionAttemptJournal, type SessionAttemptJournal } from '../model/session-attempt-journal';
import { id, initial, instant, recordAttempt, response, savedLine, scope } from '../model/session-recording-result.fixture';
import { transitionSessionRecordingResult as transition, type SessionRecordingResult } from '../model/session-recording-result';
import type { SessionRecordingController } from '../model/use-session-recording';
import { RecordServiceSessionForm } from './record-service-session-form';

const state = vi.hoisted(() => ({ patch: vi.fn(), get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ PATCH: state.patch, GET: state.get, POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const context = {
  generated_at: instant, business_timezone: 'Asia/Kuwait', recorder_membership_ids: [id(8)],
  recorder_membership_id: id(8), discount_limit: { source: 'PERSON', bps: 1000 },
} satisfies RecordingContext;
const full = {
  data: {
    line: { ...savedLine, price: '4.250', discount: '0.250', net: '4.000', revision: 2, edited: true as const },
    session: { id: id(12), total_net: '4.000' },
  },
  response: { status: 200 },
};
type Gate = { resolve: (value: unknown) => void; reject: (error: unknown) => void };
const journals: SessionAttemptJournal[] = [];

function openJournal() {
  const created = createSessionAttemptJournal(scope, { now: () => Date.now(), newId: () => id(70) });
  journals.push(created);
  return created;
}
function twoLineResult() {
  const second = { ...savedLine, id: id(19), name_en: 'Second service', ordinal: 2 };
  const session = { ...response.session, lines: [savedLine, second] };
  return transition(initial, { type: 'RECORDED', attempt: recordAttempt, response: { outcome: 'COMPLETE', session, rejected_lines: [] } });
}
function Harness({ seed, store, hideSession = false }: { seed: SessionRecordingResult; store: SessionAttemptJournal; hideSession?: boolean }) {
  const [result, setResult] = useState(seed);
  const shown = hideSession ? { ...result, session: null } : result;
  const recording: SessionRecordingController = {
    result: shown, journal: store, retry: async () => undefined, selectCustomer: () => undefined, replaceResult: setResult,
    submit: async () => { setResult((current) => ({ ...current, feedback: { kind: 'SAVING' } })); },
  };
  return <RecordServiceSessionForm scope={scope} context={context} online recording={recording} onRefreshScope={() => undefined} />;
}
function mountVisit(seed: SessionRecordingResult, store: SessionAttemptJournal) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const ui = (hideSession: boolean) => <QueryClientProvider client={client}><Harness seed={seed} store={store} hideSession={hideSession} /></QueryClientProvider>;
  return { ...render(ui(false)), ui };
}
function queuePatches() {
  const pending: Gate[] = [];
  state.patch.mockReset();
  state.patch.mockImplementation(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }); }));
  return pending;
}
function input(idName: string) {
  const node = document.getElementById(idName);
  if (!(node instanceof HTMLInputElement)) throw new Error(`missing ${idName}`);
  return node;
}
function fill() {
  fireEvent.change(input('edit-price'), { target: { value: '8.000' } });
  fireEvent.change(input('edit-discount'), { target: { value: '1.000' } });
  fireEvent.change(input('edit-reason'), { target: { value: 'because' } });
}
const lineSave = () => fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
function disabled(name: string) {
  const button = screen.getByRole('button', { name });
  return button instanceof HTMLButtonElement && button.disabled;
}
function editDisabled(index: number) {
  const button = screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') })[index];
  return button instanceof HTMLButtonElement && button.disabled;
}
function actionsLocked() {
  return disabled(t('en', 'serviceSessions.correctAndAppend')) && disabled(t('en', 'serviceSessions.newVisit'))
    && disabled(t('en', 'serviceSessions.newVisitSameCustomer')) && editDisabled(1) && disabled(t('en', 'serviceLineEdit.close'));
}
function actionsFree(editorClosed: boolean) {
  const closeFree = editorClosed
    ? screen.queryByRole('button', { name: t('en', 'serviceLineEdit.close') }) === null
    : !disabled(t('en', 'serviceLineEdit.close'));
  return !disabled(t('en', 'serviceSessions.correctAndAppend')) && !disabled(t('en', 'serviceSessions.newVisit'))
    && !disabled(t('en', 'serviceSessions.newVisitSameCustomer')) && !editDisabled(0) && !editDisabled(1) && closeFree;
}
function pokeLockedActions() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.correctAndAppend') }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.newVisit') }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.newVisitSameCustomer') }));
  const other = screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') })[1];
  if (!other) throw new Error('missing edit');
  fireEvent.click(other);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.close') }));
}
async function settle(pending: Gate[], index: number, value: unknown) {
  const gate = pending[index];
  if (!gate) throw new Error('missing response');
  await act(async () => { gate.resolve(value); });
}
async function openPending() {
  const pending = queuePatches();
  const store = openJournal();
  const seed = twoLineResult();
  const view = mountVisit(seed, store);
  const first = screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') })[0];
  if (!first) throw new Error('missing edit');
  fireEvent.click(first);
  fill();
  lineSave();
  await waitFor(() => expect(pending).toHaveLength(1));
  await waitFor(() => expect(actionsLocked()).toBe(true));
  pokeLockedActions();
  expect(screen.getByLabelText(t('en', 'serviceLineEdit.reason'))).toBeTruthy();
  expect(screen.queryByText(t('en', 'serviceSessions.saving'))).toBeNull();
  expect(screen.getAllByText('Synthetic customer')).toHaveLength(2);
  expect(state.patch).toHaveBeenCalledTimes(1);
  return { pending, view };
}

beforeEach(() => {
  state.get.mockImplementation((path: string) => Promise.resolve({
    data: String(path).endsWith('/recording-context') ? context : { items: [], next_cursor: null },
  }));
});
afterEach(() => {
  journals.splice(0).forEach((store) => { store.changeScope(null); store.dispose(); });
  sessionStorage.clear();
  state.get.mockReset();
  state.patch.mockReset();
  state.post.mockReset();
});

it('disables the recording submit, both new-visit buttons, the other edit and close while a line save is pending and enables them after it succeeds', async () => {
  const { pending } = await openPending();
  await settle(pending, 0, full);
  expect(await screen.findByText('4.250')).toBeTruthy();
  await waitFor(() => expect(actionsFree(true)).toBe(true));
});

function refused(status: number, code: string, details?: unknown) {
  return { error: { code, message_ar: `${code} AR`, message_en: `${code} EN`, ...(details === undefined ? {} : { details }) }, response: { status } };
}
const hint = () => screen.queryByText(t('en', 'serviceLineEdit.outcomeUnknown'));
const reasonBox = () => screen.queryByLabelText(t('en', 'serviceLineEdit.reason'));
const headerAt = (index: number) => state.patch.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;
const revisionAt = (index: number) => (state.patch.mock.calls[index]?.[1].body as { expected_revision: number }).expected_revision;

it('keeps the editor open and the visit locked with a replay hint after a network error, then replays the same key and releases on success', async () => {
  const { pending } = await openPending();
  const gate = pending[0];
  if (!gate) throw new Error('missing response');
  await act(async () => { gate.reject(new Error('offline')); });
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'admin.unexpected'));
  expect(hint()).toBeTruthy();
  expect(reasonBox()).toBeTruthy();
  expect((screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }) as HTMLButtonElement).disabled).toBe(false);
  expect(actionsLocked()).toBe(true);
  pokeLockedActions();
  expect(screen.queryByText(t('en', 'serviceSessions.saving'))).toBeNull();
  expect(screen.getAllByText('Synthetic customer')).toHaveLength(2);
  const key = headerAt(0);
  const revision = revisionAt(0);
  lineSave();
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(headerAt(1)).toBe(key);
  expect(revisionAt(1)).toBe(revision);
  expect(actionsLocked()).toBe(true);
  await settle(pending, 1, full);
  expect(await screen.findByText('4.250')).toBeTruthy();
  await waitFor(() => expect(actionsFree(true)).toBe(true));
  expect(hint()).toBeNull();
  const again = screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') })[0];
  if (!again) throw new Error('missing edit');
  fireEvent.click(again);
  fill();
  lineSave();
  await waitFor(() => expect(pending).toHaveLength(3));
  await waitFor(() => expect(actionsLocked()).toBe(true));
  await settle(pending, 2, full);
  await waitFor(() => expect(actionsFree(true)).toBe(true));
});

it.each([
  [500, 'INTERNAL'],
  [409, 'SESSION_EDIT_IN_PROGRESS'],
] as const)('keeps the visit locked when a line save returns %s %s', async (status, code) => {
  const { pending } = await openPending();
  await settle(pending, 0, refused(status, code));
  expect((await screen.findByRole('alert')).textContent).toContain(`${code} EN`);
  expect(hint()).toBeTruthy();
  expect(reasonBox()).toBeTruthy();
  expect(actionsLocked()).toBe(true);
});

async function settleKnown(pending: Gate[], kind: 'unchanged' | 'forbidden' | 'stale') {
  if (kind === 'stale') {
    await settle(pending, 0, refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 4 }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(actionsLocked()).toBe(true);
    await settle(pending, 1, refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 5 }));
    return;
  }
  await settle(pending, 0, kind === 'forbidden' ? refused(403, 'FORBIDDEN') : refused(422, 'SESSION_EDIT_NO_CHANGE'));
}

it.each([
  ['422', 'unchanged', false],
  ['403', 'forbidden', true],
  ['409 after the retry', 'stale', false],
] as const)('releases the visit lock after a known %s line-save refusal', async (_label, kind, editorClosed) => {
  const { pending } = await openPending();
  await settleKnown(pending, kind);
  await waitFor(() => expect(actionsFree(editorClosed)).toBe(true));
  expect(hint()).toBeNull();
  if (editorClosed) expect(reasonBox()).toBeNull();
  else expect(reasonBox()).toBeTruthy();
});

it('returns the recording lock to zero when the saved result unmounts during a pending line save', async () => {
  const { pending, view } = await openPending();
  view.rerender(view.ui(true));
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.edit') })).toBeNull();
  expect(disabled(t('en', 'serviceSessions.correctAndAppend'))).toBe(true);
  await settle(pending, 0, full);
  await waitFor(() => expect(disabled(t('en', 'serviceSessions.correctAndAppend'))).toBe(false));
  view.rerender(view.ui(false));
  await waitFor(() => expect(actionsFree(true)).toBe(true));
  const again = screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') })[0];
  if (!again) throw new Error('missing edit');
  fireEvent.click(again);
  fill();
  lineSave();
  await waitFor(() => expect(pending).toHaveLength(2));
  await waitFor(() => expect(actionsLocked()).toBe(true));
  await settle(pending, 1, full);
  await waitFor(() => expect(actionsFree(true)).toBe(true));
});
