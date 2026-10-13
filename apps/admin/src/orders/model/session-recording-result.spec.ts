import { afterEach, expect, it, vi } from 'vitest';
import { serviceSessionErrors } from '@pospay/i18n';
import { freezeSessionAttempt, SessionSavedDisplayFailure, type SessionJournalEnvelope } from './session-attempt';
import { createSessionAttemptJournal } from './session-attempt-journal';
import { emptySessionRecordingResult, newSessionVisit, sessionResultCommand, sessionResultFrozen, sessionResultLate, transitionSessionRecordingResult as transition } from './session-recording-result';
import { appendAttempt, attempt, discountError, id, initial, inputLine, instant, recordAttempt, rejection, response, savedLine, scope } from './session-recording-result.fixture';
import { sessionPerformerInputs } from './session-drafts';

afterEach(() => sessionStorage.clear());
const recordedAttempt = { ...recordAttempt, body: { ...recordAttempt.body, recorder_membership_id: id(8), occurred_at: instant } };
const recorded = () => transition(initial, { type: 'RECORDED', attempt: recordedAttempt, response });
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
    const inputs = (drafts: typeof state.drafts) => drafts.lines.map((row) => [row.local_id, row.price, row.discount_kind, row.discount_amount, row.discount_percentage, row.performers]);
    expect(inputs(result.drafts)).toEqual(inputs(state.drafts)); expect(result.sessionId).toBe(kind === 'record' ? null : id(12));
    const retry = journal.begin(sessionResultCommand(result, [inputLine]), [id(10)]);
    expect(retry.kind).toBe(kind); expect(retry.key).not.toBe(pending.key);
  } finally { journal.changeScope(null); journal.dispose(); }
});
it.each(['SESSION_RECORDER_MEMBERSHIP_REQUIRED', 'SESSION_TIME_TOO_OLD', 'SESSION_PERFORMER_SHARES_INVALID', 'SESSION_PERFORMER_SELF_FORBIDDEN', 'SESSION_LINE_CAPACITY_EXCEEDED', 'SESSION_TOTAL_TOO_LARGE'] as const)('preserves drafts without partial success on %s', (code) => {
  const error = { status: code === 'SESSION_PERFORMER_SELF_FORBIDDEN' ? 403 : 422, code, ...serviceSessionErrors[code] };
  const result = transition(initial, { type: 'FAILED', attempt, error });
  expect(result.drafts.lines).toBe(initial.drafts.lines); expect(result.session).toBeNull(); expect(result.feedback).toEqual({ kind: 'ERROR', error, refreshScope: error.status === 403 });
  const settled = transition(result, { type: 'JOURNAL', entry: null });
  expect(settled).toEqual(result); expect(settled.drafts.lines).toBe(initial.drafts.lines);
});
it.each([new TypeError('Network'), { status: 409, code: 'IDEMPOTENCY_KEY_IN_PROGRESS', message_ar: 'retry', message_en: 'retry' }])('freezes an unresolved attempt for identical replay', (error) => {
  const result = transition(initial, { type: 'FAILED', attempt, error });
  expect(result.attempt).toBe(attempt); expect(sessionResultFrozen(result)).toBe(true); expect(result.drafts.lines).toBe(initial.drafts.lines);
  expect(() => sessionResultCommand(result, [inputLine])).toThrow('UNRESOLVED');
});
it('idempotency reuse with rejection-looking details remains an atomic error on the saved visit', () => {
  const first = recorded(), error = { ...discountError, code: 'IDEMPOTENCY_KEY_REUSED', message_ar: 'synthetic', message_en: 'synthetic' };
  const result = transition(first, { type: 'FAILED', attempt: { ...appendAttempt, rowIds: [id(10)], body: { lines: [inputLine] } }, error });
  expect(result.feedback.kind).toBe('ERROR'); expect(result.drafts.lines).toBe(first.drafts.lines); expect(result.session).toBe(first.session); expect(result.rejected).toEqual([]);
});
it('clears a PARTIAL visit left elsewhere or switches to a different saved visit', () => {
  const old = recorded(), empty = transition(old, { type: 'JOURNAL', entry: null });
  expect(empty).toEqual(emptySessionRecordingResult(old.customer)); expect(sessionResultCommand(empty, [inputLine]).kind).toBe('record');
  const switched = transition(old, { type: 'JOURNAL', entry: { version: 1, state: 'PARTIAL', scope, sessionId: id(99) } });
  expect(switched).toEqual({ ...emptySessionRecordingResult(old.customer), sessionId: id(99) });
});
it.each(['NOT_PERSISTED', 'SAVING', 'UNRESOLVED'] as const)('a matching partial journal restores stale %s feedback', (kind) => {
  const stale = { ...recorded(), attempt, feedback: { kind }, persistenceWarning: 'NOT_PERSISTED' as const };
  const result = transition(stale, { type: 'JOURNAL', entry: { version: 1, state: 'PARTIAL', scope, sessionId: id(12) } });
  expect(result.feedback.kind).toBe('PARTIAL'); expect(result.attempt).toBeNull(); expect(sessionResultFrozen(result)).toBe(false);
});
it.each(['SAVING', 'UNRESOLVED'] as const)('a settled journal still clears a pending %s visit', (kind) => {
  const stale = { ...recorded(), attempt, feedback: { kind }, persistenceWarning: 'NOT_PERSISTED' as const };
  expect(transition(stale, { type: 'JOURNAL', entry: null })).toEqual(emptySessionRecordingResult(stale.customer));
});
it('a null journal restores a saved visit whose feedback was only a storage warning', () => {
  const stale = { ...recorded(), attempt, feedback: { kind: 'NOT_PERSISTED' as const }, persistenceWarning: 'NOT_PERSISTED' as const };
  const result = transition(stale, { type: 'JOURNAL', entry: null });
  expect(result.session).toBe(stale.session); expect(result.rejected).toEqual(stale.rejected); expect(result.drafts.lines).toEqual(stale.drafts.lines);
  expect(result.feedback).toEqual({ kind: 'PARTIAL' }); expect(result.persistenceWarning).toBeNull(); expect(result.attempt).toBeNull();
});
it.each(['record', 'append'] as const)('a %s success clears stale storage warnings and retains only a fresh warning', (kind) => {
  const stale = { ...emptySessionRecordingResult(), persistenceWarning: 'NOT_PERSISTED' as const };
  const event = kind === 'record' ? { type: 'RECORDED' as const, attempt: recordAttempt, response }
    : { type: 'APPENDED' as const, attempt: appendAttempt, response: { ...response, added_lines: [savedLine] } };
  expect(sessionResultFrozen(transition(stale, event))).toBe(false);
  expect(sessionResultFrozen(transition(stale, { ...event, persistenceWarning: 'NOT_PERSISTED' }))).toBe(true);
});
it.each(['record', 'append'] as const)('restores a cold %s replay, retaining rejected rows for correction on the same visit', (kind) => {
  const body = { recorder_membership_id: id(8), lines: [inputLine, { ...inputLine, price: '8.000', discount: { kind: 'AMOUNT' as const, amount: '2.000' },
    performers: [{ employee_id: id(6), share_bps: 7000 }, { employee_id: id(17), share_bps: 3000 }] }] };
  const frozen = kind === 'record' ? { ...recordAttempt, body: { ...body, customer_id: id(7), occurred_at: instant } } : { ...appendAttempt, body };
  const pending = transition(emptySessionRecordingResult(), { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt: frozen } });
  expect(pending.drafts.lines.map((line) => line.local_id)).toEqual(frozen.rowIds); expect(pending.sessionId).toBe(kind === 'append' ? id(12) : null);
  const row = pending.drafts.lines[1]; if (!row) throw new Error('Missing recovered draft');
  expect(row).toMatchObject({ price: '8.000', discount_kind: 'AMOUNT', discount_amount: '2.000', share_mode: 'CUSTOM' });
  expect(sessionPerformerInputs(row)).toEqual(frozen.body.lines[1]?.performers);
  const replay = { ...response, rejected_lines: [{ ...rejection, price: '8.000', discount: '2.000', net: '6.000', effective_discount_bps: 1579, max_discount_amount: '1.587' }] };
  const result = frozen.kind === 'record' ? transition(pending, { type: 'RECORDED', attempt: frozen, response: replay })
    : transition(pending, { type: 'APPENDED', attempt: frozen, response: { ...replay, added_lines: [savedLine] } });
  expect(result.drafts.lines).toHaveLength(1); expect(result.drafts.lines[0]).toMatchObject({ local_id: row.local_id, price: row.price,
    discount_amount: row.discount_amount, performers: row.performers, service: { id: row.service_id, name_en: rejection.name_en, price: rejection.list_price } });
  expect(result.rejected[0]?.localId).toBe(row.local_id);
  expect(sessionResultCommand(result, [inputLine])).toMatchObject({ kind: 'append', sessionId: id(12) });
});
it('restores missing rejected rows even if the replay response arrives without a pending projection', () => {
  const result = transition(emptySessionRecordingResult(), { type: 'RECORDED', attempt: recordAttempt, response });
  expect(result.drafts.lines[0]).toMatchObject({ local_id: id(10), price: inputLine.price, discount_kind: 'PERCENT', discount_percentage: '10.00' });
});
it.each([400, 403, 422])('a cold append with definite %s retains its target and editable drafts', (status) => {
  const pending = transition(emptySessionRecordingResult(), { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt: appendAttempt } });
  const result = transition(pending, { type: 'FAILED', attempt: appendAttempt, error: { status, code: 'SESSION_TIME_TOO_OLD', ...serviceSessionErrors.SESSION_TIME_TOO_OLD } });
  expect(result.sessionId).toBe(id(12)); expect(result.drafts.lines).toHaveLength(2); expect(sessionResultFrozen(result)).toBe(false);
  expect(sessionResultCommand(result, [inputLine])).toMatchObject({ kind: 'append', sessionId: id(12) });
});
it('a cold all-rejected creation retains its frozen customer ID for another creation', () => {
  const result = transition(emptySessionRecordingResult(), { type: 'FAILED', attempt: recordAttempt, error: discountError });
  expect(result.drafts.lines).toHaveLength(2); expect(sessionResultCommand(result, [inputLine])).toMatchObject({ kind: 'record', body: { customer_id: id(7) } });
});
it('drops a stale selected customer so recovered creation retries and same-customer visits belong to the frozen customer', () => {
  const customerId = id(77), frozen = { ...recordAttempt, rowIds: [id(10)], body: { customer_id: customerId, lines: [inputLine] } };
  const pending = transition(emptySessionRecordingResult(initial.customer), { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt: frozen } });
  expect(pending.customer).toBeNull(); expect(pending.customerId).toBe(customerId);
  const refused = transition(pending, { type: 'FAILED', attempt: frozen, error: { ...discountError, details: { rejected_lines: [{ ...rejection, input_index: 0 }] } } });
  expect(sessionResultCommand(refused, [inputLine])).toMatchObject({ kind: 'record', body: { customer_id: customerId } });
  const customer = { ...response.session.customer, id: customerId, name: 'Recovered synthetic customer' };
  const complete = transition(refused, { type: 'RECORDED', attempt: frozen, response: { ...response, outcome: 'COMPLETE', rejected_lines: [], session: { ...response.session, customer } } });
  expect(newSessionVisit(complete, { leaveVisit: vi.fn() }, true).customer).toEqual({ id: customerId, name: customer.name, phone: customer.phone_masked });
});
it.each([null, { version: 1, state: 'PARTIAL', scope, sessionId: id(12) }, { version: 1, state: 'PARTIAL', scope, sessionId: id(99) },
  { version: 1, state: 'PENDING', attempt: { ...appendAttempt, rowIds: [id(10)], body: { lines: [inputLine] } } },
  { version: 1, state: 'PENDING', attempt: { ...appendAttempt, sessionId: id(99), route: `${attempt.route}/${id(99)}/lines` } },
  { version: 1, state: 'EXPIRED', scope, key: attempt.key, createdAt: attempt.createdAt, sessionId: id(99) },
  { version: 1, state: 'SAVED_DISPLAY_FAILED', scope, sessionId: id(99) }] satisfies (SessionJournalEnvelope | null)[])('storage warnings preserve the saved PARTIAL visit and drafts for journal %j', (entry) => {
  const saved = recorded(); let result = saved;
  for (let repeat = 0; repeat < 2; repeat++) {
    result = transition(result, { type: 'JOURNAL', entry, persistenceWarning: 'NOT_PERSISTED' });
    expect(result.session).toBe(saved.session); expect(result.sessionId).toBe(saved.sessionId); expect(result.drafts.lines).toEqual(saved.drafts.lines);
    expect(result.rejected).toEqual(saved.rejected); expect(sessionResultFrozen(result)).toBe(true);
  }
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
  const settled = transition(complete, { type: 'JOURNAL', entry: null });
  expect(settled).toEqual(complete); expect(sessionResultCommand(settled, [inputLine])).toMatchObject({ kind: 'append', sessionId: id(12) });
  expect(complete.drafts.lines).toEqual([]); expect(newSessionVisit(complete, { leaveVisit }, false)).toEqual(emptySessionRecordingResult());
  expect(newSessionVisit(complete, { leaveVisit }, true)).toEqual(emptySessionRecordingResult(initial.customer)); expect(leaveVisit).toHaveBeenCalledTimes(2);
  expect(() => newSessionVisit(complete, { leaveVisit: () => { throw new Error('storage'); } }, false)).toThrow('storage');
});
const completeResponse = { ...response, outcome: 'COMPLETE' as const, rejected_lines: [] };
it('keeps a saved complete visit when a storage warning appears and then clears', () => {
  const complete = transition(initial, { type: 'RECORDED', attempt: recordAttempt, response: completeResponse });
  const warned = transition(complete, { type: 'JOURNAL', entry: null, persistenceWarning: 'NOT_PERSISTED' });
  expect(warned.session).toBe(complete.session); expect(warned.feedback).toEqual({ kind: 'COMPLETE' });
  const cleared = transition(warned, { type: 'JOURNAL', entry: null });
  expect(cleared.session).toBe(complete.session); expect(cleared.sessionId).toBe(complete.sessionId);
  expect(cleared.addedLineIds).toEqual(complete.addedLineIds); expect(cleared.customer).toEqual(complete.customer);
  expect(cleared.feedback).toEqual({ kind: 'COMPLETE' });
});
it('keeps rejected drafts when a storage warning clears on a saved partial visit', () => {
  const saved = recorded();
  const warned = transition(saved, { type: 'JOURNAL', entry: null, persistenceWarning: 'NOT_PERSISTED' });
  expect(warned.session).toBe(saved.session); expect(warned.feedback).toEqual({ kind: 'PARTIAL' });
  const cleared = transition(warned, { type: 'JOURNAL', entry: null });
  expect(cleared.session).toBe(saved.session); expect(cleared.sessionId).toBe(saved.sessionId);
  expect(cleared.rejected).toEqual(saved.rejected); expect(cleared.drafts.lines).toEqual(saved.drafts.lines);
  expect(cleared.customer).toEqual(saved.customer); expect(cleared.feedback).toEqual({ kind: 'PARTIAL' });
});
it.each(['SAVING', 'UNRESOLVED'] as const)('a null journal still clears a pending %s visit that saved nothing', (kind) => {
  const pending = transition(initial, { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt }, inFlight: kind === 'SAVING' });
  expect(pending.feedback.kind).toBe(kind); expect(pending.session).toBeNull();
  expect(transition(pending, { type: 'JOURNAL', entry: null })).toEqual(emptySessionRecordingResult(initial.customer));
});
it('a recovered complete creation keeps the attempt membership when every draft row was already present', () => {
  const membership = id(28), occurredAt = '2026-09-01T00:00:00.000Z';
  const frozen = freezeSessionAttempt(scope, { kind: 'record', body: { customer_id: id(7), recorder_membership_id: membership, occurred_at: occurredAt, lines: [inputLine, inputLine] } }, [id(9), id(10)], { now: () => Date.parse(instant), newId: () => id(30) });
  if (frozen.kind !== 'record') throw new Error('Invalid record fixture');
  const pending = transition(initial, { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt: frozen } });
  expect(pending.drafts.lines.map((line) => line.local_id)).toEqual([id(9), id(10)]);
  expect(pending.drafts.recorder_membership_id).toBe(membership); expect(pending.drafts.occurred_at).toBe(occurredAt);
  const complete = transition(pending, { type: 'RECORDED', attempt: frozen, response: completeResponse });
  expect(sessionResultCommand(complete, [inputLine])).toEqual({ kind: 'append', sessionId: id(12), body: { lines: [inputLine], recorder_membership_id: membership } });
});
it.each(['journal', 'recorded', 'failed', 'appended'] as const)('recovery via %s without recorder_membership_id clears a stale draft selection', (path) => {
  const state = path === 'appended' ? { ...initial, sessionId: appendAttempt.sessionId } : initial;
  const error = { status: 422, code: 'SESSION_TIME_TOO_OLD' as const, ...serviceSessionErrors.SESSION_TIME_TOO_OLD };
  const result = path === 'journal' ? transition(state, { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt: recordAttempt } })
    : path === 'failed' ? transition(state, { type: 'FAILED', attempt: recordAttempt, error })
    : path === 'recorded' ? transition(state, { type: 'RECORDED', attempt: recordAttempt, response: completeResponse })
    : transition(state, { type: 'APPENDED', attempt: appendAttempt, response: { ...completeResponse, added_lines: [savedLine] } });
  expect(result.drafts.recorder_membership_id).toBeNull();
  expect(result.drafts.occurred_at).toBe(path === 'appended' ? instant : undefined);
});
