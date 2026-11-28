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

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: api.get, PUT: api.put }) }));
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
