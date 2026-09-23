import { businessSettings as settingsSchema } from '@pospay/contracts';
import { createDatabase, type Database, type TenantWrappers, type Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { businessSettingsQuery, type SettingsReadCache } from '../business-settings.query.ts';

// CLAUDE.md §9: the settings read has a result-shape test and an EXPLAIN ANALYZE assertion on a seeded dataset.
const { A, B } = TENANT;
const access = { companyId: A.company, userId: USER };
const TEMPLATE = { defaultLanguage: 'ar', calendar: 'gregorian' };
const noCache: SettingsReadCache = {
  read: async () => ({ generation: '0', json: null }),
  fill: async () => undefined,
};

let testDb: TestDatabase;
let db: Database;
const plans: string[] = [];

function explaining(database: Database): TenantWrappers {
  const explain = (tx: Tx): Tx =>
    new Proxy(tx, {
      get: (target, property, receiver) =>
        property === 'execute'
          ? async (query: SQL) => {
              const [row] = await target.execute<{ plan: unknown }>(
                sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`,
              );
              plans.push(JSON.stringify(Object.values(row ?? {})[0]));
              return target.execute(query);
            }
          : Reflect.get(target, property, receiver),
    });
  return {
    withUser: (userId, fn) => database.withUser(userId, (tx) => fn(explain(tx))),
    withNewTenant: (userId, fn) => database.withNewTenant(userId, (tx, id) => fn(explain(tx), id)),
    withTenant: (companyId, fn, options) =>
      database.withTenant(companyId, (tx) => fn(explain(tx)), options),
  };
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    // A realistic spread: 40 companies × 50 businesses, each with a settings row.
    await owner`
      INSERT INTO companies (id, name_en, owner_user_id, plan_id)
      SELECT gen_random_uuid(), 'Bulk ' || n, ${USER}, (SELECT id FROM plans LIMIT 1)
      FROM generate_series(1, 40) AS n`;
    await owner`
      INSERT INTO businesses (id, company_id, vertical_type, name_en)
      SELECT gen_random_uuid(), c.id, 'retail', 'B' || n
      FROM companies c CROSS JOIN generate_series(1, 50) AS n`;
    await owner`
      INSERT INTO business_settings (company_id, business_id, calendar)
      SELECT company_id, id, 'hijri' FROM businesses WHERE id <> ${A.business}`;
    await owner`ANALYZE business_settings`;
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.company } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

describe('business-settings.query', () => {
  it('a business with no row gets the template in the BusinessSettings shape', async () => {
    const read = await businessSettingsQuery(db, noCache, TEMPLATE, access, A.business);
    expect(settingsSchema.parse(read)).toEqual({
      business_id: A.business,
      default_language: 'ar',
      calendar: 'gregorian',
      tax_rule: null,
      overridden: [],
      updated_at: null,
    });
  });

  it("another company's settings are invisible: its business reads as the template", async () => {
    const read = await businessSettingsQuery(db, noCache, TEMPLATE, access, B.business);
    expect(read).toMatchObject({ calendar: 'gregorian', overridden: [] });
  });

  it('EXPLAIN ANALYZE: one primary-key lookup, never a sequential scan', async () => {
    plans.length = 0;
    await businessSettingsQuery(explaining(db), noCache, TEMPLATE, access, A.business);
    const plan = plans.at(-1) ?? '';
    expect(plan).toContain('business_settings_pkey');
    expect(plan).not.toContain('Seq Scan');
  });
});
