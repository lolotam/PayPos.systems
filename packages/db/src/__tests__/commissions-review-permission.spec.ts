import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
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

const PERMISSION = 'review:commissions:business';
const DEFAULT_ROLES = ['owner', 'general_manager', 'business_manager'];

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

it('registers the review permission in the catalog', () => {
  expect(PERMISSIONS).toContain(PERMISSION);
});

it('grants the review permission to the approved global roles', async () => {
  const rows = await owner`SELECT r.code, rp.permission_code
    FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE rp.role_owner_key = 'global' AND rp.permission_code = ${PERMISSION}
    ORDER BY r.code`;
  expect(rows.map((row) => row['code'])).toEqual([...DEFAULT_ROLES].sort());
});

it('never grants the review permission to the device role', async () => {
  const device = SYSTEM_ROLES.find((role) => role.code === 'device');
  const rows = await owner`SELECT 1 FROM role_permissions
    WHERE role_id = ${device?.id ?? ''}::uuid AND permission_code = ${PERMISSION}`;
  expect(rows).toHaveLength(0);
});

it('gives a membership created before the migration the default through the global role', async () => {
  // العضوية تشير للدور العالمي، فمنحة الأدوار الجديدة بتغطيها من غير خطوة بيانات.
  const [role] = await owner`SELECT id FROM roles
    WHERE company_id IS NULL AND code = 'business_manager'`;
  const membershipId = crypto.randomUUID();
  await owner`INSERT INTO memberships(
    company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${A.company},${membershipId}::uuid,${USER}::uuid,${role?.['id']}::uuid,'global',
      'COMPANY',${A.company}::uuid)`;
  const rows = await db.withTenant(A.company, (tx) =>
    tx.execute<{ permission_code: string }>(sql`SELECT rp.permission_code
      FROM memberships m JOIN role_permissions rp
        ON rp.role_id = m.role_id AND rp.role_owner_key = m.role_owner_key
      WHERE m.company_id = app_company_id() AND m.id = ${membershipId}::uuid
        AND rp.permission_code = ${PERMISSION}`),
  );
  expect(rows).toHaveLength(1);
});

it('upgrades a legacy company by applying the migration alone, with no reseed', async () => {
  // الحالة قبل الترحيل: الشركة والأدوار موجودة والمنحة لسه مش متزرعة.
  await owner`DELETE FROM role_permissions WHERE permission_code = ${PERMISSION}`;
  await owner`DELETE FROM permissions WHERE code = ${PERMISSION}`;
  const [viewer] = await owner`SELECT id FROM roles
    WHERE company_id IS NULL AND code = 'viewer'`;
  await owner`INSERT INTO memberships(
    company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${A.company},gen_random_uuid(),${USER}::uuid,${viewer?.['id']}::uuid,'global',
      'COMPANY',${A.company}::uuid)`;
  expect(await grantedRoles()).toEqual([]);

  // الترحيل وحده: نفس ملف الـ migration بيتطبق من غير seed تاني.
  for (const statement of migrationStatements()) {
    await owner.unsafe(statement);
  }

  expect(await grantedRoles()).toEqual([...DEFAULT_ROLES].sort());
  // الدور اللي مش من الافتراضات ما بياخدش المنحة من الترحيل.
  const viewerRows = await owner`SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE r.code = 'viewer' AND rp.permission_code = ${PERMISSION}`;
  expect(viewerRows).toHaveLength(0);
});

/** الأدوار العالمية اللي منحها الترحيل للصلاحية دي. */
async function grantedRoles(): Promise<readonly string[]> {
  const rows = await owner`SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE rp.role_owner_key = 'global' AND rp.permission_code = ${PERMISSION} ORDER BY r.code`;
  return rows.map((row) => row['code'] as string);
}

/** جمل ملف الـ migration كما هو، مقسومة على فواصل drizzle. */
function migrationStatements(): readonly string[] {
  const directory = resolve('migrations');
  const file = readdirSync(directory).find((name) => name.startsWith('0245_'));
  if (file === undefined) throw new Error('the review permission migration file is missing');
  return readFileSync(resolve(directory, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.replace(/^--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}
