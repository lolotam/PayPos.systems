import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { id, initial, recordAttempt, response, savedLine, scope } from '../model/session-recording-result.fixture';
import { transitionSessionRecordingResult as transition, type SessionRecordingResult } from '../model/session-recording-result';
import { SessionSavedResult } from './session-saved-result';

const state = vi.hoisted(() => ({ patch: vi.fn(), get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ PATCH: state.patch, GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const narrow = { data: { saved: true, edited: true }, response: { status: 200 } };
const full = {
  data: {
    line: { ...savedLine, price: '4.250', discount: '0.250', net: '4.000', revision: 2, edited: true as const },
    session: { id: id(12), total_net: '4.000' },
  },
  response: { status: 200 },
};
type Gate = { resolve: (value: unknown) => void; reject: (error: unknown) => void };
type FailureKind = 'network' | 'stale' | 'invalid';

function refused(status: number, code: string, details?: unknown) {
  return { error: { code, message_ar: `${code} AR`, message_en: `${code} EN`, ...(details === undefined ? {} : { details }) }, response: { status } };
}
function twoLineSession() {
  const second = { ...savedLine, id: id(19), name_en: 'Second service', ordinal: 2 };
  return { ...response.session, lines: [savedLine, second] };
}
function FlightLock({ result }: { result: SessionRecordingResult }) {
  const [editsInFlight, setEditsInFlight] = useState(0);
  return <SessionSavedResult result={result} journal={{ leaveVisit: vi.fn() }} onNewVisit={vi.fn()} scope={scope} online
    editBusy={editsInFlight > 0}
    onRequestStart={() => { setEditsInFlight((count) => count + 1); }}
    onRequestEnd={() => { setEditsInFlight((count) => count - 1); }} />;
}
function tree(client: QueryClient, session: ReturnType<typeof twoLineSession>) {
  const result = transition(initial, { type: 'RECORDED', attempt: recordAttempt, response: { outcome: 'COMPLETE', session, rejected_lines: [] } });
  return <QueryClientProvider client={client}><FlightLock result={result} /></QueryClientProvider>;
}
function queuePatches() {
  const pending: Gate[] = [];
  state.patch.mockReset();
  state.get.mockReset();
  state.patch.mockImplementation(() => new Promise((resolve, reject) => { pending.push({ resolve, reject }); }));
  return pending;
}
function editButtons() {
  return screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') });
}
function editAt(index: number) {
  const button = editButtons()[index];
  if (!button) throw new Error(`missing edit ${index}`);
  fireEvent.click(button);
}
function buttonDisabled(name: string, index?: number) {
  const found = index === undefined ? screen.queryByRole('button', { name }) : editButtons()[index];
  return found instanceof HTMLButtonElement && found.disabled;
}
function controlsLocked() {
  return buttonDisabled(t('en', 'serviceLineEdit.edit'), 1) && buttonDisabled(t('en', 'serviceLineEdit.close'));
}
function fill(price: string, discount: string) {
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.price')), { target: { value: price } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.discountAmount')), { target: { value: discount } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'because' } });
}
const save = () => fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
const reason = () => screen.queryByLabelText(t('en', 'serviceLineEdit.reason'));
const keyOf = (index: number) => state.patch.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;

async function openAndSaveFirst() {
  const pending = queuePatches();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const view = render(tree(client, twoLineSession()));
  editAt(0);
  fill('8.000', '1.000');
  save();
  await waitFor(() => expect(pending).toHaveLength(1));
  await waitFor(() => expect(controlsLocked()).toBe(true));
  return { view, client, pending };
}
async function settleFailure(kind: FailureKind, pending: Gate[]) {
  const first = pending[0];
  if (!first) throw new Error('missing response');
  if (kind === 'network') {
    await act(async () => { first.reject(new Error('offline')); });
    return t('en', 'admin.unexpected');
  }
  if (kind === 'invalid') {
    await act(async () => { first.resolve(refused(422, 'SESSION_EDIT_NO_CHANGE')); });
    return 'SESSION_EDIT_NO_CHANGE EN';
  }
  await act(async () => { first.resolve(refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 4 })); });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(controlsLocked()).toBe(true);
  const second = pending[1];
  if (!second) throw new Error('missing retry');
  await act(async () => { second.resolve(refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 5 })); });
  return 'SESSION_LINE_REVISION_STALE EN';
}

it('disables the other edit and close while a save is pending and enables edits after it succeeds', async () => {
  const { pending } = await openAndSaveFirst();
  const first = pending[0];
  if (!first) throw new Error('missing response');
  await act(async () => { first.resolve(full); });
  expect(await screen.findByText('4.250')).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.close') })).toBeNull();
  for (const button of editButtons()) expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(state.patch).toHaveBeenCalledTimes(1);
  expect(state.get).not.toHaveBeenCalled();
});

it.each([
  ['409 after the retry', 'stale'],
  ['422', 'invalid'],
] as const)('shows the %s error in the still-open editor and releases the lock', async (_label, kind) => {
  const { pending } = await openAndSaveFirst();
  const message = await settleFailure(kind, pending);
  expect((await screen.findByRole('alert')).textContent).toContain(message);
  expect(screen.queryByText(t('en', 'serviceLineEdit.outcomeUnknown'))).toBeNull();
  expect(reason()).toBeTruthy();
  await waitFor(() => expect(controlsLocked()).toBe(false));
  expect(state.get).not.toHaveBeenCalled();
});

it('shows a network error in the still-open editor and keeps the visit locked', async () => {
  const { pending } = await openAndSaveFirst();
  const message = await settleFailure('network', pending);
  expect((await screen.findByRole('alert')).textContent).toContain(message);
  expect(screen.getByText(t('en', 'serviceLineEdit.outcomeUnknown'))).toBeTruthy();
  expect(reason()).toBeTruthy();
  expect(controlsLocked()).toBe(true);
  expect(state.get).not.toHaveBeenCalled();
});

it('does not close or open another line while a save is pending', async () => {
  const { pending } = await openAndSaveFirst();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.close') }));
  editAt(1);
  expect(screen.getAllByLabelText(t('en', 'serviceLineEdit.reason'))).toHaveLength(1);
  expect(state.patch).toHaveBeenCalledTimes(1);
  const first = pending[0];
  if (!first) throw new Error('missing response');
  await act(async () => { first.resolve(narrow); });
  expect(await screen.findByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeTruthy();
  expect(reason()).toBeNull();
});

it('keeps a later editor open when an earlier save completes after the snapshot changes', async () => {
  const { view, client, pending } = await openAndSaveFirst();
  view.rerender(tree(client, { ...twoLineSession(), total_net: '9.000' }));
  expect(reason()).toBeTruthy();
  await waitFor(() => expect(buttonDisabled(t('en', 'serviceLineEdit.edit'), 1)).toBe(true));
  const first = pending[0];
  if (!first) throw new Error('missing response');
  await act(async () => { first.resolve(narrow); });
  await waitFor(() => expect(reason()).toBeNull());
  await waitFor(() => expect(buttonDisabled(t('en', 'serviceLineEdit.edit'), 1)).toBe(false));
  editAt(1);
  expect(await screen.findByText(t('en', 'serviceLineEdit.edited'))).toBeTruthy();
  expect(reason()).toBeTruthy();
  expect(state.patch).toHaveBeenCalledTimes(1);
});

it('shows the newer snapshot figures after a late replay response for a line with no tracked local edit', async () => {
  const { view, client, pending } = await openAndSaveFirst();
  const newer = { ...twoLineSession(), lines: twoLineSession().lines.map((line, index) => index === 0 ? { ...line, price: '7.000', discount: '0.000', net: '7.000', revision: 3, edited: true as const } : line) };
  view.rerender(tree(client, newer));
  const first = pending[0];
  if (!first) throw new Error('missing response');
  await act(async () => { first.resolve(full); });
  await waitFor(() => expect(reason()).toBeNull());
  expect(screen.queryByText('4.250', { exact: false })).toBeNull();
  expect(screen.getAllByText('7.000', { exact: false }).length).toBeGreaterThan(0);
});

it('keeps the uncertain editor and its idempotency key when the same visit snapshot is replaced', async () => {
  const { view, client, pending } = await openAndSaveFirst();
  const gate = pending[0];
  if (!gate) throw new Error('missing response');
  await act(async () => { gate.reject(new Error('offline')); });
  expect(await screen.findByText(t('en', 'serviceLineEdit.outcomeUnknown'))).toBeTruthy();
  view.rerender(tree(client, { ...twoLineSession(), total_net: '9.000' }));
  expect(reason()).toBeTruthy();
  expect(screen.getByText(t('en', 'serviceLineEdit.outcomeUnknown'))).toBeTruthy();
  expect(controlsLocked()).toBe(true);
  const price = screen.getByLabelText(t('en', 'serviceSessions.price'));
  expect((price as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(price, { target: { value: '1.000' } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'changed' } });
  const sent = state.patch.mock.calls[0]?.[1].body;
  save();
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(keyOf(1)).toBe(keyOf(0));
  expect(state.patch.mock.calls[1]?.[1].body).toEqual(sent);
  expect(controlsLocked()).toBe(true);
});
