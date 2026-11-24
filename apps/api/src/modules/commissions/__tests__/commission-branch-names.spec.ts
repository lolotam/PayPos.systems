import { createDatabase } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  commissionBranchNamesStatement,
  readCommissionBranchNames,
} from '../../../../test/harness.ts';
import {
  estimateFixture,
  ids,
  type EstimateFixture,
} from './commission-estimate.fixture.ts';

let f: EstimateFixture;
let db: ReturnType<typeof createDatabase>;

beforeAll(async () => {
  f = await estimateFixture();
  db = createDatabase({ url: f.h.urls.app, ids });
  // فروع كتير في الشركة، علشان الخطة تتفحص على جدول فيه أكتر من فرع نشاط الهدف.
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    SELECT ${f.company},gen_random_uuid(),${f.business},'Bulk branch '||n FROM generate_series(1, 200) n`;
  await f.h.owner`ANALYZE branches`;
});

afterAll(async () => {
  await db?.close();
  await f?.h.close();
});

it('returns the name of every requested branch and leaves out an id with no row', async () => {
  const unknown = ids.newId();
  const names = await db.withTenant(f.company, (tx) =>
    readCommissionBranchNames(tx, f.company, f.business, [f.branch, f.secondBranch, unknown]),
  );

  expect(names.get(f.branch)).toEqual({ nameAr: null, nameEn: 'Estimate branch' });
  expect(names.get(f.secondBranch)).toEqual({ nameAr: null, nameEn: 'Estimate second branch' });
  expect(names.has(unknown)).toBe(false);
});

it('reads only the branches of the requested business', async () => {
  const other = ids.newId();
  await f.h.owner`INSERT INTO businesses(company_id,id,vertical_type,name_en)
    VALUES (${f.company},${other},'salon','Second business for the names proof')`;
  const names = await db.withTenant(f.company, (tx) =>
    readCommissionBranchNames(tx, f.company, other, [f.branch]),
  );

  expect(names.size).toBe(0);
});

it('the lookup plan reads the branches through an index, binding the id list once', async () => {
  const statement = commissionBranchNamesStatement(f.company, f.business, [f.branch, f.secondBranch]);
  await db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const [row] = await tx.execute<{ 'QUERY PLAN': unknown }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`,
    );
    const text = JSON.stringify(row?.['QUERY PLAN']);
    expect(text).toMatch(/branches_/);
    expect(text).not.toContain('"Node Type":"Seq Scan"');
    expect(text).not.toContain('"Node Type":"Sort"');
  });
});
