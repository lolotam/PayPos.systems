import { beforeAll, afterAll, expect, it } from 'vitest';
import { TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  countSessionsSince,
  latestSessionWatermark,
  listSessionsSince,
  type BootstrapRangeRead,
  type BootstrapSessionRead,
} from '../queries/day-sessions-since.query.ts';
import { daySessionsFixture, type DaySessionsFixture } from './day-sessions.fixture.ts';

let f: DaySessionsFixture;
beforeAll(async () => {
  f = await daySessionsFixture();
});
afterAll(async () => {
  await f?.close();
});

it('pages the frozen range in id order and never repeats a session', async () => {
  const day = '2026-06-01';
  const sessions = await createSessions(day, 7);
  const range = rangeOf(day, lastOf(sessions));
  const pages: string[][] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await read(range, cursor, 3);
    if (page.length === 0) break;
    pages.push(page.map((session) => session.sessionId));
    cursor = page.at(-1)?.sessionId ?? null;
    if (page.length < 3) break;
  }
  expect(pages.map((page) => page.length)).toEqual([3, 3, 1]);
  expect(pages.flat()).toEqual(sessions);
});

it('resumes from a checkpoint and reads only the sessions after it', async () => {
  const day = '2026-06-02';
  const sessions = await createSessions(day, 5);
  const range = rangeOf(day, lastOf(sessions));
  const checkpoint = sessions[2];
  if (checkpoint === undefined) throw new Error('CHECKPOINT_MISSING');
  const rest = await read(range, checkpoint, 3);
  expect(rest.map((session) => session.sessionId)).toEqual(sessions.slice(3));
});

it('leaves out sessions outside the frozen range but retains cancelled sessions', async () => {
  const day = '2026-06-03';
  const older = await createSession('2026-05-01');
  const inside = await createSession(day);
  const recorded = await f.session({ occurredAt: instant(day), recordedAt: instant('2026-07-01') });
  const cancelled = await createSession(day);
  await f.cancelLine(cancelled.lineId);
  const range = rangeOf(
    day,
    lastOf([older.sessionId, inside.sessionId, recorded.sessionId, cancelled.sessionId]),
  );
  await createSession(day);
  const sessions = await read(range, null, 10);
  expect(sessions.map((session) => session.sessionId)).toEqual([
    inside.sessionId,
    cancelled.sessionId,
  ]);
  expect(await count(range)).toBe(2);
});

it('counts the sessions the pages return and the ones already done', async () => {
  const day = '2026-06-04';
  const sessions = await createSessions(day, 4);
  const range = rangeOf(day, lastOf(sessions));
  expect(await count(range)).toBe((await readAll(range)).length);
  const checkpoint = sessions[1];
  if (checkpoint === undefined) throw new Error('CHECKPOINT_MISSING');
  expect(await count({ ...range, maxSessionId: checkpoint })).toBe(2);
});

it('refuses a bad limit, a bad cursor and a company that is not the transaction tenant', async () => {
  const range = rangeOf('2026-06-06', f.ids.newId());
  await expect(read(range, null, 0)).rejects.toThrow('DAY_SESSIONS_LIMIT_INVALID');
  await expect(read(range, null, 201)).rejects.toThrow('DAY_SESSIONS_LIMIT_INVALID');
  await expect(read(range, null, 1.5)).rejects.toThrow('DAY_SESSIONS_LIMIT_INVALID');
  await expect(read(range, 'not-a-uuid', 10)).rejects.toThrow('DAY_SESSIONS_CURSOR_INVALID');
  await expect(read({ ...range, maxSessionId: 'not-a-uuid' }, null, 10)).rejects.toThrow(
    'DAY_SESSIONS_CURSOR_INVALID',
  );
  await expect(
    f.db.withTenant(f.tenant.company, (tx) =>
      listSessionsSince(tx, TENANT.B.company, range, null, 10),
    ),
  ).rejects.toThrow('DAY_SESSIONS_TENANT_MISMATCH');
  await expect(
    f.db.withTenant(f.tenant.company, (tx) => countSessionsSince(tx, TENANT.B.company, range)),
  ).rejects.toThrow('DAY_SESSIONS_TENANT_MISMATCH');
  await expect(
    f.db.withTenant(f.tenant.company, (tx) => latestSessionWatermark(tx, TENANT.B.company)),
  ).rejects.toThrow('DAY_SESSIONS_TENANT_MISMATCH');
});

it('never shows the sessions of another company', async () => {
  const day = '2026-06-05';
  const foreign = await f.session({
    occurredAt: instant(day),
    recordedAt: instant(day, 10),
    company: TENANT.B.company,
  });
  const mine = await createSession(day);
  const range = rangeOf(day, mine.sessionId);
  const sessions = await read(range, null, 10);
  expect(sessions.map((session) => session.sessionId)).toEqual([mine.sessionId]);
  expect(await count(range)).toBe(1);
  const theirs = await f.db.withTenant(TENANT.B.company, (tx) =>
    listSessionsSince(tx, TENANT.B.company, range, null, 10),
  );
  expect(theirs.map((session) => session.sessionId)).toEqual([foreign.sessionId]);
});

it('reads the highest session id and reports no watermark for a company without sessions', async () => {
  const day = '2026-06-07';
  const sessions = await createSessions(day, 2);
  const watermark = await f.db.withTenant(f.tenant.company, (tx) =>
    latestSessionWatermark(tx, f.tenant.company),
  );
  expect(watermark).toBe(lastOf(sessions));
  const company = await f.addCompany();
  const empty = await f.db.withTenant(company.companyId, (tx) =>
    latestSessionWatermark(tx, company.companyId),
  );
  expect(empty).toBeNull();
});

function instant(day: string, hour = 9): Date {
  return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00.000Z`);
}

function rangeOf(day: string, maxSessionId: string): BootstrapRangeRead {
  return { cutoff: instant(day, 0), maxSessionId, recordedAtOrBefore: instant(day, 23) };
}

async function createSession(day: string): Promise<{ sessionId: string; lineId: string }> {
  return f.session({ occurredAt: instant(day), recordedAt: instant(day, 10) });
}

async function createSessions(day: string, count: number): Promise<string[]> {
  const sessions: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const session = await createSession(day);
    sessions.push(session.sessionId);
  }
  return sessions;
}

function lastOf(sessions: readonly string[]): string {
  const last = sessions.at(-1);
  if (last === undefined) throw new Error('SESSION_IDS_MISSING');
  return last;
}

function read(range: BootstrapRangeRead, cursor: string | null, limit: number) {
  return f.db.withTenant(f.tenant.company, (tx) =>
    listSessionsSince(tx, f.tenant.company, range, cursor, limit),
  );
}

async function readAll(range: BootstrapRangeRead): Promise<BootstrapSessionRead[]> {
  const sessions: BootstrapSessionRead[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await read(range, cursor, 50);
    sessions.push(...page);
    const last = page.at(-1);
    if (last === undefined) break;
    cursor = last.sessionId;
    if (page.length < 50) break;
  }
  return sessions;
}

function count(range: BootstrapRangeRead): Promise<number> {
  return f.db.withTenant(f.tenant.company, (tx) => countSessionsSince(tx, f.tenant.company, range));
}
