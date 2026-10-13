import { errorMessages, serviceSessionErrors, t } from '@pospay/i18n';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';
import { expect, it, vi } from 'vitest';
import type { SessionDraftForm } from '../model/session-drafts';
import { emptySessionRecordingResult, transitionSessionRecordingResult as transition, type SessionRecordingResult } from '../model/session-recording-result';
import { appendAttempt, attempt, discountError, id, initial, recordAttempt, rejection, response, savedLine, scope } from '../model/session-recording-result.fixture';
import { SessionDraftSummary } from './session-draft-summary';
import { SessionSavedResult } from './session-saved-result';
import { SessionRejectedLines } from './session-rejected-lines';
import { SessionWriteFeedback } from './session-write-feedback';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const partial = () => transition(initial, { type: 'RECORDED', attempt: recordAttempt, response });
function Harness({ result, leaveVisit = vi.fn(), onNewVisit = vi.fn(), onEdit = vi.fn(), onReplay = vi.fn() }: {
  result: SessionRecordingResult; leaveVisit?: () => void; onNewVisit?: (next: SessionRecordingResult) => void; onEdit?: (id: string) => void; onReplay?: () => void;
}) {
  const form = useForm<SessionDraftForm>({ defaultValues: result.drafts });
  return <div dir={state.locale === 'ar' ? 'rtl' : 'ltr'}><FormProvider {...form}>
    <SessionSavedResult result={result} journal={{ leaveVisit }} onNewVisit={onNewVisit} />
    <SessionRejectedLines result={result} onEdit={onEdit} /><SessionDraftSummary />
    <SessionWriteFeedback result={result} onReplay={onReplay} />
  </FormProvider></div>;
}
it.each(['ar', 'en'] as const)('shows separate saved/draft totals, read-only lines, request-index correction and both dated warnings in %s', (locale) => {
  state.locale = locale; const onEdit = vi.fn(), result = partial(), view = render(<Harness result={result} onEdit={onEdit} />);
  expect(view.container.firstElementChild?.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
  expect(screen.getByText(t(locale, 'serviceSessions.savedTotal')).textContent).toContain('6.412');
  expect(screen.getByText(t(locale, 'serviceSessions.draftTotal')).textContent).toContain('6.412');
  expect(screen.queryByText('12.824')).toBeNull(); expect(screen.getByText(t(locale, 'serviceSessions.readOnly'))).toBeTruthy();
  expect(view.container.querySelectorAll('input')).toHaveLength(0);
  expect(screen.getByText('33.34%')).toBeTruthy(); expect(screen.getAllByText('33.33%')).toHaveLength(2);
  for (const key of ['notClockedIn', 'approvedLeave'] as const) expect(screen.getByText((text) => text.includes(t(locale, `serviceSessions.${key}`)) && text.includes('Synthetic performer'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: t(locale, 'serviceSessions.newVisit') })).toBeNull();
  const rejected = screen.getByRole('region', { name: t(locale, 'serviceSessions.rejectedLines') });
  expect(document.activeElement).toBe(within(rejected).getByRole('alert'));
  for (const value of ['10.01', '10.00', '6.413', '0.712']) expect(within(rejected).getByText(value)).toBeTruthy();
  fireEvent.click(within(rejected).getByRole('button')); expect(onEdit).toHaveBeenCalledWith(id(10));
});
it('reports an unresolved attempt and storage failure together while disabling correction', () => {
  state.locale = 'en'; const result = transition(partial(), { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt: appendAttempt }, persistenceWarning: 'NOT_PERSISTED' });
  render(<Harness result={result} />);
  expect(screen.getByText(serviceSessionErrors.SESSION_ATTEMPT_NOT_PERSISTED.message_en)).toBeTruthy();
  expect(screen.getByText(t('en', 'serviceSessions.unresolved'))).toBeTruthy();
  expect((screen.getByRole('button', { name: t('en', 'serviceSessions.editRejected') }) as HTMLButtonElement).disabled).toBe(true);
});
it.each(['ar', 'en'] as const)('catches both journal leave failures and displays localized feedback in %s', (locale) => {
  state.locale = locale;
  const result = transition(initial, { type: 'RECORDED', attempt: recordAttempt, response: { ...response, outcome: 'COMPLETE', rejected_lines: [] } });
  for (const code of ['SESSION_ATTEMPT_NOT_PERSISTED', 'SESSION_ATTEMPT_UNRESOLVED']) {
    const onNewVisit = vi.fn(), view = render(<SessionSavedResult result={result} onNewVisit={onNewVisit} journal={{ leaveVisit: () => { throw new Error(code); } }} />);
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'serviceSessions.newVisit') })); expect(onNewVisit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(code === 'SESSION_ATTEMPT_NOT_PERSISTED'
      ? serviceSessionErrors.SESSION_ATTEMPT_NOT_PERSISTED[locale === 'ar' ? 'message_ar' : 'message_en'] : t(locale, 'serviceSessions.unresolved'));
    expect(screen.queryByRole('button')).toBeNull(); view.unmount();
  }
});
it.each([401, 403])('requests scope refresh once for an authority error with status %s', (status) => {
  const error = { status, code: 'FORBIDDEN', ...errorMessages('FORBIDDEN') }, onRefreshScope = vi.fn();
  const result = transition(initial, { type: 'FAILED', attempt, error });
  const view = render(<SessionWriteFeedback result={result} onRefreshScope={onRefreshScope} />); expect(onRefreshScope).toHaveBeenCalledTimes(1);
  view.rerender(<SessionWriteFeedback result={{ ...result }} onRefreshScope={() => onRefreshScope()} />); expect(onRefreshScope).toHaveBeenCalledTimes(1);
});
it('shows new-visit buttons after COMPLETE clears a stale storage warning', () => {
  state.locale = 'en'; const result = transition({ ...initial, persistenceWarning: 'NOT_PERSISTED' }, { type: 'RECORDED', attempt: recordAttempt,
    response: { ...response, outcome: 'COMPLETE', rejected_lines: [] } });
  render(<SessionSavedResult result={result} journal={{ leaveVisit: vi.fn() }} onNewVisit={vi.fn()} />);
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.newVisit') })).toBeTruthy();
});
it('uses authoritative late flags and identifies only newly added lines', () => {
  state.locale = 'en'; const result = partial(), extra = { ...savedLine, id: id(15), ordinal: 2, late: true };
  render(<Harness result={{ ...result, session: { ...response.session, lines: [...response.session.lines, extra], total_net: '12.824' }, addedLineIds: [extra.id] }} />);
  expect(screen.getByText(t('en', 'serviceSessions.late'))).toBeTruthy(); expect(screen.getAllByText(t('en', 'serviceSessions.newlySaved'))).toHaveLength(1);
});
it('tells reception to raise an already-too-low price rather than only removing its discount', () => {
  state.locale = 'en'; render(<Harness result={transition(initial, { type: 'FAILED', attempt, error: { ...discountError,
    details: { rejected_lines: [{ ...rejection, price: '6.000', discount: '0.000', net: '6.000', max_discount_amount: '0.000' }] } } })} />);
  expect(screen.getByText(t('en', 'serviceSessions.raisePrice'))).toBeTruthy();
});
it.each([false, true])('new visit same customer=%s calls leaveVisit and clears the complete result', (sameCustomer) => {
  state.locale = 'en'; const result = transition(initial, { type: 'RECORDED', attempt: recordAttempt, response: { ...response, outcome: 'COMPLETE', rejected_lines: [] } });
  const leaveVisit = vi.fn(), onNewVisit = vi.fn(() => expect(leaveVisit).toHaveBeenCalledTimes(1));
  render(<Harness result={result} leaveVisit={leaveVisit} onNewVisit={onNewVisit} />);
  fireEvent.click(screen.getByRole('button', { name: t('en', sameCustomer ? 'serviceSessions.newVisitSameCustomer' : 'serviceSessions.newVisit') }));
  expect(onNewVisit).toHaveBeenCalledWith(emptySessionRecordingResult(sameCustomer ? initial.customer : null));
});
it.each(['ar', 'en'] as const)('shows journal safety messages with replay only for a pending unresolved attempt in %s', (locale) => {
  state.locale = locale;
  const pending = transition(initial, { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt } }), onReplay = vi.fn();
  const view = render(<SessionWriteFeedback result={pending} onReplay={onReplay} />);
  fireEvent.click(screen.getByRole('button', { name: t(locale, 'serviceSessions.retryOriginal') })); expect(onReplay).toHaveBeenCalledTimes(1);
  for (const [entry, key] of [[{ version: 1 as const, state: 'EXPIRED' as const, scope, key: attempt.key, createdAt: attempt.createdAt }, 'expired'],
    [{ version: 1 as const, state: 'SAVED_DISPLAY_FAILED' as const, scope }, 'savedDisplayFailed']] as const) {
    view.rerender(<SessionWriteFeedback result={transition(initial, { type: 'JOURNAL', entry })} onReplay={onReplay} />);
    expect(screen.getByRole('alert').textContent).toBe(t(locale, `serviceSessions.${key}`)); expect(screen.queryByRole('button')).toBeNull();
  }
  view.rerender(<SessionWriteFeedback result={transition(initial, { type: 'JOURNAL', entry: null, persistenceWarning: 'NOT_PERSISTED' })} onReplay={onReplay} />);
  expect(screen.getByRole('alert').textContent).toBe(serviceSessionErrors.SESSION_ATTEMPT_NOT_PERSISTED[locale === 'ar' ? 'message_ar' : 'message_en']);
});
it.each(['SESSION_TIME_TOO_OLD', 'SESSION_PERFORMER_SELF_FORBIDDEN', 'SESSION_LINE_CAPACITY_EXCEEDED', 'IDEMPOTENCY_KEY_REUSED'] as const)('shows distinct atomic error %s', (code) => {
  state.locale = 'en'; const error = { status: 422, code, ...(code === 'IDEMPOTENCY_KEY_REUSED' ? errorMessages(code) : serviceSessionErrors[code]) };
  render(<SessionWriteFeedback result={transition(initial, { type: 'FAILED', attempt, error })} onReplay={vi.fn()} />);
  expect(screen.getByRole('alert').textContent).toBe(error.message_en); expect(screen.queryByRole('button')).toBeNull();
});
