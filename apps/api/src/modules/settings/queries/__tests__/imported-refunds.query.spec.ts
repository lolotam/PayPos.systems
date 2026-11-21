import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  permissionFixture,
  type PermissionFixture,
} from '../../../../../test/permissions-fixture.ts';
import { importedRefundsQuery } from '../imported-refunds.query.ts';

let f: PermissionFixture;

beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('the query returns the stored value and off for a missing row without creating one', async () => {
  await f.h.owner`DELETE FROM business_settings WHERE company_id = ${f.company}
    AND business_id = ${f.business}`;
  expect(
    await f.db.withTenant(f.company, (tx) => importedRefundsQuery(tx, f.company, f.business)),
  ).toEqual({ imported_refunds_enabled: false });
  expect(
    await f.h.owner`SELECT count(*)::int AS rows FROM business_settings
      WHERE company_id = ${f.company} AND business_id = ${f.business}`,
  ).toEqual([{ rows: 0 }]);
  await f.h.owner`INSERT INTO business_settings (company_id, business_id, imported_refunds_enabled)
    VALUES (${f.company}, ${f.business}, true)`;
  expect(
    await f.db.withTenant(f.company, (tx) => importedRefundsQuery(tx, f.company, f.business)),
  ).toEqual({ imported_refunds_enabled: true });
});

it('EXPLAIN ANALYZE: one primary-key lookup, never a sequential scan', async () => {
  const plans: string[] = [];
  const explaining = (tx: Tx): Tx =>
    new Proxy(tx, {
      get: (target, property, receiver) =>
        property === 'execute'
          ? async (query: SQL) => {
              const [row] = await target.execute<{ plan: unknown }>(
                sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`,
              );
              plans.push(JSON.stringify(row));
              return target.execute(query);
            }
          : Reflect.get(target, property, receiver),
    });
  await f.db.withTenant(f.company, (tx) =>
    importedRefundsQuery(explaining(tx), f.company, f.business),
  );
  const plan = plans.at(-1) ?? '';
  expect(plan).toContain('business_settings_pkey');
  expect(plan).not.toContain('Seq Scan');
});
