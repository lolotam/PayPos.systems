import { readFileSync, writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sellablePackageTypesStatement } from '../queries/sellable-package-types.query.ts';
import { packageTypesFixture, type PackageFixture } from './package-types.fixture.ts';
let f: PackageFixture;
const ddl = readFileSync(
  new URL(
    '../../../../../../packages/db/migrations/0231_2026-11-18_active-packages-index.sql',
    import.meta.url,
  ),
  'utf8',
);

beforeAll(async () => {
  f = await packageTypesFixture();
  await f.h
    .owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days,selling_stopped_at)
    SELECT ${f.company}, ('01920000-0000-7000-8000-' || lpad(to_hex(n),12,'0'))::uuid,
      ${f.business}, 'Synthetic package ' || n, '1.000', 30,
      CASE WHEN n % 100 = 0 THEN NULL ELSE now() END
    FROM generate_series(1,20000) n`;
  await f.h.owner`ANALYZE package_types`;
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function statement(cursor?: string) {
  return sellablePackageTypesStatement(f.company, f.business, {
    limit: 20,
    ...(cursor === undefined ? {} : { cursor }),
  });
}

it('uses the partial index without stopped-row filtering or sorting for both cursor pages', async () => {
  expect(
    await f.h
      .owner`SELECT indisvalid, indisready FROM pg_index WHERE indexrelid='package_types_active_business_id_idx'::regclass`,
  ).toEqual([{ indisvalid: true, indisready: true }]);
  await f.h.owner`DROP INDEX CONCURRENTLY package_types_active_business_id_idx`;
  const cursors = [undefined, '01920000-0000-7000-8000-000000002710'];
  const explain = (cursor?: string) =>
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement(cursor)}`),
    );
  const before = [];
  for (const cursor of cursors) before.push(await explain(cursor));
  const evidence = [];
  await f.h.owner.unsafe(ddl);
  await f.h.owner`ANALYZE package_types`;
  for (const [page, cursor] of cursors.entries()) {
    const after = await explain(cursor);
    evidence.push({ page, before: before[page], after });
    const plan = JSON.stringify(after);
    expect(plan).toContain('package_types_active_business_id_idx');
    expect(plan).not.toContain('"Node Type":"Sort"');
    expect(plan).not.toContain('selling_stopped_at');
    const rows = await f.db.withTenant(f.company, (tx) => tx.execute(statement(cursor)));
    expect(rows).toHaveLength(21);
    expect(rows[0]).toMatchObject({ price: '1.000', validity_days: 30, revision: 1 });
    expect(rows.map((row) => row['id'])).toEqual(
      Array.from(
        { length: 21 },
        (_, n) =>
          `01920000-0000-7000-8000-${((cursor === undefined ? 0 : 10000) + (n + 1) * 100).toString(16).padStart(12, '0')}`,
      ),
    );
  }
  const output = process.env['POSPAY_INDEX_EXPLAIN_OUTPUT'];
  if (output !== undefined) writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
});
