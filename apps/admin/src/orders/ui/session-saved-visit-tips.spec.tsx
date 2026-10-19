import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { sessionTipsPath } from '../api/use-session-tips';
import {
  initial,
  recordAttempt,
  response,
  savedLine,
  scope,
} from '../model/session-recording-result.fixture';
import {
  transitionSessionRecordingResult as transition,
  type SessionRecordingResult,
} from '../model/session-recording-result';
import { SessionSavedVisit } from './session-saved-visit';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: api.get }) }));
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
