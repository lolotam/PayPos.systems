import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { sessionTipsPath } from '../api/use-session-tips';
import {
  id,
  initial,
  recordAttempt,
  response,
  savedLine,
  scope,
} from '../model/session-recording-result.fixture';
import {
  emptySessionRecordingResult,
  transitionSessionRecordingResult as transition,
  type SessionRecordingResult,
} from '../model/session-recording-result';
import { SessionSavedResult } from './session-saved-result';
import { SessionSavedVisit } from './session-saved-visit';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), patch: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: api.get, PUT: api.put, PATCH: api.patch }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const session = { ...response.session, lines: [savedLine] };
const result = transition(initial, {
  type: 'RECORDED',
  attempt: recordAttempt,
  response: { outcome: 'COMPLETE', session, rejected_lines: [] },
});
const forbidden = {
  error: { code: 'FORBIDDEN', message_ar: 'Forbidden AR', message_en: 'Forbidden EN' },
  response: { status: 403 },
};

function Visit({ editBusy }: { editBusy: boolean }) {
  const [busy, setBusy] = useState(editBusy);
  return (
    <>
      <button type="button" onClick={() => setBusy(true)}>
        Mark edit busy
      </button>
      <SessionSavedVisit result={result as SessionRecordingResult} scope={scope} online editBusy={busy} />
    </>
  );
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function hide(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  api.get.mockReset();
  api.put.mockReset();
  api.patch.mockReset();
});

it('disables Record tip while an edit is busy and keeps that editor after a tips refusal', async () => {
  let release: (value: unknown) => void = () => undefined;
  api.get.mockImplementation((path: string) => {
    if (path !== sessionTipsPath) {
      return Promise.resolve({
        error: { code: 'SESSION_NOT_FOUND', message_ar: 'x', message_en: 'x' },
        response: { status: 404 },
      });
    }
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Visit editBusy={false} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.edit') }));
  expect(screen.getByLabelText(t('en', 'serviceLineEdit.reason'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  expect(await screen.findByText(t('en', 'admin.loading'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Mark edit busy' }));
  const launcher = screen.getByRole('button', { name: t('en', 'sessionTips.open') });
  expect((launcher as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    release(forbidden);
  });
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(screen.getByText('Synthetic service')).toBeTruthy();
  expect(screen.getByLabelText(t('en', 'serviceLineEdit.reason'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'sessionTips.open') })).toBeNull();
});

it('shows Record tip again when switching to visit B after a 403 hid it on visit A (#406)', async () => {
  api.get.mockResolvedValue(forbidden);
  const visitA = result as SessionRecordingResult;
  const visitB = {
    ...visitA,
    sessionId: id(99),
    session: visitA.session ? { ...visitA.session, id: id(99) } : null,
  };
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionSavedVisit result={visitA} scope={scope} online />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(screen.queryByRole('button', { name: t('en', 'sessionTips.open') })).toBeNull();

  view.rerender(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SessionSavedVisit result={visitB} scope={scope} online />
    </QueryClientProvider>,
  );
  expect(screen.getByRole('button', { name: t('en', 'sessionTips.open') })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('preserves an unresolved tip retry on visit A through empty New Visit and visit B transitions (#406)', async () => {
  const savedTips = { revision: 1, tips: [{ employee_id: id(6), method: 'CASH' as const, amount: '1.000' }], total_cash: '1.000', total_card: '0.000' };
  api.get.mockImplementation((path: string) =>
    Promise.resolve(
      path === sessionTipsPath
        ? { data: { revision: 0, tips: [], total_cash: '0.000', total_card: '0.000' }, response: { status: 200 } }
        : { error: { code: 'SESSION_NOT_FOUND', message_ar: 'x', message_en: 'x' }, response: { status: 404 } },
    ),
  );
  api.put.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ data: savedTips, response: { status: 200 } });
  const visitA = result as SessionRecordingResult;
  const visitB = { ...visitA, sessionId: id(99), session: visitA.session ? { ...visitA.session, id: id(99) } : null };
  const stubJournal = { leaveVisit: () => undefined };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const frame = (current: SessionRecordingResult) => (
    <QueryClientProvider client={client}>
      <SessionSavedResult result={current} journal={stubJournal} onNewVisit={() => undefined} scope={scope} online />
    </QueryClientProvider>
  );
  const view = render(frame(visitA));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  await screen.findByLabelText(t('en', 'sessionTips.total'));
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.total')), { target: { value: '1.000' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.useSuggestion') }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  expect(await screen.findByRole('button', { name: t('en', 'sessionTips.retrySame') })).toBeTruthy();

  view.rerender(frame(emptySessionRecordingResult()));
  expect(screen.queryByRole('button', { name: t('en', 'sessionTips.open') })).toBeNull();
  view.rerender(frame(visitB));
  expect(screen.queryByRole('button', { name: t('en', 'sessionTips.retrySame') })).toBeNull();
  view.rerender(frame(visitA));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'sessionTips.retrySame') }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  expect(api.put.mock.calls[1]?.[1].params.header['Idempotency-Key']).toBe(api.put.mock.calls[0]?.[1].params.header['Idempotency-Key']);
  expect(api.put.mock.calls[1]?.[1].body).toEqual(api.put.mock.calls[0]?.[1].body);
});

it('retains the restored Idempotency-Key on replay if the original in-flight PUT settles late (#406)', async () => {
  const savedTips = { revision: 1, tips: [{ employee_id: id(6), method: 'CASH' as const, amount: '1.000' }], total_cash: '1.000', total_card: '0.000' };
  api.get.mockImplementation((path: string) =>
    Promise.resolve(
      path === sessionTipsPath
        ? { data: { revision: 0, tips: [], total_cash: '0.000', total_card: '0.000' }, response: { status: 200 } }
        : { error: { code: 'SESSION_NOT_FOUND', message_ar: 'x', message_en: 'x' }, response: { status: 404 } },
    ),
  );
  let resolveFirst: (value: unknown) => void = () => undefined;
  api.put.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValueOnce({ data: savedTips, response: { status: 200 } });
  const visitA = result as SessionRecordingResult;
  const visitB = { ...visitA, sessionId: id(99), session: visitA.session ? { ...visitA.session, id: id(99) } : null };
  const stubJournal = { leaveVisit: () => undefined };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const frame = (current: SessionRecordingResult) => (
    <QueryClientProvider client={client}><SessionSavedResult result={current} journal={stubJournal} onNewVisit={() => undefined} scope={scope} online /></QueryClientProvider>
  );
  const view = render(frame(visitA));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  await screen.findByLabelText(t('en', 'sessionTips.total'));
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.total')), { target: { value: '1.000' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.useSuggestion') }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));

  view.rerender(frame(visitB));
  view.rerender(frame(visitA));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  const retryButton = await screen.findByRole('button', { name: t('en', 'sessionTips.retrySame') });
  await act(async () => { resolveFirst({ data: savedTips, response: { status: 200 } }); });
  fireEvent.click(retryButton);
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
  expect(api.put.mock.calls[1]?.[1].params.header['Idempotency-Key']).toBe(api.put.mock.calls[0]?.[1].params.header['Idempotency-Key']);
});

it('closes open tip and saved-line editors and resets drafts when operator scope changes (#406)', async () => {
  api.get.mockImplementation((path: string) =>
    Promise.resolve(
      path === sessionTipsPath
        ? { data: { revision: 0, tips: [], total_cash: '0.000', total_card: '0.000' }, response: { status: 200 } }
        : { error: { code: 'SESSION_NOT_FOUND', message_ar: 'x', message_en: 'x' }, response: { status: 404 } },
    ),
  );
  const stubJournal = { leaveVisit: () => undefined };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const frame = (activeScope: typeof scope) => (
    <QueryClientProvider client={client}><SessionSavedResult result={result as SessionRecordingResult} journal={stubJournal} onNewVisit={() => undefined} scope={activeScope} online /></QueryClientProvider>
  );
  const view = render(frame(scope));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.edit') }));
  const reasonInput = screen.getByLabelText(t('en', 'serviceLineEdit.reason')) as HTMLInputElement;
  fireEvent.change(reasonInput, { target: { value: 'Operator A draft' } });
  expect(reasonInput.value).toBe('Operator A draft');

  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  const input = (await screen.findByLabelText(t('en', 'sessionTips.total'))) as HTMLInputElement;
  fireEvent.change(input, { target: { value: '2.000' } });
  expect(input.value).toBe('2.000');

  view.rerender(frame({ ...scope, userId: id(98) }));
  expect(screen.queryByLabelText(t('en', 'sessionTips.total'))).toBeNull();
  expect(screen.queryByLabelText(t('en', 'serviceLineEdit.reason'))).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.edit') }));
  expect((screen.getByLabelText(t('en', 'serviceLineEdit.reason')) as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  const reopened = (await screen.findByLabelText(t('en', 'sessionTips.total'))) as HTMLInputElement;
  expect(reopened.value).not.toBe('2.000');
});

async function submitQuickTip() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.open') }));
  await screen.findByLabelText(t('en', 'sessionTips.total'));
  fireEvent.change(screen.getByLabelText(t('en', 'sessionTips.total')), { target: { value: '1.000' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.useSuggestion') }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'sessionTips.save') }));
}

it('isolates 401 tip denials across operator switches including late 401 save responses (#406)', async () => {
  const unauth = { error: { code: 'UNAUTHENTICATED', message_ar: 'Unauth AR', message_en: 'Unauth EN' }, response: { status: 401 } };
  api.get.mockResolvedValue({ data: { revision: 0, tips: [], total_cash: '0.000', total_card: '0.000' }, response: { status: 200 } });
  let resolveFirst: (value: unknown) => void = () => undefined;
  api.put.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; })).mockResolvedValueOnce(unauth);
  const stubJournal = { leaveVisit: () => undefined };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const frame = (activeScope: typeof scope) => (
    <QueryClientProvider client={client}><SessionSavedResult result={result as SessionRecordingResult} journal={stubJournal} onNewVisit={() => undefined} scope={activeScope} online /></QueryClientProvider>
  );
  const view = render(frame(scope));
  await submitQuickTip();
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));

  view.rerender(frame({ ...scope, userId: id(98) }));
  await act(async () => { resolveFirst(unauth); });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Synthetic service')).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'sessionTips.open') })).toBeTruthy();

  await submitQuickTip();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Synthetic service')).toBeNull();

  view.rerender(frame({ ...scope, userId: id(99) }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Synthetic service')).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'sessionTips.open') })).toBeTruthy();

  view.rerender(frame({ ...scope, userId: id(98) }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Synthetic service')).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'sessionTips.open') })).toBeTruthy();
});

function startLineEdit(reason: string) {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.edit') }));
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: reason } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
}

it('hides stale snapshot figures after an operator switch following a line edit and stops stale PATCH retry on unmount (#406)', async () => {
  api.get.mockResolvedValue({ error: { code: 'SESSION_NOT_FOUND', message_ar: 'x', message_en: 'x' }, response: { status: 404 } });
  let resolveStale: (value: unknown) => void = () => undefined;
  api.patch.mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
    .mockResolvedValueOnce({ data: { saved: true, edited: true }, response: { status: 200 } });
  const stubJournal = { leaveVisit: () => undefined };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const frame = (activeScope: typeof scope) => (
    <QueryClientProvider client={client}><SessionSavedResult result={result as SessionRecordingResult} journal={stubJournal} onNewVisit={() => undefined} scope={activeScope} online /></QueryClientProvider>
  );
  const view = render(frame(scope));
  startLineEdit('Operator A stale retry');
  await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));

  view.rerender(frame({ ...scope, userId: id(98) }));
  await act(async () => {
    resolveStale({ error: { code: 'SESSION_LINE_REVISION_STALE', message_ar: 'Stale AR', message_en: 'Stale EN', details: { current_revision: 2 } }, response: { status: 409 } });
  });
  expect(api.patch).toHaveBeenCalledTimes(1);

  startLineEdit('Operator B narrow save');
  expect(await screen.findByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeTruthy();
  expect(screen.queryByText('7.125')).toBeNull();

  view.rerender(frame({ ...scope, userId: id(99) }));
  expect(screen.getByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeTruthy();
  expect(screen.queryByText('7.125')).toBeNull();
  expect(screen.queryByText('6.412')).toBeNull();
});
