import { afterEach, expect, it, vi } from 'vitest';
import { serviceSessionErrors } from '@pospay/i18n';
import { SessionSavedDisplayFailure } from './session-attempt';
import { createSessionAttemptJournal } from './session-attempt-journal';
import { emptySessionRecordingResult, newSessionVisit, sessionResultCommand, sessionResultFrozen, sessionResultLate, transitionSessionRecordingResult as transition } from './session-recording-result';
import { attempt, discountError, id, initial, inputLine, instant, recordAttempt, rejection, response, savedLine, scope } from './session-recording-result.fixture';

afterEach(() => sessionStorage.clear());
const recorded = () => transition(initial, { type: 'RECORDED', attempt: recordAttempt, response });
it('maps duplicate services by the frozen request index after local reordering; replay is idempotent', () => {
  const result = transition({ ...initial, drafts: { ...initial.drafts, lines: [...initial.drafts.lines].reverse() } }, { type: 'RECORDED', attempt: recordAttempt, response });
  expect(result.drafts.lines.map((line) => line.local_id)).toEqual([id(10)]);
  expect(result.rejected[0]?.localId).toBe(id(10)); expect(result.session).toBe(response.session);
  expect(transition(result, { type: 'RECORDED', attempt: recordAttempt, response })).toEqual(result);
});
it('replaces the full visit through repeated partial/complete appends, preserving headers and only current rejections', () => {
  const first = recorded(), command = sessionResultCommand(first, [inputLine]);
  expect(command).toEqual({ kind: 'append', sessionId: id(12), body: { lines: [inputLine], recorder_membership_id: id(8) } });
  const appendedAttempt = { ...attempt, kind: 'append' as const, sessionId: id(12), body: { lines: [inputLine, inputLine] }, rowIds: [id(10), id(14)] };
  const extra = { ...savedLine, id: id(15), ordinal: 2, input_index: 0, late: true };
  const nextResponse = { ...response, session: { ...response.session, total_net: '12.824', lines: [savedLine, extra] }, added_lines: [extra] };
  const a = initial.drafts.lines[0], b = initial.drafts.lines[1]; if (!a || !b) throw new Error('Missing fixture drafts');
  const next = transition({ ...first, drafts: { ...first.drafts, lines: [b, { ...a, local_id: id(14) }] } }, { type: 'APPENDED', attempt: appendedAttempt, response: nextResponse });
  expect(next.session).toBe(nextResponse.session); expect(next.addedLineIds).toEqual([id(15)]); expect(next.drafts.lines.map((line) => line.local_id)).toEqual([id(14)]);
  if (!next.session) throw new Error('Missing saved session');
  expect(sessionResultLate(next.session)).toBe(true); expect(next.rejected[0]?.localId).toBe(id(14));
  const finalResponse = { ...nextResponse, outcome: 'COMPLETE' as const, rejected_lines: [], added_lines: [{ ...extra, id: id(16), ordinal: 3 }],
    session: { ...nextResponse.session, total_net: '19.236', lines: [...nextResponse.session.lines, { ...extra, id: id(16), ordinal: 3 }] } };
  const final = transition(next, { type: 'APPENDED', attempt: { ...appendedAttempt, rowIds: [id(14)] }, response: finalResponse });
  expect(final.drafts.lines).toEqual([]); expect(final.rejected).toEqual([]); expect(final.session?.total_net).toBe('19.236');
  expect(final.session?.occurred_at).toBe(instant); expect(final.session?.lines[0]).toBe(savedLine);
  expect(transition(final, { type: 'APPENDED', attempt: appendedAttempt, response: finalResponse })).toEqual(final);
  expect(sessionResultCommand(final, [inputLine]).kind).toBe('append');
});
it.each(['record', 'append'] as const)('keeps the appropriate drafts and visit on all-rejected %s; corrections use a new key', async (kind) => {
  const state = kind === 'record' ? initial : recorded(), journal = createSessionAttemptJournal(scope, { now: () => Date.parse(instant), newId: vi.fn().mockReturnValueOnce(id(21)).mockReturnValueOnce(id(22)) });
  try {
    const command = sessionResultCommand(state, [inputLine]), pending = journal.begin(command, [id(10)]);
    const error = { ...discountError, details: { rejected_lines: [{ ...rejection, input_index: 0 }] } };
    await expect(journal.run(pending, () => Promise.reject(error))).rejects.toBe(error);
    const result = transition(state, { type: 'FAILED', attempt: pending, error });
    expect(result.drafts.lines).toEqual(state.drafts.lines); expect(result.sessionId).toBe(kind === 'record' ? null : id(12));
    const retry = journal.begin(sessionResultCommand(result, [inputLine]), [id(10)]);
    expect(retry.kind).toBe(kind); expect(retry.key).not.toBe(pending.key);
  } finally { journal.changeScope(null); journal.dispose(); }
});
it.each(['SESSION_RECORDER_MEMBERSHIP_REQUIRED', 'SESSION_TIME_TOO_OLD', 'SESSION_PERFORMER_SHARES_INVALID', 'SESSION_PERFORMER_SELF_FORBIDDEN', 'SESSION_LINE_CAPACITY_EXCEEDED', 'SESSION_TOTAL_TOO_LARGE'] as const)('preserves drafts without partial success on %s', (code) => {
  const error = { status: code === 'SESSION_PERFORMER_SELF_FORBIDDEN' ? 403 : 422, code, ...serviceSessionErrors[code] };
  const result = transition(initial, { type: 'FAILED', attempt, error });
  expect(result.drafts).toBe(initial.drafts); expect(result.session).toBeNull(); expect(result.feedback).toEqual({ kind: 'ERROR', error, refreshScope: error.status === 403 });
});
it.each([new TypeError('Network'), { status: 409, code: 'IDEMPOTENCY_KEY_IN_PROGRESS', message_ar: 'retry', message_en: 'retry' }])('freezes an unresolved attempt for identical replay', (error) => {
  const result = transition(initial, { type: 'FAILED', attempt, error });
  expect(result.attempt).toBe(attempt); expect(sessionResultFrozen(result)).toBe(true); expect(result.drafts).toBe(initial.drafts);
  expect(() => sessionResultCommand(result, [inputLine])).toThrow('UNRESOLVED');
});
it('idempotency reuse with rejection-looking details remains an atomic error on the saved visit', () => {
  const first = recorded(), error = { ...discountError, code: 'IDEMPOTENCY_KEY_REUSED', message_ar: 'synthetic', message_en: 'synthetic' };
  const result = transition(first, { type: 'FAILED', attempt, error });
  expect(result.feedback.kind).toBe('ERROR'); expect(result.drafts).toBe(first.drafts); expect(result.session).toBe(first.session); expect(result.rejected).toEqual([]);
});
it('replaying a pending write resolves the frozen result and keeps the authoritative header/line late OR', () => {
  const pending = transition(initial, { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt } });
  const result = transition(pending, { type: 'RECORDED', attempt: recordAttempt, response });
  expect(sessionResultFrozen(result)).toBe(false); expect(result.attempt).toBeNull(); expect(sessionResultLate(response.session)).toBe(false);
  expect(sessionResultLate({ ...response.session, late: true })).toBe(true);
});
it('projects journal safety states and saved-display failures without allowing a new visit', () => {
  for (const entry of [{ version: 1 as const, state: 'PENDING' as const, attempt },
    { version: 1 as const, state: 'EXPIRED' as const, scope, key: attempt.key, createdAt: attempt.createdAt },
    { version: 1 as const, state: 'SAVED_DISPLAY_FAILED' as const, scope, sessionId: id(12) }]) {
    const result = transition(initial, { type: 'JOURNAL', entry });
    expect(sessionResultFrozen(result)).toBe(true); expect(() => newSessionVisit(result, { leaveVisit: vi.fn() }, false)).toThrow();
  }
  expect(transition(initial, { type: 'JOURNAL', entry: null, persistenceWarning: 'NOT_PERSISTED' }).feedback.kind).toBe('NOT_PERSISTED');
  expect(transition(initial, { type: 'FAILED', attempt, error: new SessionSavedDisplayFailure(201, { session: { id: id(12) } }) }).sessionId).toBe(id(12));
  const saving = transition(initial, { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt }, inFlight: true });
  expect(saving.feedback.kind).toBe('SAVING');
});
it('COMPLETE clears drafts and new-visit choices leave the journal before clearing all or keeping only the customer', () => {
  const complete = transition(initial, { type: 'RECORDED', attempt: recordAttempt, response: { ...response, outcome: 'COMPLETE', rejected_lines: [] } }), leaveVisit = vi.fn();
  expect(complete.drafts.lines).toEqual([]); expect(newSessionVisit(complete, { leaveVisit }, false)).toEqual(emptySessionRecordingResult());
  expect(newSessionVisit(complete, { leaveVisit }, true)).toEqual(emptySessionRecordingResult(initial.customer)); expect(leaveVisit).toHaveBeenCalledTimes(2);
  expect(() => newSessionVisit(complete, { leaveVisit: () => { throw new Error('storage'); } }, false)).toThrow('storage');
});
