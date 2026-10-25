import type { Tx } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { listCurrentSessionTips, type CurrentSessionTipEntry,
  type CurrentSessionTipsPageRequest, type CurrentSessionTipsRange } from '../queries/session-tips-bootstrap.query.ts';
import { ids, must, pairLine, recordVisit, recordVisitAt, runTips, tip, tipFixture, tipInput, tipRows,
  type TipFixture } from '../../../../test/session-tips.fixture.ts';

let f: TipFixture;
const RANGE = { from: '2026-10-01', to: '2026-10-31' };
const ALL = { after: null, limit: 200 };
const EMPTY = { items: [], next_cursor: null };

beforeAll(async () => { f = await tipFixture(); });
afterAll(async () => { await f?.close(); });

function read(companyId = f.company, businessId = f.business, range = RANGE, page = ALL) {
  return f.db.withTenant(companyId, (tx) => listCurrentSessionTips(tx, companyId, businessId, range, page));
}
function byEntry(left: CurrentSessionTipEntry, right: CurrentSessionTipEntry) {
  const employee = left.employee_id < right.employee_id ? -1 : left.employee_id > right.employee_id ? 1 : 0;
  return employee !== 0 ? employee : left.method < right.method ? -1 : left.method > right.method ? 1 : 0;
}
async function readItem(sessionId: string) {
  return must((await read()).items.find((item) => item.session_id === sessionId));
}

it('returns exactly the current session shape with canonical sorted entries and no private fields', async () => {
  const visit = await recordVisit(f, [pairLine(f)]);
  const sent = [tip(f, 0, 'CASH', '1.500'), tip(f, 0, 'CARD', '2.250'), tip(f, 1, 'CASH', '3.000')];
  await runTips(f, visit.sessionId, tipInput(sent));
  const revision = must((await tipRows(f, visit.sessionId)).revisions[0]);
  const result = await read();
  expect(result.next_cursor).toBeNull();
  const item = await readItem(visit.sessionId);
  expect(item).toEqual({ session_id: visit.sessionId, business_date: '2026-10-14', revision: 1,
    tips: [...sent].sort(byEntry), event_ids: [revision.event_id] });
  expect(Object.keys(item).sort()).toEqual(['business_date', 'event_ids', 'revision', 'session_id', 'tips']);
  expect(item.tips[0]?.amount).toMatch(/^\d+\.\d{3}$/);
  expect(JSON.stringify(item)).not.toMatch(/phone|customer|reason/i);
});

it('returns only revision three entries with every event id in revision order', async () => {
  const visit = await recordVisit(f, [pairLine(f)]);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CARD', '2.000')], { expected_revision: 1, reason: 'second set' }));
  const latest = [tip(f, 0, 'CARD', '3.000'), tip(f, 1, 'CASH', '4.000')];
  await runTips(f, visit.sessionId, tipInput(latest, { expected_revision: 2, reason: 'third set' }));
  const rows = await tipRows(f, visit.sessionId);
  const item = await readItem(visit.sessionId);
  expect(item.revision).toBe(3);
  expect(item.tips).toEqual([...latest].sort(byEntry));
  expect(item.event_ids).toEqual(rows.revisions.map((row) => row.event_id));
});

it('returns a cleared latest set as an empty entry list with both event ids', async () => {
  const visit = await recordVisit(f);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.500')]));
  await runTips(f, visit.sessionId, tipInput([], { expected_revision: 1, reason: 'cleared by reception' }));
  const rows = await tipRows(f, visit.sessionId);
  const item = await readItem(visit.sessionId);
  expect(item).toMatchObject({ session_id: visit.sessionId, revision: 2, tips: [] });
  expect(item.event_ids).toEqual(rows.revisions.map((row) => row.event_id));
});

it('excludes untipped and out-of-range visits while including both range bounds', async () => {
  const range = { from: '2026-10-01', to: '2026-10-10' };
  const noTip = await recordVisitAt(f, '2026-10-05T08:00:00.000Z');
  const outside = await recordVisitAt(f, '2026-09-30T08:00:00.000Z');
  await runTips(f, outside.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
  const lower = await recordVisitAt(f, '2026-10-01T08:00:00.000Z');
  const upper = await recordVisitAt(f, '2026-10-10T08:00:00.000Z');
  for (const visit of [lower, upper]) await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CARD', '2.000')]));
  const result = await read(f.company, f.business, range);
  expect(result.items.map((item) => item.session_id)).toEqual([lower.sessionId, upper.sessionId].sort());
  expect(must(result.items.find((item) => item.session_id === lower.sessionId)).business_date).toBe(range.from);
  expect(must(result.items.find((item) => item.session_id === upper.sessionId)).business_date).toBe(range.to);
  expect(result.items.map((item) => item.session_id)).not.toContain(noTip.sessionId);
  expect(result.items.map((item) => item.session_id)).not.toContain(outside.sessionId);
});

type InvalidCase = {
  code: string;
  companyId?: string;
  businessId?: string;
  range?: CurrentSessionTipsRange;
  page?: CurrentSessionTipsPageRequest;
};
const invalidCases: InvalidCase[] = [
  { code: 'SESSION_TIPS_BOOTSTRAP_RANGE_INVALID', range: { from: '2026-02-30', to: '2026-10-31' } },
  { code: 'SESSION_TIPS_BOOTSTRAP_RANGE_INVALID', range: { from: '2026-1-1', to: '2026-10-31' } },
  { code: 'SESSION_TIPS_BOOTSTRAP_RANGE_INVALID', range: { from: '', to: '2026-10-31' } },
  { code: 'SESSION_TIPS_BOOTSTRAP_RANGE_INVALID', range: { from: '2026-11-01', to: '2026-10-31' } },
  { code: 'SESSION_TIPS_BOOTSTRAP_LIMIT_INVALID', page: { after: null, limit: 0 } },
  { code: 'SESSION_TIPS_BOOTSTRAP_LIMIT_INVALID', page: { after: null, limit: 201 } },
  { code: 'SESSION_TIPS_BOOTSTRAP_LIMIT_INVALID', page: { after: null, limit: 1.5 } },
  { code: 'SESSION_TIPS_BOOTSTRAP_CURSOR_INVALID', page: { after: 'not-a-uuid', limit: 10 } },
  { code: 'SESSION_TIPS_BOOTSTRAP_SCOPE_INVALID', companyId: 'bad' },
  { code: 'SESSION_TIPS_BOOTSTRAP_SCOPE_INVALID', businessId: 'bad' },
];

it.each(invalidCases)('rejects $code before touching the database', async (invalid) => {
  let queried = false;
  const tx = { execute: async () => { queried = true; return []; } } as unknown as Tx;
  const error = await listCurrentSessionTips(tx, invalid.companyId ?? f.company, invalid.businessId ?? f.business,
    invalid.range ?? RANGE, invalid.page ?? ALL).then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(RangeError);
  expect((error as RangeError).message).toBe(invalid.code);
  expect(queried).toBe(false);
});

it('returns an empty page for another tenant, business, or mismatched company argument', async () => {
  const visit = await recordVisit(f);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.500')]));
  const other = ids.newId();
  expect(await f.db.withTenant(other, (tx) => listCurrentSessionTips(tx, other, f.business, RANGE, ALL))).toEqual(EMPTY);
  expect(await read(f.company, ids.newId())).toEqual(EMPTY);
  expect(await f.db.withTenant(f.company, (tx) => listCurrentSessionTips(tx, other, f.business, RANGE, ALL))).toEqual(EMPTY);
  expect((await read()).items.map((item) => item.session_id)).toContain(visit.sessionId);
});
