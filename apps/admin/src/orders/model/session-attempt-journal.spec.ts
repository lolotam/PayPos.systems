import { afterEach, expect, it } from 'vitest';
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
