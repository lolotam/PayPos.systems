import { type WorkspaceCompanyNames } from '@pospay/contracts';
import {
  createDatabase,
  OWNER_ROLE_ID,
  type Database,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { myWorkspaces, type WorkspaceNames } from '../my-workspaces.query.ts';

const { A, B } = TENANT;
const LOGO_FILE = '01920000-0000-7000-8000-0000000000f2';
const USER = '01920000-0000-7000-8000-0000000000e1';

const plans: string[] = [];

const businesses: WorkspaceCompanyNames['businesses'] = [
  {
    id: A.business,
    name_ar: null,
    name_en: 'Business A',
    business_type: 'retail',
    country: 'KW',
    branches: [],
  },
  {
    id: B.business,
    name_ar: null,
    name_en: 'Business B',
    business_type: 'retail',
    country: 'KW',
    branches: [],
  },
];

const names: WorkspaceNames = {
  describe: async (tx) => {
    const [row] = Array.from(
      await tx.execute<{ id: string | null }>(sql`SELECT app_company_id() AS id`),
    );
    if (row?.id == null) throw new Error('workspace names were read outside withTenant');
    return { id: row.id, name_ar: null, name_en: 'Company', businesses: [...businesses] };
  },
};

let testDb: TestDatabase;
let db: Database;

/** بيشرح جملة الاستعلام ويسجّل الخطة، زي ما اختبار مساحة العمل الأصلي بيعمل. */
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

async function seed(owner: postgres.Sql): Promise<void> {
  await owner`INSERT INTO "user" (id, name, email) VALUES (${USER}, 'U', 'logo@example.test')`;
  await owner`
    INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at)
    VALUES (${A.company}, gen_random_uuid(), ${USER}, ${OWNER_ROLE_ID}, 'global', 'COMPANY', ${A.company},
            '2024-01-01T00:00:00Z'::timestamptz)`;
  await owner`
    INSERT INTO file_objects (
      company_id, id, business_id, owner_module, owner_entity_id, staging_key, storage_key,
      content_type, size_bytes, required_permission, created_by, created_at, status
    ) VALUES (
      ${A.company}, ${LOGO_FILE}, ${A.business}, 'settings', ${A.business}, ${'staging-logo'},
      ${'verified-logo'}, 'image/png', 10, 'manage:business-identity:business', ${USER},
      now(), 'READY'
    )`;
  await owner`
    INSERT INTO business_settings (company_id, business_id, logo_file_id)
    VALUES (${A.company}, ${A.business}, ${LOGO_FILE})`;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await seed(owner);
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.company } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

describe('myWorkspaces business logo reference (079 TQ-1)', () => {
  it('carries the bound logo and leaves a business without one untouched', async () => {
    const body = await myWorkspaces(db, names, USER);
    expect(body.companies[0]?.businesses[0]?.logo_file_id).toBe(LOGO_FILE);
    expect(body.companies[0]?.businesses[1]?.logo_file_id).toBeUndefined();
    expect(Object.keys(body.companies[0]?.businesses[1] ?? {})).not.toContain('logo_file_id');
  });

  it('EXPLAIN ANALYZE reads the logos through an index and never scans the table', async () => {
    plans.length = 0;
    await myWorkspaces(explaining(db), names, USER);
    const plan = plans.find((entry) => entry.includes('business_settings')) ?? '';
    expect(plan).toContain('Index Scan');
    expect(plan).toMatch(/business_settings_(pkey|logo_file_key)/);
    expect(plan).not.toContain('Seq Scan on business_settings');
  });
});
