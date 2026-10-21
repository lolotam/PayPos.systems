import { afterAll, beforeAll, expect, it } from 'vitest';
import { AT, ids, must } from './session.fixture.ts';
import {
  changeQuiet,
  changeRows,
  performersFixture,
  performersInput,
  runChange,
  sessionStamp,
  visitAt,
  visitOf,
  type PerformersFixture,
} from './line-performers.helpers.ts';

let f: PerformersFixture;
beforeAll(async () => { f = await performersFixture(); });
afterAll(async () => { await f?.close(); });

it('PC-14 a session outside the recording window is refused and the clock is restored', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  f.setAt(new Date('2026-12-01T00:00:00.000Z'));
  try {
    const key = ids.newId();
    await expect(runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { key })).rejects.toThrow('SESSION_TIME_TOO_OLD');
    expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    f.setAt(AT);
  }
});

it('PC-14 the first day of the previous month is still inside the window', async () => {
  const visit = await visitAt(f, '2026-09-01T08:00:00.000Z');
  const line = must(visit.lines[0]).id;
  const result = await runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }));
  expect(result).toMatchObject({ line: { revision: 2 } });
});

it('PC-14 a stale revision is refused before the closed window', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  f.setAt(new Date('2026-12-01T00:00:00.000Z'));
  try {
    const error = await runChange(f, visit.sessionId, line, performersInput({ expected_revision: 2, performers: [{ employee_id: must(f.employees[1]) }] }))
      .then(() => null, (caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE', details: { current_revision: 1 } });
    expect(Object.keys((error as { details: object }).details)).toEqual(['current_revision']);
  } finally {
    f.setAt(AT);
  }
});

it('PC-15 partial: an in-window change writes only the change artifacts; an approved or paid month is not seedable yet', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const stamp = await sessionStamp(f, visit.sessionId);
  const before = await f.h.owner`SELECT event_type FROM outbox WHERE company_id=${f.company} AND aggregate_id=${visit.sessionId} ORDER BY event_type`;
  await runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }));
  const saved = await changeRows(f, visit.sessionId, line);
  expect(saved.headers).toHaveLength(1);
  expect(saved.audits).toHaveLength(1);
  expect(saved.events).toHaveLength(1);
  expect(await sessionStamp(f, visit.sessionId)).toBe(stamp);
  const after = await f.h.owner`SELECT event_type FROM outbox WHERE company_id=${f.company} AND aggregate_id=${visit.sessionId} AND event_type<>'ServiceSessionRecorded'`;
  expect(before.map((row) => row['event_type'])).not.toContain('ServiceLineChanged');
  expect(after.map((row) => row['event_type'])).toEqual(['ServiceLineChanged']);
});
