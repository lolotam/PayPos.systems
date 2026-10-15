import { afterEach, expect, it } from 'vitest';
import { SESSION_ATTEMPT_RETENTION_MS, SESSION_ATTEMPT_SAFETY_MARGIN_MS } from './session-attempt';
import { createSessionAttemptJournal, type SessionAttemptJournal } from './session-attempt-journal';
import { id, inputLine, instant, response, scope } from './session-recording-result.fixture';

const journals: SessionAttemptJournal[] = [];
const refusal = { status: 422, code: 'SESSION_DISCOUNT_ABOVE_LIMIT', message_ar: 'Synthetic AR', message_en: 'Synthetic EN' };

function open() {
  let next = 40;
  const journal = createSessionAttemptJournal(scope, { now: () => Date.parse(instant), newId: () => id(next++) });
  journals.push(journal);
  return journal;
}

afterEach(() => {
  journals.splice(0).forEach((journal) => { journal.changeScope(null); journal.dispose(); });
  sessionStorage.clear();
});

function savedSession(sessionId: string, occurredAt: string) {
  return { ...response, outcome: 'COMPLETE' as const, rejected_lines: [], session: { ...response.session, id: sessionId, occurred_at: occurredAt } };
}

async function save(journal: SessionAttemptJournal, sessionId: string, occurredAt: string) {
  const attempt = journal.begin({ kind: 'record', body: { customer_id: id(7), lines: [inputLine, inputLine] } }, [id(9), id(10)]);
  await journal.run(attempt, async () => ({ status: 201, data: savedSession(sessionId, occurredAt) }));
}

async function refuse(journal: SessionAttemptJournal, sessionId: string) {
  const attempt = journal.begin({ kind: 'append', sessionId, body: { lines: [inputLine] } }, [id(10)]);
  await expect(journal.run(attempt, () => Promise.reject(refusal))).rejects.toBe(refusal);
  return journal.read();
}

it('keeps the completed visit time when a later append is refused', async () => {
  const journal = open();
  await save(journal, id(12), instant);
  expect(await refuse(journal, id(12))).toEqual({ version: 1, state: 'PARTIAL', scope, sessionId: id(12), occurredAt: instant });
});

it('keeps only the latest visit time, so a refused append for the previous visit has no time', async () => {
  const journal = open();
  await save(journal, id(12), instant);
  await save(journal, id(15), '2026-10-14T09:00:00.000Z');
  expect(await refuse(journal, id(12))).toEqual({ version: 1, state: 'PARTIAL', scope, sessionId: id(12) });
});

it('drops the visit time once the visit is left, so the next refused append has no time', async () => {
  const journal = open();
  await save(journal, id(12), instant);
  expect(await refuse(journal, id(12))).toMatchObject({ occurredAt: instant });
  journal.leaveVisit();
  expect(await refuse(journal, id(12))).toEqual({ version: 1, state: 'PARTIAL', scope, sessionId: id(12) });
});

const retention = SESSION_ATTEMPT_RETENTION_MS + SESSION_ATTEMPT_SAFETY_MARGIN_MS;
function clocked() {
  let now = Date.parse(instant), next = 80;
  const journal = createSessionAttemptJournal(scope, { now: () => now, newId: () => id(next++) });
  journals.push(journal);
  return { journal, advance: () => { now += retention; } };
}
async function expire(kind: 'record' | 'append' = 'record') {
  const box = clocked();
  const command = kind === 'record'
    ? { kind: 'record' as const, body: { customer_id: id(7), lines: [inputLine] } }
    : { kind: 'append' as const, sessionId: id(12), body: { lines: [inputLine] } };
  const attempt = box.journal.begin(command, [id(9)]);
  await expect(box.journal.run(attempt, () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
  box.advance();
  const entry = box.journal.read();
  if (entry?.state !== 'EXPIRED') throw new Error('expected EXPIRED');
  return { ...box, entry, attempt };
}

it.each(['record', 'append'] as const)('confirms only an EXPIRED entry for the same actor and scope as %s', async (kind) => {
  const pending = clocked();
  const command = kind === 'record'
    ? { kind: 'record' as const, body: { customer_id: id(7), lines: [inputLine] } }
    : { kind: 'append' as const, sessionId: id(12), body: { lines: [inputLine] } };
  pending.journal.begin(command, [id(9)]);
  expect(() => pending.journal.confirm(kind === 'record' ? 'RECORDED_ELSEWHERE' : 'NOT_RECORDED')).toThrow('SESSION_ATTEMPT_UNAVAILABLE');
  expect(pending.journal.read()?.state).toBe('PENDING');
  pending.journal.changeScope(null);
  const { journal, entry } = await expire(kind);
  const proof = journal.confirm(kind === 'record' ? 'RECORDED_ELSEWHERE' : 'NOT_RECORDED');
  expect(proof.outcome).toBe(kind === 'record' ? 'RECORDED_ELSEWHERE' : 'NOT_RECORDED');
  expect(proof.operation).toBe(kind === 'record' ? 'record-service-session' : 'append-service-session-lines');
  expect(proof.scope).toEqual(scope); expect(proof.key).toBe(entry.key); expect(journal.read()).toBeNull();
  expect(() => journal.confirm('NOT_RECORDED')).toThrow('SESSION_ATTEMPT_UNAVAILABLE');
});

it('refuses confirmation while the original send is still in flight', async () => {
  const box = clocked();
  const attempt = box.journal.begin({ kind: 'record', body: { customer_id: id(7), lines: [inputLine] } }, [id(9)]);
  let release: ((value: { status: number; data: ReturnType<typeof savedSession> }) => void) | undefined;
  const pending = box.journal.run(attempt, () => new Promise<{ status: number; data: ReturnType<typeof savedSession> }>((resolve) => { release = resolve; }));
  try {
    await Promise.resolve();
    expect(() => box.journal.confirm('NOT_RECORDED')).toThrow('SESSION_ATTEMPT_UNAVAILABLE');
    expect(box.journal.read()?.state).toBe('PENDING');
  } finally {
    release?.({ status: 201, data: savedSession(id(12), instant) });
    await pending;
  }
  expect(box.journal.read()).toBeNull();
});

it('keeps a partial visit when confirmation is refused', async () => {
  const journal = open();
  await save(journal, id(12), instant);
  expect(await refuse(journal, id(12))).toMatchObject({ state: 'PARTIAL', sessionId: id(12) });
  expect(() => journal.confirm('RECORDED_ELSEWHERE')).toThrow('SESSION_ATTEMPT_UNAVAILABLE');
  expect(journal.read()?.state).toBe('PARTIAL');
});

it('mints a new idempotency key after NOT_RECORDED and never resends the expired one', async () => {
  const { journal, entry } = await expire();
  journal.confirm('NOT_RECORDED');
  const again = journal.begin({ kind: 'record', body: { customer_id: id(7), lines: [inputLine] } }, [id(9)]);
  expect(again.key).not.toBe(entry.key);
  let sent: string | undefined;
  await journal.run(again, async () => { sent = again.key; return { status: 201, data: savedSession(id(12), instant) }; });
  expect(sent).toBe(again.key); expect(sent).not.toBe(entry.key);
});

it('clears an EXPIRED marker on logout and on a scope change', async () => {
  const loggedOut = await expire();
  loggedOut.journal.changeScope(null);
  expect(loggedOut.journal.read()).toBeNull();
  expect(() => loggedOut.journal.confirm('RECORDED_ELSEWHERE')).toThrow('SESSION_ATTEMPT_UNAVAILABLE');
  const moved = await expire();
  moved.journal.changeScope({ ...scope, userId: id(99) });
  expect(moved.journal.read()).toBeNull();
  expect(() => moved.journal.confirm('NOT_RECORDED')).toThrow('SESSION_ATTEMPT_UNAVAILABLE');
});

it('does not clear the marker when the confirm write fails', async () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const parsed = JSON.parse(value) as { envelope?: { state?: string } };
      if (parsed.envelope?.state === 'IDLE') throw new Error('full');
      memory.set(key, value);
    },
    removeItem: (key: string) => { memory.delete(key); },
  };
  let now = Date.parse(instant), next = 100;
  const journal = createSessionAttemptJournal(scope, { now: () => now, newId: () => id(next++) }, storage);
  journals.push(journal);
  const attempt = journal.begin({ kind: 'record', body: { customer_id: id(7), lines: [inputLine] } }, [id(9)]);
  await expect(journal.run(attempt, () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
  now += retention;
  expect(journal.read()?.state).toBe('EXPIRED');
  expect(() => journal.confirm('RECORDED_ELSEWHERE')).toThrow('SESSION_ATTEMPT_NOT_PERSISTED');
  expect(journal.read()?.state).toBe('EXPIRED');
});
