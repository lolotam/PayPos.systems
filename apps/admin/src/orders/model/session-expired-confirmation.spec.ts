import { afterEach, expect, it, vi } from 'vitest';
import { SESSION_ATTEMPT_RETENTION_MS, SESSION_ATTEMPT_SAFETY_MARGIN_MS } from './session-attempt';
import { createSessionAttemptJournal, type SessionAttemptJournal } from './session-attempt-journal';
import { confirmExpiredRecording, emptySessionRecordingResult, sessionResultFrozen, transitionSessionRecordingResult as transition } from './session-recording-result';
import { attempt, id, initial, inputLine, instant, recordAttempt, response, scope } from './session-recording-result.fixture';

const journals: SessionAttemptJournal[] = [];
const retention = SESSION_ATTEMPT_RETENTION_MS + SESSION_ATTEMPT_SAFETY_MARGIN_MS;
const expiredEntry = { version: 1 as const, state: 'EXPIRED' as const, scope, key: attempt.key, createdAt: attempt.createdAt, lastSentAt: attempt.createdAt };
afterEach(() => {
  journals.splice(0).forEach((journal) => { journal.changeScope(null); journal.dispose(); });
  sessionStorage.clear();
});

async function expire(kind: 'record' | 'append' = 'record') {
  let now = Date.parse(instant), next = 120;
  const journal = createSessionAttemptJournal(scope, { now: () => now, newId: () => id(next++) });
  journals.push(journal);
  const command = kind === 'append'
    ? { kind: 'append' as const, sessionId: id(12), body: { lines: [inputLine] } }
    : { kind: 'record' as const, body: { customer_id: id(7), lines: [inputLine] } };
  const started = journal.begin(command, [id(9)]);
  await expect(journal.run(started, () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
  now += retention;
  const entry = journal.read();
  if (entry?.state !== 'EXPIRED') throw new Error('expected EXPIRED');
  return { journal, entry };
}

it('keeps in-tab drafts after NOT_RECORDED and the next begin uses a new key', async () => {
  const { journal, entry } = await expire();
  const expired = transition(initial, { type: 'JOURNAL', entry });
  const next = confirmExpiredRecording(expired, journal, 'NOT_RECORDED', vi.fn(async () => undefined));
  expect(next.drafts.lines.map((line) => line.local_id)).toEqual(initial.drafts.lines.map((line) => line.local_id));
  expect(next.feedback.kind).toBe('IDLE'); expect(next.expiredAttempt).toBeNull(); expect(sessionResultFrozen(next)).toBe(false);
  expect(journal.begin({ kind: 'record', body: { customer_id: id(7), lines: [inputLine] } }, [id(9)]).key).not.toBe(entry.key);
});

it('leaves an empty form when NOT_RECORDED follows a reloaded EXPIRED envelope', async () => {
  const { journal, entry } = await expire();
  const cold = transition(emptySessionRecordingResult(), { type: 'JOURNAL', entry });
  expect(cold.drafts.lines).toEqual([]); expect(cold.expiredAttempt?.key).toBe(entry.key);
  const next = confirmExpiredRecording(cold, journal, 'NOT_RECORDED', vi.fn(async () => undefined));
  expect(next.drafts.lines).toEqual([]); expect(next.feedback.kind).toBe('IDLE'); expect(next.expiredAttempt).toBeNull();
});

it('drops drafts and the marker when a create is confirmed as recorded elsewhere', async () => {
  const { journal, entry } = await expire();
  const next = confirmExpiredRecording(transition(initial, { type: 'JOURNAL', entry }), journal, 'RECORDED_ELSEWHERE', vi.fn(async () => undefined));
  expect(next.drafts.lines).toEqual([]); expect(next.session).toBeNull(); expect(next.customer).toBeNull();
  expect(next.feedback.kind).toBe('IDLE'); expect(next.expiredAttempt).toBeNull(); expect(journal.read()).toBeNull();
});

it('returns an append to the saved visit without drafts when she confirms it was recorded', async () => {
  const { journal, entry } = await expire('append');
  const saved = transition(initial, { type: 'RECORDED', attempt: recordAttempt, response: { ...response, outcome: 'COMPLETE', rejected_lines: [] } });
  const next = confirmExpiredRecording(transition(saved, { type: 'JOURNAL', entry }), journal, 'RECORDED_ELSEWHERE', vi.fn(async () => undefined));
  expect(next.session).toBe(saved.session); expect(next.sessionId).toBe(id(12)); expect(next.drafts.lines).toEqual([]);
  expect(next.feedback.kind).toBe('COMPLETE'); expect(journal.read()).toBeNull();
});

it('keeps the append session id when the saved visit is not loaded in this tab', async () => {
  const { journal, entry } = await expire('append');
  const expired = transition(emptySessionRecordingResult(), { type: 'JOURNAL', entry });
  expect(expired.session).toBeNull(); expect(expired.sessionId).toBe(id(12));
  const next = confirmExpiredRecording(expired, journal, 'RECORDED_ELSEWHERE', vi.fn(async () => undefined));
  expect(next.session).toBeNull(); expect(next.sessionId).toBe(id(12)); expect(next.feedback.kind).toBe('IDLE'); expect(next.drafts.lines).toEqual([]);
});

it('sends one revoke for either confirmation and still clears when that revoke fails', async () => {
  for (const outcome of ['RECORDED_ELSEWHERE', 'NOT_RECORDED'] as const) {
    const { journal, entry } = await expire();
    const revoke = vi.fn(() => Promise.reject(new Error('offline')));
    const next = confirmExpiredRecording(transition(initial, { type: 'JOURNAL', entry }), journal, outcome, revoke);
    await Promise.resolve();
    expect(revoke).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ outcome, key: entry.key }));
    expect(journal.read()).toBeNull(); expect(next.expiredAttempt).toBeNull();
  }
});

it('does not revoke when confirmation cannot clear the marker', async () => {
  const expired = transition(initial, { type: 'JOURNAL', entry: expiredEntry });
  const revoke = vi.fn();
  expect(() => confirmExpiredRecording(expired, { confirm() { throw new Error('SESSION_ATTEMPT_NOT_PERSISTED'); } }, 'NOT_RECORDED', revoke)).toThrow('SESSION_ATTEMPT_NOT_PERSISTED');
  await Promise.resolve();
  expect(revoke).not.toHaveBeenCalled(); expect(expired.feedback.kind).toBe('EXPIRED');
});

it('keeps the expired view across a storage warning and clears it when the journal disappears', () => {
  const expired = transition(initial, { type: 'JOURNAL', entry: expiredEntry });
  expect(expired.expiredAttempt).toMatchObject({ key: attempt.key, operation: 'record-service-session', lastSentAt: attempt.createdAt });
  expect(expired.drafts.lines).toHaveLength(initial.drafts.lines.length);
  const warned = transition(expired, { type: 'JOURNAL', entry: expiredEntry, persistenceWarning: 'NOT_PERSISTED' });
  expect(warned.feedback.kind).toBe('EXPIRED'); expect(warned.expiredAttempt?.key).toBe(attempt.key);
  expect(transition(expired, { type: 'JOURNAL', entry: null })).toEqual(emptySessionRecordingResult(initial.customer));
});
