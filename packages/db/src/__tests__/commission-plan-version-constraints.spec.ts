import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  OTHER_COMMISSION_IDS,
} from '../../test/commission-statement-fixtures.ts';
import {
  insertCommissionPlanVersion,
  seedCommissionPlanVersionTenants,
} from '../../test/commission-plan-version-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let db: Database;
const ids = systemUuidV7();
const tenant = COMMISSION_TENANT.A;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionPlanVersionTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await testDb?.drop();
});

const insert = (row: Record<string, unknown> = {}) =>
  db.withTenant(tenant.company, (tx) => insertCommissionPlanVersion(tx, tenant, ids, row));

it('refuses a duplicate employee version', async () => {
  await insert();
  await expectPgError(insert(), '23505', 'commission_plan_versions_version_key');
});

it('refuses version zero', async () => {
  await expectPgError(insert({ version: 0 }), '23514', 'commission_plan_versions_version');
});

it('refuses whole_period together with repair_period', async () => {
  await expectPgError(
    insert({ wholePeriod: true, repairPeriod: '2026-10' }),
    '23514',
    'commission_plan_versions_whole_or_repair',
  );
});

it.each(['2026-13', '0000-01'])('refuses bad repair_period %s', async (repairPeriod) => {
  await expectPgError(insert({ repairPeriod }), '23514', 'commission_plan_versions_repair_period');
});

it('refuses a JSON array plan', async () => {
  await expectPgError(insert({ plan: [] }), '23514', 'commission_plan_versions_plan_object');
});

it('refuses an employee of another business through the composite FK', async () => {
  await expectPgError(
    insert({ employeeId: OTHER_COMMISSION_IDS.employee }),
    '23503',
    'commission_plan_versions_employee_fk',
  );
});

it('inserts a valid plan version', async () => {
  await insert({ version: 2, repairPeriod: '2026-10' });
  const rows = await db.withTenant(tenant.company, (tx) =>
    tx.execute<{ version: number; repair_period: string }>(
      sql`SELECT version,repair_period FROM commission_plan_versions WHERE version=2`,
    ),
  );
  expect(rows).toEqual([{ version: 2, repair_period: '2026-10' }]);
});
