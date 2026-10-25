import { afterAll, beforeAll, expect, it } from 'vitest';
import { listCurrentSessionTips, type CurrentSessionTips } from '../queries/session-tips-bootstrap.query.ts';
import { must, pairLine, recordVisitAt, runTips, tip, tipFixture, tipInput, tipRows,
  type TipFixture } from '../../../../test/session-tips.fixture.ts';

let f: TipFixture;
beforeAll(async () => { f = await tipFixture(); });
afterAll(async () => { await f?.close(); });

function read(day: string, after: string | null = null, limit = 200) {
  return f.db.withTenant(f.company, (tx) => listCurrentSessionTips(tx, f.company, f.business,
    { from: `2026-10-${day}`, to: `2026-10-${day}` }, { after, limit }));
}
async function seed(day: string, count: number, severalEntries = false) {
  const visits: string[] = [];
  for (let index = 0; index < count; index++) {
    const visit = await recordVisitAt(f, `2026-10-${day}T08:00:00.000Z`, [pairLine(f)]);
    const entries = severalEntries
      ? [tip(f, 0, 'CASH', '1.500'), tip(f, 0, 'CARD', '2.000'), tip(f, 1, 'CASH', '3.000')]
      : [tip(f, 0, 'CASH', '1.000')];
    await runTips(f, visit.sessionId, tipInput(entries));
    visits.push(visit.sessionId);
  }
  return visits;
}
async function restOfPages(day: string, firstCursor: string) {
  const pages = [];
  let cursor: string | null = firstCursor;
  while (cursor !== null) {
    const page = await read(day, cursor, 2);
    pages.push(page);
    cursor = page.next_cursor;
  }
  return pages;
}
function idsOf(items: readonly CurrentSessionTips[]) {
  return items.map((item) => item.session_id);
}

it('pages sessions rather than entries and concatenates to the unpaged result', async () => {
  await seed('01', 5, true);
  const unpaged = await read('01');
  const first = await read('01', null, 2);
  const second = await read('01', first.next_cursor, 2);
  const third = await read('01', second.next_cursor, 2);
  const pages = [first, second, third];
  expect(pages.map((page) => page.items.length)).toEqual([2, 2, 1]);
  expect(pages.flatMap((page) => page.items)).toEqual(unpaged.items);
  expect(first.next_cursor).toBe(must(first.items.at(-1)).session_id);
  expect(second.next_cursor).toBe(must(second.items.at(-1)).session_id);
  expect(third.next_cursor).toBeNull();
  const ids = pages.flatMap((page) => idsOf(page.items));
  expect(new Set(ids).size).toBe(ids.length);
  expect(first.items.flatMap((item) => item.tips).length).toBeGreaterThan(first.items.length);
});

it('keeps the keyset stable across revisions and newly tipped visits', async () => {
  const oldIds = await seed('02', 5);
  const before = idsOf((await read('02')).items);
  expect(before).toEqual([...oldIds].sort());
  const first = await read('02', null, 2);
  const changed = must(first.items[0]);
  await runTips(f, changed.session_id, tipInput([tip(f, 0, 'CASH', '2.000')],
    { expected_revision: 1, reason: 'changed during bootstrap' }));
  const added = await recordVisitAt(f, '2026-10-02T09:00:00.000Z');
  await runTips(f, added.sessionId, tipInput([tip(f, 0, 'CARD', '3.000')]));
  const rest = await restOfPages('02', must(first.next_cursor));
  const seen = [first, ...rest].flatMap((page) => page.items);
  const seenIds = idsOf(seen);
  expect(new Set(seenIds).size).toBe(seenIds.length);
  for (const id of oldIds) expect(seenIds.filter((seenId) => seenId === id)).toHaveLength(1);
  expect(seenIds.filter((id) => id === added.sessionId).length).toBeLessThanOrEqual(1);
  if (added.sessionId > must(first.next_cursor)) {
    expect(must(seen.find((item) => item.session_id === added.sessionId)).tips)
      .toEqual([{ employee_id: must(f.employees[0]), method: 'CARD', amount: '3.000' }]);
  }
  const current = must((await read('02')).items.find((item) => item.session_id === changed.session_id));
  expect(current.revision).toBe(2);
  expect(current.event_ids).toHaveLength(2);
});

it('never tears a revision from its event ids or entries during interleaved writes', async () => {
  const [sessionId] = await seed('03', 1);
  const id = must(sessionId);
  const readLoop = async () => {
    for (let iteration = 0; iteration < 6; iteration++) {
      const item = must((await read('03')).items[0]);
      expect(item.event_ids.length).toBe(item.revision);
      expect(item.tips).toEqual([{ employee_id: must(f.employees[0]), method: 'CASH', amount: `${item.revision}.000` }]);
    }
  };
  const writeLoop = async () => {
    for (let revision = 2; revision <= 6; revision++) {
      await runTips(f, id, tipInput([tip(f, 0, 'CASH', `${revision}.000`)],
        { expected_revision: revision - 1, reason: `revision ${revision}` }));
    }
  };
  await Promise.all([readLoop(), writeLoop()]);
  const final = must((await read('03')).items[0]);
  expect(final.revision).toBe(6);
  expect(final.event_ids).toEqual((await tipRows(f, id)).revisions.map((row) => row.event_id));
});
