import { ratingSettings as ratingSettingsSchema } from '@pospay/contracts';
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
import { ratingSettingsQuery } from '../rating-settings.query.ts';

// CLAUDE.md §9: the read has a result-shape test and an EXPLAIN ANALYZE assertion on a seeded dataset.
const { A, B } = TENANT;

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
    withMember: (userId, companyId, fn) =>
      database.withMember(userId, companyId, (tx) => fn(explain(tx))),
    withTenant: (companyId, fn, options) =>
      database.withTenant(companyId, (tx) => fn(explain(tx)), options),
  };
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`INSERT INTO "user"(id,name,email) VALUES(${USER},'Synthetic operator','operator@example.test')
      ON CONFLICT (id) DO NOTHING`;
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
      INSERT INTO rating_settings (company_id, id, business_id, requests_enabled, updated_by, updated_at, revision)
      SELECT company_id, gen_random_uuid(), id, true, ${USER}, now(), 1
      FROM businesses WHERE id <> ${A.business}`;
    await owner`ANALYZE rating_settings`;
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.company } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

describe('rating-settings.query', () => {
  it('a business with no row reads as the shared off default', async () => {
    const read = await db.withTenant(A.company, (tx) =>
      ratingSettingsQuery(tx, A.company, A.business),
    );
    expect(ratingSettingsSchema.parse(read)).toEqual({ requests_enabled: false });
  });

  it("another company's row is invisible and reads as the off default", async () => {
    const read = await db.withTenant(A.company, (tx) =>
      ratingSettingsQuery(tx, A.company, B.business),
    );
    expect(read).toEqual({ requests_enabled: false });
  });

  it('a stored row reads its own value', async () => {
    const read = await db.withTenant(B.company, (tx) =>
      ratingSettingsQuery(tx, B.company, B.business),
    );
    expect(ratingSettingsSchema.parse(read)).toEqual({ requests_enabled: true });
  });

  it('EXPLAIN ANALYZE: one unique-key lookup, never a sequential scan', async () => {
    plans.length = 0;
    await explaining(db).withTenant(A.company, (tx) =>
      ratingSettingsQuery(tx, A.company, A.business),
    );
    const plan = plans.at(-1) ?? '';
    expect(plan).toContain('rating_settings_company_business_id_key');
    expect(plan).not.toContain('Seq Scan');
  });
});
