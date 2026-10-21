import { createDatabase, type Database, type Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { alertRulesQuery } from '../alert-rules.query.ts';

// CLAUDE.md §9: the alert-rules read has a result-shape test and an EXPLAIN ANALYZE assertion on a seeded dataset.
const { A } = TENANT;
let testDb: TestDatabase;
let db: Database;
const plans: string[] = [];

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

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`INSERT INTO "user" (id,name,email) VALUES (${USER},'Synthetic user','alert-plan@example.test')
      ON CONFLICT DO NOTHING`;
    // 200 other businesses of company A, each with six business rules and one branch overriding the same six.
    await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
      SELECT gen_random_uuid(), ${A.company}, 'retail', 'B' || n FROM generate_series(1, 200) AS n`;
    await owner`INSERT INTO branches (id, company_id, business_id, name_en)
      SELECT gen_random_uuid(), company_id, id, 'Branch' FROM businesses
      WHERE company_id = ${A.company} AND id <> ${A.business}`;
    await owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
        delay_minutes,lead_minutes,updated_by,revision)
      SELECT b.company_id, gen_random_uuid(), b.id, scope.branch_id, k.kind, true, ARRAY['owner']::text[],
        ARRAY['IN_APP']::text[], NULL, NULL, ${USER}, 1
      FROM businesses b
      CROSS JOIN unnest(ARRAY['ATTENDANCE_EXCEPTION','LATE_SERVICE_SESSION','SERVICE_LINE_EDITED',
        'SERVICE_LINE_CANCELLED','SERVICE_LINE_PERFORMERS_CHANGED','SHIFT_BREAK_RETURNED_OTHER_BRANCH']) AS k(kind)
      CROSS JOIN LATERAL (SELECT NULL::uuid AS branch_id UNION ALL
        SELECT r.id FROM branches r WHERE r.company_id = b.company_id AND r.business_id = b.id) AS scope
      WHERE b.company_id = ${A.company} AND b.id <> ${A.business}`;
    await owner`ANALYZE alert_rules`;
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.company } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

it('returns the stored rows only: no rule and a null master switch before anything is saved', async () => {
  const stored = await db.withTenant(A.company, (tx) =>
    alertRulesQuery(tx, A.company, A.business, A.branch),
  );
  expect(stored).toEqual({ alertsEnabled: null, rules: [] });
});

it('EXPLAIN ANALYZE: the rules read uses an alert_rules index, never a sequential scan', async () => {
  plans.length = 0;
  await db.withTenant(A.company, (tx) => alertRulesQuery(explain(tx), A.company, A.business, A.branch));
  const rulesPlan = plans.find((plan) => plan.includes('"Relation Name":"alert_rules"')) ?? '';
  expect(rulesPlan).toMatch(/alert_rules_(branch_fk_idx|business_kind_key|branch_kind_key)/);
  expect(rulesPlan).not.toContain('Seq Scan');
});

it('returns one row per stored rule, with its scope and its revision', async () => {
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
        delay_minutes,lead_minutes,updated_by,revision)
      VALUES (${A.company}, gen_random_uuid(), ${A.business}, NULL, 'SHIFT_NOT_CLOCKED_IN', true,
        ARRAY['owner']::text[], ARRAY['IN_APP']::text[], 20, NULL, ${USER}, 3)`;
  } finally {
    await owner.end();
  }
  const stored = await db.withTenant(A.company, (tx) =>
    alertRulesQuery(tx, A.company, A.business, A.branch),
  );
  expect(stored?.alertsEnabled).toBeNull();
  expect(stored?.rules).toEqual([
    {
      branchId: null,
      kind: 'SHIFT_NOT_CLOCKED_IN',
      enabled: true,
      recipientRoles: ['owner'],
      channels: ['IN_APP'],
      delayMinutes: 20,
      leadMinutes: null,
      revision: 3,
    },
  ]);
});

it("a business that is not the company's has no rules to return", async () => {
  const unknown = '01920000-0000-7000-8000-0000000000ff';
  const business = await db.withTenant(A.company, (tx) =>
    alertRulesQuery(tx, A.company, unknown, null),
  );
  expect(business).toBeNull();
  const branch = await db.withTenant(A.company, (tx) =>
    alertRulesQuery(tx, A.company, unknown, A.branch),
  );
  expect(branch).toBeNull();
});
