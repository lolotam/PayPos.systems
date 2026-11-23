import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../client.ts';

let testDb: TestDatabase, owner: postgres.Sql, app: Database;
const ids = systemUuidV7();
const { A } = TENANT;
const CHECK = 'alert_rules_statement_roles';
const rolesLiteral = (roles: string[]) =>
  sql.raw(`ARRAY[${roles.map((role) => `'${role}'`).join(',')}]::text[]`);

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO "user" (id,name,email) VALUES (${USER},'Synthetic user','alerts-486-check@example.test')
    ON CONFLICT DO NOTHING`;
  app = createDatabase({ url: testDb.appUrl, ids, maxConnections: 1 });
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
  await testDb?.drop();
});

const insertAsApp = (kind: string, roles: string[], branch: string | null = null) =>
  app.withTenant(A.company, (tx) =>
    tx.execute(
      sql`INSERT INTO alert_rules(company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
        delay_minutes,lead_minutes,updated_by,revision)
        VALUES(${A.company},${ids.newId()},${A.business},${branch},${kind},true,${rolesLiteral(roles)},
        ARRAY['IN_APP']::text[],null,null,${USER},1)`,
    ),
  );

it('the migrated CHECK is validated and refuses branch_manager on both statement kinds', async () => {
  const [constraint] = await owner<{ convalidated: boolean }[]>`
    SELECT convalidated FROM pg_constraint WHERE conname = ${CHECK} AND conrelid = 'alert_rules'::regclass`;
  expect(constraint).toEqual({ convalidated: true });
  await expect(insertAsApp('STATEMENT_AWAITING_REVIEW', ['branch_manager'])).rejects.toMatchObject({
    cause: { constraint_name: CHECK },
  });
  await expect(
    insertAsApp('STATEMENT_AWAITING_APPROVAL', ['owner', 'branch_manager']),
  ).rejects.toMatchObject({ cause: { constraint_name: CHECK } });
});

it('the CHECK refuses a direct update that adds the role to a stored statement rule', async () => {
  await insertAsApp('STATEMENT_AWAITING_APPROVAL', ['owner']);
  await expect(
    app.withTenant(A.company, (tx) =>
      tx.execute(
        sql`UPDATE alert_rules SET recipient_roles = ARRAY['owner','branch_manager']::text[]
          WHERE company_id = ${A.company} AND kind = 'STATEMENT_AWAITING_APPROVAL'`,
      ),
    ),
  ).rejects.toMatchObject({ cause: { constraint_name: CHECK } });
});

it('still accepts the other roles on statement kinds and branch_manager on other kinds', async () => {
  await insertAsApp('STATEMENT_AWAITING_REVIEW', ['owner', 'general_manager', 'business_manager']);
  await insertAsApp('ATTENDANCE_EXCEPTION', ['owner', 'branch_manager']);
  const [row] = await owner<
    { count: string }[]
  >`SELECT count(*) FROM alert_rules WHERE company_id = ${A.company}`;
  expect(Number(row?.count)).toBeGreaterThanOrEqual(2);
});
