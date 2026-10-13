import { afterAll, beforeAll, expect, it } from 'vitest';
import { sessionServiceOptionPage, type SessionServiceOptionsQuery } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { readSessionServiceOptions } from '../index.ts';
import { sessionServiceOptionsStatement } from '../queries/session-service-options.query.ts';
import { must, sessionFixture, type SessionFixture } from '../../../../test/service-session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => {
  f = await sessionFixture();
  for (const [i, name] of ['محمد', 'مُحمد', 'محمود', null].entries())
    await f.h.owner`UPDATE services SET name_ar=${name},name_en=${must(['Zulu', 'ÉCLAIR %_\\', 'Éclair plain', 'Alpha'][i])}
      WHERE company_id=${f.company} AND id=${must(f.services[i])}`;
});
afterAll(async () => { await f?.close(); });
const read = (query: SessionServiceOptionsQuery) => f.db.withTenant(f.company, (tx) =>
  readSessionServiceOptions(tx, f.company, f.business, f.branch, query));

it('uses ICU Arabic/English global name order, nullable fallback and exact cursor round trips', async () => {
  for (const lang of ['ar', 'en'] as const) {
    const found: string[] = []; let cursor: string | undefined;
    for (let i = 0; i < 4; i++) {
      const page = await read({ lang, limit: 1, ...(cursor === undefined ? {} : { cursor }) });
      expect(page).toEqual(sessionServiceOptionPage.parse(page));
      found.push(...page.items.map((r) => r.id)); cursor = page.next_cursor ?? undefined;
      expect(page.next_cursor === null).toBe(i === 3);
    }
    expect(found).toEqual(lang === 'ar' ? [f.services[3], ...f.services.slice(0, 3)]
      : [f.services[3], f.services[1], f.services[2], f.services[0]]);
  }
});
it('folds non-ASCII search on either name before paging and treats all LIKE wildcards literally', async () => {
  const first = await read({ lang: 'ar', q: 'éclair', limit: 1 });
  expect(first.items.map((r) => r.id)).toEqual([f.services[1]]);
  const last = await read({ lang: 'ar', q: 'ÉCLAIR', limit: 1, cursor: must(first.next_cursor) });
  expect(last.items.map((r) => r.id)).toEqual([f.services[2]]); expect(last.next_cursor).toBeNull();
  for (const q of ['%', '_', '\\', '%_\\'])
    expect((await read({ lang: 'en', q, limit: 20 })).items.map((r) => r.id)).toEqual([f.services[1]]);
  expect((await read({ lang: 'en', q: 'محمود', limit: 20 })).items.map((r) => r.id)).toEqual([f.services[2]]);
});
it('EXPLAIN ANALYZE uses the existing scope index for both languages, search and keyset SQL', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    for (const lang of ['ar', 'en'] as const) for (const cursor of [null, { key: 'Alpha', id: must(f.services[3]) }]) {
      const plan = JSON.stringify(await tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${sessionServiceOptionsStatement(
        f.company, f.business, { lang, q: 'éclair', limit: 2 }, cursor)}`));
      expect(plan).toContain('services_company_business_id_key'); expect(plan).not.toContain('Seq Scan');
    }
  });
});
