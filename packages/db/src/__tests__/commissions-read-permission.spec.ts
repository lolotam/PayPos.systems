import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, PERMISSIONS, SYSTEM_ROLES, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  seedCommissionStatementTenants,
} from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { USER } from '../../test/tenancy-fixtures.ts';

const PERMISSION = 'read:commissions:business';
const DEFAULT_ROLES = ['owner', 'general_manager', 'business_manager', 'accountant', 'branch_manager'];

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const { A } = COMMISSION_TENANT;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => crypto.randomUUID() } });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

it('registers the read permission in the catalog', () => {
  expect(PERMISSIONS).toContain(PERMISSION);
});

it('grants the read permission to the approved global roles', async () => {
  const rows = await owner`SELECT r.code, rp.permission_code
    FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE rp.role_owner_key = 'global' AND rp.permission_code = ${PERMISSION}
    ORDER BY r.code`;
  expect(rows.map((row) => row['code'])).toEqual([...DEFAULT_ROLES].sort());
});

it('never grants the read permission to the device role', async () => {
  const device = SYSTEM_ROLES.find((role) => role.code === 'device');
  const rows = await owner`SELECT 1 FROM role_permissions
    WHERE role_id = ${device?.id ?? ''}::uuid AND permission_code = ${PERMISSION}`;
  expect(rows).toHaveLength(0);
});

it('gives a membership created before the migration the default through the global role', async () => {
  // العضوية تشير للدور العالمي، فمنحة الأدوار الجديدة بتغطيها من غير خطوة بيانات.
  const [role] = await owner`SELECT id FROM roles
    WHERE company_id IS NULL AND code = 'branch_manager'`;
  const membershipId = crypto.randomUUID();
  await owner`INSERT INTO memberships(
    company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${A.company},${membershipId}::uuid,${USER}::uuid,${role?.['id']}::uuid,'global',
      'BRANCH',${A.branch}::uuid)`;
  const rows = await db.withTenant(A.company, (tx) =>
    tx.execute<{ permission_code: string }>(sql`SELECT rp.permission_code
      FROM memberships m JOIN role_permissions rp
        ON rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
      WHERE m.company_id = app_company_id() AND m.id = ${membershipId}::uuid
        AND rp.permission_code = ${PERMISSION}`),
  );
  expect(rows).toHaveLength(1);
});
